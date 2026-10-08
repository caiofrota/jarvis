import { expect, test } from "./fixtures";

test("companion works without a physical endpoint and starts a fresh session", async ({ page }) => {
  const sessions = ["ee3f4f65-201e-45f7-b045-186b7693da53", "e7c96b24-73e1-4ccf-a99a-a531858efaca"];
  await page.route("**/api/v1/companion/options", (route) =>
    route.fulfill({ json: { name: "Jarvis", assistants: [], areas: [] } }),
  );
  await page.route("**/api/v1/companion/session", (route) =>
    route.fulfill({ json: { sessionId: sessions.shift() } }),
  );
  await page.goto("/studio");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iniciar conversa", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.getByRole("button", { name: "Configurações", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Assistente", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Localização atual", exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Contexto da conversa", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("tab", { name: "Transcrição", exact: true }).click();
  let submitted: unknown;
  await page.route("**/api/v1/companion/message", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: { text: "Resposta do cérebro central.", voice: "kokoro-pf_dora" },
    });
  });
  await page.getByLabel("Mensagem", { exact: true }).fill("Olá!");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Resposta do cérebro central.");
  expect(submitted).toEqual({
    sessionId: "ee3f4f65-201e-45f7-b045-186b7693da53",
    assistantId: null,
    areaId: null,
    text: "Olá!",
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await expect(page.getByRole("log")).not.toContainText("Resposta do cérebro central.");
});
