/**
 * Per-session serial execution.
 *
 * The intelligence service is stateless and the gateway round-trips the whole
 * incident state into every call, so two concurrent analyses for one session
 * would both read the same `current_state` and the second would silently discard
 * the first one's facts. Turns therefore queue per session; different sessions
 * still run in parallel.
 */
export class SessionQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // Swallow the predecessor's rejection: one failed turn must not poison the
    // queue for every turn behind it.
    const next = previous.then(task, task);
    this.tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Number of sessions with a queue entry. Diagnostics only. */
  get size(): number {
    return this.tails.size;
  }

  clear(key: string): void {
    this.tails.delete(key);
  }
}
