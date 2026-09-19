import { config as loadEnv } from "dotenv";

loadEnv();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface GatewayConfig {
  port: number;
  host: string;
  logLevel: string;
  intelligenceUrl: string;
  voiceUrl: string;
  analyzeTimeoutMs: number;
  voiceTimeoutMs: number;
  degradeAfterFallbacks: number;
  dispatchTravelMs: number;
  dispatchTickMs: number;
  approvalTimeoutS: number;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioNumber: string;
  twilioVoice: string;
  /** Pin phone calls to one session id, or "call_sid" for one session per call. */
  twilioSessionId: string;
  /** Public https base a tunnel exposes; required for Twilio signature checks. */
  publicBaseUrl: string;
}

export const config: GatewayConfig = {
  port: int("PORT", 8000),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
  intelligenceUrl: (process.env.INTELLIGENCE_URL ?? "http://localhost:8082").replace(/\/+$/, ""),
  voiceUrl: (process.env.VOICE_URL ?? "http://localhost:8100").replace(/\/+$/, ""),
  analyzeTimeoutMs: int("ANALYZE_TIMEOUT_MS", 9000),
  voiceTimeoutMs: int("VOICE_TIMEOUT_MS", 4000),
  degradeAfterFallbacks: int("DEGRADE_AFTER_FALLBACKS", 2),
  dispatchTravelMs: int("DISPATCH_TRAVEL_MS", 9000),
  dispatchTickMs: int("DISPATCH_TICK_MS", 300),
  approvalTimeoutS: int("APPROVAL_TIMEOUT_S", 120),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioNumber: process.env.TWILIO_NUMBER ?? "",
  twilioVoice: process.env.TWILIO_VOICE ?? "Polly.Joanna-Neural",
  twilioSessionId: process.env.TWILIO_SESSION_ID ?? "aura-demo-0197",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
};
