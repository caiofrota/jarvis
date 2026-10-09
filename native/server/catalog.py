"""Validated catalog and deterministic room resolution, independent of the LLM."""

import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .reply import Expression

CHARACTER_PERSONALITY = (
    "Interprete Rosie como uma personagem robótica de mesa, com uma carinha animada. "
    "Quando o usuário brincar com seu humor ou pedir uma expressão, entre na brincadeira "
    "com uma fala curta e a expressão correspondente. Por exemplo, para 'você fica com raiva?', "
    "diga 'Olha minha cara de brava!' com expression angry. "
    "Evite quebrar essas brincadeiras com avisos genéricos como 'sou uma IA' ou "
    "'não sinto emoções'. Isso é atuação da personagem; não alegue sentimentos humanos reais. "
    "Se perguntarem explicitamente sobre seu funcionamento, explique com honestidade. "
    "Fora dessas interações, continue respondendo normalmente, sem forçar piadas."
)

DEFAULT_PERSONALITY = (
    "Você é Rosie, uma robô de mesa. Converse em português brasileiro, em 1 a 3 frases, "
    "com naturalidade e atenção ao contexto. Responda normalmente por padrão. "
    "Use humor apenas ocasionalmente, quando o assunto ou o usuário convidarem; "
    "não acrescente piadas a saudações, agradecimentos ou respostas práticas por hábito. "
    "Em assuntos tristes ou sérios, seja acolhedora e direta. "
    "Não invente estados da casa. Sem emojis nas respostas. "
    "Faça perguntas de volta só quando forem úteis, mantendo a pontuação natural. "
    + CHARACTER_PERSONALITY
)


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(c for c in value if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^\w\s-]", " ", value).split())


class Room(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=80)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class Device(Room):
    room: str
    kind: Literal["light", "switch", "fan", "climate", "sensor", "other"] = "light"
    command_topic: str = Field(default="", max_length=200)
    state_topic: str = Field(default="", max_length=200)
    state_path: str = Field(default="", max_length=100)
    actions: dict[str, str] = Field(default_factory=lambda: {"on": "ON", "off": "OFF"})

    @field_validator("command_topic", "state_topic")
    @classmethod
    def exact_topic(cls, value):
        if any(c in value for c in ("#", "+", "\0")) or value.startswith("$"):
            raise ValueError("Use um tópico MQTT exato, sem curingas ou tópico de sistema.")
        return value

    @field_validator("actions")
    @classmethod
    def bounded_actions(cls, value):
        if len(value) > 20:
            raise ValueError("Cadastre no máximo 20 ações.")
        if any(not k or len(k) > 40 or len(v.encode()) > 4096 for k, v in value.items()):
            raise ValueError("Ação ou mensagem MQTT inválida.")
        return value

    @model_validator(mode="after")
    def action_topic(self):
        if self.kind == "sensor":
            self.actions = {}
        elif not self.command_topic or not self.actions:
            raise ValueError("Dispositivos controláveis precisam de tópico e ações.")
        return self


class Robot(Room):
    room: str
    token: str = Field(min_length=16, max_length=128)


class Step(BaseModel):
    device: str
    action: str


class Routine(Room):
    room: str
    steps: list[Step] = Field(min_length=1, max_length=20)


class Settings(BaseModel):
    provider: Literal["openai", "deepseek"] = "openai"
    model: str = "gpt-4o-mini"
    api_key: str = ""
    mqtt_host: str = ""
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_tls: bool = False
    listen_seconds: int = Field(default=30, ge=5, le=120)
    drowsy_seconds: int = Field(default=60, ge=0, le=3600)
    prefill_ms: int = Field(default=600, ge=60, le=1800)
    volume: int = Field(default=70, ge=0, le=100)
    stt_model: Literal["tiny", "base", "small"] = "base"
    tts_voice: str = "pt_BR-faber-medium"
    tts_quality: Literal["fast", "detailed"] = "fast"
    max_output_tokens: int = Field(default=300, ge=64, le=1000)
    history_turns: int = Field(default=4, ge=0, le=12)
    personality: str = Field(
        default=DEFAULT_PERSONALITY,
        max_length=3000,
    )

    @field_validator("tts_voice")
    @classmethod
    def voice_filename(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
            raise ValueError("Nome da voz inválido.")
        return value


class CustomIntent(Room):
    room: str | None = None
    phrases: list[str] = Field(min_length=1, max_length=30)
    responses: list[str] = Field(min_length=1, max_length=30)
    device: str | None = None
    expression: Expression = "neutral"

    @field_validator("responses")
    @classmethod
    def safe_placeholders(cls, values):
        for text in values:
            if len(text) > 1000 or re.search(
                r"[{}]", re.sub(r"\{(?:valor|nome|ambiente)\}", "", text)
            ):
                raise ValueError("Use apenas {valor}, {nome} e {ambiente} nas respostas.")
        return values


class Catalog(BaseModel):
    settings: Settings = Field(default_factory=Settings)
    rooms: list[Room] = Field(default_factory=list, max_length=100)
    devices: list[Device] = Field(default_factory=list, max_length=500)
    robots: list[Robot] = Field(default_factory=list, max_length=20)
    routines: list[Routine] = Field(default_factory=list, max_length=100)
    intents: list[CustomIntent] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def references(self):
        for items in (self.rooms, self.devices, self.robots, self.routines, self.intents):
            if len({x.id for x in items}) != len(items):
                raise ValueError("IDs duplicados no cadastro.")
        rooms = {x.id for x in self.rooms}
        for item in [*self.devices, *self.robots, *self.routines]:
            if item.room not in rooms:
                raise ValueError(f"Cômodo inexistente: {item.room}")
        devices = {x.id: x for x in self.devices}
        for intent in self.intents:
            if intent.room is not None and intent.room not in rooms:
                raise ValueError("Cômodo da intent inexistente.")
            if intent.device is not None and intent.device not in devices:
                raise ValueError("Sensor da intent inexistente.")
            if any("{valor}" in text for text in intent.responses) and not intent.device:
                raise ValueError("Respostas com {valor} precisam de um sensor.")
        for routine in self.routines:
            for step in routine.steps:
                d = devices.get(step.device)
                if d is None or step.action not in d.actions or d.room != routine.room:
                    raise ValueError(
                        "Cada etapa da rotina precisa pertencer ao seu cômodo "
                        "e usar uma ação cadastrada."
                    )
        return self


KIND_NAMES = {
    "light": ["luz", "luzes", "lampada", "lampadas", "iluminacao"],
    "fan": ["ventilador"],
    "switch": ["tomada", "interruptor"],
    "climate": ["ar", "ar condicionado"],
}


class ResolutionError(ValueError):
    pass


def matches(item, name):
    return normalize(name) in {normalize(x) for x in [item.id, item.name, *item.aliases]}


def resolve_room(catalog: Catalog, name: str | None, robot_id: str) -> str:
    robot = next((r for r in catalog.robots if r.id == robot_id), None)
    if robot is None:
        raise ResolutionError("Robô não cadastrado.")
    if not name:
        return robot.room
    rooms = [r for r in catalog.rooms if matches(r, name)]
    if len(rooms) != 1:
        raise ResolutionError(f"Não identifiquei um único cômodo chamado {name}.")
    return rooms[0].id


def resolve(
    catalog: Catalog, robot_id: str, target: str, room: str | None = None, routine: bool = False
):
    room_id = resolve_room(catalog, room, robot_id)
    items = [i for i in (catalog.routines if routine else catalog.devices) if i.room == room_id]
    found = [i for i in items if matches(i, target)]
    if not found and not routine:
        kinds = [k for k, names in KIND_NAMES.items() if normalize(target) in names]
        found = [i for i in items if i.kind in kinds]
    if not found:
        raise ResolutionError(
            "Não encontrei esse dispositivo ou rotina nesse cômodo. "
            "Diga o nome e o cômodo desejados."
        )
    if len(found) > 1:
        raise ResolutionError("Qual deles: " + ", ".join(i.name for i in found) + "?")
    return found[0]


def parse_local(text: str, catalog: Catalog):
    """Only parse explicit familiar commands; do not guess unrecognized locations."""
    value = normalize(text)
    action_match = re.fullmatch(
        r"(?:por favor )?(liga|ligue|acende|acenda|desliga|desligue|apaga|apague) "
        r"(?:a |o |as |os )?(.+?)(?: por favor)?",
        value,
    )
    if not action_match:
        for routine in catalog.routines:
            if matches(routine, value):
                return {"target": value, "room": None, "routine": True, "action": "run"}
        return None
    verb, target = action_match.groups()
    room = None
    # Treat any location suffix as explicit, even when unknown: never fall back locally.
    location = re.fullmatch(r"(.+?) (?:da|do|na|no|em) (.+)", target)
    if location:
        target, room = location.groups()
    return {
        "target": target,
        "room": room,
        "routine": False,
        "action": "off" if verb.startswith(("deslig", "apag")) else "on",
    }
