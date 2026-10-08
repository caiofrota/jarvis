import {
  app,
  BrowserWindow,
  dialog,
  session,
  shell,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
} from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, X509Certificate } from 'node:crypto';
import { ActionService, createCatalog } from '../lib/actions';
import { WindowSession, reachableBounds, windowPanels, type WindowState } from './window-session';
import { companionOptions } from '../lib/companion-options';
import { acceptsCompanionCertificate, companionCertificateDecision } from '../lib/companion-certificate';
import {
  companionUserAgent,
  externalWebLink,
  sameServer,
  systemAccountSetup,
} from '../packages/api-client/src/connection';

// Remote content receives only origin-checked window and catalog-action capabilities.
// No Node access, arbitrary paths, shell commands, credentials or local AI bridge.
const userData =
  process.env.JARVIS_TEST_DATA && !app.isPackaged
    ? process.env.JARVIS_TEST_DATA
    : resolve(app.getPath('appData'), 'JarvisCompanion');
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath('userData', userData);
app.setName('Jarvis Companion');
const lock = app.requestSingleInstanceLock({ companion: true });
const windows = new Map<string, BrowserWindow>();
const windowSession = new WindowSession(resolve(app.getPath('userData'), 'window-session.json'), windows);
let window: BrowserWindow | undefined;
let actions: ActionService | undefined;
const microphones = new Set<number>();
const owned = (contents: Electron.WebContents) =>
  [...windows.values()].some((value) => value.webContents === contents);

if (!lock) app.quit();
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
app.on('before-quit', () => windowSession.closeAll());
app.on('window-all-closed', () => app.quit());

app
  .whenReady()
  .then(async () => {
    if (!lock) return;
    const state = resolve(app.getPath('userData'), 'companion-server.json');
    let saved: { origin: string; certificate?: string } | undefined;
    try {
      saved = JSON.parse(readFileSync(state, 'utf8'));
    } catch {
      /* First launch. */
    }
    let options;
    try {
      const serializedArgs = process.env.JARVIS_COMPANION_ARGUMENTS;
      delete process.env.JARVIS_COMPANION_ARGUMENTS;
      const args: unknown = serializedArgs
        ? JSON.parse(serializedArgs)
        : process.argv.slice(app.isPackaged ? 1 : 2);
      if (!Array.isArray(args) || args.some((value) => typeof value !== 'string'))
        throw new Error('Os argumentos de inicialização do companion são inválidos.');
      options = companionOptions(args, saved);
    } catch (error) {
      dialog.showErrorBox('Conectar o Jarvis', (error as Error).message);
      app.quit();
      return;
    }
    const { origin } = options;
    let pinned: Buffer | undefined;
    if (options.certificate) {
      try {
        pinned = new X509Certificate(readFileSync(resolve(options.certificate))).raw;
        if (!acceptsCompanionCertificate(pinned, pinned, new URL(origin).hostname))
          throw new Error('O certificado não corresponde ao servidor ou está fora da validade.');
      } catch (error) {
        dialog.showErrorBox('Certificado do servidor', (error as Error).message);
        app.quit();
        return;
      }
    }
    const partition = session.fromPartition('persist:jarvis-companion');
    partition.setUserAgent(`${partition.getUserAgent()} ${companionUserAgent}`);
    if (pinned)
      partition.setCertificateVerifyProc((request, callback) => {
        callback(
          companionCertificateDecision(
            request.hostname,
            new URL(origin).hostname,
            request.errorCode,
            request.certificate.data,
            pinned!,
          ),
        );
      });
    const microphoneAllowed = (id: number) => microphones.has(id);
    partition.setPermissionCheckHandler(
      (contents, permission, requestingOrigin, details) =>
        permission === 'media' &&
        details.mediaType === 'audio' &&
        details.isMainFrame === true &&
        !!contents &&
        owned(contents) &&
        sameServer(contents.getURL(), origin) &&
        sameServer(requestingOrigin, origin),
    );
    partition.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (
        permission !== 'media' ||
        details.isMainFrame !== true ||
        !owned(contents) ||
        !sameServer(contents.getURL(), origin) ||
        !sameServer(details.requestingUrl, origin) ||
        !('mediaTypes' in details) ||
        details.mediaTypes?.length !== 1 ||
        details.mediaTypes[0] !== 'audio'
      ) {
        callback(false);
        return;
      }
      const ownerWindow = [...windows.values()].find((value) => value.webContents === contents);
      if (!microphoneAllowed(contents.id) && ownerWindow) {
        const answer = await dialog.showMessageBox(ownerWindow, {
          type: 'question',
          title: 'Microfone do Jarvis',
          message: 'Permitir que o Jarvis use seu microfone?',
          detail: `A fala será processada pelo servidor ${origin}.`,
          buttons: ['Permitir', 'Cancelar'],
          defaultId: 1,
          cancelId: 1,
        });
        if (answer.response === 0 && owned(contents)) microphones.add(contents.id);
      }
      callback(microphoneAllowed(contents.id) && owned(contents) && sameServer(contents.getURL(), origin));
    });
    async function createWindow(panel: WindowState['panel'] = 'main', id = 'main', saved?: WindowState) {
      if (windowSession.closing) return;
      const win = new BrowserWindow({
        width: panel === 'main' ? 1440 : 1100,
        height: panel === 'main' ? 960 : 820,
        ...(saved?.bounds
          ? reachableBounds(
              saved.bounds,
              screen.getAllDisplays().map((display) => display.workArea),
            )
          : {}),
        minWidth: 420,
        minHeight: 600,
        title: 'Jarvis Companion',
        backgroundColor: '#090e14',
        show: false,
        webPreferences: {
          session: partition,
          preload: resolve(__dirname, 'companion-preload.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      const contentsId = win.webContents.id;
      windows.set(id, win);
      windowSession.register(id, panel, saved);
      if (id === 'main') window = win;
      const changed = () => windowSession.changed();
      win.on('move', changed);
      win.on('resize', changed);
      win.on('maximize', changed);
      win.on('unmaximize', changed);
      win.on('enter-full-screen', changed);
      win.on('leave-full-screen', changed);
      win.on('close', () => {
        if (id === 'main') windowSession.closeAll(id);
      });
      win.setMenuBarVisibility(false);
      const navigate = (url: string) => {
        if (
          sameServer(url, origin) &&
          ['/', '/studio'].includes(new URL(url).pathname) &&
          !systemAccountSetup(url, origin)
        )
          return true;
        if (externalWebLink(url)) void shell.openExternal(url);
        return false;
      };
      win.webContents.on('will-navigate', (event, url) => {
        if (!navigate(url)) event.preventDefault();
      });
      win.webContents.on('will-redirect', (event, url) => {
        if (!navigate(url)) event.preventDefault();
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (externalWebLink(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      partition.on('will-download', (event) => event.preventDefault());
      win.on('closed', () => {
        windows.delete(id);
        windowSession.removed(id);
        microphones.delete(contentsId);
        actions?.cancel(contentsId);
        if (id === 'main') window = undefined;
      });
      win.once('ready-to-show', () => {
        if (saved?.maximized) win.maximize();
        if (saved?.fullscreen) {
          win.once('enter-full-screen', () => windowSession.restored(id));
          win.setFullScreen(true);
        } else windowSession.restored(id);
        win.show();
      });
      try {
        const url = new URL('/studio', origin);
        url.searchParams.set('window', id);
        if (id !== 'main') url.searchParams.set('secondary', '1');
        if (panel !== 'main') url.searchParams.set('panel', panel);
        await win.loadURL(url.href);
      } catch {
        dialog.showErrorBox(
          'Servidor indisponível',
          `Não foi possível conectar a ${origin}. Confira a rede e o certificado HTTPS.`,
        );
        win.show();
        return;
      }
    }
    function trusted(event: IpcMainInvokeEvent) {
      if (
        !owned(event.sender) ||
        event.senderFrame !== event.sender.mainFrame ||
        !sameServer(event.senderFrame?.url ?? '', origin) ||
        new URL(event.senderFrame!.url).pathname !== '/studio'
      )
        throw new Error('Origem não autorizada.');
    }
    const handle = (name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      ipcMain.handle('jarvis-companion:' + name, async (event, ...args) => {
        try {
          trusted(event);
          return { ok: true, value: await callback(event, ...args) };
        } catch (cause) {
          return { ok: false, error: (cause as Error).message };
        }
      });
    };
    handle('panel', async (_event, panel) => {
      if (typeof panel !== 'string' || !windowPanels.slice(1).includes(panel as never))
        throw new Error('Painel desconhecido.');
      await createWindow(panel as WindowState['panel'], randomUUID());
      return true;
    });
    handle('workspace', async () => {
      await createWindow('main', randomUUID());
      return true;
    });
    const executor = () =>
      (actions ??= new ActionService({
        catalog: createCatalog({
          folders: {
            documents: app.getPath('documents'),
            downloads: app.getPath('downloads'),
            desktop: app.getPath('desktop'),
          },
        }),
      }));
    handle('actions', () => executor().list());
    handle('actions-prepare', (event, id, newInstance = false) => {
      if (typeof id !== 'string' || typeof newInstance !== 'boolean') throw new Error('Ação inválida.');
      return executor().prepare(id, event.sender.id, newInstance);
    });
    handle('actions-cancel', (event) => executor().cancel(event.sender.id));
    handle('actions-execute', async (event, token) => {
      if (typeof token !== 'string') throw new Error('Confirmação inválida.');
      const pending = executor().pending.get(token);
      if (!pending || pending.owner !== event.sender.id || pending.expiresAt <= Date.now())
        throw new Error('Confirmação inválida ou expirada.');
      const ownerWindow = [...windows.values()].find((value) => value.webContents === event.sender)!;
      const answer = await dialog.showMessageBox(ownerWindow, {
        type: 'question',
        title: 'Abrir no seu computador',
        message: `Abrir ${pending.item.label}?`,
        buttons: ['Abrir', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
      });
      trusted(event);
      if (answer.response !== 0) {
        executor().cancel(event.sender.id);
        throw new Error('Abertura cancelada.');
      }
      return executor().execute(token, event.sender.id);
    });
    for (const saved of windowSession.read()) await createWindow(saved.panel, saved.id, saved);
    try {
      const certificate = pinned ? resolve(app.getPath('userData'), 'companion-server.cer') : undefined;
      if (certificate && pinned) writeFileSync(certificate, pinned, { mode: 0o600 });
      writeFileSync(state, JSON.stringify({ origin, certificate }), { mode: 0o600 });
    } catch {
      dialog.showErrorBox(
        'Preferências do companion',
        'Não consegui salvar a conexão. Na próxima abertura, informe --server e o certificado novamente.',
      );
    }
  })
  .catch((error) => {
    dialog.showErrorBox('Jarvis Companion', (error as Error).message);
    app.quit();
  });
