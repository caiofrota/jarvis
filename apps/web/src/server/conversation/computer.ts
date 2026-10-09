import { randomUUID } from "node:crypto";
import type { CompanionComputerCatalog, CompanionComputerOffer } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";
export function computerOpenTool(catalog: CompanionComputerCatalog) {
  return {
    type: "function",
    function: {
      name: "open_computer",
      description:
        "Propõe abrir um aplicativo ou pasta instalado NESTE computador, apenas a pedido explícito atual. Não executa: aguarda consentimento nativo. Use somente um ID real do catálogo, pergunte se o nome for incerto ou ambíguo. Não use para hipóteses, recomendações ou negações.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", enum: catalog.targets.map((target) => target.id) },
          newInstance: { type: "boolean" },
        },
        required: ["id", "newInstance"],
        additionalProperties: false,
      },
    },
  };
}
export function proposeComputer(
  raw: unknown,
  catalog: CompanionComputerCatalog,
): CompanionComputerOffer {
  const args = z.object({ id: z.string(), newInstance: z.boolean() }).strict().parse(raw);
  const target = catalog.targets.find((value) => value.id === args.id);
  if (!target) throw new DomainError("Esse aplicativo não está disponível neste computador.");
  return {
    requestId: randomUUID(),
    clientId: catalog.clientId,
    id: target.id,
    label: target.label,
    newInstance: args.newInstance,
    expires: Date.now() + 120000,
  };
}
