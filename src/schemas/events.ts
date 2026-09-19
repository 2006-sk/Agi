import { randomUUID } from "node:crypto";
import { z } from "zod";

/** Shared event envelope from master_plan.md. */
export const EventType = z.enum([
  "incident.updated",
  "protocol.changed",
  "tool.started",
  "tool.completed",
  "dispatch.proposed",
]);
export type EventType = z.infer<typeof EventType>;

export const EventEnvelope = z.object({
  event_id: z.string(),
  session_id: z.string(),
  type: EventType,
  timestamp: z.string(),
  /** Sequence within this response; the gateway re-stamps it with the session-wide sequence. */
  sequence: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const ProtocolChangedPayload = z.object({
  protocol_id: z.string(),
  previous_step: z.string().nullable(),
  current_step: z.string(),
  reason: z.string(),
  escalation: z.boolean(),
});

export const ToolStartedPayload = z.object({
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export const ToolCompletedPayload = z.object({
  tool: z.string(),
  result_summary: z.string(),
  result: z.unknown(),
  duration_ms: z.number(),
});

export const DispatchProposedPayload = z.object({
  action_id: z.string(),
  services: z.array(z.string()),
  units: z.array(z.unknown()),
  route: z.unknown().nullable(),
  reason: z.string(),
  human_required: z.literal(true),
});

export interface EventFactoryOptions {
  now?: () => Date;
  idGen?: () => string;
}

/** Produces and buffers envelopes with a per-response monotonically increasing sequence. */
export class EventFactory {
  private sequence = 0;
  private readonly emitted: EventEnvelope[] = [];
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(
    private readonly sessionId: string,
    options: EventFactoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.idGen = options.idGen ?? (() => `evt_${randomUUID()}`);
  }

  emit(type: EventType, payload: Record<string, unknown>): EventEnvelope {
    this.sequence += 1;
    const event: EventEnvelope = {
      event_id: this.idGen(),
      session_id: this.sessionId,
      type,
      timestamp: this.now().toISOString(),
      sequence: this.sequence,
      payload,
    };
    this.emitted.push(event);
    return event;
  }

  all(): EventEnvelope[] {
    return [...this.emitted];
  }
}
