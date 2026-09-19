#!/usr/bin/env python3
"""
Build the Vapi assistant payload for either mode.

Kept out of the shell script because the tool schemas are large and nesting
them in bash heredocs is how you end up debugging quoting at 2am.

  vapi  Vapi's own STT / model / TTS. The agent reaches AURA through tools,
        which move the incident and light the deck. The approval gate stays
        in AURA: request_dispatch opens it and returns "pending".

  aura  Vapi is carriage only. Gradium does STT and TTS through AURA
        endpoints, and the deterministic protocol machine writes every line.
"""

import json
import sys

FIRST_MESSAGE = (
    "Emergency services. This line is answered by an A I assistant with a human "
    "dispatcher supervising. Tell me what is happening and where you are."
)

SYSTEM_PROMPT = """You are AURA, an emergency call-intake assistant answering an overflow 911 line. A human dispatcher is supervising you and sees everything you record.

Your job is to find out, as fast as possible:
1. WHERE the emergency is - get this first, it matters more than anything else.
2. WHAT is happening.
3. Whether the person is conscious and breathing.
4. Any danger to responders.

Rules:
- Ask ONE short question at a time. Callers are frightened; do not lecture.
- The moment you learn anything, call update_incident. Do not wait until the end of the call.
- The moment you have an address, call verify_address.
- Once the address is verified and you know what service is needed, call find_units.
- When units are found and the situation warrants it, call request_dispatch.
- If the caller says the person is not breathing, has no pulse, or is unresponsive, set priority to critical immediately and interrupt whatever you were asking.
- NEVER say an ambulance has been dispatched or is on its way. A human must approve first. Say "I am arranging help now, stay on the line."
- Do not give medical instructions beyond keeping the caller calm and on the line.
- Keep every reply under about 25 words."""


def tool(name, description, properties, required, url):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
        "server": {"url": url},
    }


def tools(base):
    url = f"{base}/vapi/tools"
    return [
        tool(
            "update_incident",
            "Record what you have learned about the emergency. Call this as soon as "
            "you learn anything new - the dispatcher's screen updates live from it. "
            "Safe to call repeatedly.",
            {
                "category": {
                    "type": "string",
                    "enum": ["medical", "fire", "police", "other"],
                    "description": "Kind of emergency.",
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "critical"],
                    "description": "critical for not breathing, no pulse, unconscious, or immediate threat to life.",
                },
                "chief_complaint": {"type": "string", "description": "The main problem in a few words."},
                "conscious": {"type": "string", "enum": ["yes", "no", "unknown"]},
                "breathing": {"type": "string", "enum": ["normal", "labored", "no", "unknown"]},
                "people_at_risk": {"type": "number"},
                "facts": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Short observations, e.g. 'chest pain', 'pain radiating to arm'.",
                },
                "hazards": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Dangers to responders, e.g. 'gas smell', 'aggressive dog'.",
                },
            },
            [],
            url,
        ),
        tool(
            "verify_address",
            "Verify and map the caller's address. Call as soon as they give one. "
            "Nothing can be dispatched until this succeeds.",
            {"address": {"type": "string", "description": "The address exactly as the caller said it."}},
            ["address"],
            url,
        ),
        tool(
            "find_units",
            "Find the nearest available responder units and calculate a route. "
            "Requires a verified address.",
            {"service": {"type": "string", "enum": ["EMS", "FIRE", "POLICE"]}},
            ["service"],
            url,
        ),
        tool(
            "request_dispatch",
            "Ask the human dispatcher to approve sending the units. This does NOT "
            "dispatch - a human must approve. Tell the caller help is being arranged.",
            {"reason": {"type": "string", "description": "Why dispatch is needed now."}},
            ["reason"],
            url,
        ),
    ]


def build(mode, base, ws_base, secret, voice_id):
    server = {"url": f"{base}/vapi/webhook"}
    if secret:
        server["secret"] = secret

    payload = {
        "name": "AURA",
        "firstMessageMode": "assistant-speaks-first",
        "firstMessage": FIRST_MESSAGE,
        "server": server,
        "serverMessages": ["status-update", "transcript", "speech-update", "end-of-call-report"],
        "silenceTimeoutSeconds": 30,
        "maxDurationSeconds": 600,
    }

    if mode == "vapi":
        # Vapi owns speech and reasoning; AURA is reached through tools.
        payload["transcriber"] = {"provider": "deepgram", "model": "nova-2", "language": "en"}
        payload["voice"] = {"provider": "vapi", "voiceId": voice_id}
        payload["model"] = {
            "provider": "openai",
            "model": "gpt-4.1",
            "temperature": 0.3,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}],
            "tools": tools(base),
        }
    else:
        # Carriage only: every thinking and speaking part points back at AURA.
        tool_server = {"url": f"{ws_base}/vapi/transcriber"}
        voice_server = {"url": f"{base}/vapi/voice", "timeoutSeconds": 30}
        if secret:
            tool_server["secret"] = secret
            voice_server["secret"] = secret
        payload["transcriber"] = {"provider": "custom-transcriber", "server": tool_server}
        payload["voice"] = {"provider": "custom-voice", "server": voice_server}
        payload["model"] = {
            "provider": "custom-llm",
            "url": f"{base}/vapi",
            "model": "aura-protocol",
            "messages": [
                {
                    "role": "system",
                    "content": "Ignored. Every reply comes from the AURA protocol state machine.",
                }
            ],
        }

    return payload


if __name__ == "__main__":
    mode, base, ws_base, secret, voice_id = (sys.argv + [""] * 5)[1:6]
    print(json.dumps(build(mode, base, ws_base, secret, voice_id)))
