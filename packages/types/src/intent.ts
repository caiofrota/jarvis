import { z } from "zod";
import { type ResponseRule, responseRuleSchema } from "./intent-rules";

export const intentMarkers = ["valor", "nome", "ambiente", "robo", "cidade", "pessoa", "condicao"];
export const intentParameterSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,31}$/, "Use letras minúsculas, números e sublinhado.")
      .refine(
        (v) => ![...intentMarkers, "constructor", "prototype", "__proto__"].includes(v),
        "Este nome de parâmetro é reservado.",
      ),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(160).default(""),
    type: z.enum(["text", "number", "choice"]).default("text"),
    required: z.boolean().default(false),
    choices: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    choiceAliases: z
      .record(z.string().min(1).max(80), z.array(z.string().trim().min(1).max(80)).max(10))
      .default({}),
  })
  .superRefine((v, ctx) => {
    if (v.type === "choice" && v.choices.length < 2)
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Cadastre pelo menos duas opções.",
      });
    if (new Set(v.choices.map((s) => s.toLocaleLowerCase("pt-BR"))).size !== v.choices.length)
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "As opções não podem se repetir.",
      });
    if (Object.keys(v.choiceAliases).some((choice) => !v.choices.includes(choice)))
      ctx.addIssue({
        code: "custom",
        path: ["choiceAliases"],
        message: "Associe as outras formas de dizer a uma opção cadastrada.",
      });
  });
export type IntentParameter = z.infer<typeof intentParameterSchema>;
export const conversationalIntentFields = {
  matchMode: z.enum(["exact", "semantic"]).default("exact"),
  responseMode: z.enum(["template", "generated"]).default("template"),
  description: z.string().trim().max(400).default(""),
  topicTerms: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  followUpPhrases: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
  instructions: z.string().trim().max(1000).default(""),
  humor: z.enum(["natural", "occasional", "playful"]).default("occasional"),
  parameters: z.array(intentParameterSchema).max(6).default([]),
  responseRules: z.array(responseRuleSchema).max(8).default([]),
  serious: z.boolean().default(false),
  sensorMaxAgeSeconds: z.number().int().min(30).max(86400).default(900),
  dataSource: z.enum(["sensor", "weather"]).default("sensor"),
};

type IntentInput = {
  matchMode: string;
  responseMode: string;
  description: string;
  instructions: string;
  parameters: IntentParameter[];
  responses: string[];
  deviceId: string | null;
  responseRules: ResponseRule[];
  dataSource: "sensor" | "weather";
};
export function validateIntent(v: IntentInput, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (v.matchMode === "semantic" && !v.description)
    issue("description", "Descreva o significado desta intent e quando ela deve ser usada.");
  if (v.responseMode === "generated" && !v.instructions)
    issue("instructions", "Informe como o robô deve responder.");
  if (v.responseMode === "template" && !v.responses.length)
    issue("responses", "Cadastre pelo menos uma resposta.");
  if (v.matchMode === "exact" && v.parameters.length)
    issue("parameters", "Parâmetros extraídos da fala precisam do reconhecimento por significado.");
  if (new Set(v.parameters.map((p) => p.name)).size !== v.parameters.length)
    issue("parameters", "Os nomes dos parâmetros não podem se repetir.");
  const allowed = new Set([...intentMarkers, ...v.parameters.map((p) => p.name)]);
  for (const [index, rule] of v.responseRules.entries()) {
    const ruleIssue = (key: string, message: string) =>
      ctx.addIssue({ code: "custom", path: ["responseRules", index, key], message });
    if (
      (rule.minValue !== null || rule.maxValue !== null) &&
      !v.deviceId &&
      v.dataSource !== "weather"
    )
      ruleIssue("minValue", "Condições por valor precisam do sensor da resposta.");
    if (v.responseMode === "template" && !rule.responses.length)
      ruleIssue("responses", "Cadastre ao menos uma resposta para esta condição.");
  }
  const allResponses = [...v.responses, ...v.responseRules.flatMap((r) => r.responses)];
  for (const response of allResponses) {
    const remainder = response.replace(/\{([a-z][a-z0-9_]*)\}/g, (marker, key: string) =>
      allowed.has(key) ? "" : marker,
    );
    if (/[{}]/.test(remainder))
      issue("responses", "Use apenas marcadores conhecidos ou parâmetros cadastrados.");
  }
  if (allResponses.some((t) => t.includes("{valor}")) && !v.deviceId && v.dataSource !== "weather")
    issue("deviceId", "Respostas com {valor} precisam de um sensor.");
  if (allResponses.some((t) => t.includes("{condicao}")) && v.dataSource !== "weather")
    issue("responses", "O marcador {condicao} precisa da fonte de clima da cidade.");
  if (v.dataSource === "weather" && v.deviceId)
    issue("deviceId", "Use o clima da cidade ou um sensor, sem misturar as fontes.");
}
