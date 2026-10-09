import { describe, expect, it } from "vitest";
import { isStopPhrase } from "../src/server/conversation/attention";

describe("local conversation cancellation", () => {
  it.each([
    "Pode parar.",
    "Cancele a conversa!",
    "Rosie, volte a dormir, por favor.",
    "Por favor, Jarvis, pode cancelar a conversa.",
    "Chega por hoje, obrigada, Rosie.",
    "Não quero mais conversar, Rosie, muito obrigado.",
    "Rosie, não quero conversar.",
    "Vamos encerrar a conversa.",
    "Vamos parar!",
    "Pode descansar, Rosie.",
    "Fim da conversa.",
    "Tchau, Rosie!",
    "Por favor, pare de ouvir.",
  ])("recognizes an explicit stop: %s", (text) => {
    expect(isStopPhrase(text, ["Rosie", "Jarvis"])).toBe(true);
  });

  it.each([
    "Não pare.",
    "Não pode parar.",
    "Não vá dormir.",
    "Cancelar alarme.",
    "Pare a música da cozinha.",
    "Quero saber como cancelar a conversa.",
    "O que significa pode parar?",
    "Fale sobre dormir.",
    "Obrigada, Rosie.",
    "",
  ])("keeps other requests and negations out of cancellation: %s", (text) => {
    expect(isStopPhrase(text, ["Rosie", "Jarvis"])).toBe(false);
  });
});
