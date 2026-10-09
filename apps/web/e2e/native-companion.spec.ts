import { expect, test } from "./fixtures";

test("native clients start personal authorization in the system-browser page", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", { value: "fixture-browser JarvisCompanion/0.1" }),
  );
  await page.route("**/api/v1/personal-integrations", (route) =>
    route.fulfill({
      json: {
        callback: "https://jarvis.example.test/api/v1/personal-integrations/callback",
        providers: [
          { provider: "google", configured: true },
          { provider: "microsoft", configured: true },
        ],
        connections: [],
      },
    }),
  );
  let authorizations = 0;
  await page.route("**/api/v1/personal-integrations/authorize", (route) => {
    authorizations++;
    return route.fulfill({
      status: 500,
      json: { error: "Authorization must not start inside the native shell." },
    });
  });
  await page.goto("/integrations");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("link", { name: "Abrir conexões no navegador" })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Conectar Google", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/integrations$/);
  expect(authorizations).toBe(0);
  await popup.close();
});
