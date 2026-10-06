import { randomUUID } from 'node:crypto';
import type { IPCChannels } from '../shared/ipc';
import type { IpcMainInvokeEvent } from 'electron';
import { projectRoot } from '../lib/paths';
import { app, BrowserWindow, ipcMain, session, screen } from 'electron';
import * as path from 'node:path';
import { isAppURL, MicrophoneGate } from '../lib/permissions';
import { AIService } from '../lib/ai';
import { ActionService, createCatalog } from '../lib/actions';
import { VoiceService } from '../lib/voice';
import { DuplexVoiceService } from '../lib/local-voice';
import { SecretStore } from '../lib/secret-store';
import { WakeWordService } from '../lib/wakeword';
import { WindowSession, reachableBounds, windowPanels, type WindowState } from './window-session';
const ai = new AIService(),
  windows = new Map<string, BrowserWindow>();
let actions: ActionService;
let secrets: SecretStore | null = null;
let elevenLabsSecrets: SecretStore | null = null;
if (process.env.JARVIS_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.JARVIS_TEST_DATA);
const windowSession = new WindowSession(path.join(app.getPath('userData'), 'window-session.json'), windows);
const voice: VoiceService = new VoiceService({
  ai,
  vocabulary: () => [
    'Jarvis',
    ...(actions?.items || [])
      .filter((item) => item.available && item.kind === 'app')
      .map((item) => item.label),
  ],
  local: app.isPackaged
    ? new DuplexVoiceService({
        root: app.getPath('userData'),
        dataDir: path.join(app.getPath('userData'), 'voice-models'),
        scriptsDir: path.join(process.resourcesPath, 'voice'),
      })
    : new DuplexVoiceService(),
});
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => {
  const win = windows.get('main');
  if (win) {
    win.restore();
    win.show();
    win.focus();
  }
});
const entry = path.join(projectRoot, 'out/index.html');
const microphones = new MicrophoneGate(entry);
function wakewordPaths() {
  return app.isPackaged
    ? {
        root: app.getPath('userData'),
        dataDir: path.join(app.getPath('userData'), 'voice-models'),
        scriptsDir: path.join(process.resourcesPath, 'voice'),
      }
    : {};
}
const wakeword: WakeWordService = new WakeWordService({
  ...wakewordPaths(),
  onDetected: (owner) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === owner);
    if (win && !win.isDestroyed()) win.webContents.send('jarvis:wakeword');
  },
});
function trusted(event: IpcMainInvokeEvent) {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Origem não autorizada.');
  if (!isAppURL(event.senderFrame?.url || '', entry)) throw new Error('Origem não autorizada.');
}
function createWindow(panel: WindowState['panel'] = 'main', windowId = 'main', saved?: WindowState) {
  if (windowSession.closing) return;
  if (windows.get(windowId) && !windows.get(windowId)!.isDestroyed()) {
    windows.get(windowId)!.show();
    windows.get(windowId)!.focus();
    return;
  }
  const win = new BrowserWindow({
    width: panel === 'main' ? 1440 : 1100,
    height: panel === 'main' ? 960 : 820,
    ...(saved?.bounds
      ? reachableBounds(
          saved.bounds,
          screen.getAllDisplays().map((display) => display.workArea),
        )
      : {}),
    minWidth: panel === 'main' ? 800 : 360,
    minHeight: panel === 'main' ? 650 : 420,
    title: panel === 'main' ? 'Jarvis Studio' : 'Jarvis — ' + panel,
    backgroundColor: '#090e14',
    icon: path.join(projectRoot, 'assets/icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  windows.set(windowId, win);
  windowSession.register(windowId, panel, saved);
  const changed = () => windowSession.changed();
  win.on('move', changed);
  win.on('resize', changed);
  win.on('maximize', changed);
  win.on('unmaximize', changed);
  win.on('enter-full-screen', changed);
  win.on('leave-full-screen', changed);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('close', () => {
    if (windowId === 'main') windowSession.closeAll(windowId);
    const id = win.webContents.id;
    ai.cancel(id);
    voice.cancel(id);
    voice.cancelSpeech(id);
    actions?.cancel(id);
    microphones.set(id, false);
    wakeword.stop(id);
  });
  win.on('closed', () => {
    windows.delete(windowId);
    windowSession.removed(windowId);
  });
  win.once('ready-to-show', () => {
    if (windowSession.closing || win.isDestroyed()) return;
    if (saved?.maximized) win.maximize();
    if (saved?.fullscreen) {
      win.once('enter-full-screen', () => windowSession.restored(windowId));
      win.setFullScreen(true);
    } else windowSession.restored(windowId);
    if (!process.env.JARVIS_TEST_HIDE || app.isPackaged) win.show();
  });
  windowSession.changed();
  win.loadFile(entry, {
    query:
      windowId === 'main'
        ? { window: windowId }
        : { window: windowId, secondary: '1', ...(panel === 'main' ? {} : { panel }) },
  });
}
const handle = <K extends keyof IPCChannels>(
  name: K,
  callback: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<IPCChannels[K]>
  ) => ReturnType<IPCChannels[K]> | Awaited<ReturnType<IPCChannels[K]>>,
) =>
  ipcMain.handle('jarvis:' + name, async (event, ...args: unknown[]) => {
    trusted(event);
    try {
      return { ok: true, value: await callback(event, ...(args as Parameters<IPCChannels[K]>)) };
    } catch (errorCause) {
      const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
      return { ok: false, error: error.message };
    }
  });
handle('actions', () => actions.list());
handle('actions-prepare', (event, id) => actions.prepare(id, event.sender.id));
handle('actions-execute', (event, token) => actions.execute(token, event.sender.id));
handle('actions-cancel', (event) => actions.cancel(event.sender.id));
handle('voice-local-warm', (event, engine) => voice.warmLocal(event.sender.id, engine));
handle('elevenlabs-status', () => voice.elevenlabs.status());
handle('elevenlabs-voices', () => voice.elevenlabs.voices());
handle('elevenlabs-key', (_, key) => {
  const result = voice.elevenlabs.setKey(key);
  try {
    elevenLabsSecrets?.write(key);
  } catch (cause) {
    voice.elevenlabs.setKey('');
    throw cause;
  }
  return result;
});
handle('voice-local-status', () => voice.localStatus());
handle('voice-local-install', () => voice.installLocal());
handle('speak', (event, request) => voice.speak(request, event.sender.id));
handle('stop-speech', (event) => voice.cancelSpeech(event.sender.id));
handle('transcribe', (event, request) => voice.transcribe(request, event.sender.id));
handle('voice-cancel', (event) => voice.cancel(event.sender.id));
handle('microphone', (event, enabled) => microphones.set(event.sender.id, enabled));
handle('wakeword', (event, enabled) =>
  enabled ? wakeword.start(event.sender.id) : wakeword.stop(event.sender.id),
);
handle('wakeword-status', () => wakeword.status());
handle('hardware', () => ({
  ...ai.hardware(),
  appMemoryMB: Math.round(app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024),
}));
handle('status', () => ai.status());
handle('warm', (event, request) => ai.warm(request, event.sender.id));
handle('models', (_, provider) => ai.models(provider));
handle('key', (_, key) => {
  const result = ai.setKey(key);
  try {
    secrets?.write(ai.cloudKey);
  } catch (cause) {
    ai.setKey('');
    throw cause;
  }
  return result;
});
handle('cancel', (event) => ai.cancel(event.sender.id));
handle('panel', (_, panel) => {
  if (!windowPanels.slice(1).some((id) => id === panel)) throw new Error('Painel desconhecido.');
  createWindow(panel, randomUUID());
  return true;
});
handle('workspace', () => {
  createWindow('main', randomUUID());
  return true;
});
handle('chat', (event, request) => {
  const owner = event.sender.id;
  return ai.chat(
    { ...request, targets: [...actions.list().items, ...actions.list().apps] },
    (data) => {
      if (!event.sender.isDestroyed()) event.sender.send('jarvis:chat-event', data);
    },
    owner,
  );
});
app.whenReady().then(() => {
  if (!singleInstance) return;
  secrets = new SecretStore(path.join(app.getPath('userData'), 'openai-api-key.bin'));
  ai.setKey(secrets.read());
  elevenLabsSecrets = new SecretStore(path.join(app.getPath('userData'), 'elevenlabs-api-key.bin'));
  voice.elevenlabs.setKey(elevenLabsSecrets.read());
  actions = new ActionService({
    catalog: createCatalog({
      folders: {
        documents: app.getPath('documents'),
        downloads: app.getPath('downloads'),
        desktop: app.getPath('desktop'),
      },
      project: app.isPackaged ? path.dirname(app.getPath('exe')) : projectRoot,
    }),
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(microphones.allows(contents, permission, details, 'request')),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    microphones.allows(contents, permission, details, 'check'),
  );
  for (const saved of windowSession.read()) createWindow(saved.panel, saved.id, saved);
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('before-quit', () => windowSession.closeAll());
app.on('window-all-closed', () => {
  ai.cloudKey = '';
  wakeword.dispose();
  voice.local.dispose();
  app.quit();
});
