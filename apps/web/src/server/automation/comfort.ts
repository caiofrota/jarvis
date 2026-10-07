import type { Repository } from "@rosie/db";
import { type EntityMap, normalize, type Settings } from "@rosie/types";
import { context, DomainError, type TurnContext } from "@rosie/types/context";
import type { Command } from "./commands";
import { contextScope, deviceFingerprint } from "./plans";
import { resolveDevice } from "./resolver";
import type { Automations, ComfortState, Confirmation } from "./service";

type Feeling = "cold" | "hot";
type Proposal = { feeling: Feeling; expires: number; command: Command; expected: Confirmation };
const yes =
  /^(?:sim|pode|pode sim|sim pode|pode fazer|pode ajustar|pode ligar|pode desligar|quero|quero sim)(?: por favor)?$/;
const no =
  /^(?:nao|nao precisa|nao quero|deixa pra la|deixa quieto|cancela|cancele)(?: obrigad[oa])?$/;

function comfortPhrase(text: string, names: string[] = [], rooms: string[] = []) {
  let phrase = normalize(text);
  const edges = [
    ...names,
    "por favor",
    "nossa",
    "olha",
    "poxa",
    "eita",
    "viu",
    "sabe",
    "hein",
    "oi",
    "ei",
  ]
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  // Only address/politeness at the edges; never remove negation, conditions or other clauses.
  for (let n = 0; n < 8; n++) {
    const before = phrase;
    for (const edge of edges) {
      if (phrase.startsWith(`${edge} `)) phrase = phrase.slice(edge.length + 1);
      if (phrase.endsWith(` ${edge}`)) phrase = phrase.slice(0, -edge.length - 1);
    }
    if (before === phrase) break;
  }
  for (const room of rooms.map(normalize).filter(Boolean))
    for (const preposition of ["aqui no", "aqui na", "no", "na", "em"])
      if (phrase.endsWith(` ${preposition} ${room}`))
        phrase = `${phrase.slice(0, -preposition.length - room.length - 2)} aqui`;
  return phrase;
}
export function comfortFeeling(
  text: string,
  names: string[] = [],
  rooms: string[] = [],
): Feeling | null {
  const m = comfortPhrase(text, names, rooms).match(
    /^(?:(?:eu )?(?:(?:estou|to|tou|estamos) (?:com|sentindo|passando)|(?:sinto|estou sentindo|to sentindo)) (?:muito |bastante |um pouco de |um |um pouco |muita )?|que |(?:esta|ta) (?:muito |um |bem )?)(frio|friozinho|calor|calorzinho|calorao|quente|gelado)(?: demais| pra caramba| para caramba| danado)?(?: aqui| nesse ambiente| neste ambiente)?$/,
  );
  return m ? (/^(frio|gelado)/.test(m[1]) ? "cold" : "hot") : null;
}

/** Only a current, concrete offer can authorize a short affirmative reply. No LLM or durable history. */
export class ComfortSuggestions {
  private pending = new Map<string, Proposal | null>();
  constructor(
    private repo: Repository,
    private automations: Automations,
  ) {}
  reset(endpointId: string) {
    this.pending.delete(endpointId);
  }
  private remember(endpointId: string, proposal: Proposal | null) {
    this.pending.delete(endpointId);
    this.pending.set(endpointId, proposal);
    const oldest = this.pending.keys().next().value;
    if (this.pending.size > 128 && oldest !== undefined) this.pending.delete(oldest);
  }
  async respond(
    endpointId: string,
    text: string,
    signal: AbortSignal,
    names: string[] = [],
    rooms: string[] = [],
    residentId?: string | null,
  ): Promise<string | null> {
    const phrase = comfortPhrase(text, names),
      feeling = comfortFeeling(text, names, rooms),
      old = this.pending.get(endpointId);
    if (feeling) {
      this.remember(endpointId, null);
      await this.repo.event("comfort_recognized", { endpoint: endpointId, feeling });
      signal.throwIfAborted();
      return this.offer(endpointId, feeling, signal, residentId);
    }
    if (this.pending.has(endpointId) && (yes.test(phrase) || no.test(phrase))) {
      this.remember(endpointId, null); // Consume before any await; never replay a confirmation.
      if (no.test(phrase)) return "Tudo bem, não vou mudar nada.";
      if (!old || Date.now() > old.expires)
        return "Não há uma sugestão válida para confirmar. Me diga novamente se está com frio ou calor.";
      const namedActions: Record<string, string> = {
        "pode ligar": "on",
        "pode desligar": "off",
        "pode ajustar": "set_temperature",
      };
      const namedAction = namedActions[phrase.replace(/ por favor$/, "")];
      if (namedAction && namedAction !== old.command.action)
        return "Essa ação é diferente da sugestão. Diga o comando completo, incluindo o aparelho que você quer alterar.";
      const c = await this.repo.catalog(),
        ctx = context(c, endpointId, residentId),
        cfg = await this.repo.settings();
      signal.throwIfAborted();
      const d = c.devices.find((v) => v.id === old.expected.deviceId && v.enabled);
      if (
        !d ||
        contextScope(ctx) !== old.expected.scope ||
        deviceFingerprint(d, cfg) !== old.expected.fingerprint
      )
        return "O ambiente ou o cadastro mudou. Me diga novamente se está com frio ou calor.";
      if (JSON.stringify(this.automations.comfortState(d)) !== old.expected.state)
        return `O estado do aparelho mudou. ${await this.offer(endpointId, old.feeling, signal, residentId)}`;
      return this.automations.executePlan(
        endpointId,
        [old.command],
        signal,
        old.expected,
        residentId,
      );
    }
    this.pending.delete(endpointId); // A different request invalidates the outstanding offer.
    return null;
  }
  private async offer(
    endpointId: string,
    feeling: Feeling,
    signal: AbortSignal,
    residentId?: string | null,
  ) {
    const c = await this.repo.catalog(),
      ctx = context(c, endpointId, residentId),
      cfg = await this.repo.settings();
    signal.throwIfAborted();
    const candidates = c.devices.filter(
      (d) =>
        d.enabled &&
        d.homeId === ctx.home.id &&
        d.roomId === ctx.room.id &&
        ["climate", "fan"].includes(d.kind),
    );
    if (!candidates.length)
      return `Não tenho ar-condicionado nem ventilador cadastrado em ${ctx.room.name}.`;
    let unavailable = false;
    let limitation = "";
    for (const kind of ["climate", "fan"]) {
      if (!candidates.some((d) => d.kind === kind)) continue;
      // The room's configured default wins; an ambiguous room is never guessed.
      const d = resolveDevice(c, ctx, kind);
      try {
        const state = this.automations.comfortState(d);
        const suggestion = this.suggestion(d, state, feeling);
        if (!suggestion) {
          if (
            state.mode === "cool" &&
            feeling === "hot" &&
            state.temperature !== undefined &&
            state.temperature === state.min
          )
            limitation = `${d.name} já está na temperatura mínima de ${String(state.min).replace(".", ",")} graus.`;
          else if (state.mode === "off" && feeling === "cold")
            limitation = `${d.name} já está desligado.`;
          else if (d.kind === "fan" && state.mode === "on" && feeling === "hot")
            limitation = `${d.name} já está ligado.`;
          continue;
        }
        signal.throwIfAborted();
        this.remember(endpointId, {
          feeling,
          expires: Date.now() + 60000,
          command: {
            target: d.id,
            room: ctx.room.id,
            action: suggestion.action,
            temperature: suggestion.temperature ?? null,
            routine: false,
            delaySeconds: 0,
          },
          expected: this.expected(d, state, cfg, ctx),
        });
        return suggestion.text;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        unavailable = true;
      }
    }
    if (limitation)
      return `${limitation} Não encontrei outro ajuste disponível nos aparelhos deste ambiente.`;
    return unavailable
      ? "Não consegui consultar um aparelho disponível com os controles necessários nesse ambiente. Não alterei nada."
      : "Não encontrei um ajuste disponível para isso nos aparelhos deste ambiente. Não alterei nada.";
  }
  private expected(
    d: EntityMap["devices"],
    state: ComfortState,
    cfg: Settings,
    ctx: TurnContext,
  ): Confirmation {
    return {
      expires: Date.now() + 60000,
      deviceId: d.id,
      scope: contextScope(ctx),
      fingerprint: deviceFingerprint(d, cfg),
      state: JSON.stringify(state),
    };
  }
  private suggestion(
    d: EntityMap["devices"],
    s: ComfortState,
    feeling: Feeling,
  ): { action: string; temperature?: number; text: string } | null {
    const hot = feeling === "hot";
    const switchOffer = (on: boolean) =>
      d.actions[on ? "on" : "off"]
        ? {
            action: on ? "on" : "off",
            text: `${d.name} está ${on ? "desligado" : "ligado"}. Quer que eu ${on ? "ligue" : "desligue"}?`,
          }
        : null;
    if (d.kind === "fan")
      return hot && s.mode === "off"
        ? switchOffer(true)
        : !hot && s.mode === "on"
          ? switchOffer(false)
          : null;
    if (s.mode === "off") {
      // turn_on may restore an unknown previous heating mode; only offer a cooling-only AC.
      return hot &&
        s.modes?.includes("cool") &&
        !s.modes.includes("heat") &&
        !s.modes.includes("auto") &&
        !s.modes.includes("heat_cool")
        ? switchOffer(true)
        : null;
    }
    if (!["cool", "heat"].includes(s.mode)) return null;
    if (
      d.actions.set_temperature &&
      s.temperature !== undefined &&
      s.min !== undefined &&
      s.max !== undefined
    ) {
      this.automations.addons.homeAssistant.validateTemperature(d, s.temperature);
      const step = s.step && s.step > 0 ? s.step : 1;
      const delta = Math.max(1, Math.round(2 / step)) * step;
      const desired = s.temperature + (hot ? -delta : delta);
      const index = Math.max(
        0,
        Math.min(Math.floor((s.max - s.min) / step + 1e-6), Math.round((desired - s.min) / step)),
      );
      const temperature = Number((s.min + index * step).toFixed(4));
      if (temperature !== s.temperature) {
        this.automations.addons.homeAssistant.validateTemperature(d, temperature);
        const number = (v: number) => String(v).replace(".", ",");
        return {
          action: "set_temperature",
          temperature,
          text: `${s.source === "command" ? `O último ajuste enviado para ${d.name} foi de` : `${d.name} está ajustado para`} ${number(s.temperature)} graus. Quer que eu ${hot ? "diminua" : "aumente"} para ${number(temperature)}?`,
        };
      }
    }
    return (!hot && s.mode === "cool") || (hot && s.mode === "heat") ? switchOffer(false) : null;
  }
}
