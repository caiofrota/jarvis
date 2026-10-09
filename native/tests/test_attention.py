import pytest

from server.attention import is_stop_phrase


@pytest.mark.parametrize(
    "text",
    [
        "para",
        "pare",
        "cancelar",
        "Cancela conversa.",
        "pode encerrar a conversa",
        "cancele a conversa",
        "Rosie, pode parar?",
        "Por favor, Rosie, volte a dormir",
        "Já chega!",
        "pode dormir, Rosie, por favor",
        "encerre a conversa",
        "tchau",
        "pare de falar",
    ],
)
def test_explicit_stop_commands(text):
    assert is_stop_phrase(text)


@pytest.mark.parametrize(
    "text",
    [
        "para que serve o microfone",
        "não pare",
        "não pode dormir",
        "boa noite",
        "cancele o alarme",
        "pare o ventilador",
        "o ônibus já chega",
        "como cancelar uma compra",
    ],
)
def test_mentions_and_device_commands_are_not_conversation_cancellation(text):
    assert not is_stop_phrase(text)
