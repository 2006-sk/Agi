/**
 * Client for Pranay's intelligence service (`services/intelligence`, :8082).
 *
 * The service is stateless: every call must carry the previous state back in.
 * The gateway is the only caller — nothing else is allowed to reach it, which is
 * what keeps the protocol state machine authoritative.
 */

import type { EchoEvent, IncidentState } from "@echo/contracts";

export interface AnalyzeRequest {
  session_id: string;
  utterance: string;
  current_state: Record<string, unknown>;
  conversation_summary: string;
}

export interface ToolProposal {
  name: string;
  arguments: Record<string, unknown>;
  human_required: boolean;
  reason: string;
}

export interface AnalyzeResponse {
  session_id: string;
  state_patch: Record<string, unknown>;
  protocol_transition: {
    protocol_id: string;
    from: string | null;
    to: string;
    reason: string;
    escalation: boolean;
  } | null;
  next_response: string;
  proposed_tools: ToolProposal[];
  confidence: number;
  executed_tools: unknown[];
  state: IncidentState;
  events: EchoEvent[];
  explanation: string;
  meta: {
    model: string;
    model_latency_ms: number | null;
    source: "model" | "fallback" | "mock" | "none";
    validation: "ok" | "retried" | "fallback" | "low_confidence";
    attempts: number;
    triggers_matched: string[];
    rejected: string[];
    total_latency_ms: number;
  };
}

export interface ToolExecuteRequest {
  session_id: string;
  tool: { name: string; arguments: Record<string, unknown> };
  current_state: Record<string, unknown>;
  approved: boolean;
  reviewer?: string;
}

export interface ToolExecuteResponse {
  session_id: string;
  execution: {
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
    result_summary: string;
    duration_ms: number;
  };
  state_patch: Record<string, unknown>;
  state: IncidentState;
  events: EchoEvent[];
}

export class IntelligenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "IntelligenceError";
  }
}

export interface IntelligenceClient {
  analyze(body: AnalyzeRequest): Promise<AnalyzeResponse>;
  executeTool(body: ToolExecuteRequest): Promise<ToolExecuteResponse>;
  health(probe?: boolean): Promise<{ ok: boolean; detail: unknown }>;
}

export class HttpIntelligenceClient implements IntelligenceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async post<T>(path: string, body: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text ? safeJson(text) : null;
      if (!response.ok) {
        throw new IntelligenceError(
          `intelligence ${path} -> ${response.status}`,
          response.status,
          parsed,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof IntelligenceError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new IntelligenceError(`intelligence ${path} timed out after ${timeoutMs}ms`, 504);
      }
      throw new IntelligenceError(
        `intelligence ${path} unreachable: ${(error as Error).message}`,
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  analyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
    return this.post<AnalyzeResponse>("/internal/analyze", body);
  }

  executeTool(body: ToolExecuteRequest): Promise<ToolExecuteResponse> {
    return this.post<ToolExecuteResponse>("/internal/tools/execute", body);
  }

  async health(probe = false): Promise<{ ok: boolean; detail: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(
        `${this.baseUrl}/internal/health${probe ? "?probe=1" : ""}`,
        { signal: controller.signal },
      );
      const detail = safeJson(await response.text());
      return { ok: response.ok, detail };
    } catch (error) {
      return { ok: false, detail: { error: (error as Error).message } };
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
