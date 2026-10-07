import { type Catalog, type EntityMap, kinds, normalize } from "@rosie/types";
import { DomainError, selectVariant, type TurnContext } from "@rosie/types/context";

function spokenName(text: string) {
  return normalize(text).replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}
export function matches(item: { id: string; name: string; aliases?: string[] }, text: string) {
  return [item.id, item.name, ...(item.aliases ?? [])].some(
    (v) => spokenName(v) === spokenName(text),
  );
}
export const kindNames: Record<string, string[]> = {
  light: ["luz", "luzes", "lampada", "lampadas", "iluminacao"],
  switch: ["tomada", "interruptor"],
  fan: ["ventilador"],
  climate: ["ar", "ar condicionado"],
};
export function effectiveRoom(c: Catalog, ctx: TurnContext, name?: string | null) {
  if (!name) return ctx.room;
  const rooms = c.rooms.filter((v) => v.homeId === ctx.home.id && v.enabled && matches(v, name));
  if (rooms.length !== 1)
    throw new DomainError("Não identifiquei um único ambiente com esse nome.");
  return rooms[0];
}
export function resolveDevice(
  c: Catalog,
  ctx: TurnContext,
  target: string,
  roomName?: string | null,
): EntityMap["devices"] {
  const room = effectiveRoom(c, ctx, roomName);
  const candidates = c.devices.filter(
    (v) => v.homeId === ctx.home.id && v.roomId === room.id && v.enabled,
  );
  const kind =
    Object.keys(kindNames).find((k) => kindNames[k].includes(spokenName(target))) ??
    (kinds.includes(target as (typeof kinds)[number]) ? target : null);
  let found = kind
    ? candidates.filter((v) => v.kind === kind)
    : candidates.filter((v) => matches(v, target));
  const preferred = kind
    ? room.defaultDevices[kind as keyof typeof room.defaultDevices]
    : undefined;
  if (preferred) found = found.filter((v) => v.id === preferred);
  if (found.length === 0) throw new DomainError("Não encontrei esse dispositivo nesse ambiente.");
  if (found.length > 1)
    throw new DomainError(`Qual deles: ${found.map((v) => v.name).join(", ")}?`);
  return found[0];
}
export function localCommand(text: string) {
  // Composite/temporal requests need one validated plan, not a greedy single target.
  if (
    /\b(?:no|nos|em|para|pra|a|aos) \d|\b(?:graus|celsius|fahrenheit)\b/.test(normalize(text)) ||
    /\b(e|depois|apos|daqui|durante|segundos?|minutos?|horas?|quando|amanha|hoje)\b/.test(
      normalize(text),
    )
  )
    return null;
  const m = normalize(text).match(
    /^(?:por favor )?(liga|ligar|ligue|acende|acender|acenda|desliga|desligar|desligue|apaga|apagar|apague) (?:a |o |as |os )?(.+?)(?: por favor)?$/,
  );
  if (!m) return null;
  const loc = m[2].match(/^(.+?) (?:da|do|na|no|em) (.+)$/);
  return {
    target: loc?.[1] ?? m[2],
    room: loc?.[2] ?? null,
    action: /^(deslig|apag)/.test(m[1]) ? "off" : "on",
    routine: false,
  };
}
export function routineSteps(
  c: Catalog,
  ctx: TurnContext,
  target: string,
  roomName?: string | null,
) {
  const room = effectiveRoom(c, ctx, roomName);
  const candidates = c.routines.filter(
    (v) =>
      matches(v, target) ||
      Boolean(v.extendsId && c.routines.some((p) => p.id === v.extendsId && matches(p, target))),
  );
  const routine = selectVariant(candidates, ctx, room.id);
  if (!routine) throw new DomainError("Essa rotina não está disponível neste contexto.");
  const steps = routine.steps.map((step) => {
    const device = step.deviceId
      ? c.devices.find((v) => v.id === step.deviceId && v.homeId === ctx.home.id && v.enabled)
      : resolveDevice(c, ctx, step.kind ?? "", step.roomId ?? room.id);
    if (!device || device.kind === "sensor" || !Object.hasOwn(device.actions, step.action))
      throw new DomainError("Uma etapa da rotina está indisponível.");
    if (!routine.crossRoom && device.roomId !== room.id)
      throw new DomainError("Essa rotina está limitada ao ambiente escolhido.");
    return { device, action: step.action };
  });
  return { name: routine.name, definition: routine, steps };
}
