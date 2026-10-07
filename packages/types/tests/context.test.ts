import { describe, expect, it } from "vitest";
import { context, selectVariant, validateReferences } from "../src/context";
import { emptyCatalog, schemas } from "../src/index";

function fixture() {
  const c = emptyCatalog();
  c.homes = [
    schemas.homes.parse({ id: "home", name: "Casa", defaults: { volume: 60 } }),
    schemas.homes.parse({ id: "other", name: "Outra casa" }),
  ];
  c.rooms = [
    schemas.rooms.parse({ id: "office", name: "Escritório", homeId: "home" }),
    schemas.rooms.parse({ id: "abroad", name: "Outro local", homeId: "other" }),
  ];
  c.assistants = [schemas.assistants.parse({ id: "rosie", name: "Rosie", homeId: "home" })];
  c.modes = [
    schemas.modes.parse({ id: "night", name: "Noturno", homeId: "home", volumeLimit: 20 }),
  ];
  c.endpoints = [
    schemas.endpoints.parse({
      id: "one",
      name: "Caixinha",
      homeId: "home",
      roomId: "office",
      assistantId: "rosie",
      token: "fixture-not-a-secret",
      volume: 80,
    }),
  ];
  return c;
}
describe("household boundaries", () => {
  it("inherits defaults, retains endpoint overrides and applies a mode cap", () => {
    const c = fixture();
    expect(context(c, "one").audio.volume).toBe(80);
    c.endpoints[0].volume = null;
    expect(context(c, "one").audio.volume).toBe(60);
    c.endpoints[0].modeId = "night";
    expect(context(c, "one").audio.volume).toBe(20);
    expect(context(c, "one").sources.volume).toBe("Noturno");
  });
  it("rejects links across homes and removal of referenced records", () => {
    const c = fixture();
    validateReferences(c);
    c.endpoints[0].roomId = "abroad";
    expect(() => validateReferences(c)).toThrow(/outra casa/);
    c.endpoints[0].roomId = "office";
    c.assistants = [];
    expect(() => validateReferences(c)).toThrow();
  });
  it("selects a scoped override and rejects incomparable applicable definitions", () => {
    const c = fixture(),
      ctx = context(c, "one"),
      base = schemas.intents.parse({
        id: "greet",
        name: "Saudação",
        homeId: "home",
        phrases: ["oi"],
        responses: ["Olá!"],
      }),
      room = schemas.intents.parse({
        ...base,
        id: "office-greet",
        extendsId: "greet",
        scope: { roomIds: ["office"] },
      }),
      robot = schemas.intents.parse({
        ...base,
        id: "robot-greet",
        scope: { assistantIds: ["rosie"] },
      });
    expect(selectVariant([base, room], ctx)?.id).toBe("office-greet");
    expect(() => selectVariant([base, room, robot], ctx)).toThrow(/mais de uma/);
    c.intents = [base, room];
    validateReferences(c);
    room.scope = { assistantIds: [], roomIds: [], residentIds: [], modeIds: [] };
    expect(() => validateReferences(c)).toThrow(/mais específicas/);
  });
  it("rejects disabled assistants and unsupported response placeholders", () => {
    const c = fixture();
    c.assistants[0].enabled = false;
    expect(() => context(c, "one")).toThrow();
    expect(() =>
      schemas.intents.parse({
        id: "x",
        name: "Teste",
        homeId: "home",
        phrases: ["oi"],
        responses: ["{password}"],
      }),
    ).toThrow();
  });
});
