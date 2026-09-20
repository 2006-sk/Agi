/**
 * Speaking into a call that is already in progress.
 *
 * Everything else in the gateway answers the caller: they say something, the
 * turn runs, a reply goes back. Dispatch is the one thing that happens *to*
 * the call — a human approves, an ambulance arrives — with nobody having
 * asked. Without this the caller is left listening to an agent that has no
 * idea help was sent, which is the single thing they want to hear.
 *
 * Vapi exposes a per-call control socket for exactly this. The URL arrives on
 * the status-update webhook as `call.monitor.controlUrl`; when it does not,
 * it can be fetched from the call record.
 */

export interface CallAnnouncer {
  /** Speak a line into the live call. Returns false if it could not be said. */
  say(session: { vapiControlUrl: string | null; activeCallId: string | null }, line: string): Promise<boolean>;
}

export class VapiCallControl implements CallAnnouncer {
  constructor(
    private readonly privateKey: string,
    private readonly timeoutMs = 5000,
    private readonly log?: { warn(o: unknown, m?: string): void; info(o: unknown, m?: string): void },
  ) {}

  /**
   * Find the control socket for a call.
   *
   * Cached on the session once found: it does not change for the life of the
   * call, and a lookup on every announcement would add latency to the moment
   * that most needs to feel immediate.
   */
  async controlUrlFor(callId: string): Promise<string | null> {
    if (!this.privateKey || !callId) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
        headers: { authorization: `Bearer ${this.privateKey}` },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { monitor?: { controlUrl?: string } };
      return body.monitor?.controlUrl ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async say(
    session: { vapiControlUrl: string | null; activeCallId: string | null },
    line: string,
  ): Promise<boolean> {
    const url = session.vapiControlUrl;
    if (!url || !line.trim()) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "say", content: line, endCallAfterSpoken: false }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.log?.warn({ status: response.status, call_id: session.activeCallId }, "vapi say rejected");
        return false;
      }
      this.log?.info({ call_id: session.activeCallId, line: line.slice(0, 60) }, "spoke into the live call");
      return true;
    } catch (error) {
      // A failed announcement must never take the call down with it.
      this.log?.warn({ err: (error as Error).message }, "vapi say failed");
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Used when no call control is configured: records what would have been said. */
export class NullCallAnnouncer implements CallAnnouncer {
  readonly said: string[] = [];
  async say(_session: unknown, line: string): Promise<boolean> {
    this.said.push(line);
    return true;
  }
}
