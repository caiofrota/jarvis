import { expect, test } from "./fixtures";

test("shortlists apps, searches the full catalog and opens a conversational request once", async ({
  page,
}, info) => {
  const clientId = "3c807e43-5afd-4361-8841-ce3e8bc744ae";
  await page.addInitScript(
    ({ clientId }) => {
      const apps = Array.from({ length: 12 }, (_, i) => ({
        id: `installed-app-${i}`,
        label: `Boreal ${String(i).padStart(2, "0")}`,
        kind: "app" as const,
        available: true,
      }));
      const calls: string[] = [];
      Object.assign(window, { fixtureLaunches: calls });
      window.jarvisCompanionWindows = {
        openPanel: async () => true,
        openWorkspace: async () => true,
        cancelAction: async () => {},
        actions: async () => ({
          clientId,
          items: [],
          apps,
          history: [
            {
              id: "used",
              targetId: "installed-app-11",
              label: "Boreal 11",
              at: new Date().toISOString(),
              status: "sent",
            },
          ],
          runtime: { restricted: false, platform: "fixture", appVersion: "fixture", message: "" },
        }),
        prepareAction: async (id) => ({
          id,
          label: apps.find((app) => app.id === id)?.label ?? "",
          token: id,
          expiresAt: Date.now() + 120000,
          kind: "app",
          target: "fixture",
        }),
        executeAction: async (token) => {
          calls.push(token);
          return {
            status: "sent",
            label: apps.find((app) => app.id === token)?.label ?? "",
            message: "Pedido enviado",
          };
        },
      };
    },
    { clientId },
  );
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".workspace-stage")).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mostrar cards", exact: true }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Próximos cards", exact: true }).click();
  await expect(page.locator(".computer-body > .action-grid .action-tile")).toHaveCount(6);
  await expect(page.locator(".computer-body > .action-grid .action-tile").first()).toContainText(
    "Boreal 11",
  );
  await page
    .getByRole("button", { name: "Todos os aplicativos e pastas (12)", exact: true })
    .click();
  await page.getByLabel("Buscar aplicativos", { exact: true }).fill("Boreal 09");
  await expect(page.locator(".computer-catalog .action-tile")).toHaveCount(1);
  await page.locator(".computer-catalog .action-tile").click();
  expect(await page.evaluate(() => Reflect.get(window, "fixtureLaunches"))).toEqual([
    "installed-app-9",
  ]);
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  let submitted: unknown;
  await page.route("**/api/v1/companion/message", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: {
        text: "Confirme no computador",
        voice: "fixture-voice",
        computerAction: {
          requestId: "ad84c1c0-8350-42d5-ab6c-7282ecc84a7d",
          clientId,
          id: "installed-app-3",
          label: "Boreal 03",
          newInstance: false,
          expires: Date.now() + 120000,
        },
      },
    });
  });
  await page.route("**/api/v1/companion/computer-result", async (route) => {
    expect(route.request().postDataJSON().status).toBe("sent");
    await route.fulfill({
      json: { text: "Pedido enviado para Boreal 03.", voice: "fixture-voice" },
    });
  });
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Voltar ao Jarvis", exact: true }).click();
  await page.getByRole("tab", { name: "Transcrição", exact: true }).click();
  await page.getByLabel("Mensagem", { exact: true }).fill("Abra Boreal 03");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Pedido enviado para Boreal 03.");
  expect(submitted).toMatchObject({
    computer: {
      clientId,
      targets: Array.from({ length: 12 }, (_, i) => ({
        id: `installed-app-${i}`,
        label: `Boreal ${String(i).padStart(2, "0")}`,
        kind: "app",
      })),
    },
  });
  expect(await page.evaluate(() => Reflect.get(window, "fixtureLaunches"))).toEqual([
    "installed-app-9",
    "installed-app-3",
  ]);
});

test("refreshes the same central list after a conversational receipt", async ({ page }, info) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".workspace-stage")).toBeVisible();
  const title = `Voice task ${info.project.name}`;
  await page.route("**/api/v1/companion/message", async (route) => {
    const current = await (await page.request.get("/api/v1/companion/tasks")).json();
    const saved = await page.request.put("/api/v1/companion/tasks", {
      headers: { origin: "http://127.0.0.1:8877" },
      data: {
        ...current,
        tasks: [...current.tasks, { id: crypto.randomUUID(), text: title, done: false }],
      },
    });
    expect(saved.ok()).toBe(true);
    await route.fulfill({
      json: { text: `Adicionei: ${title}`, voice: "fixture-voice", tasksChanged: true },
    });
  });
  await page.getByRole("tab", { name: "Transcrição", exact: true }).click();
  await page.getByLabel("Mensagem", { exact: true }).fill(`Adicione ${title}`);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(`Adicionei: ${title}`);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mostrar cards", exact: true }).click();
  await expect(page.locator(".task-list")).toContainText(title);
  await page.reload();
  await expect(page.locator(".workspace-stage")).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mostrar cards", exact: true }).click();
  await expect(page.locator(".task-list")).toContainText(title);
  await page.getByRole("button", { name: `Excluir ${title}`, exact: true }).click();
});
