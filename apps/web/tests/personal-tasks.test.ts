import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { PersonalTasks } from "../src/server/personal/tasks";
import { httpFixture } from "./http-fixture";

it("persists a private list, checks revisions, imports idempotently and refuses stale completion", async () => {
  const f = await httpFixture();
  try {
    const owner = (await f.repo.db.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const tasks = new PersonalTasks(f.repo);
    const partner = await f.repo.db.user.create({
      data: {
        username: "partner",
        name: "Partner",
        passwordHash: "fixture-unused",
        role: "member",
        enabled: true,
      },
    });
    expect(await tasks.get(partner.id)).toEqual({ tasks: [], revision: null });
    const add = (title: string) =>
      tasks.execute(owner, { operation: "add", id: null, title, expectedTitle: null });
    expect((await add("Preparar C++")).text).toContain("Adicionei");
    expect((await add("preparar C++")).text).toContain("já existe");
    await add("Preparar C#");
    const current = await tasks.get(owner);
    expect(current.tasks).toHaveLength(2);
    expect((await tasks.get(partner.id)).tasks).toEqual([]);
    await expect(tasks.save(owner, { ...current, revision: null, tasks: [] })).rejects.toThrow(
      "mudou",
    );
    const task = current.tasks[0];
    await tasks.execute(owner, {
      operation: "update",
      id: task.id,
      title: "Preparar Atlas",
      expectedTitle: task.text,
    });
    await expect(
      tasks.execute(owner, {
        operation: "complete",
        id: task.id,
        title: null,
        expectedTitle: task.text,
      }),
    ).rejects.toThrow("mudou");
    await tasks.execute(owner, {
      operation: "complete",
      id: task.id,
      title: null,
      expectedTitle: "Preparar Atlas",
    });
    expect((await tasks.get(owner)).tasks[0].done).toBe(true);
    const imported = { id: randomUUID(), text: "Mapear Boreal", done: false };
    await tasks.import(owner, { tasks: [imported] });
    await tasks.import(owner, { tasks: [imported] });
    expect((await new PersonalTasks(f.repo).get(owner)).tasks).toHaveLength(3);
    await expect(tasks.get("other")).rejects.toThrow("Conta indisponível");
    const before = await tasks.get(owner);
    await expect(
      tasks.import(owner, {
        tasks: Array.from({ length: 100 }, (_, i) => ({
          id: randomUUID(),
          text: `Extra ${i}`,
          done: false,
        })),
      }),
    ).rejects.toThrow();
    expect(await tasks.get(owner)).toEqual(before);
    await f.repo.db.user.update({ where: { id: owner }, data: { enabled: false } });
    await expect(add("Bloqueada")).rejects.toThrow("Conta indisponível");
  } finally {
    await f.close();
  }
});
it("serves the authenticated list and rejects cross-site writes", async () => {
  const f = await httpFixture();
  try {
    const login = await fetch(`${f.url}/api/v1/login`, {
      method: "POST",
      headers: { origin: f.url, "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "fixture-user-password" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const get = await fetch(`${f.url}/api/v1/companion/tasks`, { headers: { cookie } });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ tasks: [], revision: null });
    const data = { tasks: [{ id: "test", text: "Testar", done: false }], revision: null };
    expect(
      (
        await fetch(`${f.url}/api/v1/companion/tasks`, {
          method: "PUT",
          headers: { cookie, origin: "https://other.invalid", "content-type": "application/json" },
          body: JSON.stringify(data),
        })
      ).status,
    ).toBe(403);
    const saved = await fetch(`${f.url}/api/v1/companion/tasks`, {
      method: "PUT",
      headers: { cookie, origin: f.url, "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).tasks).toEqual(data.tasks);
  } finally {
    await f.close();
  }
});
