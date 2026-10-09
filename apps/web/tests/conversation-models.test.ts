import { settingsSchema } from "@rosie/types";
import { expect, it, vi } from "vitest";
import { ConversationModels } from "../src/server/conversation/models";

it("lists API-authoritative chat models, excludes non-conversational families and preserves custom identifiers", async () => {
  const settings = settingsSchema.parse({ openaiKey: "fixture" });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      data: [
        { id: "gpt-unfamiliar" },
        { id: "gpt-unfamiliar" },
        { id: "gpt-audio" },
        { id: "gpt-realtime" },
        { id: "o9-custom" },
        { id: "embedding-model" },
        { id: 42 },
      ],
    }),
  );
  const models = new ConversationModels(async () => settings, fetcher);
  expect(await models.list("openai")).toEqual(["gpt-unfamiliar", "o9-custom"]);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { authorization: "Bearer fixture" },
  });
  await models.list("openai");
  expect(fetcher).toHaveBeenCalledTimes(1);
  settings.openaiKey = "changed";
  await models.list("openai");
  expect(fetcher).toHaveBeenCalledTimes(2);
  settings.openaiKey = "";
  await expect(models.list("openai")).rejects.toThrow("chave");
});

it("does not reveal raw provider errors or reuse another provider's model catalog", async () => {
  const settings = settingsSchema.parse({ deepseekKey: "fixture" });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("private error", { status: 401 }));
  const models = new ConversationModels(async () => settings, fetcher);
  await expect(models.list("deepseek")).rejects.toThrow("401");
  expect(fetcher.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
  fetcher.mockImplementation(async () => Response.json({ data: [{ id: "deepseek-unfamiliar" }] }));
  expect(await models.list("deepseek")).toEqual(["deepseek-unfamiliar"]);
});
