import type { ActionCatalog, JarvisAPI } from '../../shared/types';
import { useEffect, useState } from 'react';
import { getAPI } from '../../client/api';
export function useActions(provided?: Pick<JarvisAPI, 'actions' | 'prepareAction' | 'executeAction'>) {
  const api = () => provided ?? getAPI();
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
      setCatalog(await api().actions());
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  async function execute(id: string, newInstance = false) {
    setBusy(true);
    setError('');
    try {
      const prepared = await api().prepareAction(id, newInstance);
      const result = await api().executeAction(prepared.token);
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
