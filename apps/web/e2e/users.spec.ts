import { expect, test } from "./fixtures";

test("administrators create a reader and the reader cannot operate robots", async ({
  page,
}, testInfo) => {
  await page.goto("/users");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Usuários", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar Test administrator", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Minha conta" })).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Nova senha", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const username = `reader-${testInfo.project.name}`;
  await page.getByRole("button", { name: "Novo usuário", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill(username);
  await page.getByLabel("Usuário", { exact: true }).fill(username);
  await page.getByLabel("Senha", { exact: true }).fill("fixture-reader-password");
  await page.getByLabel("Confirmar senha", { exact: true }).fill("fixture-reader-password");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: `Editar ${username}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nome", exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await page.getByLabel("Por página").selectOption("10");
  expect(await page.getByLabel("Por página").locator("option").allTextContents()).toEqual([
    "10",
    "20",
    "50",
    "100",
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("users.png"), fullPage: true });
  await page.request.post("/api/v1/logout", { headers: { origin: "http://127.0.0.1:8877" } });
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill(username);
  await page.getByLabel("Senha", { exact: true }).fill("fixture-reader-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Uma casa, muitas conversas." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testar voz", exact: true })).toHaveCount(0);
  await page.goto("/endpoints");
  await expect(page.getByRole("button", { name: "Novo cadastro", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Parear |Editar / })).toHaveCount(0);
  await page.goto("/users");
  await expect(page.getByRole("button", { name: "Novo usuário", exact: true })).toHaveCount(0);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Minha conta", exact: true })).toBeVisible();
});
