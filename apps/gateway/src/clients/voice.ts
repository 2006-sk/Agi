/**
 * Client for Aditya's voice service (`services/voice`, :8100).
 *
 * Every call here is best-effort. The voice layer is the one dependency that can
 * be absent for a whole demo (text mode, no mic, Gradium down) and the incident
 * must keep progressing regardless — so failures are reported, never thrown.
 */

export interface VoiceClient {
  speak(sessionId: string, text: string): Promise<boolean>;
  cancel(sessionId: string, reason: string): Promise<boolean>;
  health(): Promise<{ ok: boolean; detail: unknown }>;
}

export class HttpVoiceClient implements VoiceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly onError?: (op: string, error: Error) => void,
  ) {}

  private async post(path: string, body: unknown): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.onError?.(path, new Error(`voice ${path} -> ${response.status}`));
        return false;
      }
      return true;
    } catch (error) {
      this.onError?.(path, error as Error);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  speak(sessionId: string, text: string): Promise<boolean> {
    return this.post("/internal/speak", { session_id: sessionId, text });
  }

  cancel(sessionId: string, reason: string): Promise<boolean> {
    return this.post("/internal/cancel", { session_id: sessionId, reason });
  }

  async health(): Promise<{ ok: boolean; detail: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      const text = await response.text();
      let detail: unknown;
      try {
        detail = JSON.parse(text);
      } catch {
        detail = { raw: text };
      }
      return { ok: response.ok, detail };
    } catch (error) {
      return { ok: false, detail: { error: (error as Error).message } };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Used when no voice service is configured: everything succeeds, silently. */
export class NullVoiceClient implements VoiceClient {
  readonly spoken: { session_id: string; text: string }[] = [];
  readonly cancelled: { session_id: string; reason: string }[] = [];

  async speak(sessionId: string, text: string): Promise<boolean> {
    this.spoken.push({ session_id: sessionId, text });
    return true;
  }

  async cancel(sessionId: string, reason: string): Promise<boolean> {
    this.cancelled.push({ session_id: sessionId, reason });
    return true;
  }

  async health(): Promise<{ ok: boolean; detail: unknown }> {
    return { ok: true, detail: { mode: "null" } };
  }
}
