import { expect, test } from "./fixtures";

async function signIn(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
test("personal assistants persist without requiring a house or endpoint", async ({
  page,
}, info) => {
  await signIn(page, "/personal");
  await page.getByRole("button", { name: "Criar assistente", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    name = `Atlas ${info.project.name}`;
  await dialog.getByLabel("Nome do assistente", { exact: true }).fill(name);
  await dialog
    .getByLabel("Personalidade", { exact: true })
    .fill("Converse com clareza e curiosidade.");
  await expect(
    dialog.getByLabel("Visão de mundo e posicionamento", { exact: true }),
  ).not.toBeVisible();
  await dialog.getByText("Contexto adicional (opcional)", { exact: true }).click();
  await dialog
    .getByLabel("Visão de mundo e posicionamento", { exact: true })
    .fill("Valoriza a curiosidade.");
  await dialog
    .getByLabel("Informações do assistente", { exact: true })
    .fill("Cuida de um observatório.");
  await expect(dialog.getByLabel("Casa", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Ambiente", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Salvar assistente", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const makeDefault = page.getByRole("button", { name: `Usar ${name} por padrão`, exact: true });
  if (await makeDefault.isEnabled()) {
    await makeDefault.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Assistente padrão atualizado." }),
    ).toBeVisible();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Usar ${name} por padrão`, exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const gaps = await page
    .locator(".page-content > .panel")
    .evaluateAll((panels) =>
      panels
        .slice(1)
        .map(
          (panel, index) =>
            panel.getBoundingClientRect().top - panels[index].getBoundingClientRect().bottom,
        ),
    );
  expect(gaps.every((gap) => gap >= 20)).toBe(true);
  await page.screenshot({ path: info.outputPath("assistants-spaced.png"), fullPage: true });
  await page.getByRole("button", { name: `Excluir ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Usar Rosie por padrão", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Rosie · Seu padrão", exact: true }),
  ).toBeDisabled();
  await page.goto("/assistant-default");
  await expect(page.getByLabel("Nome do assistente", { exact: true })).toBeVisible();
  await page.goto("/studio");
  await expect(page.getByLabel("Assistente", { exact: true })).toContainText("Rosie");
  await expect(
    page.getByText("Você pode conversar sem cadastrar uma caixinha.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Configurar meus assistentes", exact: true }),
  ).toBeVisible();
});
test("integration setup and mail review require explicit confirmation", async ({ page }) => {
  const id = "78fce76a-72c3-4e0a-9817-08df074785d1",
    proposalId = "cc63b76e-e0c1-4b3f-81b5-8b2acb109b55";
  const account = "person@example.test";
  await page.route("**/api/v1/personal-integrations", (route) =>
    route.fulfill({
      json: {
        callback: "https://jarvis.example.test/api/v1/personal-integrations/callback",
        providers: [
          { provider: "google", configured: false },
          { provider: "microsoft", configured: false },
        ],
        connections: [
          {
            id,
            provider: "google",
            email: account,
            name: "Person",
            permissions: [],
            reconnect: false,
          },
        ],
      },
    }),
  );
  let draft: unknown,
    confirmed = 0;
  await page.route(`**/api/v1/personal-integrations/connections/${id}/proposals`, async (route) => {
    draft = route.request().postDataJSON().draft;
    await route.fulfill({
      json: { id: proposalId, connectionId: id, account, kind: "mail", draft },
    });
  });
  await page.route("**/api/v1/personal-integrations/confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ id: proposalId });
    confirmed++;
    await route.fulfill({ json: { message: "Envio aceito pelo provedor." } });
  });
  await signIn(page, "/integrations");
  await expect(page.getByRole("heading", { name: "Minhas contas", exact: true })).toBeVisible();
  const menuButton = page.getByRole("button", { name: "Abrir menu da administração", exact: true });
  const mobileMenu = await menuButton.isVisible();
  if (mobileMenu) await menuButton.click();
  await expect(
    page.getByRole("navigation", { name: "Administração" }).getByRole("link"),
  ).toHaveCount(5);
  if (mobileMenu) await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Conectar Google", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Conectar Microsoft", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Estas conexões pertencem a Test administrator", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Configurar aplicativo Google", exact: true }),
  ).toHaveCount(0);
  await page.goto("/provider-apps");
  await page.getByRole("button", { name: "Configurar aplicativo Google", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "https://jarvis.example.test/api/v1/personal-integrations/callback",
  );
  const password = dialog.getByLabel("Segredo do cliente", { exact: true });
  await password.fill("fixture-only-secret");
  await expect(password).toHaveAttribute("type", "password");
  await page.keyboard.press("Escape");
  await page.goto("/integrations");
  await page.getByRole("button", { name: `Escrever e-mail com ${account}`, exact: true }).click();
  await dialog.getByLabel("Destinatários", { exact: true }).fill("recipient@example.test");
  await dialog.getByLabel("Assunto", { exact: true }).fill("Revisão");
  await dialog.getByLabel("Mensagem", { exact: true }).fill("Texto de teste.");
  await dialog.getByRole("button", { name: "Revisar envio", exact: true }).click();
  await expect(dialog).toContainText("recipient@example.test");
  expect(confirmed).toBe(0);
  expect(draft).toEqual({
    to: ["recipient@example.test"],
    subject: "Revisão",
    text: "Texto de teste.",
  });
  await dialog.getByRole("button", { name: "Confirmar e enviar", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Envio aceito pelo provedor." }),
  ).toBeVisible();
  expect(confirmed).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
