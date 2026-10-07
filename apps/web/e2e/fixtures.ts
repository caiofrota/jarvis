import { test as base, expect as baseExpect } from "@playwright/test";

// The disposable server retains the production IP limit (10 logins/minute).
// Space fixture logins instead of weakening authentication for browser tests.
let nextLogin = 0;
export const test = base.extend<{ loginPacing: undefined }>({
  loginPacing: [
    async ({ page }, use) => {
      await page.route("**/api/v1/login", async (route) => {
        const wait = Math.max(0, nextLogin - Date.now());
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        nextLogin = Date.now() + 7000;
        await route.continue();
      });
      await use(undefined);
    },
    { auto: true },
  ],
});
export const expect = baseExpect.configure({ timeout: 15000 });
