import { expect, test } from "./fixtures";

test("Jarvis loading animation is centered and resolves to login", async ({ page }, testInfo) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/session", async (route) => {
    await pending;
    await route.fulfill({ status: 401, json: { error: "Faça login." } });
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Carregando", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Preparando a central…");
    await expect(page.getByText("Abrindo sua casa…", { exact: true })).toHaveCount(0);
    const box = await page.locator(".jarvis-loading-content").boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(3);
      expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(3);
    }
    await page.screenshot({ path: `/tmp/jarvis-loading-${testInfo.project.name}.png` });
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "Bem-vindo à sua casa." })).toBeVisible();
});
