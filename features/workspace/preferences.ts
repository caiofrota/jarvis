import type { Preferences, PanelId } from '../../shared/types';
export const panelNames: Record<PanelId, string> = {
  assistant: 'Assistente',
  calendar: 'Agenda',
  tasks: 'Minhas tarefas',
  notes: 'Bloco de ideias',
  system: 'Meu ambiente',
  computer: 'Meu computador',
};
export const panelIds = Object.keys(panelNames) as PanelId[];
export const profiles = { eco: 'Econômico · 8 GB', balanced: 'Equilibrado · 12 GB', full: 'Completo' };
export const defaults: Preferences = {
  order: panelIds,
  hidden: [],
  wide: [],
  profile: 'balanced',
  color: 'mint',
  motion: true,
  notes: '',
  tasks: [],
};
export function validatePrefs(input: unknown): Preferences {
  const raw = input as Partial<Preferences> | null;
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    ...defaults,
    order: [
      ...new Set([
        ...(Array.isArray(raw.order) ? raw.order.filter((id) => panelIds.includes(id)) : []),
        ...panelIds,
      ]),
    ],
    hidden: Array.isArray(raw.hidden)
      ? raw.hidden.filter((id) => panelIds.includes(id) && id !== 'assistant')
      : [],
    wide: Array.isArray(raw.wide) ? raw.wide.filter((id) => panelIds.includes(id)) : [],
    profile: raw.profile && Object.hasOwn(profiles, raw.profile) ? raw.profile : 'balanced',
    color: raw.color && ['mint', 'blue', 'violet'].includes(raw.color) ? raw.color : 'mint',
    motion: raw.motion !== false,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 30000) : '',
    tasks: Array.isArray(raw.tasks)
      ? raw.tasks
          .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string')
          .slice(0, 100)
          .map((t) => ({ id: t.id, text: t.text.slice(0, 180), done: !!t.done }))
      : [],
  };
}
