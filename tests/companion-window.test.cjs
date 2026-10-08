const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');

async function boot(directory, args = ['--server', 'https://fixture.test'], env = {}, executor) {
  const app = new EventEmitter(),
    partition = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    setName() {},
    setPath() {},
    getPath: () => directory,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit() {},
  });
  const windows = [],
    opened = [],
    dialogs = [],
    handlers = new Map();
  partition.getUserAgent = () => 'fixture-browser';
  partition.setUserAgent = (value) => {
    partition.userAgent = value;
  };
  partition.setCertificateVerifyProc = (fn) => {
    partition.certificate = fn;
  };
  partition.setPermissionCheckHandler = (fn) => {
    partition.check = fn;
  };
  partition.setPermissionRequestHandler = (fn) => {
    partition.request = fn;
  };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.id = windows.length + 1;
      this.webContents.mainFrame = {};
      Object.defineProperty(this.webContents.mainFrame, 'url', { get: () => this.url });
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = (fn) => {
        this.popup = fn;
      };
      windows.push(this);
    }
    isDestroyed() {
      return false;
    }
    getNormalBounds() {
      return { x: 0, y: 0, width: 1280, height: 900 };
    }
    isMaximized() {
      return false;
    }
    isFullScreen() {
      return false;
    }
    close() {
      this.emit('close');
      this.emit('closed');
    }
    maximize() {}
    setFullScreen() {}
    setMenuBarVisibility() {}
    show() {}
    focus() {}
    async loadURL(url) {
      this.url = url;
    }
  }
  const electron = {
    app,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    BrowserWindow,
    session: { fromPartition: () => partition },
    shell: { openExternal: async (url) => opened.push(url) },
    dialog: {
      showErrorBox: (_title, message) => {
        throw new Error(message);
      },
      showMessageBox: async (_window, options) => {
        dialogs.push(options);
        return { response: dialogs.response ?? 0 };
      },
    },
  };
  const filename = resolve('dist/desktop/companion-main.js'),
    localRequire = createRequire(filename);
  vm.runInNewContext(
    readFileSync(filename, 'utf8'),
    {
      require: (name) =>
        name === 'electron'
          ? electron
          : name === '../lib/actions' && executor
            ? {
                ActionService: class {
                  constructor() {
                    return executor;
                  }
                },
                createCatalog: () => [],
              }
            : localRequire(name),
      exports: {},
      process: { argv: ['electron', filename, ...args], env },
      console,
      URL,
      __dirname: resolve('dist/desktop'),
    },
    { filename },
  );
  await new Promise(setImmediate);
  return { window: windows[0], windows, partition, opened, dialogs, handlers, app };
}
test('remote desktop runs the central UI with only the narrow companion preload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-window-'));
  try {
    const f = await boot(directory);
    assert.equal(new URL(f.window.url).pathname, '/studio');
    assert.equal(f.window.options.webPreferences.nodeIntegration, false);
    assert.equal(f.window.options.webPreferences.sandbox, true);
    assert.equal(f.window.options.webPreferences.contextIsolation, true);
    assert.equal(f.window.options.webPreferences.preload, resolve('dist/desktop/companion-preload.js'));
    const preload = readFileSync(f.window.options.webPreferences.preload, 'utf8');
    assert.match(preload, /jarvisCompanionWindows/);
    assert.doesNotMatch(preload, /jarvisDesktop|executeJavaScript|node:fs/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'companion-server.json'), 'utf8')), {
      origin: 'https://fixture.test',
    });
    let prevented = false;
    f.window.webContents.emit(
      'will-navigate',
      {
        preventDefault() {
          prevented = true;
        },
      },
      'file:///etc/passwd',
    );
    assert.equal(prevented, true);
    assert.equal(f.opened.length, 0);
    prevented = false;
    f.window.webContents.emit(
      'will-navigate',
      {
        preventDefault() {
          prevented = true;
        },
      },
      'https://fixture.test/integrations',
    );
    assert.equal(prevented, true);
    assert.deepEqual(f.opened, ['https://fixture.test/integrations']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('microphone is audio-only, main-frame and server-bound, with one native permission prompt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-permissions-'));
  try {
    const f = await boot(directory),
      contents = f.window.webContents;
    const details = {
      isMainFrame: true,
      requestingUrl: 'https://fixture.test/studio',
      mediaTypes: ['audio'],
    };
    const request = async (permission, input) => {
      let allowed;
      await f.partition.request(
        contents,
        permission,
        (value) => {
          allowed = value;
        },
        input,
      );
      return allowed;
    };
    assert.equal(await request('media', details), true);
    assert.equal(await request('media', details), true);
    assert.equal(f.dialogs.length, 1);
    assert.equal(await request('media', { ...details, mediaTypes: ['audio', 'video'] }), false);
    assert.equal(await request('media', { ...details, isMainFrame: false }), false);
    assert.equal(await request('media', { ...details, requestingUrl: 'https://other.test' }), false);
    assert.equal(await request('display-capture', details), false);
    assert.equal(
      f.partition.check(contents, 'media', 'https://fixture.test', { isMainFrame: true, mediaType: 'audio' }),
      true,
    );
    assert.equal(
      f.partition.check(contents, 'media', 'https://fixture.test', { isMainFrame: true, mediaType: 'video' }),
      false,
    );
    assert.equal(
      f.partition.check(contents, 'media', 'https://other.test', { isMainFrame: true, mediaType: 'audio' }),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('saved local trust retains only the public certificate and survives deleting the download', async () => {
  const { execFileSync } = require('node:child_process');
  const { X509Certificate } = require('node:crypto');
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-saved-cert-'));
  try {
    const certificate = join(directory, 'download.pem'),
      key = join(directory, 'fixture.key');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        certificate,
        '-subj',
        '/CN=fixture',
        '-addext',
        'subjectAltName=DNS:fixture.test',
      ],
      { stdio: 'ignore' },
    );
    const original = new X509Certificate(readFileSync(certificate));
    writeFileSync(certificate, Buffer.concat([readFileSync(certificate), readFileSync(key)]));
    await boot(directory, ['--server', 'https://fixture.test', '--certificate', certificate]);
    const saved = JSON.parse(readFileSync(join(directory, 'companion-server.json'), 'utf8'));
    assert.notEqual(saved.certificate, certificate);
    assert.deepEqual(readFileSync(saved.certificate), original.raw);
    unlinkSync(certificate);
    const f = await boot(directory, []);
    assert.equal(new URL(f.window.url).pathname, '/studio');
    assert.equal(typeof f.partition.certificate, 'function');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('launcher arguments travel outside the native Electron command line and are consumed once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-launch-'));
  try {
    const env = { JARVIS_COMPANION_ARGUMENTS: JSON.stringify(['--server', 'https://fixture.test']) };
    const f = await boot(directory, [], env);
    assert.equal(new URL(f.window.url).pathname, '/studio');
    assert.equal(env.JARVIS_COMPANION_ARGUMENTS, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('window capabilities reject other origins, subframes and unknown panels and restore the session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-windows-'));
  let f;
  try {
    f = await boot(directory);
    const contents = f.window.webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    const panel = f.handlers.get('jarvis-companion:panel');
    assert.equal((await panel(event, 'tasks')).ok, true);
    assert.equal(f.windows.length, 2);
    assert.equal(new URL(f.windows[1].url).searchParams.get('panel'), 'tasks');
    assert.equal((await panel(event, 'file:///etc/passwd')).ok, false);
    assert.equal((await panel({ ...event, senderFrame: { url: f.window.url } }, 'notes')).ok, false);
    f.window.url = 'https://other.test/studio';
    assert.equal((await panel(event, 'notes')).ok, false);
    f.window.url = 'https://fixture.test/settings';
    assert.equal((await panel(event, 'notes')).ok, false);
    f.window.url = 'https://fixture.test/studio';
    assert.equal((await f.handlers.get('jarvis-companion:workspace')(event)).ok, true);
    f.app.emit('before-quit');
    const saved = JSON.parse(readFileSync(join(directory, 'window-session.json'), 'utf8'));
    assert.equal(saved.windows.length, 3);
    const restored = await boot(directory);
    assert.equal(restored.windows.length, 3);
    assert.equal(new URL(restored.windows[1].url).searchParams.get('panel'), 'tasks');
    restored.app.emit('before-quit');
  } finally {
    f?.app.emit('before-quit');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('computer actions require owner-bound tokens and native user consent before simulated dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-executor-'));
  const pending = new Map();
  let dispatched = 0;
  const executor = {
    pending,
    list: () => ({
      items: [{ id: 'unfamiliar-editor', label: 'Unfamiliar Editor', available: true }],
      apps: [],
      history: [],
    }),
    prepare(id, owner) {
      if (id !== 'unfamiliar-editor') throw new Error('Unavailable');
      pending.set('fixture-token', {
        owner,
        expiresAt: Date.now() + 60000,
        item: { label: 'Unfamiliar Editor' },
      });
      return { token: 'fixture-token' };
    },
    cancel(owner) {
      for (const [id, item] of pending) if (item.owner === owner) pending.delete(id);
    },
    execute(token, owner) {
      assert.equal(pending.get(token).owner, owner);
      pending.delete(token);
      dispatched++;
      return { status: 'sent' };
    },
  };
  try {
    const f = await boot(directory, ['--server', 'https://fixture.test'], {}, executor);
    const contents = f.window.webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    const prepare = f.handlers.get('jarvis-companion:actions-prepare');
    const execute = f.handlers.get('jarvis-companion:actions-execute');
    assert.equal((await prepare(event, 'unfamiliar-editor')).ok, true);
    assert.equal(dispatched, 0);
    assert.equal((await execute(event, 'invented-token')).ok, false);
    f.dialogs.response = 1;
    assert.equal((await execute(event, 'fixture-token')).ok, false);
    assert.equal(dispatched, 0);
    assert.equal(pending.size, 0);
    await prepare(event, 'unfamiliar-editor');
    f.dialogs.response = 0;
    assert.equal((await execute(event, 'fixture-token')).ok, true);
    assert.equal(dispatched, 1);
    assert.equal((await execute(event, 'fixture-token')).ok, false);
    assert.equal(dispatched, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
