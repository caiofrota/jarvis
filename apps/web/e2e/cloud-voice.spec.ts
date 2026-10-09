import { wav } from "../src/server/robot/codec";
import { expect, test } from "./fixtures";

test("cloud voice is optional per assistant and a preview never saves the choice", async ({
  page,
}, testInfo) => {
  await page.route("**/api/v1/status", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.speech.voices.push("ha-cloud-FranciscaNeural", "ha-cloud-AntonioNeural");
    data.speech.cloudHomeId = "home";
    delete data.speech.cloudError;
    await route.fulfill({ response, json: data });
  });
  const previews: string[] = [];
  let fail = true;
  await page.route("**/api/v1/voice-preview", async (route) => {
    previews.push(route.request().postDataJSON().voice);
    if (fail)
      await route.fulfill({
        status: 422,
        json: { error: "Voz da nuvem indisponível neste teste." },
      });
    else
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: wav(Buffer.alloc(32000)),
      });
  });
  await page.goto("/assistants");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Editar Rosie", exact: true }).click();
  const choice = page.getByLabel("Voz", { exact: true });
  await expect(choice).toHaveValue("kokoro-pf_dora");
  await expect(choice.locator('option[value="ha-cloud-FranciscaNeural"]')).toHaveText(
    "Francisca · Home Assistant Cloud",
  );
  await choice.selectOption("ha-cloud-FranciscaNeural");
  await expect(page.getByRole("dialog")).toContainText("Envia o texto da resposta");
  await expect(page.getByLabel("Qualidade da voz", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Ouvir no navegador", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Voz da nuvem indisponível neste teste.",
  );
  await expect(choice).toHaveValue("ha-cloud-FranciscaNeural");
  fail = false;
  await page.getByRole("button", { name: "Ouvir no navegador", exact: true }).click();
  await expect(page.locator("audio")).toBeVisible();
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.readyState))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("cloud-voice.png") });
  await choice.selectOption("ha-cloud-AntonioNeural");
  await expect(page.locator("audio")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Editar Rosie", exact: true }).click();
  await expect(choice).toHaveValue("kokoro-pf_dora");
  await choice.selectOption("ha-cloud-AntonioNeural");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Editar Rosie", exact: true }).click();
  await expect(choice).toHaveValue("ha-cloud-AntonioNeural");
  // Restore the fixture for unrelated workflows, as an owner would switch back to local.
  await choice.selectOption("kokoro-pf_dora");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(previews).toEqual(["ha-cloud-FranciscaNeural", "ha-cloud-FranciscaNeural"]);
});
