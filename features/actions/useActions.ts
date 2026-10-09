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
    [busy, setBusy] = useState(false),
    [externalBusy, setExternalBusy] = useState(false);
  async function refresh() {
    try {
      setCatalog(await api().actions());
      setError('');
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    const changed = () => void refresh();
    const external = (event: Event) => setExternalBusy((event as CustomEvent<boolean>).detail === true);
    window.addEventListener('jarvis-computer-actions-changed', changed);
    window.addEventListener('jarvis-computer-busy', external);
    return () => {
      window.removeEventListener('jarvis-computer-actions-changed', changed);
      window.removeEventListener('jarvis-computer-busy', external);
    };
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
  return { ...catalog, error, busy: busy || externalBusy, execute };
}
