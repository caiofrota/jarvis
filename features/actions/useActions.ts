import type { ActionCatalog } from '../../shared/types';
import { useEffect, useState } from 'react';
import { getAPI } from '../../client/api';
export function useActions() {
  const [catalog, setCatalog] = useState<ActionCatalog>({
      items: [],
      apps: [],
      history: [],
      runtime: { restricted: false, platform: '', appVersion: '', message: '' },
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      setCatalog(await getAPI().actions());
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  async function execute(id: string) {
    setBusy(true);
    setError('');
    try {
      const prepared = await getAPI().prepareAction(id);
      const result = await getAPI().executeAction(prepared.token);
      await refresh();
      return result.label + ': ' + result.message;
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return { ...catalog, error, busy, execute };
}
