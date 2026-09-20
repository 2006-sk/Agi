import { EventEmitter } from "node:events";
import WebSocket from "ws";

/**
 * Gradium speech client.
 *
 * Aditya's service reaches Gradium through Pipecat's `GradiumSTTService` /
 * `GradiumTTSService`. That whole stack cannot install on every machine (it
 * drags in Silero VAD and numba, neither of which has a wheel for Intel macOS),
 * and the Vapi bridge does not need any of it: Vapi already owns the transport,
 * the turn-taking and the VAD. So this talks to the same two Gradium
 * WebSocket endpoints directly, with the same protocol and the same key.
 *
 * Protocol, mirrored from `pipecat.services.gradium`:
 *
 *   STT  wss://api.gradium.ai/api/speech/asr
 *        -> {type: setup, model_name, input_format: "pcm_16000", json_config}
 *        <- {type: ready}
 *        -> {type: audio, audio: <base64 s16le mono>}
 *        <- {type: text, text: "<token>"}        (space-joined, incremental)
 *        -> {type: flush, flush_id}
 *        <- {type: flushed}                      (utterance is now final)
 *
 *   TTS  wss://api.gradium.ai/api/speech/tts
 *        -> {type: setup, output_format: "pcm", voice_id, client_req_id}
 *        <- {type: ready}
 *        -> {type: text, text, client_req_id}
 *        -> {type: end_of_stream, client_req_id}
 *        <- {type: audio, audio: <base64 s16le mono 48 kHz>}
 *        <- {type: end_of_stream}
 */

export const GRADIUM_STT_URL = "wss://api.gradium.ai/api/speech/asr";
export const GRADIUM_TTS_URL = "wss://api.gradium.ai/api/speech/tts";
/** Gradium always synthesises at 48 kHz; callers resample to what they need. */
export const GRADIUM_TTS_SAMPLE_RATE = 48000;

function headers(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, "x-api-source": "echo-gateway" };
}

/* ------------------------------------------------------------------ */
/* Audio helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resample signed 16-bit mono PCM.
 *
 * Integer ratios (48k->24k, 48k->16k) average whole groups of samples, which
 * is a cheap low-pass and avoids the aliasing you get from plain decimation.
 * Anything else falls back to linear interpolation.
 */
export function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate || input.length < 2) return input;
  const samples = new Int16Array(input.buffer, input.byteOffset, Math.floor(input.length / 2));

  if (fromRate % toRate === 0) {
    const factor = fromRate / toRate;
    const out = new Int16Array(Math.floor(samples.length / factor));
    for (let i = 0; i < out.length; i++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) sum += samples[i * factor + j] ?? 0;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / factor)));
    }
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  }

  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const frac = pos - left;
    const a = samples[left] ?? 0;
    const b = samples[left + 1] ?? a;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac)));
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Pull one channel out of interleaved PCM.
 *
 * Vapi's transcriber stream is stereo: channel 0 is the caller, channel 1 is
 * the assistant. Only the caller should reach the recogniser, or ECHO ends up
 * transcribing itself.
 */
export function extractChannel(input: Buffer, channel: number, channels: number): Buffer {
  if (channels <= 1) return input;
  const samples = new Int16Array(input.buffer, input.byteOffset, Math.floor(input.length / 2));
  const frames = Math.floor(samples.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) out[i] = samples[i * channels + channel] ?? 0;
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/** Gradium exposes discrete PCM input formats; pick the nearest supported one. */
export function inputFormatFor(sampleRate: number): string {
  const supported = [8000, 16000, 22050, 24000, 44100, 48000];
  const nearest = supported.includes(sampleRate)
    ? sampleRate
    : supported.reduce((best, r) =>
        Math.abs(r - sampleRate) < Math.abs(best - sampleRate) ? r : best,
      );
  return `pcm_${nearest}`;
}

/* ------------------------------------------------------------------ */
/* Speech to text                                                      */
/* ------------------------------------------------------------------ */

export interface SttOptions {
  apiKey: string;
  sampleRate?: number;
  language?: string;
  model?: string;
  /**
   * Silence after the last token before the utterance is finalised. Vapi waits
   * for a `final` to close the caller's turn, so this is effectively ECHO's
   * end-of-turn detector.
   */
  silenceMs?: number;
  url?: string;
}

/**
 * One streaming recognition session.
 *
 * Emits `partial` as words arrive and `final` once the caller stops talking.
 * Audio pushed before the socket is ready is buffered rather than dropped —
 * the first syllable of "he stopped breathing" is not one to lose.
 */
export class GradiumSttSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private readonly pending: Buffer[] = [];
  private tokens: string[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private flushId = 0;
  private awaitingFlush = false;
  private readonly opts: Required<Omit<SttOptions, "apiKey">> & { apiKey: string };

  constructor(options: SttOptions) {
    super();
    this.opts = {
      apiKey: options.apiKey,
      sampleRate: options.sampleRate ?? 16000,
      language: options.language ?? "en",
      model: options.model ?? "default",
      silenceMs: options.silenceMs ?? 800,
      url: options.url ?? GRADIUM_STT_URL,
    };
  }

  connect(): void {
    if (this.ws || this.closed) return;
    const ws = new WebSocket(this.opts.url, { headers: headers(this.opts.apiKey) });
    this.ws = ws;

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "setup",
          model_name: this.opts.model,
          input_format: inputFormatFor(this.opts.sampleRate),
          json_config: { language: this.opts.language },
        }),
      );
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready": {
          this.ready = true;
          this.emit("ready");
          for (const chunk of this.pending.splice(0)) this.sendAudio(chunk);
          break;
        }
        case "text": {
          const token = String(msg.text ?? "");
          if (!token) break;
          this.tokens.push(token);
          this.emit("partial", this.transcript());
          this.armSilenceTimer();
          break;
        }
        case "flushed": {
          this.awaitingFlush = false;
          const text = this.transcript();
          this.tokens = [];
          if (text) this.emit("final", text);
          break;
        }
        case "error": {
          this.emit("error", new Error(String(msg.message ?? JSON.stringify(msg))));
          break;
        }
        default:
          break;
      }
    });

    ws.on("error", (error) => this.emit("error", error));
    ws.on("close", () => {
      this.ready = false;
      this.ws = null;
      if (!this.closed) this.emit("close");
    });
  }

  /** Gradium streams word tokens; Pipecat joins them with spaces, so do we. */
  private transcript(): string {
    return this.tokens.join(" ").replace(/\s+/g, " ").trim();
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.flush(), this.opts.silenceMs);
    this.silenceTimer.unref?.();
  }

  /** Force end-of-utterance now (silence elapsed, or the call is wrapping up). */
  flush(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (!this.ws || !this.ready || this.awaitingFlush || this.tokens.length === 0) return;
    this.awaitingFlush = true;
    this.flushId += 1;
    try {
      this.ws.send(JSON.stringify({ type: "flush", flush_id: this.flushId }));
    } catch {
      this.awaitingFlush = false;
    }
  }

  /** Feed mono s16le PCM at the configured sample rate. */
  push(pcm: Buffer): void {
    if (this.closed || pcm.length === 0) return;
    if (!this.ready) {
      // Bound the backlog so a socket that never opens cannot grow without limit.
      if (this.pending.length < 200) this.pending.push(pcm);
      return;
    }
    this.sendAudio(pcm);
  }

  private sendAudio(pcm: Buffer): void {
    try {
      this.ws?.send(JSON.stringify({ type: "audio", audio: pcm.toString("base64") }));
    } catch {
      /* the close handler reports it */
    }
  }

  close(): void {
    this.closed = true;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
  }
}

/* ------------------------------------------------------------------ */
/* Text to speech                                                      */
/* ------------------------------------------------------------------ */

export interface TtsOptions {
  apiKey: string;
  voiceId: string;
  /** Output rate the caller wants; Gradium speaks at 48 kHz and we resample. */
  sampleRate?: number;
  timeoutMs?: number;
  url?: string;
}

/**
 * Synthesise one line and return raw mono s16le PCM at `sampleRate`.
 *
 * Buffered rather than streamed: Vapi's custom-voice endpoint is a plain POST
 * that wants the whole clip in the response body.
 */
export function gradiumSynthesize(text: string, options: TtsOptions): Promise<Buffer> {
  const {
    apiKey,
    voiceId,
    sampleRate = GRADIUM_TTS_SAMPLE_RATE,
    timeoutMs = 15000,
    url = GRADIUM_TTS_URL,
  } = options;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: headers(apiKey) });
    const chunks: Buffer[] = [];
    const contextId = `echo_${Date.now().toString(36)}`;
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      if (error) return reject(error);
      const pcm48 = Buffer.concat(chunks);
      resolve(resamplePcm16(pcm48, GRADIUM_TTS_SAMPLE_RATE, sampleRate));
    };

    const timer = setTimeout(
      () => finish(chunks.length ? null : new Error("gradium tts timed out")),
      timeoutMs,
    );
    timer.unref?.();

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "setup",
          output_format: "pcm",
          voice_id: voiceId,
          close_ws_on_eos: false,
          client_req_id: contextId,
        }),
      );
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "ready") {
        ws.send(JSON.stringify({ type: "text", text, client_req_id: contextId }));
        ws.send(JSON.stringify({ type: "end_of_stream", client_req_id: contextId }));
      } else if (msg.type === "audio") {
        chunks.push(Buffer.from(String(msg.audio), "base64"));
      } else if (msg.type === "end_of_stream") {
        finish(null);
      } else if (msg.type === "error") {
        finish(new Error(String(msg.message ?? JSON.stringify(msg))));
      }
    });

    ws.on("error", (error) => finish(error as Error));
    ws.on("close", () => finish(chunks.length ? null : new Error("gradium tts closed early")));
  });
}
