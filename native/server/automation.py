import asyncio
import json
import ssl
import time

import paho.mqtt.client as mqtt

from .catalog import ResolutionError, resolve


class Automations:
    def __init__(self, store):
        self.store = store
        self.client = None
        self.connected = False
        self.lock = asyncio.Lock()
        self.states = {}

    def close(self):
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()
        self.client = None
        self.connected = False
        self.states.clear()

    def connect(self):
        self.close()
        cfg = self.store.catalog.settings
        if not cfg.mqtt_host:
            return
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="rosie-native-server")
        if cfg.mqtt_username:
            client.username_pw_set(cfg.mqtt_username, cfg.mqtt_password)
        if cfg.mqtt_tls:
            client.tls_set_context(ssl.create_default_context())

        def connected(c, userdata, flags, reason, properties):
            self.connected = not reason.is_failure
            if self.connected:
                for topic in {d.state_topic for d in self.store.catalog.devices if d.state_topic}:
                    c.subscribe(topic, qos=1)

        def disconnected(c, userdata, flags, reason, properties):
            self.connected = False
            self.states.clear()

        def received(c, userdata, message):
            if len(message.payload) <= 8192:
                self.states[message.topic] = (
                    message.payload.decode(errors="replace"),
                    time.monotonic(),
                )

        client.on_connect = connected
        client.on_disconnect = disconnected
        client.on_message = received
        client.reconnect_delay_set(1, 30)
        client.connect_async(cfg.mqtt_host, cfg.mqtt_port, keepalive=30)
        client.loop_start()
        self.client = client

    def value(self, device):
        record = self.states.get(device.state_topic)
        if not self.connected or record is None or time.monotonic() - record[1] > 300:
            raise ResolutionError("Não tenho um valor recente desse sensor agora.")
        value = record[0]
        if device.state_path:
            try:
                value = json.loads(value)
                for part in device.state_path.split("."):
                    value = value[part]
            except (ValueError, KeyError, TypeError):
                raise ResolutionError("O sensor respondeu em um formato diferente do cadastrado.")
        if (
            value is None
            or isinstance(value, (dict, list))
            or str(value).lower() in ("unknown", "unavailable", "nan")
        ):
            raise ResolutionError("O sensor está sem um valor disponível agora.")
        return str(value)[:200]

    async def execute(self, robot_id, target, action="on", room=None, routine=False):
        async with self.lock:
            catalog = self.store.catalog
            item = resolve(catalog, robot_id, target, room, routine)
            if routine:
                steps = [
                    (next(d for d in catalog.devices if d.id == s.device), s.action)
                    for s in item.steps
                ]
            else:
                steps = [(item, action)]
            if any(a not in d.actions for d, a in steps):
                raise ResolutionError("Essa ação não está cadastrada para o dispositivo.")
            if not self.connected or self.client is None:
                raise ResolutionError("O MQTT está desconectado. Nenhum comando foi enviado.")
            sent = []
            for device, verb in steps:
                info = self.client.publish(
                    device.command_topic, device.actions[verb], qos=1, retain=False
                )
                try:
                    await asyncio.to_thread(info.wait_for_publish, 5)
                    if not info.is_published():
                        raise TimeoutError()
                except (RuntimeError, ValueError, TimeoutError):
                    self.store.event(
                        "mqtt_uncertain",
                        {"robot": robot_id, "device": device.id, "already_sent": sent},
                    )
                    raise ResolutionError(
                        "Não consegui confirmar a entrega ao broker. "
                        "A ação pode ter ocorrido; não vou repeti-la automaticamente."
                    )
                sent.append(device.id)
                self.store.event(
                    "mqtt_sent",
                    {"robot": robot_id, "device": device.id, "room": device.room, "action": verb},
                )
            return "Comando enviado para " + item.name + "."
