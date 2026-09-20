import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildGateway, type EchoGateway } from "../src/app.js";
import { NullVoiceClient } from "../src/clients/voice.js";
import { config as baseConfig } from "../src/config.js";
import { isValidTwilioSignature } from "../src/routes/twilio.js";
import { FakeIntelligence } from "./helpers/fakeIntelligence.js";

const SESSION = "echo-demo-0197";
const CALL_SID = "CA0123456789abcdef";
const AUTH_TOKEN = "test_auth_token";

let gateway: EchoGateway;
let intelligence: FakeIntelligence;
let baseUrl: string;

/** POST a Twilio webhook the way Twilio does: form-encoded. */
async function twilioPost(
  path: string,
  params: Record<string, string>,
  { signature }: { signature?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (signature !== undefined) headers["x-twilio-signature"] = signature;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  return { status: response.status, body: await response.text() };
}

async function start(overrides: Partial<typeof baseConfig> = {}) {
  intelligence = new FakeIntelligence();
  gateway = await buildGateway({
    intelligence,
    voice: new NullVoiceClient(),
    logger: false,
    config: {
      ...baseConfig,
      emitViewEvents: true,
      twilioAuthToken: "",
      twilioSessionId: SESSION,
      twilioVoice: "Polly.Joanna-Neural",
      publicBaseUrl: "",
      dispatchTravelMs: 300,
      dispatchTickMs: 60,
      ...overrides,
    },
  });
  await gateway.app.listen({ port: 0, host: "127.0.0.1" });
  const address = gateway.app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  await gateway.app.close();
});

/* ------------------------------------------------------------------ */

describe("signature validation", () => {
  const url = "https://example.ngrok.app/twilio/voice";
  const params = { CallSid: CALL_SID, From: "+14085901963", To: "+17372583478" };

  function sign(token: string) {
    const payload = Object.keys(params)
      .sort()
      .reduce((acc, k) => acc + k + params[k as keyof typeof params], url);
    return createHmac("sha1", token).update(Buffer.from(payload, "utf8")).digest("base64");
  }

  it("accepts a correctly signed request", () => {
    expect(isValidTwilioSignature(AUTH_TOKEN, url, params, sign(AUTH_TOKEN))).toBe(true);
  });

  it("rejects a signature made with the wrong token", () => {
    expect(isValidTwilioSignature(AUTH_TOKEN, url, params, sign("other_token"))).toBe(false);
  });

  it("rejects a tampered parameter", () => {
    const signature = sign(AUTH_TOKEN);
    const tampered = { ...params, From: "+19995550000" };
    expect(isValidTwilioSignature(AUTH_TOKEN, url, tampered, signature)).toBe(false);
  });

  it("rejects garbage without throwing on a length mismatch", () => {
    expect(isValidTwilioSignature(AUTH_TOKEN, url, params, "nope")).toBe(false);
  });

  it("refuses an unsigned webhook once a token is configured", async () => {
    await gateway.app.close();
    await start({ twilioAuthToken: AUTH_TOKEN });
    const result = await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+1408" });
    expect(result.status).toBe(403);
    // Nothing was created off an unverified request.
    expect(gateway.store.has(SESSION)).toBe(false);
  });
});

describe("inbound call", () => {
  it("answers with a gather and an AI-disclosure greeting", async () => {
    const result = await twilioPost("/twilio/voice", {
      CallSid: CALL_SID,
      From: "+14085901963",
      To: "+17372583478",
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain("<Response>");
    expect(result.body).toContain('<Gather input="speech"');
    expect(result.body).toContain('action="/twilio/gather"');
    expect(result.body).toContain("Polly.Joanna-Neural");
    // A caller must be told they are talking to an AI with a human supervising.
    expect(result.body).toMatch(/A I assistant/);
    expect(result.body).toMatch(/human dispatcher/);
  });

  it("opens a gateway session the deck can already see", async () => {
    await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+14085901963" });
    const session = gateway.store.get(SESSION);
    expect(session).toBeDefined();
    expect(session?.channel).toBe("phone");
    expect(session?.caller_number).toBe("+14085901963");
    expect(session?.log[0]?.type).toBe("session.started");
    expect(session?.log[0]?.sequence).toBe(1);
  });

  it("gives each call its own session in call_sid mode", async () => {
    await gateway.app.close();
    await start({ twilioSessionId: "call_sid" });
    await twilioPost("/twilio/voice", { CallSid: "CAaaa", From: "+1" });
    await twilioPost("/twilio/voice", { CallSid: "CAbbb", From: "+2" });
    expect(gateway.store.has("twilio_CAaaa")).toBe(true);
    expect(gateway.store.has("twilio_CAbbb")).toBe(true);
  });

  it("starts a genuinely new call from a clean slate", async () => {
    await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+1408" });
    await twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: "he has chest pain",
      Confidence: "0.9",
    });
    expect(gateway.store.get(SESSION)!.state?.category).toBe("medical");

    // A different CallSid is a different caller.
    await twilioPost("/twilio/voice", { CallSid: "CAsecondcall", From: "+1408" });
    const session = gateway.store.get(SESSION)!;
    expect(session.state).toBeNull();
    expect(session.log[0]?.sequence).toBe(1);
  });

  it("does not wipe a live call when Twilio repeats the webhook", async () => {
    // Twilio retries this webhook when a response is slow. Treating a retry as
    // a new call clears the board in the middle of the conversation.
    await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+1408" });
    await twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: "he has chest pain",
      Confidence: "0.9",
    });
    const before = gateway.store.get(SESSION)!.sequence;

    const repeat = await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+1408" });
    expect(repeat.status).toBe(200);

    const session = gateway.store.get(SESSION)!;
    expect(session.state?.category).toBe("medical");
    expect(session.sequence).toBeGreaterThanOrEqual(before);
  });
});

describe("a caller turn", () => {
  beforeEach(async () => {
    await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+14085901963" });
  });

  it("runs speech through the protocol and speaks the approved reply", async () => {
    const result = await twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: "my father has chest pain",
      Confidence: "0.92",
    });

    expect(result.status).toBe(200);
    expect(result.body).toContain("<Say");
    expect(result.body).toContain("address");
    // The loop continues: every reply is followed by another gather.
    expect(result.body).toContain('<Gather input="speech"');
    expect(intelligence.analyzeCalls).toHaveLength(1);
  });

  it("puts the caller's words and ECHO's reply on the deck", async () => {
    await twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: "my father has chest pain",
      Confidence: "0.92",
    });
    const log = gateway.store.get(SESSION)!.log;
    const caller = log.find((e) => e.type === "transcript.final" && e.payload.speaker === "caller");
    const echo = log.find((e) => e.type === "transcript.final" && e.payload.speaker === "echo");
    expect(caller?.payload.text).toBe("my father has chest pain");
    expect(caller?.payload.confidence).toBe(0.92);
    expect(echo).toBeDefined();
  });

  it("publishes the caller's transcript exactly once", async () => {
    await twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: "my father has chest pain",
      Confidence: "0.9",
    });
    const finals = gateway.store
      .get(SESSION)!
      .log.filter((e) => e.type === "transcript.final" && e.payload.speaker === "caller");
    expect(finals).toHaveLength(1);
  });

  it("re-prompts on silence instead of analysing an empty utterance", async () => {
    const result = await twilioPost("/twilio/gather", { CallSid: CALL_SID, SpeechResult: "" });
    expect(result.status).toBe(200);
    expect(result.body).toContain("did not catch that");
    expect(result.body).toContain("<Gather");
    expect(intelligence.analyzeCalls).toHaveLength(0);
  });

  it("escapes speech that would otherwise break the TwiML", async () => {
    const result = await twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: 'he said "it hurts" & <collapsed>',
      Confidence: "0.8",
    });
    expect(result.status).toBe(200);
    // The response must stay well-formed: no raw angle brackets from input.
    expect(result.body).not.toContain("<collapsed>");
    const tagNames = [...result.body.matchAll(/<\/?([A-Za-z?][^\s/>]*)/g)].map((m) => m[1]);
    for (const tag of tagNames) {
      expect(["?xml", "Response", "Gather", "Say", "Hangup"]).toContain(tag);
    }
  });

  it("keeps the caller on the line rather than answering a superseded turn", async () => {
    const session = gateway.store.get(SESSION)!;
    intelligence.options.latencyMs = 60;
    const turn = twilioPost("/twilio/gather", {
      CallSid: CALL_SID,
      SpeechResult: "my father has chest pain",
      Confidence: "0.9",
    });
    await new Promise((r) => setTimeout(r, 15));
    gateway.store.beginTurn(session); // a newer turn opens mid-analysis

    const result = await turn;
    expect(result.status).toBe(200);
    expect(result.body).not.toContain("<Say");
    expect(result.body).toContain("<Gather");
  });

  it("drives the full cardiac path to the human gate over the phone", async () => {
    for (const line of [
      "my father is clutching his chest",
      "we are at 170 St. Germain Avenue",
      "he is awake but sweating",
      "wait, he stopped breathing",
    ]) {
      const result = await twilioPost("/twilio/gather", {
        CallSid: CALL_SID,
        SpeechResult: line,
        Confidence: "0.9",
      });
      expect(result.status).toBe(200);
    }

    const session = gateway.store.get(SESSION)!;
    expect(session.state?.priority).toBe("critical");
    expect(session.state?.status).toBe("awaiting_approval");
    expect(session.approvals.size).toBe(1);
    // The phone call cannot dispatch on its own.
    expect(intelligence.toolCalls).toHaveLength(0);

    const types = session.log.map((e) => e.type);
    expect(types).toContain("approval.requested");
    expect(types).toContain("route.proposed");
  });
});

describe("call status", () => {
  it("ends the call on a completed callback", async () => {
    await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+1408" });
    const result = await twilioPost("/twilio/status", {
      CallSid: CALL_SID,
      CallStatus: "completed",
    });
    expect(result.status).toBe(204);
    const session = gateway.store.get(SESSION)!;
    expect(session.status).toBe("ended");
    expect(session.log.map((e) => e.type)).toContain("call.ended");
  });

  it("ignores an in-progress callback", async () => {
    await twilioPost("/twilio/voice", { CallSid: CALL_SID, From: "+1408" });
    await twilioPost("/twilio/status", { CallSid: CALL_SID, CallStatus: "in-progress" });
    expect(gateway.store.get(SESSION)!.status).toBe("active");
  });
});

describe("setup helper", () => {
  it("says what is still missing when no tunnel is configured", async () => {
    const response = await fetch(`${baseUrl}/twilio/config`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.public_base_url).toBeNull();
    expect(String(body.voice_webhook)).toContain("PUBLIC_BASE_URL");
  });

  it("prints the exact webhook URL once a tunnel is configured", async () => {
    await gateway.app.close();
    await start({ publicBaseUrl: "https://demo.ngrok.app", twilioAuthToken: AUTH_TOKEN });
    const response = await fetch(`${baseUrl}/twilio/config`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body.voice_webhook).toBe("https://demo.ngrok.app/twilio/voice");
    expect(body.status_callback).toBe("https://demo.ngrok.app/twilio/status");
  });
});
