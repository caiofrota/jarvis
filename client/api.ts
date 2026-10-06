import type { JarvisAPI } from '../shared/types';
let instance: JarvisAPI | undefined;
export function getAPI(): JarvisAPI {
  if (instance) return instance;
  instance = (() => {
    if (window.jarvisDesktop) return window.jarvisDesktop;
    let token: string | undefined;
    const owner = crypto.randomUUID();
    async function api(route: string, body: object = {}, retried = false): Promise<Response> {
      if (location.protocol === 'file:')
        throw new Error('Para conectar a IA, use o aplicativo desktop ou a prévia iniciada por pnpm dev.');
      if (!token) {
        const data = await (await fetch('/api/session')).json();
        token = data.token;
      }
      const response = await fetch('/api/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Jarvis-Token': token || '' },
        body: JSON.stringify({ ...body, owner }),
      });
      if (response.status === 403 && !retried) {
        token = undefined;
        return api(route, body, true);
      }
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Falha de conexão.');
      }
      return response;
    }
    return {
      elevenLabsStatus: async () => (await api('voice/elevenlabs/status')).json(),
      setElevenLabsKey: async (key) => (await api('voice/elevenlabs/key', { key })).json(),
      elevenLabsVoices: async () => (await api('voice/elevenlabs/voices')).json(),
      actions: async () => (await api('actions')).json(),
      prepareAction: async (id) => (await api('actions/prepare', { id })).json(),
      cancelAction: async () => (await api('actions/cancel')).json(),
      executeAction: async (token) => (await api('actions/execute', { token })).json(),
      warmLocalVoice: async (engine) => (await api('voice/local-warm', { engine })).json(),
      localVoiceStatus: async () => (await api('voice/local-status')).json(),
      installLocalVoice: async () => (await api('voice/local-install')).json(),
      speak: async (request) => (await api('voice/speak', { request })).json(),
      stopSpeech: async () => (await api('voice/stop-speech')).json(),
      transcribe: async (request) => (await api('voice/transcribe', { request })).json(),
      cancelVoice: async () => (await api('voice/cancel')).json(),
      microphone: async () => true,
      wakeword: async () => ({
        available: false,
        enabled: false,
        listening: false,
        phrase: 'JARVIS',
        message: 'Wakeword local disponível no aplicativo desktop.',
      }),
      wakewordStatus: async () => ({
        available: false,
        enabled: false,
        listening: false,
        phrase: 'JARVIS',
        message: 'Wakeword local disponível no aplicativo desktop.',
      }),
      onWakeword: () => () => {},
      hardware: async () => (await api('hardware')).json(),
      status: async () => (await api('status')).json(),
      warm: async (request) => (await api('warm', { request })).json(),
      models: async (provider) => (await api('models', { provider })).json(),
      setKey: async (key) => (await api('key', { key })).json(),
      cancel: async () => (await api('cancel')).json(),
      chat: async (request, callback) => {
        const response = await api('chat', { request });
        const reader = response.body!.getReader(),
          decoder = new TextDecoder();
        let buffer = '',
          terminal = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let i;
          while ((i = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            if (line.trim()) {
              const event = JSON.parse(line);
              callback(event);
              if (['done', 'error', 'cancelled'].includes(event.type)) terminal = true;
            }
          }
        }
        if (!terminal) throw new Error('A conexão local terminou antes da resposta.');
      },
    };
  })();
  return instance;
}
