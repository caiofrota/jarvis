import type { CalendarBinding, ResidentCalendarStatus } from "@rosie/types";
import { expect, test } from "./fixtures";

test("resident calendar tab preserves drafts, handles errors and saves an explicit binding", async ({
  page,
}, info) => {
  await page.goto("/residents");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const name = `Agenda ${info.project.name}`;
  await page.getByRole("button", { name: "Novo cadastro" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await expect(
    page.getByText("Salve este morador e abra a edição para vincular sua agenda."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  let binding: CalendarBinding | null = null,
    revision: string | null = null,
    fail = false;
  const payload = (): ResidentCalendarStatus => ({
    binding,
    revision,
    connected: true,
    setupUrl: "https://ha.example.invalid/config/integrations",
    message: "Escolha a agenda que pertence a este morador.",
    options: [{ id: "calendar.caio", name: "Agenda pessoal", canCreate: true, available: true }],
  });
  await page.route(/\/api\/v1\/catalog\/residents\/[^/]+\/calendar$/, async (route) => {
    const method = route.request().method();
    if (method === "PUT" && fail) {
      await route.fulfill({ status: 503, json: { error: "Sem conexão. Tente novamente." } });
      return;
    }
    if (method === "PUT") {
      binding = route.request().postDataJSON().binding;
      revision = "saved";
    }
    if (method === "DELETE") {
      binding = null;
      revision = null;
    }
    await route.fulfill({ json: payload() });
  });
  await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await page.getByLabel("Agenda deste morador", { exact: true }).selectOption("calendar.caio");
  await page.getByLabel("Habilitar consultas por voz", { exact: true }).check();
  await page.getByLabel("Permitir criar eventos com confirmação", { exact: true }).check();
  await page.getByRole("tab", { name: "Perfil", exact: true }).click();
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await expect(page.getByLabel("Agenda deste morador", { exact: true })).toHaveValue(
    "calendar.caio",
  );
  fail = true;
  await page.getByRole("button", { name: "Salvar agenda", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Sem conexão");
  await expect(
    page.getByLabel("Permitir criar eventos com confirmação", { exact: true }),
  ).toBeChecked();
  fail = false;
  await page.getByRole("button", { name: "Salvar agenda", exact: true }).click();
  await expect(page.getByText("Configuração da agenda salva.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Desvincular agenda", exact: true }).click();
  await page.getByRole("button", { name: "Manter vínculo", exact: true }).click();
  await expect(page.getByLabel("Agenda deste morador", { exact: true })).toHaveValue(
    "calendar.caio",
  );
  await page.getByRole("button", { name: "Desvincular agenda", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar desvinculação", exact: true }).click();
  await expect(
    page.getByText("Vínculo removido. Os eventos do Google foram mantidos.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
