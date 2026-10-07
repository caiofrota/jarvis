import { json } from "@rosie/db";
import { schemas } from "@rosie/types";
import { context } from "@rosie/types/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Automations } from "../src/server/automation/service";
import { conversationExamples } from "../src/server/conversation/examples";
import {
  exactIntent,
  intentMatchesTopic,
  parseIntentReply,
  semanticIntents,
} from "../src/server/conversation/intents";
import { Conversation } from "../src/server/conversation/service";
import { catalogFixture, repositoryFixture } from "./fixture";

afterEach(() => vi.unstubAllGlobals());
const abort = () => AbortSignal.timeout(10000);
const output = (
  text: string,
  id: string | null,
  parameters: { name: string; value: string }[] = [],
) => ({ text, expression: "happy", intent: { id, parameters } });
const providerResponse = (reply: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }],
      usage: { prompt_tokens: 20, completion_tokens: 20 },
    }),
  );
async function configured() {
  const f = await repositoryFixture();
  await f.repo.db.setting.update({
    where: { id: "settings" },
    data: { data: { openaiKey: "fixture-key" } },
  });
  for (const intent of conversationExamples("home", "rosie"))
    await f.repo.db.entry.create({
      data: { collection: "intents", id: intent.id, name: intent.name, data: json(intent) },
    });
  return f;
}

describe("conversational intent contracts", () => {
  it("requires topic evidence and never treats unrelated comparisons as assistant clarification", () => {
    const c = catalogFixture(),
      intent = conversationExamples("home", "rosie")[0];
    c.intents.push(intent);
    const ctx = context(c, "one"),
      focus = { id: intent.id, name: intent.name, parameters: { assistente: "Alexa" } };
    for (const text of [
      "Lula ou Bolsonaro?",
      "Café ou chá?",
      "Android ou iPhone?",
      "Qual você prefere?",
      "Alexandre",
      "E a política?",
    ]) {
      expect(intentMatchesTopic(intent, text)).toBe(false);
      expect(intentMatchesTopic(intent, text, focus)).toBe(false);
      expect(semanticIntents(c, ctx, text, focus)).not.toContainEqual(intent);
      expect(() =>
        parseIntentReply(output("Qual assistente?", intent.id), [intent], ctx, undefined, {
          text,
          focus,
        }),
      ).toThrow("assunto");
    }
    for (const text of [
      "Você conhece a Alexa?",
      "E a Siri?",
      "Prefiro outra assistente",
      "A assistente da Apple",
    ])
      expect(intentMatchesTopic(intent, text)).toBe(true);
    expect(intentMatchesTopic(intent, "Está com ciúme dela?")).toBe(false);
    expect(intentMatchesTopic(intent, "Está com ciúme dela?", focus)).toBe(true);
    expect(intentMatchesTopic(intent, "Está com ciúme dela? E Lula ou Bolsonaro?", focus)).toBe(
      false,
    );
    expect(
      intentMatchesTopic(intent, "Está com ciúme dela?", { ...focus, id: "different-intent" }),
    ).toBe(false);
    const generic = parseIntentReply(
      output("A Alexa!", intent.id, [{ name: "assistente", value: "Alexa" }]),
      [intent],
      ctx,
      undefined,
      { text: "Prefiro outra assistente", focus },
    );
    expect(generic.needsClarification).toBe(true);
    expect(generic.parameters).toEqual({});
  });
  it("rejects undeclared selections even when no intent is offered", () => {
    const ctx = context(catalogFixture(), "one");
    expect(() => parseIntentReply(output("Qual assistente?", "other-assistants"), [], ctx)).toThrow(
      "não está disponível",
    );
    expect(parseIntentReply(output("Resposta normal", null), [], ctx).reply.text).toBe(
      "Resposta normal",
    );
  });
  it("keeps old exact replies compatible and rejects undeclared or unsafe parameters", () => {
    const old = catalogFixture().intents[0];
    const { matchMode: _m, responseMode: _r, parameters: _p, ...legacy } = old;
    expect(schemas.intents.parse(legacy)).toMatchObject({
      matchMode: "exact",
      responseMode: "template",
      parameters: [],
    });
    const sample = conversationExamples("home", "rosie")[0];
    expect(() => schemas.intents.parse({ ...sample, description: "" })).toThrow();
    expect(() =>
      schemas.intents.parse({
        ...sample,
        parameters: [...sample.parameters, ...sample.parameters],
      }),
    ).toThrow();
    expect(() =>
      schemas.intents.parse({
        ...sample,
        parameters: [{ ...sample.parameters[0], name: "constructor" }],
      }),
    ).toThrow();
    expect(() =>
      schemas.intents.parse({ ...sample, responses: ["Olá {nao_cadastrado}"] }),
    ).toThrow();
    expect(() => schemas.intents.parse({ ...sample, matchMode: "exact" })).toThrow();
    expect(
      schemas.intents.parse({
        ...sample,
        responseMode: "template",
        responses: ["Você citou {assistente}."],
      }).responses,
    ).toHaveLength(1);
  });
  it("applies household, room, resident and variant scope before offering semantic definitions", () => {
    const c = catalogFixture(),
      base = conversationExamples("home", "rosie")[0];
    c.intents.push(
      base,
      schemas.intents.parse({
        ...base,
        id: "office-other",
        extendsId: base.id,
        scope: { assistantIds: ["rosie"], roomIds: ["office"] },
      }),
    );
    c.intents.push(
      schemas.intents.parse({ ...base, id: "someone-else", scope: { residentIds: ["resident"] } }),
    );
    c.intents.push(schemas.intents.parse({ ...base, id: "other-house", homeId: "elsewhere" }));
    expect(semanticIntents(c, context(c, "one")).map((v) => v.id)).toEqual(["office-other"]);
    expect(semanticIntents(c, context(c, "two")).map((v) => v.id)).toEqual(["other-assistants"]);
    expect(exactIntent(c, context(c, "one"), "BÓM DIA! ")?.id).toBe("greeting");
  });
  it("validates choices and numbers, asks for required data and ignores model text for clarification", () => {
    const c = catalogFixture(),
      ctx = context(c, "one"),
      intent = conversationExamples("home", "rosie")[0];
    expect(parseIntentReply(output("wrong", intent.id), [intent], ctx).reply.text).toContain(
      "Alexa, Siri, Google Assistente",
    );
    expect(
      parseIntentReply(
        output("wrong", intent.id, [{ name: "assistente", value: "Unknown" }]),
        [intent],
        ctx,
      ).needsClarification,
    ).toBe(true);
    expect(
      parseIntentReply(
        output("ok", intent.id, [{ name: "assistente", value: "siri" }]),
        [intent],
        ctx,
      ).parameters,
    ).toEqual({ assistente: "Siri" });
    expect(() => parseIntentReply(output("bad", "unavailable"), [intent], ctx)).toThrow();
    expect(() =>
      parseIntentReply(output("bad", intent.id, [{ name: "execute", value: "ON" }]), [intent], ctx),
    ).toThrow();
    const numeric = schemas.intents.parse({
      ...intent,
      responses: [],
      parameters: [{ name: "quantidade", label: "a quantidade", type: "number", required: true }],
    });
    expect(
      parseIntentReply(
        output("ok", numeric.id, [{ name: "quantidade", value: "2,5" }]),
        [numeric],
        ctx,
      ).parameters,
    ).toEqual({ quantidade: "2.5" });
    expect(
      parseIntentReply(
        output("bad", numeric.id, [{ name: "quantidade", value: "Infinity" }]),
        [numeric],
        ctx,
      ).needsClarification,
    ).toBe(true);
  });
  it("grounds named choices in current speech, aliases and same-intent follow-ups", () => {
    const c = catalogFixture(),
      ctx = context(c, "one"),
      intent = conversationExamples("home", "rosie")[0];
    const parse = (text: string, named: string, answer: string, previous?: string) =>
      parseIntentReply(
        output(answer, intent.id, [{ name: "assistente", value: named }]),
        [intent],
        ctx,
        undefined,
        {
          text,
          focus: previous
            ? { id: intent.id, name: intent.name, parameters: { assistente: previous } }
            : undefined,
        },
      );
    const missing = parse("Prefiro outra assistente", "Alexa", "A Alexa é ótima.");
    expect(missing.needsClarification).toBe(true);
    expect(missing.parameters).toEqual({});
    const changed = parse("Agora falo da Siri", "Alexa", "A Alexa é ótima.", "Alexa");
    expect(changed.parameters).toEqual({ assistente: "Siri" });
    expect(changed.needsRepair).toBe(true);
    expect(changed.reply.text).not.toContain("Você está falando");
    const wrongText = parse("Você conhece a Alexa?", "Alexa", "A Siri é ótima.");
    expect(wrongText.needsRepair).toBe(true);
    expect(wrongText.reply.text).not.toContain("Siri");
    expect(parse("A assistente da Apple", "Siri", "A Siri é ótima.").needsClarification).toBe(
      false,
    );
    expect(parse("Está com ciúme dela?", "Siri", "Só de brincadeira!", "Siri").parameters).toEqual({
      assistente: "Siri",
    });
    expect(() => parse("Ela", "Siri", "A Siri é ótima.")).toThrow("assunto");
    expect(
      parse("A Alexa e a Siri", "Alexa", "Alexa e Siri têm diferenças.").needsClarification,
    ).toBe(false);
    expect(() => parse("Alexandre", "Alexa", "A Alexa é ótima.")).toThrow("assunto");
    expect(() =>
      schemas.intents.parse({
        ...intent,
        parameters: [{ ...intent.parameters[0], choiceAliases: { Unknown: ["Apple"] } }],
      }),
    ).toThrow();
  });
});

describe("conversation continuity", () => {
  it.each([false, true])(
    "excludes the assistant intent on a topic change, including pending clarification: %s",
    async (clarifying) => {
      const f = await configured();
      try {
        const requests: {
          messages: { role: string; content: string }[];
          response_format: {
            json_schema: {
              schema: { properties: { intent: { properties: { id: { enum: unknown[] } } } } };
            };
          };
        }[] = [];
        const answers = [
          output(
            "A Alexa tem seus pontos fortes.",
            "other-assistants",
            clarifying ? [] : [{ name: "assistente", value: "Alexa" }],
          ),
          output("São políticos com propostas diferentes.", null),
          output("A quem você se refere?", null),
          output("A Siri é da Apple.", "other-assistants", [{ name: "assistente", value: "Siri" }]),
        ];
        const fetcher = vi.fn(async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return providerResponse(answers.shift());
        });
        vi.stubGlobal("fetch", fetcher);
        const conversation = new Conversation(f.repo, {} as Automations);
        await conversation.respond(
          "one",
          clarifying ? "Prefiro outra assistente" : "Você conhece a Alexa?",
          abort(),
        );
        const changed = await conversation.respond("one", "Lula ou Bolsonaro?", abort());
        expect(changed.intent).toBeUndefined();
        expect(changed.text).not.toMatch(/Alexa|Siri|Qual assistente/);
        const system = requests[1].messages[0].content;
        expect(system).not.toContain('"id":"other-assistants"');
        expect(system).not.toContain("Contexto anterior de intent");
        expect(
          requests[1].response_format.json_schema.schema.properties.intent?.properties.id.enum ??
            [],
        ).not.toContain("other-assistants");
        await conversation.respond("one", "Está com ciúme dela?", abort());
        expect(requests[2].messages[0].content).not.toContain('"id":"other-assistants"');
        const next = await conversation.respond("one", "E a Siri?", abort());
        expect(next.intent?.parameters).toEqual({ assistente: "Siri" });
        expect(fetcher).toHaveBeenCalledTimes(4);
      } finally {
        await f.close();
      }
    },
  );
  it.each([
    ["Conheço a Alexa, ela é da Amazon.", false],
    ["Você está falando de Alexa, certo?", true],
    ["A Siri é da Apple.", true],
  ])(
    "bounds internal name repair without asking the user to reconfirm: %s",
    async (draft, exhausted) => {
      const f = await configured();
      try {
        const responses = [
          output("A Siri é da Apple.", "other-assistants", [
            { name: "assistente", value: "Alexa" },
          ]),
          output(draft, "other-assistants", [{ name: "assistente", value: "Alexa" }]),
        ];
        const requests: { tool_choice: string }[] = [];
        const fetch = vi.fn(async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return providerResponse(responses.shift());
        });
        vi.stubGlobal("fetch", fetch);
        const execute = vi.fn();
        const conversation = new Conversation(f.repo, { execute } as unknown as Automations);
        const reply = await conversation.respond("one", "Você conhece a Alexa?", abort());
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(requests[1].tool_choice).toBe("none");
        expect(execute).not.toHaveBeenCalled();
        expect(reply.intent?.parameters).toEqual({ assistente: "Alexa" });
        expect(reply.text).not.toMatch(/Siri|Você está falando/);
        if (exhausted) expect(reply.text).toContain("Me atrapalhei");
        else expect(reply.text).toBe(draft);
      } finally {
        await f.close();
      }
    },
  );
  it("answers a known assistant directly even when provider metadata is omitted on successive turns", async () => {
    const f = await configured();
    try {
      const responses = [
        output("Conheço a Alexa, ela é da Amazon.", "other-assistants"),
        output("Podemos continuar falando dela!", "other-assistants"),
        output("A Siri é da Apple.", "other-assistants", [{ name: "assistente", value: "Alexa" }]),
      ];
      const fetch = vi.fn(async () => providerResponse(responses.shift()));
      vi.stubGlobal("fetch", fetch);
      const conversation = new Conversation(f.repo, {} as Automations);
      const first = await conversation.respond("one", "Você conhece a Alexa?", abort());
      expect(first.text).toBe("Conheço a Alexa, ela é da Amazon.");
      expect(first.intent?.parameters).toEqual({ assistente: "Alexa" });
      const second = await conversation.respond("one", "Sim", abort());
      expect(second.text).toBe("Podemos continuar falando dela!");
      const third = await conversation.respond("one", "E a Siri?", abort());
      expect(third.text).toBe("A Siri é da Apple.");
      expect(third.intent?.parameters).toEqual({ assistente: "Siri" });
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      await f.close();
    }
  });
  it("carries local answers into replies and isolates endpoint histories", async () => {
    const f = await configured(),
      requests: { messages: { content: string }[] }[] = [];
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return providerResponse(output("Eu estava brincando!", null));
        }),
      );
      const conversation = new Conversation(f.repo, {} as Automations);
      const local = await conversation.respond("one", "bom dia", abort());
      expect(requests).toHaveLength(0);
      await conversation.respond("one", "como você sabe?", abort());
      expect(requests[0].messages).toContainEqual({ role: "assistant", content: local.text });
      await conversation.respond("two", "como você sabe?", abort());
      expect(requests[1].messages).not.toContainEqual({ role: "assistant", content: local.text });
      conversation.reset("one");
      await conversation.respond("one", "começar de novo", abort());
      expect(requests[2].messages).not.toContainEqual({ role: "assistant", content: local.text });
    } finally {
      await f.close();
    }
  });
  it("recognizes and answers in one provider call, keeping parameters for follow-up and clearing them on topic change", async () => {
    const f = await configured(),
      requests: Record<string, unknown>[] = [];
    try {
      const responses = [
        output("A Siri? Estou de olho!", "other-assistants", [
          { name: "assistente", value: "Siri" },
        ]),
        output("Ciúme de brincadeira!", "other-assistants", [
          { name: "assistente", value: "Siri" },
        ]),
        output("Dois mais dois são quatro.", null),
        output("Uma nova conversa.", null),
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return providerResponse(responses.shift());
        }),
      );
      const execute = vi.fn(),
        conversation = new Conversation(f.repo, { execute } as unknown as Automations);
      const reply = await conversation.respond(
        "one",
        "a outra assistente da Apple é melhor",
        abort(),
      );
      expect(requests).toHaveLength(1);
      expect(reply.intent?.parameters).toEqual({ assistente: "Siri" });
      await conversation.respond("one", "está com ciúme dela?", abort());
      expect(JSON.stringify(requests[1])).toContain("Contexto anterior de intent");
      await conversation.respond("one", "quanto é dois mais dois?", abort());
      await conversation.respond("one", "assunto novo", abort());
      expect(JSON.stringify(requests[3])).not.toContain("Contexto anterior de intent");
      expect(execute).not.toHaveBeenCalled();
      const events = await f.repo.db.event.findMany({ where: { kind: "intent_selected" } });
      expect(JSON.stringify(events)).not.toContain('"Siri"');
    } finally {
      await f.close();
    }
  });
  it("asks once for a missing parameter, then accepts its value on the next turn", async () => {
    const f = await configured(),
      requests: Record<string, unknown>[] = [];
    try {
      const responses = [
        output("ignore", "other-assistants"),
        output("Alexa anotada!", "other-assistants", [{ name: "assistente", value: "Alexa" }]),
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return providerResponse(responses.shift());
        }),
      );
      const conversation = new Conversation(f.repo, {} as Automations);
      const first = await conversation.respond("one", "prefiro a outra assistente", abort());
      expect(first.expression).toBe("curious");
      expect(first.text).toContain("Qual assistente");
      const second = await conversation.respond("one", "a Alexa", abort());
      expect(second.intent?.parameters.assistente).toBe("Alexa");
      expect(JSON.stringify(requests[1])).toContain(first.text);
    } finally {
      await f.close();
    }
  });
  it("renders validated parameters in ready replies instead of accepting generated content", async () => {
    const f = await configured();
    try {
      const intent = schemas.intents.parse({
        ...conversationExamples("home", "rosie")[0],
        responseMode: "template",
        responses: ["{pessoa}, você citou {assistente} em {ambiente}."],
      });
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "intents", id: intent.id } },
        data: { data: json(intent) },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          providerResponse(
            output("DO NOT SAY THIS", intent.id, [{ name: "assistente", value: "Alexa" }]),
          ),
        ),
      );
      const conversation = new Conversation(f.repo, {} as Automations);
      expect((await conversation.respond("one", "a Alexa me entende", abort())).text).toBe(
        "visitante, você citou Alexa em Escritório.",
      );
    } finally {
      await f.close();
    }
  });
  it("prevents overlapping turns and discards a late provider reply after reset", async () => {
    const f = await configured();
    try {
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          entered();
          await blocked;
          return providerResponse(output("A resposta velha", null));
        }),
      );
      const conversation = new Conversation(f.repo, {} as Automations);
      const old = conversation.respond("one", "primeira pergunta", abort());
      const rejected = expect(old).rejects.toThrow();
      await started;
      await expect(conversation.respond("one", "segunda pergunta", abort())).rejects.toThrow(
        /Aguarde/,
      );
      conversation.reset("one");
      release();
      await rejected;
      let next: unknown;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          next = JSON.parse(init.body);
          return providerResponse(output("Nova resposta", null));
        }),
      );
      await conversation.respond("one", "nova sessão", abort());
      expect(JSON.stringify(next)).not.toContain("resposta velha");
      expect(JSON.stringify(next)).not.toContain("primeira pergunta");
    } finally {
      await f.close();
    }
  });
  it("clears context after offline room changes and honors zero-history settings", async () => {
    const f = await configured();
    try {
      const payloads: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          payloads.push(JSON.parse(init.body));
          return providerResponse(output("Certo.", null));
        }),
      );
      const conversation = new Conversation(f.repo, {} as Automations);
      const local = await conversation.respond("one", "bom dia", abort());
      const endpoint = (await f.repo.catalog()).endpoints[0];
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "endpoints", id: endpoint.id } },
        data: { data: json({ ...endpoint, roomId: "kitchen" }) },
      });
      await conversation.respond("one", "continue", abort());
      expect(JSON.stringify(payloads[0])).not.toContain(local.text);
      const assistant = (await f.repo.catalog()).assistants[0];
      await f.repo.db.entry.update({
        where: { collection_id: { collection: "assistants", id: assistant.id } },
        data: { data: json({ ...assistant, historyTurns: 0 }) },
      });
      await conversation.respond("one", "bom dia", abort());
      await conversation.respond("one", "mais uma", abort());
      expect((payloads[1] as { messages: unknown[] }).messages).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
  it("does not call a provider for exact templates when no provider key exists", async () => {
    const f = await repositoryFixture();
    try {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const conversation = new Conversation(f.repo, {} as Automations);
      expect((await conversation.respond("one", "bom dia", abort())).text).toContain("Rosie");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});
