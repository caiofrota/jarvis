const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');

async function boot(directory, args = ['--server', 'https://fixture.test']) {
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
    dialogs = [];
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
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = (fn) => {
        this.popup = fn;
      };
      windows.push(this);
    }
    setMenuBarVisibility() {}
    show() {}
    focus() {}
    async loadURL(url) {
      this.url = url;
    }
  }
  const electron = {
    app,
    BrowserWindow,
    session: { fromPartition: () => partition },
    shell: { openExternal: async (url) => opened.push(url) },
    dialog: {
      showErrorBox: (_title, message) => {
        throw new Error(message);
      },
      showMessageBox: async (_window, options) => {
        dialogs.push(options);
        return { response: 0 };
      },
    },
  };
  const filename = resolve('dist/desktop/companion-main.js'),
    localRequire = createRequire(filename);
  vm.runInNewContext(
    readFileSync(filename, 'utf8'),
    {
      require: (name) => (name === 'electron' ? electron : localRequire(name)),
      exports: {},
      process: { argv: ['electron', filename, ...args], env: {} },
      console,
      URL,
    },
    { filename },
  );
  await new Promise(setImmediate);
  return { window: windows[0], partition, opened, dialogs };
}
test('remote desktop runs only the chosen central UI with no privileged bridge', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-window-'));
  try {
    const f = await boot(directory);
    assert.equal(f.window.url, 'https://fixture.test/studio');
    assert.equal(f.window.options.webPreferences.nodeIntegration, false);
    assert.equal(f.window.options.webPreferences.sandbox, true);
    assert.equal(f.window.options.webPreferences.contextIsolation, true);
    assert.equal(f.window.options.webPreferences.preload, undefined);
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
    assert.equal(f.window.url, 'https://fixture.test/studio');
    assert.equal(typeof f.partition.certificate, 'function');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
