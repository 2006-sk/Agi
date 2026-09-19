"""Gradium-supported languages + lightweight detection for reply routing.

Gradium STT/TTS currently cover: en, es, fr, de, pt.
With STT language=\"any\", Gradium can transcribe mixed speech, but Pipecat
does not surface the detected code on TranscriptionFrame — so we infer it
from the transcript text for TTS settings, gateway utterance language, and
local-echo replies.
"""

from __future__ import annotations

import re
from typing import Literal

GradiumLang = Literal["en", "es", "fr", "de", "pt"]
SUPPORTED: tuple[GradiumLang, ...] = ("en", "es", "fr", "de", "pt")

# Short, high-signal tokens for emergency / conversational demo speech.
_MARKERS: dict[GradiumLang, tuple[str, ...]] = {
    "en": (
        "the",
        "and",
        "help",
        "please",
        "address",
        "breathing",
        "chest",
        "pain",
        "emergency",
        "stopped",
        "hello",
        "need",
        "he's",
        "she's",
        "can't",
    ),
    "es": (
        "el",
        "la",
        "ayuda",
        "por",
        "favor",
        "calle",
        "dolor",
        "pecho",
        "respirar",
        "emergencia",
        "hola",
        "necesito",
        "está",
        "direccion",
        "dirección",
        "pare",
        "dejó",
    ),
    "fr": (
        "le",
        "la",
        "aide",
        "s'il",
        "vous",
        "rue",
        "douleur",
        "poitrine",
        "respirer",
        "urgence",
        "bonjour",
        "besoin",
        "arrêté",
        "adresse",
    ),
    "de": (
        "der",
        "die",
        "das",
        "hilfe",
        "bitte",
        "straße",
        "strasse",
        "schmerz",
        "brust",
        "atmen",
        "notfall",
        "hallo",
        "brauche",
        "adresse",
        "aufgehört",
    ),
    "pt": (
        "o",
        "a",
        "ajuda",
        "por",
        "favor",
        "rua",
        "dor",
        "peito",
        "respirar",
        "emergência",
        "emergencia",
        "olá",
        "ola",
        "preciso",
        "endereço",
        "endereco",
        "parou",
    ),
}

_CHAR_HINTS: dict[GradiumLang, str] = {
    "es": "ñ¿¡áéíóúü",
    "fr": "àâæçéèêëïîôœùûüÿ",
    "de": "äöüß",
    "pt": "ãõáàâçéêíóôú",
}

LOCAL_ECHO_REPLIES: dict[GradiumLang, str] = {
    "en": (
        "Okay, I understand. Can you tell me the address "
        "and whether they are conscious?"
    ),
    "es": (
        "De acuerdo, entiendo. ¿Puede decirme la dirección "
        "y si la persona está consciente?"
    ),
    "fr": (
        "D'accord, je comprends. Pouvez-vous me donner l'adresse "
        "et me dire si la personne est consciente ?"
    ),
    "de": (
        "In Ordnung, ich verstehe. Können Sie mir die Adresse nennen "
        "und sagen, ob die Person bei Bewusstsein ist?"
    ),
    "pt": (
        "Certo, entendi. Pode me dizer o endereço "
        "e se a pessoa está consciente?"
    ),
}

SAFE_FALLBACK_LINES: dict[GradiumLang, str] = {
    "en": "Please stay on the line while I connect you to a dispatcher.",
    "es": "Por favor permanezca en la línea mientras lo conecto con un despachador.",
    "fr": "Veuillez rester en ligne pendant que je vous connecte à un répartiteur.",
    "de": "Bitte bleiben Sie in der Leitung, während ich Sie mit einem Disponenten verbinde.",
    "pt": "Por favor, permaneça na linha enquanto eu o conecto a um despachante.",
}


def normalize_lang(code: str | None, default: GradiumLang = "en") -> GradiumLang:
    if not code:
        return default
    base = str(code).strip().lower().replace("_", "-").split("-")[0]
    if base == "any":
        return default
    if base in SUPPORTED:
        return base  # type: ignore[return-value]
    return default


def detect_language(text: str, *, default: GradiumLang = "en") -> GradiumLang:
    """Infer Gradium language from transcript text (best-effort for demo)."""
    cleaned = (text or "").strip().lower()
    if len(cleaned) < 2:
        return default

    tokens = set(re.findall(r"[a-zàâäæçéèêëïîôœùûüÿñãõáíóúüß']+", cleaned, flags=re.I))
    scores: dict[GradiumLang, float] = {lang: 0.0 for lang in SUPPORTED}

    for lang, markers in _MARKERS.items():
        for marker in markers:
            if marker in tokens:
                scores[lang] += 2.0 if len(marker) > 3 else 1.0

    for lang, chars in _CHAR_HINTS.items():
        for ch in chars:
            if ch in cleaned:
                scores[lang] += 1.5

    # Prefer non-English if tied with a clear second language signal
    best = max(SUPPORTED, key=lambda lang: (scores[lang], lang != "en"))
    if scores[best] <= 0:
        return default
    return best


def local_echo_reply(lang: GradiumLang) -> str:
    return LOCAL_ECHO_REPLIES.get(lang, LOCAL_ECHO_REPLIES["en"])


def safe_fallback(lang: GradiumLang, override: str | None = None) -> str:
    if override and lang == "en":
        return override
    return SAFE_FALLBACK_LINES.get(lang, SAFE_FALLBACK_LINES["en"])
