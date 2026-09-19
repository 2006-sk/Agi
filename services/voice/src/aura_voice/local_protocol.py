"""Local medical-protocol mock for voice bring-up (not production intelligence).

Voice must not invent emergency instructions in the real system — Shresth/Pranay
own replies. This mock only exists so Aditya can demo a changing conversation
without the gateway.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from aura_voice.language import GradiumLang


@dataclass
class LocalProtocolState:
    """Tracks a single local demo call."""

    has_complaint: bool = False
    has_address: bool = False
    not_breathing: bool = False
    conscious_asked: bool = False
    turns: int = 0
    facts: list[str] = field(default_factory=list)


_STATE: dict[str, LocalProtocolState] = {}


def reset_local_protocol(session_id: str) -> None:
    _STATE[session_id] = LocalProtocolState()


def _state(session_id: str) -> LocalProtocolState:
    if session_id not in _STATE:
        _STATE[session_id] = LocalProtocolState()
    return _STATE[session_id]


def _contains_any(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def local_protocol_reply(
    session_id: str, text: str, language: GradiumLang = "en"
) -> str:
    """
    Deterministic branching for the chest-pain → not-breathing demo path.
    Returns the next AURA question / acknowledgment in the caller's language.
    """
    st = _state(session_id)
    st.turns += 1
    t = (text or "").lower()

    # Critical interrupt path
    if _contains_any(
        t,
        (
            "stopped breathing",
            "not breathing",
            "isn't breathing",
            "isnt breathing",
            "no pulse",
            "unconscious",
            "no respira",
            "dejó de respirar",
            "dejo de respirar",
            "ne respire plus",
            "atmet nicht",
            "não respira",
            "nao respira",
        ),
    ):
        st.not_breathing = True
        st.facts.append("not breathing")
        return _msg(
            language,
            en=(
                "Understood — this is critical. I am preparing EMS dispatch "
                "and will need a human to approve. Stay on the line. "
                "Is anyone there to start CPR if I guide them?"
            ),
            es=(
                "Entendido — esto es crítico. Estoy preparando el envío de EMS "
                "y necesitaré aprobación humana. Permanezca en la línea. "
                "¿Hay alguien que pueda iniciar RCP si le guío?"
            ),
            fr=(
                "Compris — c'est critique. Je prépare l'envoi des secours "
                "et j'aurai besoin d'une validation humaine. Restez en ligne. "
                "Y a-t-il quelqu'un pour commencer la RCP si je guide ?"
            ),
            de=(
                "Verstanden — das ist kritisch. Ich bereite den EMS-Einsatz vor "
                "und brauche eine menschliche Freigabe. Bleiben Sie in der Leitung. "
                "Ist jemand da, der mit Anleitung CPR beginnen kann?"
            ),
            pt=(
                "Entendido — isto é crítico. Estou a preparar o envio de EMS "
                "e preciso de aprovação humana. Fique na linha. "
                "Há alguém que possa iniciar RCP se eu orientar?"
            ),
        )

    if _contains_any(
        t,
        (
            "chest pain",
            "heart",
            "cardiac",
            "dolor de pecho",
            "pecho",
            "douleur",
            "poitrine",
            "brust",
            "schmerz",
            "peito",
            "dor no peito",
        ),
    ):
        st.has_complaint = True
        st.facts.append("chest pain")

    if _contains_any(
        t,
        (
            "street",
            "avenue",
            "ave",
            "road",
            "st.",
            "address",
            "calle",
            "avenida",
            "rue",
            "straße",
            "strasse",
            "rua",
            " germain",
            "170",
        ),
    ) or any(ch.isdigit() for ch in t) and len(t) > 8:
        st.has_address = True
        st.facts.append("location mentioned")

    if st.not_breathing:
        return _msg(
            language,
            en="Stay on the line. Help is being prepared. Is the patient an adult?",
            es="Permanezca en la línea. Se está preparando ayuda. ¿La persona es adulta?",
            fr="Restez en ligne. L'aide est en préparation. La personne est-elle adulte ?",
            de="Bleiben Sie in der Leitung. Hilfe wird vorbereitet. Ist die Person erwachsen?",
            pt="Fique na linha. A ajuda está a ser preparada. A pessoa é adulta?",
        )

    if st.has_complaint and not st.has_address:
        return _msg(
            language,
            en=(
                "I hear chest pain. What is the exact street address, "
                "and is the person conscious and breathing?"
            ),
            es=(
                "Escucho dolor de pecho. ¿Cuál es la dirección exacta, "
                "y la persona está consciente y respirando?"
            ),
            fr=(
                "J'entends une douleur à la poitrine. Quelle est l'adresse exacte, "
                "et la personne est-elle consciente et respire-t-elle ?"
            ),
            de=(
                "Ich höre von Brustschmerzen. Wie lautet die genaue Adresse, "
                "und ist die Person bei Bewusstsein und atmet sie?"
            ),
            pt=(
                "Ouço dor no peito. Qual é o endereço exato, "
                "e a pessoa está consciente e a respirar?"
            ),
        )

    if st.has_complaint and st.has_address and not st.conscious_asked:
        st.conscious_asked = True
        return _msg(
            language,
            en=(
                "Got the location. Is the person awake? "
                "Are they breathing normally right now?"
            ),
            es=(
                "Tengo la ubicación. ¿La persona está despierta? "
                "¿Está respirando con normalidad ahora?"
            ),
            fr=(
                "J'ai l'adresse. La personne est-elle éveillée ? "
                "Respire-t-elle normalement en ce moment ?"
            ),
            de=(
                "Ich habe den Ort. Ist die Person wach? "
                "Atmet sie gerade normal?"
            ),
            pt=(
                "Tenho a localização. A pessoa está acordada? "
                "Está a respirar normalmente agora?"
            ),
        )

    if st.has_complaint and st.has_address:
        return _msg(
            language,
            en=(
                "Thank you. I am preparing the medical response. "
                "Stay on the line and tell me if anything changes."
            ),
            es=(
                "Gracias. Estoy preparando la respuesta médica. "
                "Permanezca en la línea y avíseme si algo cambia."
            ),
            fr=(
                "Merci. Je prépare la réponse médicale. "
                "Restez en ligne et dites-moi si quelque chose change."
            ),
            de=(
                "Danke. Ich bereite die medizinische Reaktion vor. "
                "Bleiben Sie in der Leitung und sagen Sie Bescheid, wenn sich etwas ändert."
            ),
            pt=(
                "Obrigado. Estou a preparar a resposta médica. "
                "Fique na linha e diga-me se algo mudar."
            ),
        )

    # Opening / unclear
    return _msg(
        language,
        en=(
            "AURA emergency intake. What is the emergency, "
            "and where are you calling from?"
        ),
        es=(
            "AURA recepción de emergencias. ¿Cuál es la emergencia "
            "y desde dónde llama?"
        ),
        fr=(
            "AURA prise d'appel d'urgence. Quelle est l'urgence "
            "et d'où appelez-vous ?"
        ),
        de=(
            "AURA Notrufaufnahme. Was ist der Notfall "
            "und von wo rufen Sie an?"
        ),
        pt=(
            "AURA atendimento de emergência. Qual é a emergência "
            "e de onde está a ligar?"
        ),
    )


def _msg(
    language: GradiumLang,
    *,
    en: str,
    es: str,
    fr: str,
    de: str,
    pt: str,
) -> str:
    return {"en": en, "es": es, "fr": fr, "de": de, "pt": pt}.get(language, en)
