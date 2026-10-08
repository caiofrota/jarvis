import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { companionOptions } from '../lib/companion-options';
import { acceptsCompanionCertificate, companionCertificateDecision } from '../lib/companion-certificate';
import {
  companionUserAgent,
  externalWebLink,
  sameServer,
  systemAccountSetup,
} from '../packages/api-client/src/connection';

// Remote content has no preload, IPC bridge, Node access or local executor privileges.
const userData =
  process.env.JARVIS_TEST_DATA && !app.isPackaged
    ? process.env.JARVIS_TEST_DATA
    : resolve(app.getPath('appData'), 'JarvisCompanion');
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath('userData', userData);
app.setName('Jarvis Companion');
const lock = app.requestSingleInstanceLock({ companion: true });
let window: BrowserWindow | undefined;
if (!lock) app.quit();
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
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
      options = companionOptions(process.argv.slice(app.isPackaged ? 1 : 2), saved);
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
    let microphoneAllowed = false;
    partition.setPermissionCheckHandler(
      (contents, permission, requestingOrigin, details) =>
        permission === 'media' &&
        details.mediaType === 'audio' &&
        details.isMainFrame === true &&
        !!contents &&
        contents === window?.webContents &&
        sameServer(contents.getURL(), origin) &&
        sameServer(requestingOrigin, origin),
    );
    partition.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (
        permission !== 'media' ||
        details.isMainFrame !== true ||
        contents !== window?.webContents ||
        !sameServer(contents.getURL(), origin) ||
        !sameServer(details.requestingUrl, origin) ||
        !('mediaTypes' in details) ||
        details.mediaTypes?.length !== 1 ||
        details.mediaTypes[0] !== 'audio'
      ) {
        callback(false);
        return;
      }
      if (!microphoneAllowed && window) {
        const answer = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'Microfone do Jarvis',
          message: 'Permitir que o Jarvis use seu microfone?',
          detail: `A fala será processada pelo servidor ${origin}.`,
          buttons: ['Permitir', 'Cancelar'],
          defaultId: 1,
          cancelId: 1,
        });
        microphoneAllowed = answer.response === 0;
      }
      callback(
        microphoneAllowed && contents === window?.webContents && sameServer(contents.getURL(), origin),
      );
    });
    window = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 420,
      minHeight: 600,
      title: 'Jarvis Companion',
      backgroundColor: '#090e14',
      show: false,
      webPreferences: {
        session: partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window.setMenuBarVisibility(false);
    const navigate = (url: string) => {
      if (sameServer(url, origin) && !systemAccountSetup(url, origin)) return true;
      if (externalWebLink(url)) void shell.openExternal(url);
      return false;
    };
    window.webContents.on('will-navigate', (event, url) => {
      if (!navigate(url)) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (!navigate(url)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (externalWebLink(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    partition.on('will-download', (event) => event.preventDefault());
    window.on('closed', () => {
      window = undefined;
      microphoneAllowed = false;
    });
    window.once('ready-to-show', () => window?.show());
    try {
      await window.loadURL(`${origin}/studio`);
    } catch {
      dialog.showErrorBox(
        'Servidor indisponível',
        `Não foi possível conectar a ${origin}. Confira a rede e o certificado HTTPS.`,
      );
      window?.show();
      return;
    }
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
