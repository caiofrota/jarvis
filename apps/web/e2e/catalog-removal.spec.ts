import { expect, test } from "./fixtures";

test("room and home deletion review dependent registrations before removal", async ({
  page,
}, info) => {
  await page.goto("/homes");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Casas", exact: true })).toBeVisible();
  async function create(collection: string, data: Record<string, unknown>) {
    const response = await page.request.post(`/api/v1/catalog/${collection}`, {
      headers: { origin: "http://127.0.0.1:8877" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).id as string;
  }
  const suffix = info.project.name;
  const homeName = `Removal home ${suffix}`,
    roomName = `Removal room ${suffix}`,
    endpointName = `Removal endpoint ${suffix}`;
  const homeId = await create("homes", { name: homeName, city: "Fortaleza" });
  const roomId = await create("rooms", { name: roomName, homeId });
  await create("rooms", { name: `Remaining room ${suffix}`, homeId });
  const assistantId = await create("assistants", { name: `Removal assistant ${suffix}`, homeId });
  await create("endpoints", { name: endpointName, homeId, roomId, assistantId });
  await page.goto(`/rooms?q=${encodeURIComponent(roomName)}`);
  await page.getByRole("button", { name: `Excluir ${roomName}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(endpointName);
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Excluir ${roomName}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Excluir ${roomName}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText("Cadastro removido.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Excluir ${roomName}`, exact: true })).toHaveCount(
    0,
  );
  await page.goto(`/homes?q=${encodeURIComponent(homeName)}`);
  await page.getByRole("button", { name: `Excluir ${homeName}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(`Remaining room ${suffix}`);
  await expect(page.getByRole("dialog")).toContainText(`Removal assistant ${suffix}`);
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByText("Cadastro removido.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Excluir ${homeName}`, exact: true })).toHaveCount(
    0,
  );
});
