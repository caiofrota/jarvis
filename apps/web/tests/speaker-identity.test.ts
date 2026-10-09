import { json } from "@rosie/db";
import { schemas } from "@rosie/types";
import { context } from "@rosie/types/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Automations } from "../src/server/automation/service";
import { CatalogService } from "../src/server/catalog/service";
import { Conversation } from "../src/server/conversation/service";
import { speakerIdentityReply } from "../src/server/conversation/speaker-identity";
import { catalogFixture, repositoryFixture } from "./fixture";

afterEach(() => vi.unstubAllGlobals());
describe("speaker identity replies", () => {
  it.each([
    "Quem sou eu?",
    "Quem eu sou?",
    "Rosie, você sabe quem sou eu?",
    "Você consegue dizer quem está falando com você agora?",
    "Você consegue me dizer quem está falando?",
    "Sabe quem tá falando aqui?",
    "Quem está falando agora?",
    "Quem está falando com você?",
    "Você sabe com quem está falando?",
    "Qual é meu nome?",
    "Você sabe meu nome?",
    "Você lembra o meu nome?",
    "Você me reconhece?",
    "Você me identificou pela voz?",
    "Você reconhece a minha voz?",
    "Você consegue reconhecer minha voz?",
    "Por favor, Rosie, diga quem sou eu.",
  ])("answers a direct speaker question with the trusted identity: %s", (text) => {
    const c = catalogFixture();
    c.residents.push(schemas.residents.parse({ id: "caio", name: "Caio", homeId: "home" }));
    expect(speakerIdentityReply(text, context(c, "one", "caio"), "caio")).toMatchObject({
      text: "Reconheci sua voz, Caio!",
    });
  });
  it.each([
    "Quem é você?",
    "Quem é Caio?",
    "Quem sou eu na filosofia?",
    "Quem sou eu e acenda a luz.",
    "Não diga meu nome.",
    "Por que você não sabe quem sou eu?",
    "Como você reconhece minha voz?",
    "Qual é meu nome favorito para um cachorro?",
    "Quem está falando nessa gravação?",
    "Você conhece uma música chamada Quem Sou Eu?",
  ])("leaves other questions and compound requests to the conversation: %s", (text) => {
    expect(speakerIdentityReply(text, context(catalogFixture(), "one"), null)).toBeNull();
  });
  it("answers recognized and unknown speakers locally, clears old identity and distinguishes a fixed profile", async () => {
    const f = await repositoryFixture(),
      automations = new Automations(f.repo);
    const conversation = new Conversation(f.repo, automations),
      catalog = new CatalogService(f.repo);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    try {
      await catalog.save("residents", { name: "Caio", homeId: "home" });
      const speak = (id: string, resident?: string | null) =>
        conversation.respond(id, "Quem sou eu?", new AbortController().signal, resident);
      expect((await speak("one", "caio")).text).toBe("Reconheci sua voz, Caio!");
      expect((await speak("two", null)).text).not.toContain("Caio");
      expect((await speak("one", null)).text).toContain("Ainda não identifiquei");
      const endpoint = (await f.repo.catalog()).endpoints[0];
      await catalog.save("endpoints", { ...endpoint, residentId: "caio" }, endpoint.id, 1);
      expect((await speak("one")).text).toBe("O perfil selecionado nesta caixinha é o de Caio.");
      expect((await speak("one", null)).text).not.toContain("Caio");
      expect(request).not.toHaveBeenCalled();
    } finally {
      automations.close();
      await f.close();
    }
  });
  it("passes explicit local recognition into generation and removes it after an unknown turn", async () => {
    const f = await repositoryFixture(),
      automations = new Automations(f.repo);
    const conversation = new Conversation(f.repo, automations);
    try {
      await new CatalogService(f.repo).save("residents", {
        name: "Caio",
        homeId: "home",
        preferences: "Respostas breves.",
      });
      await f.repo.db.setting.update({
        where: { id: "settings" },
        data: { data: json({ openaiKey: "fixture-key" }) },
      });
      const request = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({ text: "Resposta de teste.", expression: "neutral" }),
                  },
                },
              ],
              usage: {},
            }),
          ),
      );
      vi.stubGlobal("fetch", request);
      const signal = new AbortController().signal;
      await conversation.respond("one", "Quem sou eu?", signal, "caio");
      await conversation.respond("one", "Como você consegue reconhecer quem fala?", signal, "caio");
      const payload = JSON.parse(
        String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body),
      );
      expect(payload.messages[0].content).toContain(
        "Pessoa reconhecida pelo serviço local de voz nesta conversa: Caio",
      );
      expect(payload.messages[0].content).toContain("Respostas breves.");
      expect(
        payload.messages.some((v: { content: string }) => v.content === "Reconheci sua voz, Caio!"),
      ).toBe(true);
      await conversation.respond("one", "Como você consegue reconhecer quem fala?", signal, null);
      const unknown = JSON.parse(
        String((request.mock.calls[1] as unknown as [string, RequestInit])[1].body),
      );
      expect(unknown.messages[0].content).toContain(
        "Nesta conversa não há uma pessoa identificada",
      );
      expect(JSON.stringify(unknown.messages)).not.toContain("Caio");
    } finally {
      automations.close();
      await f.close();
    }
  });
});
