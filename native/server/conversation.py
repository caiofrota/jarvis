import json
import random
import time
from datetime import datetime

import httpx

from .catalog import ResolutionError, normalize, parse_local
from .reply import Reply

REPLY_INSTRUCTIONS = (
    '\nRetorne JSON com exatamente "text" (fala em português) e "expression". '
    'Exemplo: {"text":"Você prefere amanhã?","expression":"curious"}. '
    "Escolha a expressão pelo tom da SUA resposta: neutral para informações e respostas comuns; "
    "happy para alegria; sad para tristeza ou acolhimento; angry para indignação pertinente, "
    "sem hostilidade ao usuário; surprised para surpresa; curious para interesse atento e perguntas; "
    "confused para confusão ou dúvida real; excited para entusiasmo e comemoração; "
    "shy para timidez brincalhona; skeptical para desconfiança leve em brincadeiras; "
    "proud para satisfação por uma conquista; affectionate para carinho e acolhimento. "
    "Curiosidade é interesse, não confusão. Prefira neutral em respostas práticas. "
    "Não force emoções nem piadas. Não escreva nomes de emoções, instruções de atuação ou "
    "marcações na fala. Preserve a interrogação nas perguntas."
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "control_home",
            "description": "Controla um dispositivo ou rotina cadastrados. "
            "Omitir o cômodo usa o cômodo atual do robô. Nunca invente tópicos MQTT.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "action": {"type": "string"},
                    "room": {"type": ["string", "null"]},
                    "routine": {"type": "boolean"},
                },
                "required": ["target", "action", "room", "routine"],
                "additionalProperties": False,
            },
        },
    }
]


class Conversation:
    def __init__(self, store, automations):
        self.store, self.automations = store, automations
        self.history = {}

    def reset(self, robot_id):
        self.history.pop(robot_id, None)

    async def respond(self, robot_id, text):
        result = await self._respond(robot_id, text)
        return result if isinstance(result, Reply) else Reply.plain(result)

    async def _respond(self, robot_id, text):
        started = time.monotonic()
        catalog = self.store.catalog
        cfg = catalog.settings
        if normalize(text) in ("que horas sao", "que horas sao agora", "me diga as horas"):
            return "Agora são " + datetime.now().astimezone().strftime("%H:%M") + "."
        robot = next(r for r in catalog.robots if r.id == robot_id)
        candidates = [
            i
            for i in catalog.intents
            if normalize(text) in {normalize(p) for p in i.phrases} and i.room in (None, robot.room)
        ]
        scoped = [i for i in candidates if i.room == robot.room]
        candidates = scoped or candidates
        if candidates:
            if len(candidates) != 1:
                return "Há duas intents cadastradas para essa frase. Ajuste o cadastro no painel."
            intent = candidates[0]
            device = next((d for d in catalog.devices if d.id == intent.device), None)
            room_name = next(r.name for r in catalog.rooms if r.id == robot.room)
            template = random.choice(intent.responses)
            try:
                value = self.automations.value(device) if "{valor}" in template else ""
            except ResolutionError as exc:
                return str(exc)
            return Reply(
                text=template.format(
                    valor=value, nome=device.name if device else robot.name, ambiente=room_name
                ),
                expression=intent.expression,
            )
        command = parse_local(text, catalog)
        if command:
            try:
                answer = await self.automations.execute(robot_id, **command)
            except ResolutionError as exc:
                answer = str(exc)
            return answer
        if not cfg.api_key:
            return "Cadastre a chave do provedor no painel para habilitar a conversa."
        robot = next(r for r in catalog.robots if r.id == robot_id)
        # No broker topics, passwords or internal tokens are sent to a provider.
        inventory = {
            "rooms": [r.model_dump() for r in catalog.rooms],
            "devices": [
                {
                    "name": d.name,
                    "aliases": d.aliases,
                    "room": d.room,
                    "kind": d.kind,
                    "actions": list(d.actions),
                }
                for d in catalog.devices
            ],
            "routines": [{"name": r.name, "room": r.room} for r in catalog.routines],
        }
        prompt = (
            cfg.personality
            + "\nAgora: "
            + datetime.now().astimezone().isoformat()
            + "\nCômodo do robô: "
            + robot.room
            + "\nCadastro: "
            + json.dumps(inventory, ensure_ascii=False)
            + "\nPara automação use control_home. Nunca diga que executou algo sem resultado da função. "
            "Se houver dúvida, pergunte. Ausência de cômodo significa este cômodo; preserve cômodos explícitos."
            + REPLY_INSTRUCTIONS
        )
        previous = (
            self.history.get(robot_id, [])[-cfg.history_turns * 2 :] if cfg.history_turns else []
        )
        messages = [
            {"role": "system", "content": prompt},
            *previous,
            {"role": "user", "content": text[:4000]},
        ]
        url = (
            "https://api.openai.com/v1/chat/completions"
            if cfg.provider == "openai"
            else "https://api.deepseek.com/chat/completions"
        )
        answer = Reply.plain("Não consegui concluir essa solicitação.")
        async with httpx.AsyncClient(timeout=30) as client:
            for iteration in range(3):
                payload = {
                    "model": cfg.model,
                    "messages": messages,
                    "max_tokens": cfg.max_output_tokens,
                    "tools": TOOLS,
                    "parallel_tool_calls": False,
                }
                if cfg.provider == "deepseek":
                    payload["thinking"] = {"type": "disabled"}
                    payload["response_format"] = {"type": "json_object"}
                else:
                    payload["response_format"] = {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "robot_reply",
                            "strict": True,
                            "schema": Reply.model_json_schema(),
                        },
                    }
                if iteration >= 1:
                    payload["tool_choice"] = "none"
                response = await client.post(
                    url, json=payload, headers={"Authorization": "Bearer " + cfg.api_key}
                )
                response.raise_for_status()
                result = response.json()
                self.store.event(
                    "llm_usage",
                    {
                        "robot": robot_id,
                        "provider": cfg.provider,
                        "model": cfg.model,
                        "usage": result.get("usage", {}),
                        "elapsed_ms": round((time.monotonic() - started) * 1000),
                    },
                )
                message = result["choices"][0]["message"]
                calls = message.get("tool_calls", [])
                if not calls:
                    if result["choices"][0].get("finish_reason") == "length":
                        raise ValueError("Incomplete conversation response")
                    answer = Reply.model_validate_json(message.get("content") or "")
                    break
                messages.append(
                    {k: message[k] for k in ("role", "content", "tool_calls") if k in message}
                )
                for call in calls:
                    try:
                        if call["function"]["name"] != "control_home":
                            raise ResolutionError("Função não permitida.")
                        args = json.loads(call["function"]["arguments"])
                        if set(args) - {"target", "action", "room", "routine"}:
                            raise ResolutionError("Parâmetros inválidos.")
                        result_text = await self.automations.execute(robot_id, **args)
                    except (ResolutionError, TypeError, ValueError) as exc:
                        result_text = str(exc)
                    messages.append(
                        {"role": "tool", "tool_call_id": call["id"], "content": result_text}
                    )
        self.history[robot_id] = [
            *previous,
            {"role": "user", "content": text[:4000]},
            {"role": "assistant", "content": answer.model_dump_json()},
        ][-24:]
        return answer
