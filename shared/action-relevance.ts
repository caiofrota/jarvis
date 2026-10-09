import type { ActionRecord, Target } from './types';
export function relevantApplications(
  targets: Target[],
  history: ActionRecord[],
  favorites: string[] = [],
  limit = 6,
) {
  const usage = new Map<string, { count: number; last: number }>();
  for (const record of history) {
    if (record.status !== 'sent' || !record.targetId) continue;
    const previous = usage.get(record.targetId) ?? { count: 0, last: 0 };
    usage.set(record.targetId, {
      count: previous.count + 1,
      last: Math.max(previous.last, Date.parse(record.at) || 0),
    });
  }
  return [
    ...new Map(
      targets
        .filter((target) => target.kind === 'app' && target.available)
        .map((target) => [target.id, target]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) ||
        (usage.get(b.id)?.count ?? 0) - (usage.get(a.id)?.count ?? 0) ||
        (usage.get(b.id)?.last ?? 0) - (usage.get(a.id)?.last ?? 0) ||
        a.label.localeCompare(b.label, 'pt-BR') ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
