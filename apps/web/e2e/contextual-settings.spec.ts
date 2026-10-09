import { expect, test } from "./fixtures";

test("weather city, assistant worldview and independent addon settings persist", async ({
  page,
}, testInfo) => {
  await page.goto("/homes");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.route("**/api/v1/weather/locations?*", (route) =>
    route.fulfill({
      json: {
        items: [{ name: "Fortaleza, Ceará, Brasil", latitude: -3.71722, longitude: -38.54306 }],
      },
    }),
  );
  await page.getByRole("button", { name: "Novo cadastro", exact: true }).click();
  const name = `Weather home ${testInfo.project.name}`;
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Cidade", { exact: true }).fill("Fortaleza");
  await page.getByLabel("Buscar cidade para o clima", { exact: true }).fill("Fortaleza");
  await page.getByRole("button", { name: "Buscar cidade", exact: true }).click();
  await page.getByLabel("Cidade encontrada", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Local selecionado: Fortaleza, Ceará, Brasil",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Excluir ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/assistants");
  await page.getByRole("button", { name: "Editar Rosie", exact: true }).click();
  await page.getByText(/Contexto adicional \(opcional\)/).click();
  await page
    .getByLabel("Visão de mundo e posicionamento", { exact: true })
    .fill("Perspectiva marxista em temas políticos.");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Editar Rosie", exact: true }).click();
  await page.getByText(/Contexto adicional \(opcional\)/).click();
  await expect(page.getByLabel("Visão de mundo e posicionamento", { exact: true })).toHaveValue(
    "Perspectiva marxista em temas políticos.",
  );
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  const voice = page.getByRole("tab", { name: "Voz", exact: true });
  await expect(voice).toHaveAttribute("aria-selected", "true");
  await voice.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Conversa", exact: true })).toBeFocused();
  await expect(page.getByLabel("Chave da OpenAI", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Clima", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(voice).toBeFocused();
  await page.getByLabel("Reconhecimento da fala", { exact: true }).selectOption("tiny");
  await page.getByRole("tab", { name: "MQTT", exact: true }).click();
  await page.getByLabel("Ativar addon MQTT", { exact: true }).uncheck();
  await page.getByRole("tab", { name: "Clima", exact: true }).click();
  await page.getByLabel("Ativar addon de clima", { exact: true }).check();
  await page.getByRole("tab", { name: "Busca na internet", exact: true }).click();
  await page.getByLabel("Ativar busca na internet", { exact: true }).check();
  await page.getByLabel("Orçamento mensal da busca (US$)", { exact: true }).fill("5");
  await page.getByLabel("Reutilizar pesquisas recentes (cache)", { exact: true }).check();
  await voice.click();
  await expect(page.getByLabel("Reconhecimento da fala", { exact: true })).toHaveValue("tiny");
  await expect(
    page.getByLabel("Orçamento mensal da busca (US$)", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Configurações salvas." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Reconhecimento da fala", { exact: true })).toHaveValue("tiny");
  await page.getByRole("tab", { name: "MQTT", exact: true }).click();
  await expect(page.getByLabel("Ativar addon MQTT", { exact: true })).not.toBeChecked();
  await page.getByRole("tab", { name: "Clima", exact: true }).click();
  await expect(page.getByLabel("Ativar addon de clima", { exact: true })).toBeChecked();
  await page.getByRole("tab", { name: "Busca na internet", exact: true }).click();
  await expect(page.getByLabel("Ativar busca na internet", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Orçamento mensal da busca (US$)", { exact: true })).toHaveValue(
    "5",
  );
  await expect(
    page.getByLabel("Reutilizar pesquisas recentes (cache)", { exact: true }),
  ).toBeChecked();
  // Saving another tab must reveal invalid fields instead of silently failing.
  await page.getByLabel("Orçamento mensal da busca (US$)", { exact: true }).fill("101");
  await voice.click();
  await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Busca na internet", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("Orçamento mensal da busca (US$)", { exact: true })).toBeFocused();
  await page.getByLabel("Orçamento mensal da busca (US$)", { exact: true }).fill("5");
  await page.getByRole("tab", { name: "Clima", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
