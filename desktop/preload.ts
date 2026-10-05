import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IPCChannels } from '../shared/ipc';
import type { ChatEvent, DesktopAPI } from '../shared/types';
async function call<K extends keyof IPCChannels>(
  name: K,
  ...args: Parameters<IPCChannels[K]>
): Promise<Awaited<ReturnType<IPCChannels[K]>>> {
  const result = (await ipcRenderer.invoke('jarvis:' + name, ...args)) as {
    ok: boolean;
    error?: string;
    value: Awaited<ReturnType<IPCChannels[K]>>;
  };
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: DesktopAPI = {
  actions: () => call('actions'),
  prepareAction: (id) => call('actions-prepare', id),
  executeAction: (token) => call('actions-execute', token),
  cancelAction: () => call('actions-cancel'),
  microphone: (enabled) => call('microphone', enabled),
  wakeword: (enabled) => call('wakeword', enabled),
  wakewordStatus: () => call('wakeword-status'),
  onWakeword: (listener) => {
    const callback = () => listener();
    ipcRenderer.on('jarvis:wakeword', callback);
    return () => ipcRenderer.removeListener('jarvis:wakeword', callback);
  },
  warmLocalVoice: (engine) => call('voice-local-warm', engine),
  localVoiceStatus: () => call('voice-local-status'),
  installLocalVoice: () => call('voice-local-install'),
  speak: (request) => call('speak', request),
  stopSpeech: () => call('stop-speech'),
  transcribe: (request) => call('transcribe', request),
  cancelVoice: () => call('voice-cancel'),
  hardware: () => call('hardware'),
  status: () => call('status'),
  warm: (request) => call('warm', request),
  models: (provider) => call('models', provider),
  setKey: (key) => call('key', key),
  cancel: () => call('cancel'),
  openPanel: (panel) => call('panel', panel),
  openWorkspace: () => call('workspace'),
  chat: (request, callback) => {
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    const delivered = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const listener = (_event: IpcRendererEvent, data: ChatEvent) => {
      try {
        callback(data);
        if (['done', 'error', 'cancelled'].includes(data.type)) complete();
      } catch (error) {
        fail(error);
      }
    };
    ipcRenderer.on('jarvis:chat-event', listener);
    // invoke completion and streamed events use separate IPC deliveries.
    // Keep the listener until both finish so actions and done cannot be lost.
    return Promise.all([call('chat', request), delivered])
      .then(([result]) => result)
      .finally(() => ipcRenderer.removeListener('jarvis:chat-event', listener));
  },
};
contextBridge.exposeInMainWorld('jarvisDesktop', api);
