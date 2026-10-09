import type { Collection } from "@rosie/types";
export type Column = { key: string; label: string };
const name = { key: "name", label: "Nome" },
  home = { key: "homeName", label: "Casa" },
  room = { key: "roomName", label: "Ambiente" },
  enabled = { key: "enabled", label: "Situação" };
export const columns: Record<Collection, Column[]> = {
  homes: [name, { key: "city", label: "Cidade" }, enabled],
  rooms: [name, home, enabled],
  assistants: [name, { key: "voice", label: "Voz" }, home, enabled],
  endpoints: [
    name,
    { key: "assistantName", label: "Robô" },
    room,
    { key: "volume", label: "Volume" },
    enabled,
  ],
  devices: [
    name,
    { key: "kind", label: "Tipo" },
    { key: "connection", label: "Conexão" },
    room,
    enabled,
  ],
  residents: [
    name,
    home,
    { key: "voiceStatus", label: "Reconhecimento de voz" },
    { key: "calendarStatus", label: "Agenda" },
    enabled,
  ],
  modes: [name, home, enabled],
  routines: [name, { key: "scopeLabel", label: "Associações" }, enabled],
  intents: [
    name,
    { key: "matchMode", label: "Reconhecimento" },
    { key: "responseMode", label: "Resposta" },
    { key: "phrases", label: "Frases" },
    { key: "expression", label: "Expressão" },
    { key: "scopeLabel", label: "Associações" },
    enabled,
  ],
};
