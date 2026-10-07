import { expect, test } from "./fixtures";

test("an owner can enable and revoke temperature control without changing aliases", async ({
  page,
}, testInfo) => {
  await page.goto("/devices");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Novo cadastro", exact: true }).click();
  const name = `AC ${testInfo.project.name}`;
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Casa", { exact: true }).selectOption("home");
  await page.getByLabel("Ambiente", { exact: true }).selectOption("office");
  await page.getByLabel("Tipo", { exact: true }).selectOption("climate");
  await page.getByLabel("Conexão", { exact: true }).selectOption("home-assistant");
  await page
    .getByLabel("Entidade no Home Assistant", { exact: true })
    .fill(`climate.${testInfo.project.name}`);
  await page.getByLabel("Outros nomes", { exact: true }).fill("ar\nar condicionado");
  const permission = page.getByLabel("Permitir ajuste de temperatura", { exact: true });
  await permission.check();
  const scenes = page.getByLabel("Cenas para temperatura (opcional)", { exact: true });
  await scenes.fill("20=scene.office_20\n22=scene.office_22");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  await expect(permission).toBeChecked();
  await expect(scenes).toHaveValue("20=scene.office_20\n22=scene.office_22");
  await expect(page.getByLabel("Outros nomes", { exact: true })).toHaveValue("ar\nar condicionado");
  await permission.scrollIntoViewIfNeeded();
  const hint = page.getByText("Autoriza pedidos como ‘coloca o ar no 20’.", { exact: false });
  const checkboxBox = await permission.boundingBox(),
    hintBox = await hint.boundingBox();
  expect(checkboxBox && hintBox && hintBox.y > checkboxBox.y + checkboxBox.height).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("temperature-permission.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await permission.focus();
  await page.keyboard.press("Space");
  await expect(permission).not.toBeChecked();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  await expect(permission).not.toBeChecked();
  await expect(page.getByLabel("Outros nomes", { exact: true })).toHaveValue("ar\nar condicionado");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Excluir ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
