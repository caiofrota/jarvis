import { expect, test } from "./fixtures";

test("search answers have adjacent clickable sources and clear when switching endpoints", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.route("**/api/v1/conversation", (route) =>
    route.fulfill({
      json: {
        text: "Veja a programação cultural do fim de semana.",
        expression: "neutral",
        web: {
          sources: [{ title: "Agenda cultural de Fortaleza", url: "https://example.org/agenda" }],
          checkedAt: "2026-09-23T20:00:00Z",
          cache: "hit",
        },
      },
    }),
  );
  await page.getByLabel("Sua mensagem", { exact: true }).fill("O que tem na cidade?");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const answer = page.locator(".conversation-reply");
  await expect(answer).toContainText("programação cultural");
  await expect(answer).toContainText("Reutilizada do cache");
  await expect(
    answer.getByRole("link", { name: "Agenda cultural de Fortaleza", exact: true }),
  ).toHaveAttribute("href", "https://example.org/agenda");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Caixinha", { exact: true }).selectOption("two");
  await expect(answer).not.toBeVisible();
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(answer).toBeVisible();
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await expect(answer).not.toBeVisible();
});
