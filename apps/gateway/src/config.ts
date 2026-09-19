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
  gradiumApiKey: string;
  gradiumVoiceId: string;
  defaultLanguage: string;
  /** Silence after the last word before an utterance is final (end-of-turn). */
  sttSilenceMs: number;
  vapiPrivateKey: string;
  vapiPublicKey: string;
  vapiPhoneNumberId: string;
  vapiPhoneNumber: string;
  vapiAssistantId: string;
  vapiSecret: string;
  vapiSessionId: string;
  vapiGreeting: string;
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
  gradiumApiKey: process.env.GRADIUM_API_KEY ?? "",
  gradiumVoiceId: process.env.GRADIUM_VOICE_ID ?? "r2sIQdqqoqgRJuXw",
  defaultLanguage: process.env.DEFAULT_LANGUAGE ?? "en",
  sttSilenceMs: int("STT_SILENCE_MS", 800),
  vapiPrivateKey: process.env.VAPI_PRIVATE_KEY ?? "",
  vapiPublicKey: process.env.VAPI_PUBLIC_KEY ?? "",
  vapiPhoneNumberId: process.env.VAPI_PHONE_NUMBER_ID ?? "",
  vapiPhoneNumber: process.env.VAPI_PHONE_NUMBER ?? "",
  vapiAssistantId: process.env.VAPI_ASSISTANT_ID ?? "",
  vapiSecret: process.env.VAPI_SECRET ?? "",
  vapiSessionId: process.env.VAPI_SESSION_ID ?? "aura-demo-0197",
  vapiGreeting:
    process.env.VAPI_GREETING ??
    "Emergency services. This line is answered by an AI assistant with a human dispatcher supervising. Tell me what is happening and where you are.",
};
