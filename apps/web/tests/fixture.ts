import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase, json, Repository } from "@rosie/db";
import { collections, type Entity, emptyCatalog, schemas, settingsSchema } from "@rosie/types";
export function catalogFixture() {
  const c = emptyCatalog();
  c.homes = [schemas.homes.parse({ id: "home", name: "Casa", city: "Fortaleza" })];
  c.rooms = [
    schemas.rooms.parse({ id: "office", name: "Escritório", homeId: "home" }),
    schemas.rooms.parse({ id: "kitchen", name: "Cozinha", homeId: "home" }),
  ];
  c.assistants = [schemas.assistants.parse({ id: "rosie", name: "Rosie", homeId: "home" })];
  c.endpoints = ["one", "two"].map((id, i) =>
    schemas.endpoints.parse({
      id,
      name: `Caixinha ${id}`,
      homeId: "home",
      roomId: i ? "kitchen" : "office",
      assistantId: "rosie",
      token: `fixture-credential-${id}`,
    }),
  );
  c.devices = ["office", "kitchen"].map((room) =>
    schemas.devices.parse({
      id: `light-${room}`,
      name: "Luz",
      homeId: "home",
      roomId: room,
      commandTopic: `fixture/${room}/set`,
    }),
  );
  c.intents = [
    schemas.intents.parse({
      id: "greeting",
      name: "Saudação",
      homeId: "home",
      phrases: ["bom dia"],
      responses: ["Olá, eu sou {robo} em {ambiente}."],
      expression: "happy",
    }),
  ];
  return c;
}
export async function repositoryFixture() {
  const dir = mkdtempSync(join(tmpdir(), "rosie-test-")),
    db = createDatabase(`file:${dir}/test.sqlite`);
  const migrations = resolve(import.meta.dirname, "../../../packages/db/prisma/migrations");
  for (const entry of readdirSync(migrations, { withFileTypes: true })
    .filter((v) => v.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = readFileSync(join(migrations, entry.name, "migration.sql"), "utf8");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.$executeRawUnsafe(statement);
  }
  const repo = new Repository(db),
    catalog = catalogFixture();
  for (const collection of collections)
    for (const value of catalog[collection] as Entity[])
      await db.entry.create({
        data: { collection, id: value.id, name: value.name, data: json(value) },
      });
  await db.setting.createMany({
    data: [
      { id: "settings", data: json(settingsSchema.parse({})) },
      { id: "schema-version", data: 2 },
    ],
  });
  return {
    repo,
    dir,
    close: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
