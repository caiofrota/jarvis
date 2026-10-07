import { chmod, copyFile, readFile } from "node:fs/promises";
import { createDatabase, json, Repository } from "@rosie/db";
import { catalogEntries, migrateLegacy } from "../src/server/catalog/migration";

const source = process.env.ROSIE_LEGACY_CATALOG;
const url = process.env.DATABASE_URL;
if (!source || !url) throw new Error("Set ROSIE_LEGACY_CATALOG and DATABASE_URL explicitly.");
const db = createDatabase(url),
  repo = new Repository(db);
try {
  if (await repo.ready())
    throw new Error("Destination is already initialized; import will not overwrite it.");
  const { catalog, settings } = migrateLegacy(JSON.parse(await readFile(source, "utf8")));
  const backup = `${source}.before-node-${Date.now()}`;
  await copyFile(source, backup);
  await chmod(backup, 0o600);
  await db.$transaction(async (tx) => {
    if (await tx.entry.count()) throw new Error("Destination is not empty.");
    await tx.entry.createMany({ data: catalogEntries(catalog) });
    await tx.setting.create({ data: { id: "settings", data: json(settings) } });
    await tx.setting.create({ data: { id: "schema-version", data: 2 } });
  });
  console.log("Imported catalog v2; endpoint credentials preserved; source backup retained.");
} finally {
  await db.$disconnect();
}
