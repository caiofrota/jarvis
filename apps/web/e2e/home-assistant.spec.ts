import { expect, test } from "./fixtures";

test("HA import table, redacted token field and announcement drafts are usable", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Home Assistant", exact: true })).toBeVisible();
  await page.route("**/api/v1/status", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        homeAssistant: { enabled: true, connected: true, ready: true, entities: 1, error: null },
      },
    });
  });
  await page.route("**/api/v1/home-assistant/entities?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "switch.office",
            name: "Luz do escritório",
            kind: "switch",
            areaName: "Escritório",
            state: "off",
            imported: false,
          },
        ],
        total: 1,
      },
    }),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Home Assistant", exact: true }).click();
  await expect(page.getByLabel("Token do Home Assistant", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByLabel("Casa deste Home Assistant", { exact: true }).selectOption("home");
  const importButton = page.getByRole("button", {
    name: "Importar Luz do escritório",
    exact: true,
  });
  await expect(importButton).toBeVisible();
  await importButton.click();
  await expect(page.getByLabel("Tipo de dispositivo", { exact: true })).toHaveValue("switch");
  await page.getByLabel("Tipo de dispositivo", { exact: true }).selectOption("light");
  await page.getByLabel("Ambiente na Rosie", { exact: true }).selectOption("office");
  await page.route("**/api/v1/home-assistant/import", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      entityId: "switch.office",
      roomId: "office",
      name: "Luz do escritório",
      kind: "light",
    });
    return route.fulfill({ status: 201, json: { id: "ha-lamp" } });
  });
  await page.getByRole("button", { name: "Importar dispositivo", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Luz do escritório importado." }),
  ).toBeVisible();
  const automatic = page.getByLabel("Usar catálogo automático do Home Assistant", { exact: true });
  await automatic.check();
  await expect(importButton).not.toBeVisible();
  await expect(page.getByText(/Gerencie nomes, áreas e exposição/)).toBeVisible();
  await automatic.uncheck();
  await expect(importButton).toBeVisible();
  await page.getByRole("tab", { name: "Falas e perguntas", exact: true }).click();
  await page.getByLabel("Caixinha para a interação", { exact: true }).selectOption("one");
  await expect(
    page.getByRole("link", { name: "Baixar scripts para o Home Assistant" }),
  ).toHaveAttribute("href", "/api/v1/home-assistant/package/one");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/endpoints");
  await page.getByRole("button", { name: "Editar Caixinha one", exact: true }).click();
  await page.getByLabel("Início do silêncio", { exact: true }).fill("23:30");
  await page.getByLabel("Silenciar avisos por horário", { exact: true }).check();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Editar Caixinha one", exact: true }).click();
  await expect(page.getByLabel("Início do silêncio", { exact: true })).toHaveValue("23:30");
  await page.keyboard.press("Escape");
  await page.route("**/api/v1/home-assistant/areas", (route) =>
    route.fulfill({
      json: { items: [{ id: "office-ha", name: "Escritório HA", homeId: "home" }] },
    }),
  );
  await page.goto("/rooms");
  await page.getByRole("button", { name: "Editar Escritório", exact: true }).click();
  await page.getByLabel("Área no Home Assistant", { exact: true }).selectOption("office-ha");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Editar Escritório", exact: true }).click();
  await expect(page.getByLabel("Área no Home Assistant", { exact: true })).toHaveValue("office-ha");
  await page.keyboard.press("Escape");
});

test("authorization callback consumes the code once and removes it from the address bar", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Home Assistant", exact: true })).toBeVisible();
  let calls = 0;
  await page.route("**/api/v1/home-assistant/authorization", (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({
      code: "fixture-code",
      state: "fixture-state",
    });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/settings?ha_auth=1&code=fixture-code&state=fixture-state");
  await expect(
    page.getByRole("status").filter({ hasText: "Token criado e salvo automaticamente" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  expect(calls).toBe(1);
  await page.getByRole("tab", { name: "Home Assistant", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Conectar com Home Assistant", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Token do Home Assistant", { exact: true })).toHaveValue("");
});
