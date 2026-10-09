import { normalize } from "@rosie/types";

const phrases = new Set([
  "ate logo",
  "ate mais",
  "cancela",
  "cancela a conversa",
  "cancela conversa",
  "cancelar",
  "cancelar a conversa",
  "cancelar conversa",
  "cancele",
  "cancele a conversa",
  "cancele conversa",
  "chega",
  "chega por hoje",
  "descansa",
  "descanse",
  "dormir",
  "durma",
  "encerra",
  "encerra a conversa",
  "encerra a escuta",
  "encerra conversa",
  "encerrar",
  "encerrar a conversa",
  "encerrar conversa",
  "encerre",
  "encerre a conversa",
  "encerre a conversacao",
  "encerre a escuta",
  "encerre conversa",
  "encerre o assunto",
  "fim da conversa",
  "ja chega",
  "nao quero conversar",
  "nao quero mais conversar",
  "para",
  "para de escutar",
  "para de falar",
  "para de ouvir",
  "parar",
  "pare",
  "pare de escutar",
  "pare de falar",
  "pare de ouvir",
  "pode cancelar",
  "pode cancelar a conversa",
  "pode descansar",
  "pode dormir",
  "pode encerrar a conversa",
  "pode parar",
  "pode parar de falar",
  "pode parar de ouvir",
  "tchau",
  "va descansar",
  "va dormir",
  "vai descansar",
  "vai dormir",
  "vamos encerrar",
  "vamos encerrar a conversa",
  "vamos parar",
  "volta a dormir",
  "volte a dormir",
]);
export function isStopPhrase(text: string, names: string[]): boolean {
  let value = normalize(text),
    previous = "";
  const edges = [
    "por favor",
    "muito obrigado",
    "muito obrigada",
    "obrigado",
    "obrigada",
    ...names.map(normalize),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  while (previous !== value) {
    previous = value;
    for (const edge of edges) {
      if (value.startsWith(`${edge} `)) value = value.slice(edge.length + 1);
      if (value.endsWith(` ${edge}`)) value = value.slice(0, -edge.length - 1);
    }
    value = value.trim();
  }
  return phrases.has(value);
}
