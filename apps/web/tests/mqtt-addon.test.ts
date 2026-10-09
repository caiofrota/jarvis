import { EventEmitter } from "node:events";
import { schemas, settingsSchema } from "@rosie/types";
import mqtt from "mqtt";
import { afterEach, expect, it, vi } from "vitest";
import { MqttAddon } from "../src/server/addons/mqtt";

vi.mock("mqtt", () => ({ default: { connect: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());

it("isolates MQTT lifecycle, accepts only subscribed states, expires readings and avoids resending uncertain commands", async () => {
  let now = 1000000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const client = Object.assign(new EventEmitter(), {
    connected: true,
    end: vi.fn(),
    subscribeAsync: vi.fn(async () => []),
    unsubscribeAsync: vi.fn(async () => {}),
    publishAsync: vi.fn(async () => {}),
  });
  vi.mocked(mqtt.connect).mockReturnValue(client as unknown as ReturnType<typeof mqtt.connect>);
  const addon = new MqttAddon(),
    cfg = settingsSchema.parse({ mqttHost: "fixture-broker" });
  const sensor = schemas.devices.parse({
    id: "temperature",
    name: "Temperature",
    homeId: "home",
    roomId: "office",
    kind: "sensor",
    stateTopic: "zigbee/outside",
    statePath: "temperature",
  });
  await addon.subscribe([sensor.stateTopic]);
  await addon.configure(cfg);
  client.emit("connect");
  expect(client.subscribeAsync).toHaveBeenCalledWith([sensor.stateTopic], { qos: 1 });
  client.emit("message", "unregistered", Buffer.from('{"temperature":99}'));
  expect(() => addon.value(sensor)).toThrow(/recente/);
  client.emit("message", sensor.stateTopic, Buffer.from('{"temperature":29.5}'));
  expect(addon.value(sensor, 30)).toBe("29.5");
  now += 31000;
  expect(() => addon.value(sensor, 30)).toThrow(/recente/);
  client.emit("message", sensor.stateTopic, Buffer.from('{"temperature":28}'));
  client.emit("offline");
  expect(() => addon.value(sensor)).toThrow(/recente/);
  client.emit("message", sensor.stateTopic, Buffer.from('{"temperature":27}'));
  await addon.subscribe([]);
  expect(client.unsubscribeAsync).toHaveBeenCalledWith([sensor.stateTopic]);
  expect(() => addon.value(sensor)).toThrow();
  client.publishAsync.mockRejectedValueOnce(new Error("timeout"));
  await expect(addon.publish("fixture/set", "ON")).rejects.toThrow("timeout");
  expect(client.publishAsync).toHaveBeenCalledTimes(1);
  await addon.configure({ ...cfg, mqttEnabled: false });
  expect(client.end).toHaveBeenCalled();
  expect(addon.connected).toBe(false);
  await expect(addon.publish("fixture/set", "ON")).rejects.toThrow(/desconectado/);
  client.emit("message", sensor.stateTopic, Buffer.from('{"temperature":99}'));
  expect(() => addon.value(sensor)).toThrow();
});

it("drops retained and oversized requests and subscribes only to configured command topics", async () => {
  const client = Object.assign(new EventEmitter(), {
    connected: true,
    end: vi.fn(),
    subscribeAsync: vi.fn(async () => []),
    unsubscribeAsync: vi.fn(async () => {}),
    publishAsync: vi.fn(async () => {}),
  });
  vi.mocked(mqtt.connect).mockReturnValue(client as unknown as ReturnType<typeof mqtt.connect>);
  const addon = new MqttAddon(),
    handler = vi.fn(),
    topic = "rosie/home/one/request";
  try {
    await addon.configure(settingsSchema.parse({ mqttHost: "fixture-broker" }));
    await addon.commands([topic], handler);
    client.emit("message", topic, Buffer.from("{}"), { retain: true });
    client.emit("message", "rosie/other/one/request", Buffer.from("{}"), { retain: false });
    client.emit("message", topic, Buffer.alloc(8193), { retain: false });
    expect(handler).not.toHaveBeenCalled();
    client.emit("message", topic, Buffer.from("{}"), { retain: false });
    expect(handler).toHaveBeenCalledTimes(1);
    await addon.commands([], handler);
    client.emit("message", topic, Buffer.from("{}"), { retain: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.unsubscribeAsync).toHaveBeenCalledWith([topic]);
  } finally {
    addon.close();
  }
});
