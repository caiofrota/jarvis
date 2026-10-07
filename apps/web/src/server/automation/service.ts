import { randomUUID } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import type { EntityMap, Settings } from "@rosie/types";
import { context, DomainError } from "@rosie/types/context";
import { Addons } from "../addons/registry";
import { HomeAssistantCatalog } from "../catalog/home-assistant";
import { type Command, planSchema } from "./commands";
import {
  contextScope,
  deviceFingerprint,
  intervalLabel,
  type Plan,
  planSetting,
  routineFingerprint,
  storedPlans,
} from "./plans";
import { resolveDevice, routineSteps } from "./resolver";

export type ComfortState = {
  source?: "command";
  mode: string;
  temperature?: number;
  min?: number;
  max?: number;
  step?: number;
  modes?: string[];
};
export type Confirmation = {
  expires: number;
  scope: string;
  deviceId: string;
  fingerprint: string;
  state: string;
};

export class Automations {
  readonly addons: Addons;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private initialized = false;
  private closed = false;
  private plans = new Map<string, Plan>();
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private repo: Repository) {
    this.addons = new Addons(repo);
    const source = new HomeAssistantCatalog(repo, this.addons.homeAssistant);
    repo.catalogProjection = (catalog) => source.project(catalog);
  }
  get connected() {
    return this.addons.mqtt.connected;
  }
  async configure() {
    await this.addons.configure(await this.repo.settings());
    await this.subscribe();
    await this.enqueue(() => this.load());
  }
  async subscribe() {
    const c = await this.repo.catalog();
    await this.addons.mqtt.subscribe([
      ...new Set(
        c.devices
          .filter((v) => v.enabled && v.connection === "mqtt" && v.stateTopic)
          .map((v) => v.stateTopic),
      ),
    ]);
  }
  value(device: EntityMap["devices"] | undefined, maxAgeSeconds = 900) {
    return device?.connection === "home-assistant"
      ? this.addons.homeAssistant.value(device, maxAgeSeconds)
      : this.addons.mqtt.value(device, maxAgeSeconds);
  }
  currentTemperature(device: EntityMap["devices"] | undefined, maxAgeSeconds = 300) {
    if (device?.connection === "home-assistant")
      return this.addons.homeAssistant.currentTemperature(device, maxAgeSeconds);
    throw new DomainError("A temperatura atual desse aparelho não está disponível.");
  }
  comfortState(device: EntityMap["devices"]): ComfortState {
    if (device.connection === "home-assistant")
      return this.addons.homeAssistant.comfortState(device);
    if (device.kind !== "fan")
      throw new DomainError("Esse aparelho não oferece uma leitura de conforto compatível.");
    const state = this.value(device, 120).trim().toLowerCase();
    if (!["on", "off"].includes(state))
      throw new DomainError("Não consegui identificar se o ventilador está ligado ou desligado.");
    return { mode: state };
  }
  private checkConfirmation(
    expected: Confirmation,
    device: EntityMap["devices"],
    cfg: Settings,
    scope: string,
  ) {
    if (
      Date.now() > expected.expires ||
      expected.scope !== scope ||
      expected.deviceId !== device.id ||
      expected.fingerprint !== deviceFingerprint(device, cfg) ||
      expected.state !== JSON.stringify(this.comfortState(device))
    )
      throw new DomainError(
        "O estado ou o cadastro do aparelho mudou. Não executei a sugestão; me diga novamente se está com frio ou calor.",
      );
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (this.closed || this.pending >= 8)
      return Promise.reject(new DomainError("Há muitos comandos pendentes. Aguarde um instante."));
    this.pending++;
    const result = this.chain
      .then(() => {
        if (this.closed) throw new DomainError("A automação foi interrompida.");
        return run();
      })
      .finally(() => {
        this.pending--;
      });
    this.chain = result.catch(() => {});
    return result;
  }
  private async save() {
    const data = json([...this.plans.values()]);
    await this.repo.db.setting.upsert({
      where: { id: planSetting },
      create: { id: planSetting, data },
      update: { data },
    });
  }
  private async load() {
    if (this.initialized) return;
    const row = await this.repo.db.setting.findUnique({ where: { id: planSetting } });
    const plans = storedPlans.parse(row?.data ?? []);
    for (const plan of plans) {
      if (plan.phase === "dispatching" || plan.dueAt <= Date.now()) {
        await this.repo.event("automation_plan_cancelled", {
          endpoint: plan.endpointId,
          plan: plan.id,
          reason: "restart_uncertain_or_expired",
        });
        continue;
      }
      this.plans.set(plan.id, plan);
      this.arm(plan);
    }
    await this.save();
    this.initialized = true;
  }
  private arm(plan: Plan) {
    clearTimeout(this.timers.get(plan.id));
    if (this.closed) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(plan.id);
        void this.enqueue(async () => {
          if (!this.plans.has(plan.id)) return;
          if (Date.now() > plan.dueAt + 5000) {
            await this.remove(plan, "missed_deadline");
            return;
          }
          await this.run(plan);
        }).catch(() => {
          // A saturated queue must not replay a consequential command later.
          this.chain = this.chain
            .then(async () => {
              if (this.plans.has(plan.id) && !this.closed)
                await this.remove(plan, "execution_failed");
            })
            .catch(() => {});
        });
      },
      Math.max(0, plan.dueAt - Date.now()),
    );
    timer.unref();
    this.timers.set(plan.id, timer);
  }
  private async remove(plan: Plan, reason: string) {
    clearTimeout(this.timers.get(plan.id));
    this.timers.delete(plan.id);
    this.plans.delete(plan.id);
    await this.save();
    await this.repo.event(
      reason === "completed" ? "automation_plan_completed" : "automation_plan_cancelled",
      {
        endpoint: plan.endpointId,
        plan: plan.id,
        reason,
      },
    );
  }
  execute(
    endpointId: string,
    target: string,
    action = "on",
    room?: string | null,
    routine = false,
    signal?: AbortSignal,
    residentId?: string | null,
  ) {
    return this.executePlan(
      endpointId,
      [{ target, action, room: room ?? null, routine, delaySeconds: 0 }],
      signal,
      undefined,
      residentId,
    );
  }
  executePlan(
    endpointId: string,
    input: Command[],
    signal?: AbortSignal,
    confirmation?: Confirmation,
    residentId?: string | null,
  ) {
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      await this.load();
      const { steps: commands } = planSchema.parse({ steps: input });
      if (
        confirmation &&
        (commands.length !== 1 || commands[0].routine || commands[0].delaySeconds)
      )
        throw new DomainError("Essa confirmação permite apenas a ação imediata oferecida.");
      if (commands.reduce((sum, step) => sum + step.delaySeconds, 0) > 3600)
        throw new DomainError("Os intervalos do pedido devem somar até uma hora.");
      const c = await this.repo.catalog(),
        ctx = context(c, endpointId, residentId),
        cfg = await this.repo.settings();
      const steps = commands.flatMap((command) => {
        if (
          command.action === "set_temperature"
            ? command.routine || typeof command.temperature !== "number"
            : command.temperature != null
        )
          throw new DomainError(
            "Informe uma temperatura numérica apenas na ação de ajustar temperatura. Nenhum comando foi enviado.",
          );
        const routine = command.routine ? routineSteps(c, ctx, command.target, command.room) : null;
        const resolved = routine
          ? routine.steps
          : [
              {
                device: resolveDevice(c, ctx, command.target, command.room),
                action: command.action,
              },
            ];
        return resolved.map((step, i) => {
          if (confirmation)
            this.checkConfirmation(confirmation, step.device, cfg, contextScope(ctx));
          if (step.device.kind === "sensor" || !Object.hasOwn(step.device.actions, step.action))
            throw new DomainError("Ação não cadastrada. Nenhum comando foi enviado.");
          if (step.device.connection === "mqtt" && !this.connected)
            throw new DomainError("O MQTT está desconectado. Nenhum comando foi enviado.");
          if (
            step.device.connection === "home-assistant" &&
            !this.addons.homeAssistant.status().ready
          )
            throw new DomainError(
              "O Home Assistant está desconectado. Nenhum comando foi enviado.",
            );
          if (step.action === "set_temperature") {
            if (typeof command.temperature !== "number" || routine)
              throw new DomainError("Esse ajuste precisa de uma temperatura explícita.");
            this.addons.homeAssistant.validateTemperature(step.device, command.temperature);
          }
          return {
            deviceId: step.device.id,
            name: step.device.name,
            action: step.action,
            fingerprint: deviceFingerprint(step.device, cfg),
            routineId: routine?.definition.id ?? null,
            routineFingerprint: routine ? routineFingerprint(routine.definition) : "",
            delaySeconds: i ? 0 : command.delaySeconds,
            ...(command.temperature != null ? { temperature: command.temperature } : {}),
          };
        });
      });
      if (steps.length > 32 || this.plans.size >= 32)
        throw new DomainError("Há etapas ou temporizadores demais. Nenhum comando foi enviado.");
      signal?.throwIfAborted();
      // A new explicit command supersedes old delayed actions on the same devices.
      for (const old of [...this.plans.values()])
        if (
          old.steps
            .slice(old.cursor)
            .some((step) => steps.some((next) => next.deviceId === step.deviceId))
        )
          await this.remove(old, "superseded");
      const plan: Plan = {
        id: randomUUID(),
        endpointId,
        scope: contextScope(ctx),
        ...(residentId !== undefined
          ? { residentId, endpointScope: contextScope(context(c, endpointId)) }
          : {}),
        steps,
        cursor: 0,
        dueAt: Date.now() + steps[0].delaySeconds * 1000,
        phase: "ready",
      };
      this.plans.set(plan.id, plan);
      await this.save();
      if (signal?.aborted || this.closed) {
        await this.remove(plan, "cancelled_before_admission");
        signal?.throwIfAborted();
        throw new DomainError("A automação foi interrompida.");
      }
      if (plan.steps[0].delaySeconds) {
        this.arm(plan);
        await this.repo.event("automation_plan_scheduled", {
          endpoint: endpointId,
          plan: plan.id,
          dueAt: plan.dueAt,
          steps: steps.length,
        });
      } else await this.run(plan, signal, confirmation);
      if (signal?.aborted) {
        if (this.plans.has(plan.id)) await this.remove(plan, "cancelled_before_admission");
        signal.throwIfAborted();
      }
      if (this.plans.has(plan.id)) {
        const next = plan.steps[plan.cursor];
        return `${plan.cursor ? "Enviei os comandos iniciais. " : ""}${next.action === "off" ? "Vou desligar" : next.action === "on" ? "Vou ligar" : next.action === "set_temperature" ? "Vou ajustar" : "Vou acionar"} ${next.name}${next.temperature != null ? ` para ${String(next.temperature).replace(".", ",")} graus` : ""} após ${intervalLabel(next.delaySeconds)}${plan.cursor + 1 < steps.length ? " e continuar as próximas etapas" : ""}.`;
      }
      return steps.length === 1
        ? steps[0].temperature != null
          ? `Enviei o ajuste de ${steps[0].name} para ${String(steps[0].temperature).replace(".", ",")} graus.`
          : `Comando enviado para ${steps[0].name}.`
        : `Comandos enviados para ${[...new Set(steps.map((step) => step.name))].join(", ")}.`;
    });
  }
  private async run(plan: Plan, signal?: AbortSignal, confirmation?: Confirmation) {
    try {
      while (plan.cursor < plan.steps.length) {
        signal?.throwIfAborted();
        if (this.closed) throw new DomainError("A automação foi interrompida.");
        const step = plan.steps[plan.cursor],
          c = await this.repo.catalog(),
          ctx = context(c, plan.endpointId, plan.residentId),
          cfg = await this.repo.settings(),
          device = c.devices.find((v) => v.id === step.deviceId && v.enabled);
        if (
          contextScope(ctx) !== plan.scope ||
          (plan.endpointScope !== undefined &&
            contextScope(context(c, plan.endpointId)) !== plan.endpointScope) ||
          !device ||
          device.homeId !== ctx.home.id ||
          !c.rooms.some(
            (room) => room.id === device.roomId && room.homeId === ctx.home.id && room.enabled,
          ) ||
          (step.routineId &&
            !c.routines.some(
              (routine) =>
                routine.id === step.routineId &&
                routine.enabled &&
                routineFingerprint(routine) === step.routineFingerprint,
            )) ||
          deviceFingerprint(device, cfg) !== step.fingerprint
        )
          throw new DomainError("O cadastro mudou; cancelei as próximas etapas.");
        if (step.action === "set_temperature") {
          if (typeof step.temperature !== "number")
            throw new DomainError("O ajuste de temperatura está incompleto.");
          this.addons.homeAssistant.validateTemperature(device, step.temperature);
        } else if (step.temperature != null)
          throw new DomainError("A ação não permite temperatura.");
        plan.phase = "dispatching";
        await this.save(); // Recovery must never resend an action with an uncertain outcome.
        signal?.throwIfAborted();
        if (this.closed) throw new DomainError("A automação foi interrompida.");
        if (confirmation) this.checkConfirmation(confirmation, device, cfg, contextScope(ctx));
        try {
          if (device.connection === "home-assistant") {
            if (step.temperature != null)
              await this.addons.homeAssistant.execute(device, step.action, step.temperature);
            else await this.addons.homeAssistant.execute(device, step.action);
          } else {
            if (!this.connected) throw new Error("MQTT disconnected");
            await this.addons.mqtt.publish(device.commandTopic, device.actions[step.action]);
          }
        } catch {
          await this.repo.event("automation_uncertain", {
            endpoint: plan.endpointId,
            device: device.id,
            connection: device.connection,
          });
          throw new DomainError(
            "Não consegui confirmar a entrega do comando. A ação pode ter ocorrido; cancelei as próximas etapas e não vou repeti-la automaticamente.",
          );
        }
        await this.repo.event(device.connection === "mqtt" ? "mqtt_sent" : "home_assistant_sent", {
          endpoint: plan.endpointId,
          device: device.id,
          action: step.action,
          ...(step.temperature != null ? { temperature: step.temperature } : {}),
          plan: plan.id,
        });
        plan.cursor++;
        if (plan.cursor === plan.steps.length) {
          await this.remove(plan, "completed");
          return;
        }
        plan.phase = "ready";
        plan.dueAt = Date.now() + plan.steps[plan.cursor].delaySeconds * 1000;
        await this.save();
        if (plan.steps[plan.cursor].delaySeconds) {
          signal?.throwIfAborted();
          this.arm(plan);
          await this.repo.event("automation_plan_scheduled", {
            endpoint: plan.endpointId,
            plan: plan.id,
            dueAt: plan.dueAt,
            remaining: plan.steps.length - plan.cursor,
          });
          return;
        }
      }
    } catch (error) {
      await this.remove(plan, "execution_failed");
      throw error;
    }
  }
  cancelPending(endpointId: string, residentId?: string | null) {
    return this.enqueue(async () => {
      await this.load();
      const ctx = context(await this.repo.catalog(), endpointId, residentId);
      let count = 0;
      for (const plan of [...this.plans.values()])
        if (plan.endpointId === endpointId && plan.scope === contextScope(ctx)) {
          await this.remove(plan, "user_cancelled");
          count++;
        }
      return count
        ? "Cancelei os temporizadores desta caixinha."
        : "Esta caixinha não tem temporizadores pendentes.";
    });
  }
  close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.addons.close();
  }
  async settled() {
    await this.chain;
  }
}
