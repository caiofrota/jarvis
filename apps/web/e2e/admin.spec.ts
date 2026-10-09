import { expect, test } from "./fixtures";

test("catalog, responsive navigation, modal cancellation and logout", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // LAN HTTP browsers do not expose this secure-context-only API.
  await page.addInitScript(() =>
    Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true }),
  );
  await page.goto("/intents");
  await expect(page.getByRole("heading", { name: "Bem-vindo à sua casa." })).toBeVisible();
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Mostrar senha" }).click();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar senha" }).click();
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Intents e humor", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar Saudação", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nome", exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await page.getByLabel("Por página").selectOption("10");
  await expect(page).toHaveURL(/pageSize=10/);
  await expect(page.locator("td[data-label=Frases]").filter({ hasText: "bom dia" })).toBeVisible();
  if (mobile) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: "Editar Saudação", exact: true }) });
    await expect(row.locator("[data-label=Expressão]")).toBeVisible();
  }
  await page.getByRole("button", { name: "Novo cadastro" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(`Saudação ${testInfo.project.name}`);
  await page
    .getByLabel("Frases que você diz", { exact: true })
    .fill(`teste ${testInfo.project.name}`);
  await page.getByLabel("Respostas possíveis", { exact: true }).fill("Olá, {robo}!");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const item = `Saudação ${testInfo.project.name}`;
  await page.getByRole("button", { name: `Excluir ${item}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: `Editar ${item}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Excluir ${item}`, exact: true }).click();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: `Excluir ${item}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByRole("button", { name: `Editar ${item}`, exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Novo cadastro" }).click();
  const semanticName = `Outras assistentes ${testInfo.project.name}`;
  await page.getByLabel("Nome", { exact: true }).fill(semanticName);
  await page.getByLabel("Reconhecimento", { exact: true }).selectOption("semantic");
  await page.getByLabel("Tipo de resposta", { exact: true }).selectOption("generated");
  await page.getByLabel("Frases que você diz", { exact: true }).fill("Você conhece a Alexa?");
  await page
    .getByLabel("Quando usar esta intent", { exact: true })
    .fill("Comentários sobre outras assistentes.");
  await page
    .getByLabel("Como responder", { exact: true })
    .fill("Pode brincar de ciúme ocasionalmente.");
  await page.getByText("Proteção contra assuntos diferentes", { exact: true }).click();
  await page
    .getByLabel("Referências ao assunto", { exact: true })
    .fill("assistente\nAlexa\nSiri\n");
  await page
    .getByLabel("Frases de continuação", { exact: true })
    .fill("Está com ciúme dela?\nPor quê?\n");
  await page.getByRole("button", { name: "Adicionar parâmetro", exact: true }).click();
  await page.getByLabel("Nome do parâmetro", { exact: true }).fill("assistente");
  await page.getByLabel("Nome na pergunta", { exact: true }).fill("assistente mencionada");
  await page.getByLabel("Tipo do parâmetro", { exact: true }).selectOption("choice");
  await page
    .getByLabel("Opções permitidas", { exact: true })
    .fill("Alexa\nSiri\nGoogle Assistente");
  await page.getByLabel("Outras formas de dizer Alexa", { exact: true }).fill("Amazon");
  await page.getByLabel("Outras formas de dizer Siri", { exact: true }).fill("Apple");
  await page.getByLabel("Obrigatório", { exact: true }).check();
  await page.getByRole("button", { name: "Adicionar regra de resposta", exact: true }).click();
  await page.getByLabel("Nome da regra", { exact: true }).fill("À noite");
  await page.getByLabel("A partir das", { exact: true }).fill("22:00");
  await page.getByLabel("Antes das", { exact: true }).fill("06:00");
  await page
    .getByLabel("Orientação desta regra", { exact: true })
    .fill("Resposta curta e tranquila.");
  await page.getByLabel("Estilo nesta regra", { exact: true }).selectOption("natural");

  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const semanticRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Editar ${semanticName}`, exact: true }) });
  await expect(semanticRow.locator("[data-label=Reconhecimento]")).toHaveText("Por significado");
  await expect(semanticRow.locator("[data-label=Resposta]")).toHaveText("Resposta gerada");
  await semanticRow.getByRole("button", { name: `Editar ${semanticName}`, exact: true }).click();
  await page.getByText("Proteção contra assuntos diferentes", { exact: true }).click();
  await expect(page.getByLabel("Referências ao assunto", { exact: true })).toHaveValue(
    "assistente\nAlexa\nSiri",
  );
  await expect(page.getByLabel("Frases de continuação", { exact: true })).toHaveValue(
    "Está com ciúme dela?\nPor quê?",
  );
  await expect(page.getByLabel("Nome do parâmetro", { exact: true })).toHaveValue("assistente");
  await expect(page.getByLabel("Nome da regra", { exact: true })).toHaveValue("À noite");
  await expect(page.getByLabel("A partir das", { exact: true })).toHaveValue("22:00");
  await page.getByRole("button", { name: "Adicionar regra de resposta", exact: true }).click();
  await page.getByRole("button", { name: "Remover regra 1", exact: true }).click();
  await expect(page.getByLabel("Nome da regra", { exact: true })).toHaveValue("");
  await page.getByLabel("Sempre responder com seriedade", { exact: true }).check();
  await expect(page.getByLabel("Estilo da conversa", { exact: true })).not.toBeVisible();

  await expect(page.getByLabel("Opções permitidas", { exact: true })).toHaveValue(
    "Alexa\nSiri\nGoogle Assistente",
  );
  await expect(page.getByLabel("Outras formas de dizer Alexa", { exact: true })).toHaveValue(
    "Amazon",
  );
  await page.getByRole("button", { name: "Adicionar parâmetro", exact: true }).click();
  await page.getByRole("button", { name: "Remover parâmetro 1", exact: true }).click();
  await expect(page.getByLabel("Nome do parâmetro", { exact: true })).toHaveValue("");
  if (mobile)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Excluir ${semanticName}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Editar ${semanticName}`, exact: true }),
  ).not.toBeVisible();
  await page.goto("/routines");
  await page.getByRole("button", { name: "Novo cadastro" }).click();
  await page.getByRole("button", { name: "Adicionar etapa", exact: true }).click();
  await page.getByRole("button", { name: "Remover etapa 1", exact: true }).click();
  await expect(page.getByLabel("Ação", { exact: true })).toHaveValue("off");
  await page.keyboard.press("Escape");
  await page.goto("/intents");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("heading", { name: "Intents e humor", exact: true }).click();
  await page.screenshot({
    path: `../../artifacts/panel-${testInfo.project.name}.png`,
    fullPage: true,
  });
  if (mobile) {
    await page.getByRole("button", { name: "Abrir menu da administração" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Abrir menu da administração" })).toBeFocused();
    await page.getByRole("button", { name: "Abrir menu da administração" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Caixinhas" }).click();
  } else await page.getByRole("link", { name: "Caixinhas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Caixinhas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Configuração efetiva de Caixinha one" }).click();
  await expect(page.getByRole("dialog")).toContainText("Rosie");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Editar Caixinha one", exact: true }).click();
  await page.getByLabel("Usar LED indicador", { exact: true }).check();
  await page.getByLabel("Brilho ao escutar (%)", { exact: true }).fill("35");
  await page.getByLabel("Brilho mínimo ao falar (%)", { exact: true }).fill("15");
  await page.getByLabel("Brilho máximo ao falar (%)", { exact: true }).fill("75");
  await page.getByLabel("Estado da tela", { exact: true }).selectOption("off");
  await page.getByLabel("Apagar por horário", { exact: true }).check();
  await page.getByLabel("Apagar às", { exact: true }).fill("23:00");
  await page.getByLabel("Ligar às", { exact: true }).fill("08:00");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Editar Caixinha one", exact: true }).click();
  await expect(page.getByLabel("Brilho ao escutar (%)", { exact: true })).toHaveValue("35");
  await expect(page.getByLabel("Estado da tela", { exact: true })).toHaveValue("off");
  await expect(page.getByLabel("Apagar às", { exact: true })).toHaveValue("23:00");
  await expect(page.getByLabel("Ligar às", { exact: true })).toHaveValue("08:00");
  await page.getByLabel("Estado da tela", { exact: true }).selectOption("auto");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  if (mobile) {
    await page.getByRole("button", { name: "Abrir menu da administração" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sair da conta" }).click();
  } else await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Caixinhas", exact: true })).toBeVisible();
  await page.goto("/overview");
  await page.getByLabel("Sua mensagem", { exact: true }).fill("bom dia");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.locator(".conversation-reply")).toContainText("Rosie");
  await expect(page.locator(".intent-result")).toContainText("Saudação");
  await page.getByRole("button", { name: "Nova conversa", exact: true }).click();
  await expect(page.locator(".conversation-reply")).not.toBeVisible();
  await expect(page.getByLabel("Sua mensagem", { exact: true })).toHaveValue("");
  expect(pageErrors).toEqual([]);
});
