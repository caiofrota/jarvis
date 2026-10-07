import { type CalendarDraft, normalize } from "@rosie/types";
import { DomainError, type TurnContext } from "@rosie/types/context";
import { z } from "zod";
import { addDays, dateLabel, localDate, timeLabel, zonedTime } from "./dates";
import type { ResidentCalendars } from "./service";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const calendarArguments = z
  .object({
    action: z.enum(["list", "create"]),
    fromDate: date,
    toDate: date.nullable(),
    title: z.string().trim().min(1).max(140).nullable(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    allDay: z.boolean(),
  })
  .strict();
export const calendarTool = {
  type: "function",
  function: {
    name: "resident_calendar",
    description:
      "Consultar a agenda do morador atual ou PROPOR um novo compromisso, sem salvar ainda. Nunca escolha outra pessoa nem invente compromissos. Criação exige confirmação posterior controlada pelo servidor. Datas YYYY-MM-DD no fuso da casa; toDate inclusiva. Consulta sem período: hoje. Para criar, peça data e hora se faltarem; não invente título nem hora. Fim omitido: 1 hora, informado na confirmação. Dia inteiro só quando pedido. Sem alterar, excluir, recorrência ou convidados. Após esclarecimento, envie o pedido completo.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create"] },
        fromDate: { type: "string" },
        toDate: { type: ["string", "null"] },
        title: { type: ["string", "null"] },
        startTime: { type: ["string", "null"] },
        endTime: { type: ["string", "null"] },
        allDay: { type: "boolean" },
      },
      required: ["action", "fromDate", "toDate", "title", "startTime", "endTime", "allDay"],
      additionalProperties: false,
    },
  },
};
type Pending = { expires: number; fingerprint: string; scope: string; draft: CalendarDraft };
const scope = (ctx: TurnContext) =>
  JSON.stringify([
    ctx.home.id,
    ctx.home.timezone,
    ctx.room.id,
    ctx.endpoint.id,
    ctx.assistant.id,
    ctx.resident?.id,
    ctx.mode?.id,
  ]);
const safeTitle = (text: string, limit = 100) =>
  text
    .replace(/[\p{Cc}\p{Cf}*#`<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

export class CalendarConversation {
  private pending = new Map<string, Pending | null>();
  constructor(private calendars: ResidentCalendars) {}
  reset(id: string) {
    this.pending.delete(id);
  }
  async answer(id: string, text: string, ctx: TurnContext, signal: AbortSignal) {
    if (!this.pending.has(id)) return null;
    let value = normalize(text);
    for (const name of [ctx.assistant.name, ...ctx.assistant.aliases]
      .map(normalize)
      .filter(Boolean)) {
      if (value.startsWith(`${name} `)) value = value.slice(name.length + 1);
      if (value.endsWith(` ${name}`)) value = value.slice(0, -name.length - 1);
    }
    const old = this.pending.get(id);
    this.pending.delete(id);
    const yes =
      /^(?:sim|pode|pode sim|sim pode|confirmo|confirma|confirmar|pode salvar|pode criar|pode marcar|pode agendar)(?: por favor)?$/.test(
        value,
      );
    const no =
      /^(?:nao|nao quero|nao precisa|nao salve|nao salva|nao pode|cancela|cancelar|cancele|deixa pra la)(?: obrigad[oa])?$/.test(
        value,
      );
    if (!yes && !no) return null;
    this.pending.set(id, null);
    if (!old) return "Não há um pedido de agenda aguardando confirmação.";
    if (no) return "Tudo bem, não criei o compromisso.";
    if (Date.now() > old.expires || old.scope !== scope(ctx))
      return "Não há uma confirmação de agenda válida. Diga novamente o compromisso que deseja criar.";
    await this.calendars.create(ctx, old.draft, old.fingerprint, signal);
    signal.throwIfAborted();
    return `Compromisso criado na agenda de ${ctx.resident?.name}.`;
  }
  local(text: string, zone: string): z.infer<typeof calendarArguments> | null {
    const value = normalize(text);
    const m = value.match(
      /^(?:qual (?:e )?(?:a )?minha agenda|(?:quais|que) (?:sao )?(?:os )?(?:meus )?compromissos(?: (?:eu )?tenho)?|o que (?:eu )?tenho (?:na agenda|agendado)|(?:me mostre|mostra|consulte) (?:a )?minha agenda)(?: (?:para|pra|de))?(?: (hoje|amanha|esta semana|essa semana))?$/,
    );
    if (!m) return null;
    const today = localDate(new Date(), zone),
      fromDate = m[1] === "amanha" ? addDays(today, 1) : today;
    return {
      action: "list",
      fromDate,
      toDate: /semana/.test(m[1] ?? "")
        ? addDays(today, (7 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7)
        : fromDate,
      title: null,
      startTime: null,
      endTime: null,
      allDay: false,
    };
  }
  async run(id: string, raw: unknown, ctx: TurnContext, signal: AbortSignal) {
    const args = calendarArguments.parse(raw),
      today = localDate(new Date(), ctx.home.timezone);
    const last = args.toDate ?? args.fromDate;
    addDays(last, 0);
    if (last < args.fromDate || Date.parse(last) - Date.parse(args.fromDate) > 30 * 86400000)
      throw new DomainError(
        "Consulte no máximo 31 dias por vez, com a data final depois da inicial.",
      );
    if (args.action === "list") {
      const events = await this.calendars.list(
        ctx,
        zonedTime(args.fromDate, "00:00", ctx.home.timezone),
        zonedTime(addDays(last, 1), "00:00", ctx.home.timezone),
        signal,
      );
      const startTime = (v: (typeof events)[number]) =>
        Date.parse(v.allDay ? zonedTime(v.start, "00:00", ctx.home.timezone) : v.start);
      const usable = events
        .filter((v) => Number.isFinite(startTime(v)))
        .sort((a, b) => startTime(a) - startTime(b));
      if (usable.length !== events.length)
        throw new DomainError(
          "A agenda retornou um horário inválido. Não consegui resumir os compromissos.",
        );
      if (!usable.length)
        return `Não encontrei compromissos na agenda de ${ctx.resident?.name} nesse período.`;
      const details = usable.slice(0, 4).map((event) => {
        const day = event.allDay
          ? event.start
          : localDate(new Date(event.start), ctx.home.timezone);
        const when = `${day === today ? "hoje" : dateLabel(day)}, ${event.allDay ? "o dia inteiro" : `às ${timeLabel(event.start, ctx.home.timezone)}`}`;
        return `${safeTitle(event.title) || "Compromisso sem título"}, ${when}`;
      });
      return `${ctx.resident?.name}, ${details.join(". ")}.${usable.length > 4 ? ` Há mais ${usable.length - 4} compromissos; consulte um período menor para ouvir os demais.` : ""}`;
    }
    const access = await this.calendars.access(ctx);
    if (!access.binding.allowCreate)
      throw new DomainError("A criação de eventos está desabilitada para esta agenda no painel.");
    if (!args.title) throw new DomainError("Qual é o nome do compromisso?");
    if (!args.allDay && !args.startTime) throw new DomainError("A que horas começa o compromisso?");
    if (!args.allDay && last !== args.fromDate && !args.endTime)
      throw new DomainError("A que horas termina o compromisso no último dia?");
    if (args.fromDate < today || args.fromDate > addDays(today, 366))
      throw new DomainError("Escolha uma data de hoje até um ano à frente.");
    if (Date.parse(last) - Date.parse(args.fromDate) > 6 * 86400000)
      throw new DomainError("Posso criar um compromisso de até sete dias por vez.");
    const start = args.allDay
      ? args.fromDate
      : zonedTime(args.fromDate, args.startTime as string, ctx.home.timezone);
    const end = args.allDay
      ? addDays(last, 1)
      : args.endTime
        ? zonedTime(last, args.endTime, ctx.home.timezone)
        : new Date(Date.parse(start) + 3600000).toISOString();
    if (end <= start || (!args.allDay && Date.parse(start) < Date.now() - 60000))
      throw new DomainError(
        "O compromisso precisa começar no futuro e terminar depois de começar.",
      );
    const draft = { title: safeTitle(args.title, 140), start, end, allDay: args.allDay };
    if (!draft.title) throw new DomainError("Diga um nome para o compromisso.");
    signal.throwIfAborted();
    this.pending.set(id, {
      draft,
      fingerprint: access.fingerprint,
      scope: scope(ctx),
      expires: Date.now() + 60000,
    });
    const oldest = this.pending.keys().next().value;
    if (this.pending.size > 128 && oldest !== undefined) this.pending.delete(oldest);
    const until = args.allDay
      ? `dia inteiro${last !== args.fromDate ? ` até ${dateLabel(last)}` : ""}`
      : `das ${timeLabel(start, ctx.home.timezone)} às ${timeLabel(end, ctx.home.timezone)}${localDate(new Date(end), ctx.home.timezone) !== args.fromDate ? ` do dia ${dateLabel(localDate(new Date(end), ctx.home.timezone))}` : ""}`;
    return `Posso criar ${draft.title} na agenda de ${ctx.resident?.name}, em ${dateLabel(args.fromDate)}, ${until}?`;
  }
}
