import type { Save, Update } from '../shared/types';
import { useEffect, useRef, useState } from 'react';
import { commitStoredValue } from './stored-value';
export function readStored<T>(key: string, fallback: T, validate: (x: unknown) => T = (x) => x as T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? validate(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}
export function useStored<T>(
  key: string,
  initial: T,
  validate: (x: unknown) => T = (x) => x as T,
): [T, Save<T>, boolean, string] {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const current = useRef(initial);
  useEffect(() => {
    current.current = readStored(key, initial, validate);
    setValue(current.current);
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === key) {
        current.current = readStored(key, initial, validate);
        setValue(current.current);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  function update(updateValue: Update<T>) {
    try {
      const saved = commitStoredValue(key, updateValue, current.current, validate);
      current.current = saved;
      setValue(saved);
      setError('');
      return saved;
    } catch (causeCause) {
      const cause = causeCause instanceof Error ? causeCause : new Error(String(causeCause));
      setError(cause.message || 'Não foi possível salvar neste navegador.');
      return null;
    }
  }
  return [value, update, ready, error];
}
