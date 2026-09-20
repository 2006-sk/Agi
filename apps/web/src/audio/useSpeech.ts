import { useEffect, useRef } from "react";
import { MEDICAL_CARDIAC_SCENARIO } from "../mock/scenario.ts";
import { useCues } from "../hooks/useCues.ts";
import { transport } from "../lib/client.ts";
import { useEchoStore } from "../store/useEchoStore.ts";

const ECHO_VOICES = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Karen", "Moira", "Tessa"];
const CALLER_VOICES = ["Daniel", "Alex", "Fred", "Google UK English Male", "Microsoft Guy", "Rishi", "Arthur", "Aaron"];
const SCRIPTED_LINES = MEDICAL_CARDIAC_SCENARIO.turns.map((t) => t.utterance);

interface SpeakOptions {
  voice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  volume: number;
  onend?: () => void;
}

/**
 * Plays ECHO's lines (and optionally the caller's) with the browser's speech
 * synthesis, standing in for Gradium TTS. Acks playback back to the gateway so
 * the conductor paces the conversation to the real audio.
 */
export function useSpeech(): void {
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const spokenCaller = useRef(new Set<string>());
  const currentAgent = useRef<string | null>(null);
  // Chrome drops onend for utterances that get garbage-collected; keep them referenced while live.
  const live = useRef(new Set<SpeechSynthesisUtterance>());
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voices.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const pick = (preferences: string[], exclude?: string | null): SpeechSynthesisVoice | null => {
    const list = voices.current;
    for (const name of preferences) {
      const match = list.find((v) => v.name.includes(name) && v.name !== exclude);
      if (match) return match;
    }
    return list.find((v) => v.lang.startsWith("en") && v.name !== exclude) ?? list[0] ?? null;
  };

  const speak = (text: string, options: SpeakOptions) => {
    const utterance = new SpeechSynthesisUtterance(text);
    if (options.voice) utterance.voice = options.voice;
    utterance.rate = options.rate;
    utterance.pitch = options.pitch;
    utterance.volume = options.volume;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      live.current.delete(utterance);
      options.onend?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    live.current.add(utterance);
    window.speechSynthesis.speak(utterance);
    return utterance;
  };

  useCues((cue) => {
    const { settings } = useEchoStore.getState();
    switch (cue.kind) {
      case "speak": {
        if (cue.speaker === "agent") {
          const ack = () => {
            if (currentAgent.current === cue.utteranceId) currentAgent.current = null;
            void transport.agentDone(cue.sessionId, cue.utteranceId).catch(() => undefined);
          };
          if (!settings.ttsEcho || !supported) {
            setTimeout(ack, cue.estimatedMs || 1500);
            return;
          }
          currentAgent.current = cue.utteranceId;
          const echoVoice = pick(ECHO_VOICES);
          speak(cue.text, { voice: echoVoice, rate: 1.0, pitch: 1.0, volume: 1, onend: ack });
        } else if (settings.ttsCaller && supported && !spokenCaller.current.has(cue.utteranceId)) {
          spokenCaller.current.add(cue.utteranceId);
          const echoVoice = pick(ECHO_VOICES);
          speak(cue.text, { voice: pick(CALLER_VOICES, echoVoice?.name), rate: 1.08, pitch: 0.82, volume: 0.9 });
        }
        break;
      }
      case "caller_speech_start": {
        if (!settings.ttsCaller || !supported || spokenCaller.current.has(cue.utteranceId)) return;
        const lower = cue.text.toLowerCase();
        const full = SCRIPTED_LINES.find((line) => line.toLowerCase().startsWith(lower));
        if (!full) return;
        spokenCaller.current.add(cue.utteranceId);
        const echoVoice = pick(ECHO_VOICES);
        speak(full, { voice: pick(CALLER_VOICES, echoVoice?.name), rate: 1.08, pitch: 0.82, volume: 0.9 });
        break;
      }
      case "interrupt": {
        if (!supported) return;
        if (currentAgent.current === cue.utteranceId) {
          currentAgent.current = null;
          window.speechSynthesis.cancel();
        }
        break;
      }
      case "reset": {
        if (supported) window.speechSynthesis.cancel();
        spokenCaller.current.clear();
        currentAgent.current = null;
        break;
      }
      default:
        break;
    }
  });
}
