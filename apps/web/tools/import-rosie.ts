import { createDatabase, json, Repository } from "@rosie/db";
import { mergeRosieCatalog } from "../src/server/catalog/rosie-import";

const sourceUrl = process.env.ROSIE_SOURCE_DATABASE_URL;
const destinationUrl = process.env.DATABASE_URL;
if (!sourceUrl || !destinationUrl || sourceUrl === destinationUrl)
  throw new Error(
    "Set distinct ROSIE_SOURCE_DATABASE_URL and DATABASE_URL. Back up the destination before applying.",
  );
const source = createDatabase(sourceUrl),
  destination = createDatabase(destinationUrl);
try {
  const input = await new Repository(source).catalog({ project: false });
  const apply = process.argv.includes("--apply");
  await destination.$transaction(async (tx) => {
    const repo = new Repository(tx as unknown as Repository["db"]);
    const plan = mergeRosieCatalog(input, await repo.catalog({ project: false }));
    if (apply) {
      for (const { collection, value } of plan.updated)
        await tx.entry.update({
          where: { collection_id: { collection, id: value.id } },
          data: { data: json(value), revision: { increment: 1 } },
        });
      for (const { collection, value } of plan.added)
        await tx.entry.create({
          data: { collection, id: value.id, name: value.name, data: json(value) },
        });
      await tx.event.create({
        data: { kind: "rosie_catalog_imported", detail: json({ added: plan.added.length }) },
      });
    }
    console.log(
      JSON.stringify({
        applied: apply,
        updated: plan.updated.map(({ collection, value }) => ({ collection, id: value.id })),
        added: plan.added.map(({ collection, value }) => ({
          collection,
          id: value.id,
          name: value.name,
        })),
        mappings: plan.mappings,
        credentials: "preserved; never printed",
      }),
    );
  });
} finally {
  await source.$disconnect();
  await destination.$disconnect();
}
