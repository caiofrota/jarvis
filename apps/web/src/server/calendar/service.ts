import { createHash, randomUUID } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import {
  type CalendarDraft,
  calendarBindingSchema,
  type ResidentCalendarStatus,
} from "@rosie/types";
import { DomainError, type TurnContext } from "@rosie/types/context";
import { z } from "zod";
import type { CalendarAddon } from "../addons/calendar";

const savedSchema = z.object({
  homeId: z.string(),
  revision: z.string(),
  binding: calendarBindingSchema,
});
const key = (id: string) => `calendar:${id}`;
export function registeredCalendar(data: unknown, homeId: string) {
  const value = savedSchema.safeParse(data);
  if (!value.success || value.data.homeId !== homeId) return "Não vinculada";
  if (!value.data.binding.enabled) return "Desativada";
  return value.data.binding.allowCreate ? "Consulta e criação" : "Somente consulta";
}
export class ResidentCalendars {
  constructor(
    private repo: Repository,
    private resolveProvider: () => CalendarAddon,
  ) {}
  private get provider() {
    return this.resolveProvider();
  }
  private async resident(id: string) {
    const row = (await this.repo.catalog()).residents.find((v) => v.id === id && v.enabled);
    if (!row) throw new DomainError("Salve e ative este morador antes de configurar a agenda.");
    return row;
  }
  private async saved(id: string) {
    const resident = await this.resident(id);
    const stored = savedSchema.safeParse(
      (await this.repo.db.setting.findUnique({ where: { id: key(id) } }))?.data,
    );
    return {
      resident,
      saved: stored.success && stored.data.homeId === resident.homeId ? stored.data : null,
    };
  }
  async status(id: string): Promise<ResidentCalendarStatus> {
    const { resident, saved } = await this.saved(id),
      cfg = await this.repo.settings();
    const linked = cfg.homeAssistantEnabled && cfg.homeAssistantHomeId === resident.homeId;
    let options: ResidentCalendarStatus["options"] = [],
      message = "Conecte o Home Assistant à casa deste morador em Voz e conexões.";
    let connected = linked && this.provider.available();
    if (linked) {
      try {
        options = await this.provider.discover(resident.homeId);
        message = options.length
          ? "Escolha a agenda que pertence a este morador."
          : "Nenhuma agenda Google encontrada. Adicione Google Calendar no Home Assistant e autorize a conta.";
      } catch {
        connected = false;
        message = "Não consegui consultar as agendas. Confira a conexão do Home Assistant.";
      }
    }
    const base = linked && cfg.homeAssistantUrl ? new URL(cfg.homeAssistantUrl) : null;
    return {
      binding: saved?.binding ?? null,
      revision: saved?.revision ?? null,
      connected,
      options,
      setupUrl: base ? new URL("/config/integrations", base).href : null,
      message,
    };
  }
  async save(id: string, input: unknown, revision: string | null) {
    const binding = calendarBindingSchema.parse(input),
      { resident, saved } = await this.saved(id);
    if ((saved?.revision ?? null) !== revision)
      throw new DomainError("A agenda foi alterada. Recarregue antes de salvar.");
    if (binding.enabled || saved?.binding.entityId !== binding.entityId) {
      const option = (await this.provider.discover(resident.homeId)).find(
        (v) => v.id === binding.entityId,
      );
      if (!option?.available)
        throw new DomainError("Escolha uma agenda Google disponível para este morador.");
      if (binding.allowCreate && !option.canCreate)
        throw new DomainError("Essa agenda permite apenas consulta.");
    }
    const data = json({ homeId: resident.homeId, revision: randomUUID(), binding });
    // Compare-and-swap includes absence; concurrent editors cannot silently overwrite.
    await this.repo.db.$transaction(async (tx) => {
      const current = savedSchema.safeParse(
        (await tx.setting.findUnique({ where: { id: key(id) } }))?.data,
      );
      const active =
        current.success && current.data.homeId === resident.homeId ? current.data.revision : null;
      const row = await tx.entry.findUnique({
        where: { collection_id: { collection: "residents", id } },
      });
      const currentResident = row?.data as Record<string, unknown> | undefined;
      if (
        active !== revision ||
        currentResident?.homeId !== resident.homeId ||
        !currentResident.enabled
      )
        throw new DomainError("O cadastro mudou. Recarregue antes de salvar a agenda.");
      await tx.setting.upsert({
        where: { id: key(id) },
        create: { id: key(id), data },
        update: { data },
      });
    });
    await this.repo.event("resident_calendar_saved", {
      resident: id,
      enabled: binding.enabled,
      allowCreate: binding.allowCreate,
    });
    return this.status(id);
  }
  async remove(id: string, revision: string | null) {
    await this.resident(id);
    await this.repo.db.$transaction(async (tx) => {
      const raw = savedSchema.safeParse(
        (await tx.setting.findUnique({ where: { id: key(id) } }))?.data,
      );
      if (!raw.success || raw.data.revision !== revision)
        throw new DomainError("A agenda foi alterada. Recarregue a página.");
      await tx.setting.delete({ where: { id: key(id) } });
    });
    await this.repo.event("resident_calendar_removed", { resident: id });
    return this.status(id);
  }
  async access(ctx: TurnContext) {
    if (!ctx.resident)
      throw new DomainError(
        "Preciso identificar quem está falando para acessar a agenda pessoal. Tente dizer mais uma frase.",
      );
    const { resident, saved } = await this.saved(ctx.resident.id),
      cfg = await this.repo.settings();
    if (resident.homeId !== ctx.home.id || !saved?.binding.enabled)
      throw new DomainError(
        `A agenda de ${ctx.resident.name} ainda não está habilitada no painel.`,
      );
    if (
      !cfg.homeAssistantEnabled ||
      cfg.homeAssistantHomeId !== ctx.home.id ||
      !this.provider.available()
    )
      throw new DomainError("A conexão da agenda com o Home Assistant está indisponível.");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          ctx.home.id,
          ctx.home.timezone,
          resident,
          saved,
          cfg.homeAssistantUrl,
          cfg.homeAssistantToken,
        ]),
      )
      .digest("hex");
    return { ...saved, fingerprint };
  }
  async list(ctx: TurnContext, start: string, end: string, signal: AbortSignal) {
    const length = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(length) || length <= 0 || length > 32 * 86400000)
      throw new DomainError("Consulte até 31 dias por vez.");
    const access = await this.access(ctx);
    signal.throwIfAborted();
    const events = await this.provider.list(
      ctx.home.id,
      access.binding.entityId,
      start,
      end,
      signal,
    );
    signal.throwIfAborted();
    if ((await this.access(ctx)).fingerprint !== access.fingerprint)
      throw new DomainError("A configuração da agenda mudou. Consulte novamente.");
    await this.repo.event("calendar_read", {
      resident: ctx.resident?.id,
      endpoint: ctx.endpoint.id,
    });
    return events;
  }
  async create(ctx: TurnContext, draft: CalendarDraft, fingerprint: string, signal: AbortSignal) {
    const access = await this.access(ctx);
    if (access.fingerprint !== fingerprint || !access.binding.allowCreate)
      throw new DomainError("A permissão ou a agenda mudou. Faça o pedido novamente.");
    signal.throwIfAborted();
    await this.repo.event("calendar_creation_requested", {
      resident: ctx.resident?.id,
      endpoint: ctx.endpoint.id,
    });
    await this.provider.create(ctx.home.id, access.binding.entityId, draft, signal, async () => {
      if ((await this.access(ctx)).fingerprint !== fingerprint)
        throw new DomainError("A agenda mudou antes do envio. Faça o pedido novamente.");
    });
    await this.repo.event("calendar_created", {
      resident: ctx.resident?.id,
      endpoint: ctx.endpoint.id,
    });
  }
}
