import { expect, test } from "./fixtures";

test("central conversation sends the selected context and resets on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true }),
  );
  await page.goto("/studio");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Converse com seu universo." })).toBeVisible();
  const context = page.getByLabel("Contexto da conversa", { exact: true });
  await expect(context).not.toHaveValue("");
  const endpointId = await context.inputValue();
  let submitted: unknown;
  await page.route("**/api/v1/conversation", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { text: "Resposta do cérebro central." } });
  });
  await page.route("**/api/v1/conversation/reset", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ endpointId });
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByLabel("Mensagem", { exact: true }).fill("Como está a casa?");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Resposta do cérebro central.");
  await page.screenshot({
    path: `/tmp/jarvis-studio-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(submitted).toEqual({ endpointId, text: "Como está a casa?" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await expect(page.getByRole("log")).not.toContainText("Resposta do cérebro central.");
});
