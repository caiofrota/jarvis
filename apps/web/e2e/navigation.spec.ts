import { expect, test } from "./fixtures";

test("client navigation retains the authenticated shell and session", async ({
  page,
}, testInfo) => {
  await page.goto("/overview");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  let sessionRequests = 0;
  let documentRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/session") sessionRequests++;
    if (request.resourceType() === "document") documentRequests++;
  });
  await page.evaluate(() => {
    document.querySelector(".app-shell")?.setAttribute("data-navigation-marker", "retained");
  });
  const mobile = testInfo.project.name === "mobile";
  if (!mobile) await page.getByRole("button", { name: "Recolher menu", exact: true }).click();
  for (const [label, path] of [
    ["Assistentes", "/personal"],
    ["Configurações", "/integrations"],
    ["Casa", "/overview"],
  ]) {
    if (mobile) await page.getByRole("button", { name: "Abrir menu da administração" }).click();
    const navigation = mobile ? page.getByRole("dialog") : page.locator(".sidebar");
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator(".app-shell")).toHaveAttribute("data-navigation-marker", "retained");
    if (!mobile) await expect(page.locator(".app-shell")).toHaveClass(/collapsed/);
    await expect(page.getByRole("heading", { name: "Carregando", exact: true })).toHaveCount(0);
  }
  if (mobile) await page.getByRole("button", { name: "Abrir menu da administração" }).click();
  const navigation = mobile ? page.getByRole("dialog") : page.locator(".sidebar");
  await navigation.getByRole("link", { name: "Conversa", exact: true }).click();
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(sessionRequests).toBe(0);
  expect(documentRequests).toBe(0);
});
