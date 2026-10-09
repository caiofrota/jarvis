import { expect, test } from "./fixtures";

test("the main Jarvis restores its original stage, focus mode and detachable cards", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".workspace-stage")).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar conversa", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administração", exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator("body").evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain("radial-gradient");
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("jarvis-main.png") });
  await page.getByRole("button", { name: "Modo foco", exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/focus-mode/);
  await page.locator(".rail").getByRole("button", { name: "Visão geral", exact: true }).click();
  await expect(page.locator("body")).not.toHaveClass(/focus-mode/);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mostrar cards", exact: true }).click();
  const title = `Task ${info.project.name}`;
  await page.getByLabel("Nova tarefa", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Adicionar tarefa", exact: true }).click();
  await expect(page.locator(".task-list")).toContainText(title);
  await page.getByRole("button", { name: "Configurar Minhas tarefas", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Abrir em nova janela", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator(".task-list")).toContainText(title);
  await expect(popup.locator(".workspace-core")).toHaveCount(0);
  await expect(popup).toHaveURL(/panel=tasks/);
  await popup.close();
  await page.getByRole("button", { name: `Excluir ${title}`, exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("authenticated home keeps loading visible until the workspace stylesheet arrives", async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/companion.css", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto("/");
    await page.getByLabel("Usuário", { exact: true }).fill("admin");
    await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Carregando", exact: true })).toBeVisible();
    await expect(page.locator(".workspace-stage")).not.toBeVisible();
    await expect(page.locator(".jarvis-loader")).toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator(".workspace-stage")).toBeVisible();
  await expect(page.locator(".jarvis-loading")).toHaveCount(0);
  await expect(page).toHaveURL(/\/(?:\?window=[^&]+)?$/);
  await page.reload();
  await expect(page.locator(".workspace-stage")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administração", exact: true })).toHaveCount(0);
});

test("a failed workspace stylesheet offers retry instead of an unstyled panel", async ({
  page,
}) => {
  let failures = 1;
  await page.route("**/companion.css", async (route) => {
    if (failures-- > 0) await route.abort();
    else await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".jarvis-loading").getByRole("alert")).toHaveText(
    "Não foi possível carregar o visual do Jarvis.",
  );
  await expect(page.locator(".workspace-stage")).not.toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.locator(".workspace-stage")).toBeVisible();
});
