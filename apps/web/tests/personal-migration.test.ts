import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Account } from "@rosie/types";
import { expect, it } from "vitest";
import { Accounts } from "../src/server/auth/accounts";
import { repositoryFixture } from "./fixture";

it("preserves existing credentials, users, sessions and household records when adding members", async () => {
  const name = "202610070001_personal_member_role",
    f = await repositoryFixture(name);
  try {
    const accounts = new Accounts(f.repo.db);
    const admin = await accounts.bootstrap({
      username: "admin",
      name: "Admin",
      password: "fixture-password",
      role: "admin",
      enabled: true,
    });
    await accounts.save(admin as Account, {
      username: "reader",
      name: "Reader",
      password: "fixture-password",
      role: "viewer",
      enabled: true,
    });
    await f.repo.db.userSession.create({
      data: { id: "fixture-session", userId: admin.id, expiresAt: new Date(Date.now() + 60000) },
    });
    const users = await f.repo.db.user.findMany(),
      sessions = await f.repo.db.userSession.findMany(),
      catalog = await f.repo.catalog();
    const sql = readFileSync(
      resolve(import.meta.dirname, `../../../packages/db/prisma/migrations/${name}/migration.sql`),
      "utf8",
    );
    for (const statement of sql
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean))
      await f.repo.db.$executeRawUnsafe(statement);
    expect(await f.repo.db.user.findMany()).toEqual(users);
    expect(await f.repo.db.userSession.findMany()).toEqual(sessions);
    expect(await f.repo.catalog()).toEqual(catalog);
    expect(await f.repo.db.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([]);
    expect(
      (
        await accounts.save(admin as Account, {
          username: "partner",
          name: "Partner",
          password: "fixture-password",
          role: "member",
          enabled: true,
        })
      ).role,
    ).toBe("member");
  } finally {
    await f.close();
  }
}, 15000);
