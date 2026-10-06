import type { Task } from '../../shared/types';
import { validatePrefs } from './preferences';
import { sharedPreferencesKey } from './window-layout';

/** Task operations must reread persisted shared state, not a render snapshot. */
export function readWorkspaceTasks(storage: Pick<Storage, 'getItem'> = localStorage): Task[] {
  const raw = storage.getItem(sharedPreferencesKey);
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.tasks)) throw new Error('Não consegui consultar sua lista de tarefas.');
  return validatePrefs(value).tasks;
}
