import { expect, test } from "./fixtures";

test("resident voice collection shows progress and offers cancellation and explicit deletion", async ({
  page,
}, testInfo) => {
  await page.goto("/residents");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const name = `Pessoa ${testInfo.project.name}`;
  await page.getByRole("button", { name: "Novo cadastro" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByRole("tab", { name: "Reconhecimento de voz", exact: true }).click();
  await expect(
    page.getByText("Salve este morador e abra a edição para cadastrar sua voz."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  let registered = false;
  let enrollment: null | {
    id: string;
    endpointId: string;
    phase: string;
    completed: number;
    total: number;
    prompt: string;
    message: string;
  } = null;
  await page.route(/\/api\/v1\/catalog\/residents\/[^/]+\/voice(?:\/.*)?$/, async (route) => {
    const req = route.request();
    if (req.url().endsWith("/enroll"))
      enrollment = {
        id: "sample",
        endpointId: "one",
        phase: "listening",
        completed: 0,
        total: 3,
        prompt: "Olá, Rosie. Esta é a minha voz.",
        message: "Leia a frase abaixo.",
      };
    if (req.url().endsWith("/cancel")) enrollment = null;
    if (req.method() === "DELETE") {
      registered = false;
      enrollment = null;
    }
    await route.fulfill({
      json: { registered, enrolledAt: registered ? new Date().toISOString() : null, enrollment },
    });
  });
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  await page.getByRole("tab", { name: "Reconhecimento de voz", exact: true }).click();
  await page.getByLabel("Caixinha para o cadastro").selectOption("one");
  await page.getByRole("button", { name: "Cadastrar voz", exact: true }).click();
  await expect(page.getByText("Leia em voz alta: Olá, Rosie. Esta é a minha voz.")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar cadastro", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cadastrar voz", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Cadastrar voz", exact: true }).click();
  await expect(page.getByText("Amostras: 0 de 3.")).toBeVisible();
  registered = true;
  enrollment = {
    id: "sample",
    endpointId: "one",
    phase: "complete",
    completed: 3,
    total: 3,
    prompt: "",
    message: "Voz cadastrada. Você já pode testar uma nova conversa.",
  };
  await expect(page.getByText("Voz cadastrada.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apagar voz cadastrada", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar exclusão da voz", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manter voz", exact: true }).click();
  await expect(page.getByText("Voz cadastrada.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apagar voz cadastrada", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar exclusão da voz", exact: true }).click();
  await expect(page.getByText("Voz ainda não cadastrada.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
