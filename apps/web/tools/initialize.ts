import { createDatabase, json } from "@rosie/db";
import { settingsSchema } from "@rosie/types";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL explicitly before initialization.");
const db = createDatabase(url);
try {
  await db.$transaction(async (tx) => {
    if ((await tx.entry.count()) || (await tx.setting.count()))
      throw new Error("Refusing to overwrite an initialized database.");
    await tx.setting.createMany({
      data: [
        { id: "schema-version", data: 2 },
        { id: "settings", data: json(settingsSchema.parse({})) },
      ],
    });
  });
  console.log(
    "Empty installation initialized; create a home, room, assistant and endpoint in the panel.",
  );
} finally {
  await db.$disconnect();
}
