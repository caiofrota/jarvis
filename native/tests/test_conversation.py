import asyncio
import json

import httpx
import pytest

from server.catalog import Catalog
from server.conversation import Conversation
from server.intent_examples import EXPRESSION_INTENTS
from server.store import Store


def fixture_conversation(tmp_path):
    store = Store(tmp_path)
    store.save(
        Catalog.model_validate(
            {
                "settings": {"api_key": "fixture-key"},
                "rooms": [{"id": "office", "name": "Escritório"}],
                "robots": [{"id": "rosie", "name": "Rosie", "room": "office", "token": "x" * 24}],
                "intents": [
                    {
                        "id": "greeting",
                        "name": "Saudação",
                        "phrases": ["Bom dia"],
                        "responses": ["Bom dia!"],
                        "expression": "happy",
                    }
                ],
            }
        )
    )

    class Automations:
        calls = []

        async def execute(self, robot_id, **args):
            self.calls.append((robot_id, args))
            return "Comando enviado."

    return Conversation(store, Automations())


@pytest.mark.parametrize("provider", ["openai", "deepseek"])
@pytest.mark.parametrize(
    "expression", ["curious", "confused", "excited", "shy", "skeptical", "proud", "affectionate"]
)
def test_one_llm_request_returns_speech_and_expression(tmp_path, monkeypatch, provider, expression):
    conversation = fixture_conversation(tmp_path)
    conversation.store.catalog.settings.provider = provider
    requests = []
    original_client = httpx.AsyncClient

    def handle(request):
        payload = json.loads(request.content)
        requests.append(payload)
        expected_type = "json_schema" if provider == "openai" else "json_object"
        assert payload["response_format"]["type"] == expected_type
        if provider == "openai":
            schema = payload["response_format"]["json_schema"]["schema"]
            assert expression in schema["properties"]["expression"]["enum"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {"text": "Você prefere amanhã?", "expression": expression}
                            )
                        },
                    }
                ]
            },
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original_client(**kw, transport=httpx.MockTransport(handle)),
    )
    reply = asyncio.run(conversation.respond("rosie", "Vamos organizar meu dia"))
    assert reply.text == "Você prefere amanhã?"
    assert reply.expression == expression
    assert len(requests) == 1
    assert not conversation.automations.calls
    local = asyncio.run(conversation.respond("rosie", "Bom dia!"))
    assert (local.text, local.expression) == ("Bom dia!", "happy")
    assert len(requests) == 1


@pytest.mark.parametrize(
    "content,finish",
    [
        ('{"text":"Oi","expression":"evil"}', "stop"),
        ('{"text":"Oi","expression":"happy","command":"any"}', "stop"),
        ('{"text":"Oi",', "length"),
        ("", "stop"),
    ],
)
def test_malformed_provider_metadata_never_becomes_spoken_text(
    tmp_path, monkeypatch, content, finish
):
    conversation = fixture_conversation(tmp_path)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original_client(
            **kw,
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={"choices": [{"finish_reason": finish, "message": {"content": content}}]},
                )
            ),
        ),
    )
    with pytest.raises(ValueError):
        asyncio.run(conversation.respond("rosie", "Conte algo"))
    assert not conversation.history
    assert not conversation.automations.calls


def test_tool_round_preserves_room_and_final_expression(tmp_path, monkeypatch):
    conversation = fixture_conversation(tmp_path)
    original_client = httpx.AsyncClient
    requests = []

    def handle(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if len(requests) == 1:
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "fixture",
                        "type": "function",
                        "function": {
                            "name": "control_home",
                            "arguments": json.dumps(
                                {"target": "luz", "action": "on", "room": "sala", "routine": False}
                            ),
                        },
                    }
                ],
            }
        else:
            assert payload["tool_choice"] == "none"
            assert payload["messages"][-1]["content"] == "Comando enviado."
            message = {"content": '{"text":"Comando enviado.","expression":"neutral"}'}
        return httpx.Response(200, json={"choices": [{"message": message}]})

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original_client(**kw, transport=httpx.MockTransport(handle)),
    )
    result = asyncio.run(conversation.respond("rosie", "Pode iluminar a sala?"))
    assert result.expression == "neutral"
    assert conversation.automations.calls == [
        ("rosie", {"target": "luz", "action": "on", "room": "sala", "routine": False})
    ]
    assert len(requests) == 2


def test_playful_angry_face_is_editable_local_intent_without_cloud_or_home_actions(
    tmp_path, monkeypatch
):
    from server.catalog import CustomIntent
    from server.intent_examples import ANGRY_FACE

    conversation = fixture_conversation(tmp_path)
    conversation.store.catalog.intents.append(CustomIntent.model_validate(ANGRY_FACE))
    conversation.store.catalog.settings.api_key = ""

    def no_cloud(**kwargs):
        raise AssertionError("Local face demonstration must not call a provider")

    monkeypatch.setattr(httpx, "AsyncClient", no_cloud)
    for phrase in ["Você fica com raiva?", "Rosie, você fica brava?", "Faz cara de brava!"]:
        reply = asyncio.run(conversation.respond("rosie", phrase))
        assert reply.expression == "angry"
        assert reply.text in ANGRY_FACE["responses"]
    greeting = asyncio.run(conversation.respond("rosie", "Bom dia"))
    assert greeting.expression == "happy"
    assert greeting.text == "Bom dia!"
    assert not conversation.automations.calls
    conversation.store.catalog.intents[-1].responses = ["Essa é minha cara."]
    assert (
        asyncio.run(conversation.respond("rosie", "Você fica brava?")).text == "Essa é minha cara."
    )


@pytest.mark.parametrize("example", EXPRESSION_INTENTS, ids=lambda item: item["expression"])
def test_each_expression_intent_resolves_its_phrases_locally(tmp_path, monkeypatch, example):
    from server.catalog import CustomIntent, normalize

    conversation = fixture_conversation(tmp_path)
    conversation.store.catalog.settings.api_key = ""
    conversation.store.catalog.intents.extend(
        CustomIntent.model_validate(item) for item in EXPRESSION_INTENTS
    )

    def no_cloud(**kwargs):
        raise AssertionError("Expression demo must not call a provider")

    monkeypatch.setattr(httpx, "AsyncClient", no_cloud)
    all_phrases = [normalize(phrase) for item in EXPRESSION_INTENTS for phrase in item["phrases"]]
    assert len(all_phrases) == len(set(all_phrases))
    assert "estou triste" not in all_phrases, "User distress must not trigger a joking face demo"
    for phrase in example["phrases"]:
        reply = asyncio.run(conversation.respond("rosie", phrase + "!"))
        assert reply.expression == example["expression"]
        assert reply.text in example["responses"]
    assert not conversation.automations.calls
