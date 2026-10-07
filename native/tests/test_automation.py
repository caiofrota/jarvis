import asyncio

import pytest

from server.catalog import Catalog, ResolutionError, parse_local, resolve


@pytest.fixture
def catalog():
    return Catalog.model_validate(
        {
            "rooms": [{"id": "kitchen", "name": "Cozinha"}, {"id": "living", "name": "Sala"}],
            "robots": [{"id": "rosie", "name": "Rosie", "room": "kitchen", "token": "x" * 24}],
            "devices": [
                {
                    "id": "kitchen_light",
                    "name": "Luz",
                    "room": "kitchen",
                    "command_topic": "test/kitchen/set",
                },
                {
                    "id": "living_light",
                    "name": "Luz",
                    "room": "living",
                    "command_topic": "test/living/set",
                },
            ],
        }
    )


def test_implicit_room_never_falls_back_to_other_room(catalog):
    assert resolve(catalog, "rosie", "luz").id == "kitchen_light"
    catalog.devices.pop(0)
    with pytest.raises(ResolutionError):
        resolve(catalog, "rosie", "luz")


def test_explicit_room_is_respected(catalog):
    assert resolve(catalog, "rosie", "luz", "sála").id == "living_light"
    with pytest.raises(ResolutionError):
        resolve(catalog, "rosie", "luz", "quarto")


def test_ambiguous_target_asks_instead_of_broadcast(catalog):
    second = catalog.devices[0].model_copy(update={"id": "pendant", "name": "Pendente"})
    catalog.devices.append(second)
    # Exact named "Luz" still wins; a generic alias must not pick arbitrarily.
    with pytest.raises(ResolutionError, match="Qual deles"):
        resolve(catalog, "rosie", "iluminação")


@pytest.mark.parametrize(
    "phrase,room,action",
    [
        ("Liga a luz", None, "on"),
        ("Desligue a luz da sala", "sala", "off"),
        ("Por favor acenda a luz na cozinha", "cozinha", "on"),
        ("Liga a luz do quarto", "quarto", "on"),
    ],
)
def test_local_commands_preserve_location(catalog, phrase, room, action):
    assert parse_local(phrase, catalog) == {
        "target": "luz",
        "room": room,
        "routine": False,
        "action": action,
    }


def test_routine_cannot_escape_its_room(catalog):
    value = catalog.model_dump()
    value["routines"] = [
        {
            "id": "night",
            "name": "Boa noite",
            "room": "kitchen",
            "steps": [{"device": "living_light", "action": "off"}],
        }
    ]
    with pytest.raises(ValueError, match="cômodo"):
        Catalog.model_validate(value)


def test_wildcard_topics_are_rejected(catalog):
    value = catalog.model_dump()
    value["devices"][0]["command_topic"] = "home/+/set"
    with pytest.raises(ValueError):
        Catalog.model_validate(value)


def test_mqtt_disconnect_does_not_claim_success(catalog, tmp_path):
    from server.automation import Automations
    from server.store import Store

    store = Store(tmp_path)
    store.save(catalog)
    with pytest.raises(ResolutionError, match="Nenhum comando"):
        asyncio.run(Automations(store).execute("rosie", "luz"))


def test_publish_uses_registered_topic_and_non_retained_payload(catalog, tmp_path):
    from server.automation import Automations
    from server.store import Store

    calls = []

    class Delivery:
        def wait_for_publish(self, timeout):
            pass

        def is_published(self):
            return True

    class Broker:
        def publish(self, topic, payload, qos, retain):
            calls.append((topic, payload, qos, retain))
            return Delivery()

    store = Store(tmp_path)
    store.save(catalog)
    automation = Automations(store)
    automation.client, automation.connected = Broker(), True
    answer = asyncio.run(automation.execute("rosie", "luz", "on"))
    assert calls == [("test/kitchen/set", "ON", 1, False)]
    assert "enviado" in answer


def test_intent_is_local_and_renders_sensor_value(catalog, tmp_path):
    import time

    from server.automation import Automations
    from server.conversation import Conversation
    from server.store import Store

    value = catalog.model_dump()
    value["devices"].append(
        {
            "id": "outside",
            "name": "Temperatura externa",
            "room": "kitchen",
            "kind": "sensor",
            "state_topic": "test/weather",
            "state_path": "temperature",
        }
    )
    value["intents"] = [
        {
            "id": "weather",
            "name": "Clima",
            "phrases": ["Qual a temperatura lá fora?"],
            "responses": ["Lá fora está {valor} graus. O sol ligou o modo air fryer!"],
            "device": "outside",
        }
    ]
    store = Store(tmp_path)
    store.save(Catalog.model_validate(value))
    automation = Automations(store)
    automation.connected = True
    automation.states["test/weather"] = ('{"temperature": 31}', time.monotonic())
    c = Conversation(store, automation)
    assert "31 graus" in asyncio.run(c.respond("rosie", "qual a temperatura la fora")).text
    automation.states.clear()
    assert "valor recente" in asyncio.run(c.respond("rosie", "Qual a temperatura lá fora?")).text


def test_intent_rejects_expression_evaluation(catalog):
    value = catalog.model_dump()
    value["intents"] = [
        {"id": "bad", "name": "Bad", "phrases": ["oi"], "responses": ["{nome.__class__}"]}
    ]
    with pytest.raises(ValueError):
        Catalog.model_validate(value)
