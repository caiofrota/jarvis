import type { PanelId, Preferences } from '../../shared/types';
import { defaults, panelIds, validatePrefs } from './preferences';
export type WindowLayout = Pick<Preferences, 'order' | 'hidden' | 'wide'>;
export interface WorkspaceIdentity {
  id: string;
  primary: boolean;
  seed: WindowLayout;
}
export const sharedPreferencesKey = 'jarvis-studio-v1';
export const layoutKey = (id: string) => 'jarvis-window-layout-v1:' + id;
export const viewKey = (id: string) => 'jarvis-window-view-v1:' + id;
export interface WindowView {
  focused: boolean;
  assistantTab: 'voice' | 'transcript';
}
export const defaultWindowView: WindowView = { focused: false, assistantTab: 'voice' };
export function validateWindowView(value: unknown): WindowView {
  const raw = value as Partial<WindowView> | null;
  return {
    focused: raw?.focused === true,
    assistantTab: raw?.assistantTab === 'transcript' ? 'transcript' : 'voice',
  };
}
export function validateLayout(input: unknown): WindowLayout {
  const raw = input as Partial<WindowLayout> | null;
  const validIds = (value: unknown): PanelId[] =>
    Array.isArray(value) ? [...new Set(value.filter((id): id is PanelId => panelIds.includes(id)))] : [];
  return {
    order: [...new Set([...validIds(raw?.order), ...panelIds])],
    hidden: validIds(raw?.hidden),
    wide: validIds(raw?.wide),
  };
}
export function workspaceIdentity(namespace = ''): WorkspaceIdentity {
  const url = new URL(location.href);
  const registeredKey = namespace + 'jarvis-primary-window-v1';
  let registered: string | null = null;
  try {
    registered = localStorage.getItem(registeredKey);
  } catch {}
  let id = url.searchParams.get('window');
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    id = registered && /^[a-zA-Z0-9_-]{1,80}$/.test(registered) ? registered : crypto.randomUUID();
    url.searchParams.set('window', id);
    history.replaceState(null, '', url);
  }
  const panel = url.searchParams.get('panel') as PanelId | null;
  const candidate = url.searchParams.get('secondary') !== '1' && !panel;
  if (candidate && !registered) {
    registered = id;
    try {
      localStorage.setItem(registeredKey, id);
    } catch {}
  }
  const primary = candidate && registered === id;
  let legacy = defaults;
  try {
    legacy = validatePrefs(JSON.parse(localStorage.getItem(namespace + sharedPreferencesKey) || 'null'));
  } catch {}
  return {
    id,
    primary,
    seed:
      panel && panelIds.includes(panel)
        ? {
            order: [panel, ...panelIds.filter((value) => value !== panel)],
            hidden: panelIds.filter((value) => value !== panel),
            wide: [],
          }
        : primary
          ? validateLayout(legacy)
          : { ...validateLayout(legacy), hidden: [...new Set([...legacy.hidden, 'assistant' as PanelId])] },
  };
}
export function sharedFields(prefs: Preferences) {
  return {
    tasks: prefs.tasks,
    notes: prefs.notes,
    profile: prefs.profile,
    color: prefs.color,
    motion: prefs.motion,
  };
}
