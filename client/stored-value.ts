import type { Update } from '../shared/types';
export function commitStoredValue<T>(
  key: string,
  update: Update<T>,
  fallback: T,
  validate: (x: unknown) => T,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): T {
  // Read the latest persisted value, including edits from another Jarvis window.
  const raw = storage.getItem(key);
  const current = raw === null ? fallback : validate(JSON.parse(raw));
  const next = validate(typeof update === 'function' ? (update as (current: T) => T)(current) : update);
  const serialized = JSON.stringify(next);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error('A gravação não foi confirmada.');
  return next;
}
