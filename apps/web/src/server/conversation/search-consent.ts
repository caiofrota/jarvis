import { createHash } from "node:crypto";
import { normalize, type Settings } from "@rosie/types";
import type { TurnContext } from "@rosie/types/context";
import type { z } from "zod";
import { contextScope } from "../automation/plans";
import type { searchArguments } from "./web-search";

export type SearchRequest = { args: z.infer<typeof searchArguments>; text: string };
const affirmative =
  /^(?:sim|pode|pode sim|sim pode|pode pesquisar|pode buscar|pesquise|pesquisa|quero sim)(?: por favor)?$/;
const negative = /^(?:nao|nao precisa|nao quero|deixa pra la|cancela|cancele)(?: obrigad[oa])?$/;

export function explicitlyRequestsSearch(text: string, names: string[] = []) {
  let phrase = normalize(text);
  for (const name of names.map(normalize).filter(Boolean)) {
    if (phrase.startsWith(`${name} `)) phrase = phrase.slice(name.length + 1);
    if (phrase.endsWith(` ${name}`)) phrase = phrase.slice(0, -name.length - 1);
  }
  if (/\b(nao|nunca|se|talvez)\b/.test(phrase)) return false;
  return (
    /^(?:por favor )?(?:(?:voce )?pode |quero que (?:voce )?|eu quero que (?:voce )?)?(?:pesquis[ae]|pesquisar|busc[ae]|buscar|procur[ae]|procurar|consult[ae]|consultar)\b/.test(
      phrase,
    ) ||
    /^(?:quero|me mostre|mostre|mostra) (?:ver )?(?:as |os |uma |um |opcoes de )?(?:passagens|passagem aerea|voos|voo)\b/.test(
      phrase,
    ) ||
    /^(?:veja|ve|olha) (?:na internet|na web|no google)\b/.test(phrase)
  );
}
function scope(ctx: TurnContext, cfg: Settings) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        contextScope(ctx),
        ctx.home.city,
        ctx.home.timezone,
        cfg.webSearchEnabled,
        cfg.openaiKey,
      ]),
    )
    .digest("hex");
}
export class SearchConsent {
  private pending = new Map<string, (SearchRequest & { expires: number; scope: string }) | null>();
  reset(id: string) {
    this.pending.delete(id);
  }
  offer(id: string, request: SearchRequest, ctx: TurnContext, cfg: Settings) {
    this.pending.delete(id);
    this.pending.set(id, { ...request, expires: Date.now() + 60000, scope: scope(ctx, cfg) });
    const oldest = this.pending.keys().next().value;
    if (this.pending.size > 128 && oldest !== undefined) this.pending.delete(oldest);
    return `Posso fazer uma pesquisa na internet sobre ${request.args.query.replace(/[.!?]+$/, "").slice(0, 180)}?`;
  }
  answer(id: string, text: string, ctx: TurnContext, cfg: Settings): SearchRequest | string | null {
    let phrase = normalize(text);
    for (const name of [ctx.assistant.name, ...ctx.assistant.aliases]
      .map(normalize)
      .filter(Boolean)) {
      if (phrase.startsWith(`${name} `)) phrase = phrase.slice(name.length + 1);
      if (phrase.endsWith(` ${name}`)) phrase = phrase.slice(0, -name.length - 1);
    }
    if (!this.pending.has(id)) return null;
    const old = this.pending.get(id);
    this.pending.delete(id);
    if (!affirmative.test(phrase) && !negative.test(phrase)) return null;
    this.pending.set(id, null);
    if (negative.test(phrase)) return "Tudo bem, não vou pesquisar.";
    if (!old || Date.now() > old.expires || old.scope !== scope(ctx, cfg))
      return "Essa pesquisa não tem mais uma confirmação pendente. Diga novamente o que você quer pesquisar.";
    return { args: old.args, text: old.text };
  }
}
