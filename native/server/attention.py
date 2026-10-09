"""Explicit end-of-conversation phrases, resolved without an LLM call."""

import re

from .catalog import normalize

STOP_PHRASES = {
    "cancela",
    "cancelar",
    "cancele",
    "pode cancelar",
    "cancela a conversa",
    "cancele a conversa",
    "cancelar a conversa",
    "cancela conversa",
    "cancele conversa",
    "cancelar conversa",
    "pode cancelar a conversa",
    "para",
    "pare",
    "parar",
    "pode parar",
    "para de falar",
    "pare de falar",
    "pare de ouvir",
    "para de ouvir",
    "pare de escutar",
    "para de escutar",
    "pode parar de ouvir",
    "pode parar de falar",
    "chega",
    "ja chega",
    "tchau",
    "ate logo",
    "ate mais",
    "dormir",
    "durma",
    "vai dormir",
    "va dormir",
    "pode dormir",
    "volta a dormir",
    "volte a dormir",
    "encerre a conversa",
    "encerra a conversa",
    "encerrar a conversa",
    "encerra conversa",
    "encerre conversa",
    "encerrar conversa",
    "pode encerrar a conversa",
    "encerre",
    "encerra",
    "encerrar",
    "encerre a conversacao",
    "encerre a escuta",
    "encerra a escuta",
    "encerre o assunto",
}


def is_stop_phrase(text: str) -> bool:
    # Only complete commands match: "para que serve" and "não pare" must not stop.
    phrase = normalize(text)
    edge = r"(?:rosie|rozi|rosy|por favor)"
    previous = None
    while phrase != previous:
        previous = phrase
        phrase = re.sub(rf"^{edge}\s+|\s+{edge}$", "", phrase).strip()
    return phrase in STOP_PHRASES
