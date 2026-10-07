import type { Collection } from "@rosie/types";
export const labels: Record<Collection, string> = {
  homes: "Casas",
  rooms: "Ambientes",
  assistants: "Assistentes compartilhados",
  endpoints: "Caixinhas",
  devices: "Dispositivos",
  residents: "Moradores",
  modes: "Modos",
  routines: "Rotinas",
  intents: "Intents e humor",
};
export const descriptions: Record<Collection, string> = {
  homes: "Localização e informações compartilhadas.",
  rooms: "Organize os ambientes e seus dispositivos padrão.",
  assistants:
    "Perfis de nome, voz e personalidade disponíveis para a conversa e para as caixinhas. Suas contas conectadas continuam privadas.",
  endpoints: "Escolha quem responde em cada lugar da casa.",
  devices: "Luzes, sensores e aparelhos conectados.",
  residents: "Preferências pessoais, separadas das conversas.",
  modes: "Comportamentos para diferentes momentos do dia.",
  routines: "Ações compartilhadas com associações e variações.",
  intents: "Frases, respostas e expressões com a sua cara.",
};
export const expressionLabels: Record<string, string> = {
  neutral: "Neutra",
  happy: "Feliz",
  sad: "Triste",
  angry: "Brava",
  surprised: "Surpresa",
  curious: "Curiosa",
  confused: "Confusa",
  excited: "Animada",
  shy: "Tímida",
  skeptical: "Desconfiada",
  proud: "Orgulhosa",
  affectionate: "Carinhosa",
};
export const kindLabels: Record<string, string> = {
  light: "Luz",
  switch: "Tomada / interruptor",
  fan: "Ventilador",
  climate: "Climatização",
  sensor: "Sensor",
  other: "Outro",
};
export const stateLabels: Record<string, string> = {
  idle: "Dormindo",
  listening: "Ouvindo",
  drowsy: "Sonolenta",
  checking: "Ouvindo",
  thinking: "Pensando",
  speaking: "Falando",
  muted: "Microfone pausado",
  error: "Erro",
  offline: "Desconectada",
};

export const intentMatchLabels: Record<string, string> = {
  exact: "Frase exata",
  semantic: "Por significado",
};
export const intentResponseLabels: Record<string, string> = {
  template: "Resposta pronta",
  generated: "Resposta gerada",
};
export const intentHumorLabels: Record<string, string> = {
  natural: "Normal",
  occasional: "Ocasional",
  playful: "Brincalhão",
};
