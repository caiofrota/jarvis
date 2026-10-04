import { useEffect, useState } from 'react';
import type { InputMode, LocalVoiceStatus } from '../../shared/types';
import { getAPI } from '../../client/api';
export function useLocalVoice(mode: InputMode, enabled: boolean) {
  const [status, setStatus] = useState<LocalVoiceStatus>({ ready: false }),
    [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let mounted = true,
      inflight = false,
      started = false;
    async function refresh() {
      if (inflight) return;
      inflight = true;
      try {
        let next = await getAPI().localVoiceStatus();
        if (!mounted) return;
        if (
          mode === 'local' &&
          (!next.ready || !next.wakewordReady) &&
          !next.installing &&
          !next.error &&
          !started
        ) {
          started = true;
          next = await getAPI().installLocalVoice();
        }
        if (mounted) setStatus(next);
      } catch (eCause) {
        const e = eCause instanceof Error ? eCause : new Error(String(eCause));
        if (mounted) setError(e.message);
      } finally {
        inflight = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [mode, enabled]);
  return {
    status,
    error,
    retry: async () => {
      try {
        setError('');
        setStatus(await getAPI().installLocalVoice());
      } catch (eCause) {
        const e = eCause instanceof Error ? eCause : new Error(String(eCause));
        setError(e.message);
      }
    },
  };
}
