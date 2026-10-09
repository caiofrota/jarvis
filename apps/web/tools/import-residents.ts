import { createDatabase, json, Repository } from "@rosie/db";
import { planResidentImport } from "../src/server/catalog/resident-import";

const sourceUrl = process.env.ROSIE_SOURCE_DATABASE_URL,
  destinationUrl = process.env.DATABASE_URL;
if (!sourceUrl || !destinationUrl || sourceUrl === destinationUrl)
  throw new Error(
    "Set distinct source and destination databases; back up and rehearse before applying.",
  );
const source = createDatabase(sourceUrl),
  destination = createDatabase(destinationUrl);
try {
  const input = await new Repository(source).catalog({ project: false });
  const sourceReferences = await source.setting.findMany({
    where: { id: { startsWith: "voiceprint:" } },
  });
  const apply = process.argv.includes("--apply");
  await destination.$transaction(async (tx) => {
    const repo = new Repository(tx as unknown as Repository["db"]);
    const plan = planResidentImport(
      input,
      await repo.catalog({ project: false }),
      sourceReferences,
      await tx.setting.findMany({ where: { id: { startsWith: "voiceprint:" } } }),
    );
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
      for (const row of plan.references)
        await tx.setting.create({ data: { id: row.id, data: json(row.data) } });
      await tx.event.create({
        data: {
          kind: "resident_configuration_imported",
          detail: {
            residents: input.residents.map((value) => value.id),
            voices: plan.references.length,
          },
        },
      });
    }
    console.log(
      JSON.stringify({
        applied: apply,
        residents: input.residents.map(({ id, name }) => ({ id, name })),
        registrationsAdded: plan.added.length,
        voicesAdded: plan.references.map(({ id }) => id),
        voicesPreserved: plan.preserved,
        biometricData: "private; never printed",
      }),
    );
  });
} catch {
  // Database errors may contain submitted biometric values; do not print their payloads.
  console.error(
    "Resident import failed. No partial import was committed; check source validity and destination conflicts.",
  );
  process.exitCode = 1;
} finally {
  await source.$disconnect();
  await destination.$disconnect();
}
