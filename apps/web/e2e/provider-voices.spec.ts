import { expect, test } from "./fixtures";

test("personal assistants select provider voices and API conversation models independently", async ({
  page,
}) => {
  await page.route("**/api/v1/me/assistant-options", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.voices.push("openai-marin", "elevenlabs-fixture_voice");
    data.voiceNames = {
      "openai-marin": "Marin · OpenAI",
      "elevenlabs-fixture_voice": "Minha voz · ElevenLabs",
    };
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/v1/me/conversation-models?provider=openai", (route) =>
    route.fulfill({ json: { models: ["gpt-unfamiliar"] } }),
  );
  await page.goto("/personal");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Criar assistente", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const voice = dialog.getByLabel("Voz do assistente", { exact: true });
  await voice.selectOption("openai-marin");
  await expect(dialog).toContainText("Voz gerada por IA");
  await expect(voice.locator('option[value="elevenlabs-fixture_voice"]')).toHaveText(
    "Minha voz · ElevenLabs",
  );
  await voice.selectOption("elevenlabs-fixture_voice");
  await dialog.getByText("Opções de voz e modelo (avançado)", { exact: true }).click();
  await dialog.getByRole("button", { name: "Consultar modelos disponíveis", exact: true }).click();
  await dialog
    .getByLabel("Modelos disponíveis na API", { exact: true })
    .selectOption("gpt-unfamiliar");
  await expect(dialog.getByLabel("Modelo de conversa", { exact: true })).toHaveValue(
    "gpt-unfamiliar",
  );
  await expect(voice).toHaveValue("elevenlabs-fixture_voice");
  await dialog.getByLabel("Provedor de conversa", { exact: true }).selectOption("deepseek");
  await expect(dialog.getByLabel("Modelos disponíveis na API", { exact: true })).toHaveCount(0);
  await expect(voice).toHaveValue("elevenlabs-fixture_voice");
});
