import type { Repository } from "@rosie/db";
import { expressions, normalize, type Reply, type WebReferences } from "@rosie/types";
import { context, DomainError, selectVariant, type TurnContext } from "@rosie/types/context";
import { z } from "zod";
import { ComfortSuggestions } from "../automation/comfort";
import {
  planSchema,
  timerCancellation,
  timingClarification,
  validatePlanTiming,
} from "../automation/commands";
import { localCommand, matches } from "../automation/resolver";
import type { Automations } from "../automation/service";
import { localTemperatureCommand, validateTemperatureValues } from "../automation/temperature";
import { CalendarConversation, calendarArguments, calendarTool } from "../calendar/conversation";
import { ResidentCalendars } from "../calendar/service";
import { Readings } from "../readings/service";
import {
  type ConversationReply,
  exactIntent,
  type Intent,
  type IntentContext,
  intentPrompt,
  parseIntentReply,
  responseSchema,
  semanticIntents,
  templateReply,
} from "./intents";
import { prepareIntent } from "./response-rules";
import { explicitlyRequestsSearch, SearchConsent, type SearchRequest } from "./search-consent";
import { speakerIdentityContext, speakerIdentityReply } from "./speaker-identity";
import { asksCurrentHomeWeather, searchPresentation } from "./weather-request";
import {
  eventPeriod,
  missingFlightDetails,
  resolveFlightDefaults,
  searchArguments,
  searchPrompt,
  searchQuery,
  searchTool,
  wantsFreshSearch,
} from "./web-search";

const seriousnessPrompt = `\nRegra de tom, com prioridade sobre personagem, humor e exemplos: saúde, dor, acidentes, perigo, luto, sofrimento, problemas reais ou um pedido para falar sério exigem uma resposta cuidadosa, direta e sem piadas, ciúme ou provocações. Isso vale também para réplicas de uma brincadeira quando a pessoa passa a falar de um problema real. No JSON, serious=true nesses casos ou quando a intent tem serious=true; nos demais, false. Se serious=true, escreva text com a resposta séria mesmo quando responseMode=template. Não copie exemplos humorísticos. Uma demonstração fictícia de expressão não significa que a pessoa esteja em perigo. Para condições de clima, use somente a leitura atual fornecida; temperatura isolada não prova chuva, alertas ou condições dentro da casa. Não confunda condições atuais com previsão para amanhã. Se faltarem dados, diga isso claramente. Expressões de deboche/alegria não combinam com preocupações reais.`;

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
const tool = {
  type: "function",
  function: {
    name: "control_home",
    description:
      "Executar um único plano com TODOS os comandos solicitados, na ordem. Sem cômodo explícito, usa o ambiente da caixinha. delaySeconds é a espera ANTES da etapa, contada após o envio da etapa anterior (ou a aceitação do plano na primeira etapa). Use 0 para imediato. Exemplo: acenda a luz e apague depois de 5 segundos = ligar com 0, desligar com 5. Nunca omita intervalos. Até 8 etapas e 1 hora no total. Para vários cômodos, inclua uma etapa por cômodo. Se falta unidade de tempo ou dispositivo, pergunte antes de chamar.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              target: { type: "string" },
              action: { type: "string" },
              room: { type: ["string", "null"] },
              routine: { type: "boolean" },
              delaySeconds: { type: "integer", minimum: 0, maximum: 3600 },
              temperature: {
                type: ["number", "null"],
                description:
                  "Temperatura absoluta em graus Celsius, apenas para a ação set_temperature de um ar-condicionado cadastrado; null nas demais ações. Nunca invente o valor nem use on/off para substituir um ajuste.",
              },
            },
            required: ["target", "action", "room", "routine", "delaySeconds", "temperature"],
            additionalProperties: false,
          },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
  },
};
export class Conversation {
  private history = new Map<string, Message[]>();
  private focus = new Map<string, IntentContext>();
  private active = new Map<string, AbortController>();
  private identities = new Map<string, string>();
  private readings: Readings;
  private comfort: ComfortSuggestions;
  private searchConsent = new SearchConsent();
  private calendar: CalendarConversation;
  private references = new Map<string, WebReferences>();
  webReferences(): Record<string, WebReferences> {
    for (const [id, value] of this.references)
      if (Date.now() - Date.parse(value.checkedAt) > 30 * 60000) this.references.delete(id);
    return Object.fromEntries(this.references);
  }
  constructor(
    private repo: Repository,
    private automations: Automations,
  ) {
    this.readings = new Readings(automations);
    this.comfort = new ComfortSuggestions(repo, automations);
    this.calendar = new CalendarConversation(
      new ResidentCalendars(repo, () => automations.addons.calendar),
    );
  }
  reset(endpointId: string) {
    this.calendar.reset(endpointId);
    this.searchConsent.reset(endpointId);
    this.comfort.reset(endpointId);
    this.history.delete(endpointId);
    this.focus.delete(endpointId);
    this.identities.delete(endpointId);
    this.active.get(endpointId)?.abort();
    this.active.delete(endpointId);
  }
  async respond(
    endpointId: string,
    text: string,
    signal: AbortSignal,
    residentId?: string | null,
  ): Promise<ConversationReply> {
    if (this.active.has(endpointId))
      throw new DomainError("Aguarde a resposta desta caixinha antes de enviar outra mensagem.");
    const controller = new AbortController();
    this.active.set(endpointId, controller);
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      combined.throwIfAborted();
      const reply = await this.respondTurn(endpointId, text, combined, residentId);
      combined.throwIfAborted();
      return reply;
    } finally {
      if (combined.aborted) {
        this.calendar.reset(endpointId);
        this.comfort.reset(endpointId);
        this.searchConsent.reset(endpointId);
      }
      if (this.active.get(endpointId) === controller) this.active.delete(endpointId);
    }
  }
  private async respondTurn(
    endpointId: string,
    text: string,
    signal: AbortSignal,
    residentId?: string | null,
  ): Promise<ConversationReply> {
    const c = await this.repo.catalog(),
      ctx = context(c, endpointId, residentId),
      cfg = await this.repo.settings();
    const plain = (value: string): Reply => ({ text: value, expression: "neutral" });
    signal.throwIfAborted();
    const identity = JSON.stringify([
      ctx.home.id,
      ctx.room.id,
      ctx.assistant.id,
      ctx.resident?.id,
      ctx.mode?.id,
    ]);
    if (this.identities.get(endpointId) !== identity) {
      this.calendar.reset(endpointId);
      this.searchConsent.reset(endpointId);
      this.comfort.reset(endpointId);
      this.history.delete(endpointId);
      this.focus.delete(endpointId);
      this.references.delete(endpointId);
      this.identities.set(endpointId, identity);
    }
    const previous = ctx.assistant.historyTurns ? (this.history.get(endpointId) ?? []) : [];
    const finish = (reply: ConversationReply): ConversationReply => {
      signal.throwIfAborted();
      if (reply.web) this.references.set(endpointId, reply.web);
      if (ctx.assistant.historyTurns) {
        const updated: Message[] = [
          ...previous,
          { role: "user", content: text.slice(0, 4000) },
          { role: "assistant", content: reply.text },
        ];
        this.history.set(endpointId, updated.slice(-ctx.assistant.historyTurns * 2));
        if (reply.intent) this.focus.set(endpointId, reply.intent);
        else this.focus.delete(endpointId);
      } else {
        this.history.delete(endpointId);
        this.focus.delete(endpointId);
      }
      return reply;
    };
    const phrase = normalize(text);
    let forced: ReturnType<typeof exactIntent>;
    try {
      const calendarAnswer = await this.calendar.answer(endpointId, text, ctx, signal);
      if (calendarAnswer !== null) {
        this.history.delete(endpointId);
        this.focus.delete(endpointId);
        return plain(calendarAnswer);
      }
      const search = this.searchConsent.answer(endpointId, text, ctx, cfg);
      if (typeof search === "string") return finish(plain(search));
      if (search) return finish(await this.runSearch(endpointId, search, ctx, signal));
      const comfort = await this.comfort.respond(
        endpointId,
        text,
        signal,
        [ctx.assistant.name, ...ctx.assistant.aliases],
        [ctx.room.name, ...ctx.room.aliases],
        residentId,
      );
      if (comfort !== null) {
        // Proposals are single-use capabilities, never instructions recoverable from LLM history.
        this.history.delete(endpointId);
        this.focus.delete(endpointId);
        return plain(comfort);
      }
      const identified = speakerIdentityReply(text, ctx, residentId);
      if (identified) {
        await this.repo.event("speaker_identity_reply", {
          endpoint: endpointId,
          resident: ctx.resident?.id ?? null,
          source: !ctx.resident ? "unknown" : residentId === undefined ? "fixed_profile" : "voice",
        });
        return finish(identified);
      }
      const calendarQuery = this.calendar.local(text, ctx.home.timezone);
      if (calendarQuery) {
        this.history.delete(endpointId);
        this.focus.delete(endpointId);
        return plain(await this.calendar.run(endpointId, calendarQuery, ctx, signal));
      }
      if (timerCancellation(text))
        return finish(plain(await this.automations.cancelPending(endpointId, residentId)));
      const timingQuestion = timingClarification(text);
      if (timingQuestion) return finish(plain(timingQuestion));
      forced = exactIntent(c, ctx, text);
      if (forced?.responseMode === "template") {
        const prepared = await prepareIntent(forced, c, ctx, this.readings, signal);
        if (prepared.error) return finish(plain(prepared.error));
        const reply = templateReply(prepared.intent, prepared.variables ?? {});
        await this.repo.event("intent_selected", {
          endpoint: endpointId,
          intent: forced.id,
          matchMode: "exact",
          parameterNames: [],
        });
        return finish(reply);
      }
      if (!forced && ["que horas sao", "que horas sao agora", "me diga as horas"].includes(phrase))
        return finish(
          plain(
            `Agora são ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: ctx.home.timezone }).format(new Date())}.`,
          ),
        );
      const temperature = localTemperatureCommand(text);
      if (temperature && !forced)
        return finish(
          plain(
            await this.automations.executePlan(
              endpointId,
              [temperature],
              signal,
              undefined,
              residentId,
            ),
          ),
        );
      const command = localCommand(text);
      signal.throwIfAborted();
      if (command && !forced)
        return finish(
          plain(
            await this.automations.execute(
              endpointId,
              command.target,
              command.action,
              command.room,
              false,
              signal,
              residentId,
            ),
          ),
        );
      if (!forced && c.routines.some((v) => v.homeId === ctx.home.id && matches(v, text)))
        return finish(
          plain(
            await this.automations.execute(endpointId, text, "run", null, true, signal, residentId),
          ),
        );
    } catch (error) {
      if (error instanceof DomainError) return finish(plain(error.message));
      throw error;
    }
    const assistant = ctx.assistant,
      key = assistant.provider === "openai" ? cfg.openaiKey : cfg.deepseekKey;
    if (!key)
      return finish(
        plain("Configure a chave do provedor no painel para habilitar a conversa por significado."),
      );
    const focus = ctx.assistant.historyTurns ? this.focus.get(endpointId) : undefined;
    const prepared = await Promise.all(
      (forced ? [forced] : semanticIntents(c, ctx, text, focus)).map((intent) =>
        prepareIntent(intent, c, ctx, this.readings, signal),
      ),
    );
    if (forced && prepared[0]?.error) return finish(plain(prepared[0].error));
    const intents = prepared.map((v) => v.intent);
    const useCurrentWeather =
      asksCurrentHomeWeather(text, ctx.home.city) &&
      prepared.some((v) => v.intent.dataSource === "weather" && !v.error && v.variables?.valor);
    const inventory = {
      rooms: c.rooms
        .filter((v) => v.homeId === ctx.home.id && v.enabled)
        .map((v) => ({ id: v.id, name: v.name, aliases: v.aliases })),
      devices: await Promise.all(
        c.devices
          .filter((v) => v.homeId === ctx.home.id && v.enabled)
          .map(async (v) => ({
            id: v.id,
            name: v.name,
            aliases: v.aliases,
            room: v.roomId,
            kind: v.kind,
            actions: Object.keys(v.actions),
            ...(v.kind === "climate"
              ? (() => {
                  try {
                    return { currentTemperature: this.automations.currentTemperature(v) };
                  } catch {
                    return { currentTemperature: null };
                  }
                })()
              : {}),
          })),
      ),
      routines: c.routines
        .filter((v) => v.homeId === ctx.home.id && v.enabled && selectVariant([v], ctx))
        .map((v) => ({ name: v.name })),
    };
    const prompt = `Você é ${assistant.name}. ${assistant.personality}\nVisão de mundo e posicionamento da personagem: ${assistant.worldview || "não definido"}. Use essa perspectiva quando o assunto pedir, distinguindo opinião de fatos e sem introduzir temas alheios à pergunta.\nInformações suas: ${assistant.facts}\nCasa: ${ctx.home.name}. Cidade: ${ctx.home.city || "não configurada"}. Informações compartilhadas: ${ctx.home.facts}\nAmbiente desta caixinha: ${ctx.room.name} (${ctx.room.id}).\n${speakerIdentityContext(ctx, residentId)}\nModo: ${ctx.mode?.instructions ?? "padrão"}.\nAgora: ${new Date().toLocaleString("pt-BR", { timeZone: ctx.home.timezone })}.\nCadastro: ${JSON.stringify(inventory)}\nUse os nomes e aliases do cadastro para identificar os dispositivos. Em um clima, currentTemperature é a leitura atual observada pelo Home Assistant, quando não for null; ao perguntarem a temperatura atual do ar, use esse valor e não o setpoint temperature. Para temperatura absoluta do ar, use action set_temperature e temperature em Celsius, somente quando essa ação estiver cadastrada; nas outras ações use temperature null. Ajustar temperatura não significa ligar nem trocar modo. Use control_home uma única vez com todas as etapas para automação; nunca afirme execução nem agendamento sem o resultado. Não ignore intervalos nem transforme etapas futuras em ações imediatas. Um tempo sem unidade exige perguntar segundos ou minutos. Se houver dúvida, pergunte. Respeite o cômodo explicitamente pedido. Não invente clima atual sem dados de uma fonte.\nResponda com JSON: text é a fala natural em texto simples, sem Markdown, asteriscos de formatação, listas ou blocos de código; expression é uma destas: ${expressions.join(", ")}. Escolha a expressão que combina com a resposta; humor é ocasional, não obrigatório.`;
    const readings: Record<string, string> = {};
    for (const entry of prepared.filter(
      (v) => v.intent.deviceId || v.intent.dataSource === "weather",
    )) {
      readings[entry.intent.id] = entry.error
        ? "Leitura indisponível. Não invente um valor nem use leituras de turnos anteriores."
        : JSON.stringify({
            valor: entry.variables?.valor,
            condicao: entry.variables?.condicao,
            fonte: entry.source,
          });
    }
    const semanticPrompt = intentPrompt(intents, focus, forced, readings, text);
    const messages: Message[] = [
      {
        role: "system",
        content:
          prompt +
          semanticPrompt +
          seriousnessPrompt +
          "\nVocê pode consultar a agenda do morador atual e propor novos compromissos pela ferramenta resident_calendar. Não invente compromissos nem confirme criação antes do resultado. Não acesse agendas de outra pessoa; sem morador identificado, peça identificação. Para criar, confirme data/hora/título completos pela ferramenta, inclusive após esclarecimentos; ela pedirá autorização antes de salvar. Datas no fuso da casa: " +
          ctx.home.timezone +
          "." +
          searchPrompt(cfg.webSearchEnabled) +
          "\nEsta resposta será falada. Use unidades por extenso: graus Celsius, por cento. Sem símbolos, tabelas ou marcadores. Para clima, use Celsius por padrão e responda apenas ao período solicitado, em uma ou duas frases; só acrescente dias e detalhes se pedidos." +
          (useCurrentWeather
            ? "\nEsta pergunta é sobre o clima atual da cidade da casa e há uma leitura atual disponível nas intents. Responda usando essa leitura, sem pesquisar e sem acrescentar previsão. Use a intent de clima correspondente. Prefira algumas nuvens a nuvens espaçadas."
            : ""),
      },
      ...(assistant.historyTurns ? previous.slice(-assistant.historyTurns * 2) : []),
      { role: "user", content: text.slice(0, 4000) },
    ];
    let result: ConversationReply = plain("Não consegui concluir essa solicitação.");
    let repairIntent: Intent | undefined;
    for (let round = 0; round < 2; round++) {
      signal.throwIfAborted();
      const payload = {
        model: assistant.model,
        messages,
        max_tokens: Math.min(assistant.maxOutputTokens, ctx.mode?.maxOutputTokens ?? 1000),
        tools: cfg.webSearchEnabled ? [tool, searchTool, calendarTool] : [tool, calendarTool],
        tool_choice: round || forced || useCurrentWeather ? "none" : "auto",
        response_format:
          assistant.provider === "openai"
            ? {
                type: "json_schema",
                json_schema: {
                  name: "robot_reply",
                  strict: true,
                  schema: responseSchema(repairIntent ? [repairIntent] : intents),
                },
              }
            : { type: "json_object" },
      };
      const start = Date.now();
      const response = await fetch(
        assistant.provider === "openai"
          ? "https://api.openai.com/v1/chat/completions"
          : "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        },
      );
      if (!response.ok) throw new Error(`Conversation provider failed (${response.status})`);
      const data = (await response.json()) as {
        choices: {
          message: { content: string | null; tool_calls?: ToolCall[] };
          finish_reason: string;
        }[];
        usage: Record<string, unknown>;
      };
      await this.repo.event("llm_usage", {
        endpoint: endpointId,
        assistant: assistant.id,
        provider: assistant.provider,
        model: assistant.model,
        usage: data.usage,
        elapsed_ms: Date.now() - start,
      });
      const choice = data.choices?.[0];
      if (!choice) throw new Error("Empty provider response");
      if (
        !round &&
        !forced &&
        choice.message.tool_calls?.some((call) => call.function.name === "resident_calendar")
      ) {
        this.history.delete(endpointId);
        this.focus.delete(endpointId);
        try {
          if (choice.message.tool_calls.length !== 1)
            throw new DomainError(
              "Vamos fazer o pedido da agenda separadamente dos outros comandos.",
            );
          const args = calendarArguments.parse(
            JSON.parse(choice.message.tool_calls[0].function.arguments),
          );
          const others = c.residents.filter((v) => v.id !== ctx.resident?.id);
          if (
            args.action === "list" &&
            others.some(
              (v) =>
                normalize(text).includes(`agenda de ${normalize(v.name)}`) ||
                normalize(text).includes(`agenda da ${normalize(v.name)}`) ||
                normalize(text).includes(`agenda do ${normalize(v.name)}`),
            )
          )
            throw new DomainError(
              "Posso consultar apenas a agenda do morador selecionado ou reconhecido nesta conversa.",
            );
          return plain(await this.calendar.run(endpointId, args, ctx, signal));
        } catch (error) {
          signal.throwIfAborted();
          return plain(
            error instanceof DomainError
              ? error.message
              : "Não consegui validar o pedido da agenda. Diga a data e o horário novamente.",
          );
        }
      }
      // Handle the entire search turn here: one hosted request, no second generation or home action.
      if (
        !round &&
        !forced &&
        choice.message.tool_calls?.some((call) => call.function.name === "search_web")
      ) {
        const call = choice.message.tool_calls.find((item) => item.function.name === "search_web");
        try {
          const args = resolveFlightDefaults(
            searchArguments.parse(JSON.parse(call?.function.arguments ?? "{}")),
            ctx.home.city,
            ctx.home.timezone,
          );
          const clarification = missingFlightDetails(args, text, ctx.home.city, ctx.home.timezone);
          if (clarification) return finish(plain(clarification));
          if (!explicitlyRequestsSearch(text, [ctx.assistant.name, ...ctx.assistant.aliases])) {
            await this.repo.event("web_search_confirmation_requested", { endpoint: endpointId });
            signal.throwIfAborted();
            return finish(plain(this.searchConsent.offer(endpointId, { args, text }, ctx, cfg)));
          }
          return finish(await this.runSearch(endpointId, { args, text }, ctx, signal));
        } catch (error) {
          signal.throwIfAborted();
          return finish(
            plain(
              error instanceof DomainError
                ? error.message
                : "Não consegui preparar a busca. Nenhuma nova tentativa foi feita.",
            ),
          );
        }
      }
      if (choice.message.tool_calls?.length && !round) {
        // One preflighted plan prevents partial execution of invalid compound requests.
        const calls = choice.message.tool_calls;
        if (calls.length !== 1 || calls[0].function.name !== "control_home")
          return finish(
            plain("Não consegui montar um único plano para o pedido. Nenhum comando foi enviado."),
          );
        try {
          const { steps } = planSchema.parse(JSON.parse(calls[0].function.arguments));
          validateTemperatureValues(text, steps);
          validatePlanTiming(text, steps);
          return finish(
            plain(
              await this.automations.executePlan(endpointId, steps, signal, undefined, residentId),
            ),
          );
        } catch (error) {
          signal.throwIfAborted();
          return finish(
            plain(
              error instanceof DomainError
                ? error.message
                : "Plano inválido; nenhum comando adicional foi enviado.",
            ),
          );
        }
      }
      if (choice.finish_reason === "length") throw new Error("Truncated provider response");
      try {
        const raw: unknown = JSON.parse(choice.message.content ?? "{}");
        const serious = z.object({ serious: z.boolean().default(false) }).parse(raw).serious;
        const selected = parseIntentReply(raw, intents, ctx, repairIntent ?? forced, {
          text,
          focus,
        });
        result = selected.reply;
        if (serious) result.expression = "neutral";
        const resolved = prepared.find((v) => v.intent.id === selected.intent?.id);
        if (resolved?.error) {
          result = { ...plain(resolved.error), intent: result.intent };
          break;
        }
        if (selected.intent && selected.needsRepair) {
          await this.repo.event("intent_reply_repair", {
            endpoint: endpointId,
            intent: selected.intent.id,
            exhausted: round > 0,
          });
          if (!round) {
            repairIntent = selected.intent;
            messages.push({
              role: "system",
              content: `Corrija a resposta antes de falar. Intent: ${selected.intent.id}. Parâmetros já identificados na fala/contexto: ${JSON.stringify(selected.parameters)}. Responda à pergunta original usando esses valores. Não peça confirmação do nome já conhecido, não mude de intent e não use outra opção. Não execute ferramentas.`,
            });
            continue;
          }
        }
        if (selected.intent) {
          if (
            selected.intent.responseMode === "template" &&
            !selected.needsClarification &&
            (!serious || selected.intent.serious)
          )
            result = templateReply(selected.intent, resolved?.variables ?? {}, selected.parameters);
          if (serious || selected.intent.serious) result.expression = "neutral";
          signal.throwIfAborted();
          await this.repo.event("intent_selected", {
            endpoint: endpointId,
            intent: selected.intent.id,
            matchMode: selected.intent.matchMode,
            parameterNames: Object.keys(selected.parameters ?? {}),
            clarification: selected.needsClarification,
          });
        }
      } catch (error) {
        if (error instanceof DomainError) result = plain(error.message);
        else throw error;
      }
      break;
    }
    return finish(result);
  }
  private runSearch(
    endpointId: string,
    { args, text }: SearchRequest,
    ctx: TurnContext,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    return this.automations.addons.webSearch.search(
      searchQuery(args),
      {
        endpointId,
        homeId: ctx.home.id,
        fresh: wantsFreshSearch(text),
        city: ctx.home.city,
        timezone: ctx.home.timezone,
        period: args.flight ? undefined : eventPeriod(text, ctx.home.timezone),
        ...(args.flight ? { flight: args.flight } : {}),
        presentation: {
          ...searchPresentation(text, args.query),
          ...(args.flight ? { flight: true } : {}),
        },
      },
      signal,
    );
  }
}
