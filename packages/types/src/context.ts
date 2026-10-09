import type { Catalog, EntityMap, Scope } from "./index";

export class DomainError extends Error {}
export function context(catalog: Catalog, endpointId: string, residentId?: string | null) {
  const endpoint = catalog.endpoints.find((v) => v.id === endpointId && v.enabled);
  if (!endpoint) throw new DomainError("Caixinha indisponível.");
  const home = catalog.homes.find((v) => v.id === endpoint.homeId && v.enabled);
  const room = catalog.rooms.find(
    (v) => v.id === endpoint.roomId && v.homeId === endpoint.homeId && v.enabled,
  );
  const assistant = catalog.assistants.find(
    (v) => v.id === endpoint.assistantId && v.homeId === endpoint.homeId && v.enabled,
  );
  if (!home || !room || !assistant)
    throw new DomainError("Confira a casa, o ambiente e o robô da caixinha.");
  const resident = catalog.residents.find(
    (v) =>
      v.id === (residentId === undefined ? endpoint.residentId : residentId) &&
      v.homeId === home.id &&
      v.enabled,
  );
  const mode = catalog.modes.find((v) => v.id === endpoint.modeId && v.enabled);
  const audio = { ...home.defaults };
  const sources: Record<keyof typeof audio, string> = {
    volume: home.name,
    prefillMs: home.name,
    listenSeconds: home.name,
    drowsySeconds: home.name,
  };
  for (const key of Object.keys(audio) as (keyof typeof audio)[]) {
    if (endpoint[key] !== null) {
      audio[key] = endpoint[key];
      sources[key] = endpoint.name;
    }
  }
  if (mode?.volumeLimit != null && audio.volume > mode.volumeLimit) {
    audio.volume = mode.volumeLimit;
    sources.volume = mode.name;
  }
  return { endpoint, home, room, assistant, resident, mode, audio, sources };
}
export type TurnContext = ReturnType<typeof context>;
export function eligible(scope: Scope, ctx: TurnContext, roomId = ctx.room.id): boolean {
  return (
    (!scope.assistantIds.length || scope.assistantIds.includes(ctx.assistant.id)) &&
    (!scope.roomIds.length || scope.roomIds.includes(roomId)) &&
    (!scope.residentIds.length ||
      Boolean(ctx.resident && scope.residentIds.includes(ctx.resident.id))) &&
    (!scope.modeIds.length || Boolean(ctx.mode && scope.modeIds.includes(ctx.mode.id)))
  );
}
export function moreSpecific(a: Scope, b: Scope): boolean {
  let strict = false;
  for (const key of ["assistantIds", "roomIds", "residentIds", "modeIds"] as const) {
    if (b[key].length && (!a[key].length || !a[key].every((v) => b[key].includes(v)))) return false;
    if (a[key].length && (!b[key].length || a[key].length < b[key].length)) strict = true;
  }
  return strict;
}
export function selectVariant<T extends EntityMap["routines"] | EntityMap["intents"]>(
  items: T[],
  ctx: TurnContext,
  roomId = ctx.room.id,
): T | undefined {
  const choices = items.filter(
    (v) => v.enabled && v.homeId === ctx.home.id && eligible(v.scope, ctx, roomId),
  );
  const best = choices.filter(
    (v) => !choices.some((other) => other !== v && moreSpecific(other.scope, v.scope)),
  );
  if (best.length > 1)
    throw new DomainError("Há mais de uma opção para essa frase. Ajuste as associações no painel.");
  return best[0];
}
export function validateReferences(c: Catalog): void {
  const haEntities = new Set<string>();
  for (const device of c.devices) {
    if (device.connection !== "home-assistant") continue;
    const key = `${device.homeId}:${device.haEntityId}`;
    if (haEntities.has(key)) throw new DomainError("Essa entidade já está cadastrada nesta casa.");
    haEntities.add(key);
  }
  for (const home of c.homes) {
    if (
      c.intents.filter((v) => v.homeId === home.id && v.enabled && v.matchMode === "semantic")
        .length > 20
    )
      throw new DomainError(
        "Use até 20 intents por significado ativas por casa para manter a conversa leve.",
      );
  }
  for (const [collection, items] of Object.entries(c)) {
    if (new Set(items.map((v) => v.id)).size !== items.length)
      throw new DomainError(`Identificador duplicado: ${collection}.`);
  }
  for (const collection of [
    "rooms",
    "assistants",
    "endpoints",
    "devices",
    "residents",
    "modes",
    "routines",
    "intents",
  ] as const) {
    for (const item of c[collection]) {
      if (!c.homes.some((v) => v.id === item.homeId))
        throw new DomainError("Casa inexistente ou ainda em uso.");
      const ref = (kind: keyof Catalog, value: string | null) => {
        if (
          value &&
          !c[kind].some(
            (v) =>
              v.id === value && ("homeId" in v ? v.homeId === item.homeId : v.id === item.homeId),
          )
        )
          throw new DomainError("Referência inexistente, de outra casa ou ainda em uso.");
      };
      if ("roomId" in item) ref("rooms", item.roomId);
      if ("assistantId" in item) {
        ref("assistants", item.assistantId);
        ref("residents", item.residentId);
        ref("modes", item.modeId);
      }
      if ("scope" in item) {
        for (const [key, kind] of [
          ["assistantIds", "assistants"],
          ["roomIds", "rooms"],
          ["residentIds", "residents"],
          ["modeIds", "modes"],
        ] as const)
          for (const value of item.scope[key]) ref(kind, value);
      }
      if ("extendsId" in item && item.extendsId) {
        ref(collection, item.extendsId);
        if (item.extendsId === item.id)
          throw new DomainError("Uma variação não pode herdar de si mesma.");
        const parent = c[collection].find((v) => v.id === item.extendsId);
        if (parent && "extendsId" in parent && parent.extendsId)
          throw new DomainError("Associe a variação diretamente à definição principal.");
        if (
          parent &&
          "scope" in parent &&
          "scope" in item &&
          !moreSpecific(item.scope, parent.scope)
        )
          throw new DomainError(
            "A variação precisa ter associações mais específicas que a definição principal.",
          );
      }
      if ("deviceId" in item) ref("devices", item.deviceId);
      if ("responseRules" in item) {
        for (const rule of item.responseRules) {
          for (const value of rule.residentIds) ref("residents", value);
          for (const value of rule.modeIds) ref("modes", value);
        }
        if (
          item.dataSource === "sensor" &&
          item.responseRules.some((v) => v.minValue !== null || v.maxValue !== null)
        ) {
          const sensor = c.devices.find((v) => v.id === item.deviceId);
          if (
            sensor?.kind !== "sensor" ||
            (sensor.connection === "home-assistant" ? !sensor.haEntityId : !sensor.stateTopic)
          )
            throw new DomainError(
              "Condições por valor precisam de um sensor com uma fonte de leitura configurada.",
            );
        }
      }
      if ("steps" in item) {
        for (const step of item.steps) {
          ref("devices", step.deviceId);
          ref("rooms", step.roomId);
          if (step.deviceId) {
            const device = c.devices.find((v) => v.id === step.deviceId);
            if (!device || device.kind === "sensor" || !Object.hasOwn(device.actions, step.action))
              throw new DomainError("Ação não cadastrada no dispositivo.");
          }
        }
      }
      if ("defaultDevices" in item) {
        for (const [kind, value] of Object.entries(item.defaultDevices)) {
          ref("devices", value);
          const device = c.devices.find((v) => v.id === value);
          if (!device || device.roomId !== item.id || device.kind !== kind)
            throw new DomainError("O dispositivo padrão precisa ser desse ambiente e tipo.");
        }
      }
    }
  }
}
