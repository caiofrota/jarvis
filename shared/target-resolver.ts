import type { Target } from './types';
export type TargetResolution =
  { type: 'action'; id: string; label: string } | { type: 'reply'; text: string };
function normalize(name: string, compound = true): string {
  const separated = compound
    ? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    : name;
  return separated
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(lnk|exe|desktop)$/i, '')
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function resolveTarget(identifiedName: string, targets: Target[]): TargetResolution {
  const name = normalize(identifiedName);
  if (!name) return { type: 'reply', text: 'Qual aplicativo você quer abrir?' };
  const available = targets.filter((target) => target.available);
  const exact = available.filter(
    (target) =>
      normalize(target.label) === name ||
      normalize(target.label).replace(/ /g, '') === name.replace(/ /g, ''),
  );
  const words = name.split(' ');
  const matches = exact.length
    ? exact
    : available.filter((target) =>
        words.every((word) =>
          normalize(target.label, words.length > 1)
            .split(' ')
            .includes(word),
        ),
      );
  if (matches.length === 1) return { type: 'action', id: matches[0].id, label: matches[0].label };
  if (matches.length > 1)
    return {
      type: 'reply',
      text:
        'Encontrei ' +
        matches
          .slice(0, 4)
          .map((target) => target.label)
          .join(' e ') +
        '. Qual deles você quer abrir?',
    };
  return {
    type: 'reply',
    text:
      'Não encontrei “' +
      identifiedName +
      '” entre os aplicativos e pastas disponíveis. Qual é o nome que aparece no seu computador?',
  };
}
