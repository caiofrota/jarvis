import { contextBridge, ipcRenderer } from 'electron';
import type { CompanionWindowsAPI } from '../shared/types';
async function call(name: string, ...args: unknown[]) {
  const result = await ipcRenderer.invoke('jarvis-companion:' + name, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: CompanionWindowsAPI = {
  openPanel: (panel) => call('panel', panel),
  openWorkspace: () => call('workspace'),
  actions: () => call('actions'),
  prepareAction: (id, newInstance) => call('actions-prepare', id, newInstance),
  executeAction: (token) => call('actions-execute', token),
  cancelAction: () => call('actions-cancel'),
};
contextBridge.exposeInMainWorld('jarvisCompanionWindows', api);
