import { useState } from 'react';
import { readStored, useStored } from '../../client/storage';
import type { Preferences, Save } from '../../shared/types';
import { defaults, validatePrefs } from './preferences';
import {
  layoutKey,
  sharedFields,
  sharedPreferencesKey,
  validateLayout,
  type WorkspaceIdentity,
} from './window-layout';

export function useWorkspacePreferences(
  identity: WorkspaceIdentity,
): [Preferences, Save<Preferences>, boolean, string] {
  const [shared, saveShared, sharedReady, sharedError] = useStored(
    sharedPreferencesKey,
    defaults,
    validatePrefs,
  );
  const [layout, saveLayout, layoutReady, layoutError] = useStored(
    layoutKey(identity.id),
    identity.seed,
    validateLayout,
  );
  const [error, setError] = useState('');
  const prefs = { ...shared, ...layout };
  const save: Save<Preferences> = (update) => {
    try {
      // Refresh both scopes before evaluating an updater (including task receipts).
      const latestShared = readStored(sharedPreferencesKey, defaults, validatePrefs);
      const latestLayout = readStored(layoutKey(identity.id), identity.seed, validateLayout);
      const current = { ...latestShared, ...latestLayout };
      const next = typeof update === 'function' ? update(current) : update;
      const nextLayout = validateLayout(next);
      if (JSON.stringify(nextLayout) !== JSON.stringify(latestLayout) && !saveLayout(nextLayout))
        throw new Error('Não foi possível salvar os cards desta janela.');
      const changes = sharedFields(next);
      if (JSON.stringify(changes) !== JSON.stringify(sharedFields(latestShared))) {
        const saved = saveShared((value) => ({ ...value, ...changes }));
        if (!saved) throw new Error('Não foi possível salvar os dados compartilhados.');
        setError('');
        return { ...saved, ...nextLayout };
      }
      setError('');
      return { ...latestShared, ...nextLayout };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  };
  return [prefs, save, sharedReady && layoutReady, error || layoutError || sharedError];
}
