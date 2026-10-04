import type { AIConfig, Model, AIStatus, Hardware, Provider, Profile } from '../../shared/types';
import { useEffect, useRef, useState } from 'react';
import { useStored } from '../../client/storage';
import { getAPI } from '../../client/api';
const BROWSER_API_KEY = 'jarvis-openai-key-v1';
const initial: AIConfig = { provider: 'local', localModel: '', cloudModel: '', keepReady: true };
function validate(input: unknown): AIConfig {
  const raw = input as Partial<AIConfig> | null;
  return {
    keepReady: raw?.keepReady !== false,
    provider: raw?.provider === 'cloud' ? 'cloud' : 'local',
    localModel: typeof raw?.localModel === 'string' ? raw.localModel : '',
    cloudModel: typeof raw?.cloudModel === 'string' ? raw.cloudModel : '',
  };
}
export function useIntelligence() {
  const [config, setConfig, ready] = useStored('jarvis-ai-v2', initial, validate);
  const [models, setModels] = useState<Model[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Partial<AIStatus>>({}),
    [hardware, setHardware] = useState<Hardware | null>(null);
  const [cloudKeyReady, setCloudKeyReady] = useState(false);
  const [preparation, setPreparation] = useState({ key: '', text: '' });
  const warmGeneration = useRef(0);
  const generation = useRef(0);
  const model = config[config.provider === 'local' ? 'localModel' : 'cloudModel'];
  async function refresh() {
    const id = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const list = await getAPI().models(config.provider);
      if (id !== generation.current) return;
      setModels(list);
      setConfig((current) => {
        const key = current.provider === 'local' ? 'localModel' : 'cloudModel';
        return list.some((m) => m.id === current[key]) ? current : { ...current, [key]: list[0]?.id || '' };
      });
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      if (id === generation.current) {
        setError(e.message);
        setModels([]);
      }
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (ready && (config.provider !== 'cloud' || cloudKeyReady)) refresh();
    return () => {
      generation.current++;
    };
  }, [ready, config.provider, cloudKeyReady]);
  useEffect(() => {
    let alive = true;
    const browser = !window.jarvisDesktop;
    const saved = browser ? localStorage.getItem(BROWSER_API_KEY) || '' : '';
    (browser ? getAPI().setKey(saved) : Promise.resolve())
      .then(() => getAPI().status())
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setCloudKeyReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    Promise.all([getAPI().status(), getAPI().hardware()])
      .then(([s, h]) => {
        setStatus(s);
        setHardware(h);
      })
      .catch((e) => setError(e.message));
  }, []);
  return {
    config,
    preparationText: preparation.key === config.provider + ':' + model ? preparation.text : '',
    setKeepReady: (keepReady: boolean) => setConfig((c) => ({ ...c, keepReady })),
    model,
    models,
    ready,
    error,
    loading,
    status,
    hardware,
    refresh,
    setProvider: (provider: Provider) => setConfig((c) => ({ ...c, provider })),
    setModel: (value: string) =>
      setConfig((c) => ({ ...c, [c.provider === 'local' ? 'localModel' : 'cloudModel']: value })),
    connect: async (key: string) => {
      const value = key.trim();
      await getAPI().setKey(value);
      if (!window.jarvisDesktop) {
        if (value) localStorage.setItem(BROWSER_API_KEY, value);
        else localStorage.removeItem(BROWSER_API_KEY);
      }
      setStatus(await getAPI().status());
      await refresh();
    },
    warm: async (profile: Profile) => {
      if (!model || config.provider !== 'local') return { ready: false };
      const id = ++warmGeneration.current;
      const key = config.provider + ':' + model;
      setPreparation((current) =>
        current.key === key && current.text === 'IA pronta' ? current : { key, text: 'Carregando IA…' },
      );
      try {
        const result = await getAPI().warm({ provider: config.provider, model, profile });
        if (id === warmGeneration.current)
          setPreparation({ key, text: result.ready ? 'IA pronta' : result.message || 'Preparação pendente' });
        return result;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (id === warmGeneration.current)
          setPreparation({ key, text: 'Não foi possível preparar: ' + message });
        throw cause;
      }
    },
  };
}
