import { expect, test } from "./fixtures";

test("secondary cards wait for primary login and update on login and logout", async ({
  page,
  context,
}) => {
  const card = await context.newPage();
  await card.goto("/studio?window=locked-card&secondary=1&panel=tasks");
  await expect(card.getByRole("heading", { name: "Painel bloqueado", exact: true })).toBeVisible();
  await expect(card.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await expect(card.locator(".task-list")).toHaveCount(0);
  await page.goto("/studio?window=main");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iniciar conversa", exact: true })).toBeVisible();
  await expect(card.getByLabel("Nova tarefa", { exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Painel bloqueado", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Configurações", exact: true }).click();
  await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Painel bloqueado", exact: true })).toBeVisible();
  await expect(card.getByLabel("Senha", { exact: true })).toHaveCount(0);
  await card.close();
});
test("secondary workspaces never render a login and a notification cannot grant a session", async ({
  page,
}) => {
  await page.goto("/studio?window=secondary-space&secondary=1");
  await expect(page.getByRole("heading", { name: "Painel bloqueado", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel("jarvis-session");
    channel.postMessage("changed");
    channel.close();
  });
  await expect(page.getByRole("heading", { name: "Painel bloqueado", exact: true })).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
});

test("secondary cards synchronize through storage when BroadcastChannel is unavailable", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
  });
  const card = await context.newPage();
  await card.goto("/studio?secondary=1&panel=tasks");
  await expect(card.getByRole("heading", { name: "Painel bloqueado", exact: true })).toBeVisible();
  await page.goto("/studio");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(card.getByLabel("Nova tarefa", { exact: true })).toBeVisible();
  await card.close();
});
