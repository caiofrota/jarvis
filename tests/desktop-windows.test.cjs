const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

async function boot(directory, actionOptions) {
  const app = new EventEmitter();
  app.isPackaged = false;
  app.getPath = () => directory;
  app.setPath = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.quit = () => app.emit('before-quit');
  const created = [];
  const handlers = new Map();
  const cleanup = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.bounds = { x: options.x || 0, y: options.y || 0, width: options.width, height: options.height };
      this.maximized = false;
      this.fullscreen = false;
      this.webContents = new EventEmitter();
      this.webContents.id = created.length + 1;
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.mainFrame = { url: 'file:///app/out/index.html' };
      created.push(this);
    }
    static getAllWindows() {
      return created.filter((win) => !win.destroyed);
    }
    isDestroyed() {
      return this.destroyed;
    }
    getNormalBounds() {
      return this.bounds;
    }
    isMaximized() {
      return this.maximized;
    }
    isFullScreen() {
      return this.fullscreen;
    }
    setMenuBarVisibility() {}
    loadFile(_file, { query }) {
      this.query = query;
      queueMicrotask(() => this.emit('ready-to-show'));
    }
    show() {}
    focus() {}
    restore() {}
    maximize() {
      this.maximized = true;
    }
    setFullScreen(value) {
      this.fullscreen = value;
      this.emit(value ? 'enter-full-screen' : 'leave-full-screen');
    }
    close() {
      if (this.destroyed) return;
      this.emit('close');
      this.destroyed = true;
      this.emit('closed');
      if (!BrowserWindow.getAllWindows().length) app.emit('window-all-closed');
    }
  }
  const cancel = (owner) => cleanup.push(owner);
  const modules = {
    electron: {
      app,
      BrowserWindow,
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
      shell: {
        openPath: async () => {
          throw new Error('The desktop must use the catalog command and arguments.');
        },
      },
    },
    '../lib/ai': {
      AIService: class {
        cancel = cancel;
        setKey() {}
      },
    },
    '../lib/voice': {
      VoiceService: class {
        local = { dispose() {} };
        cancel = cancel;
        cancelSpeech = cancel;
      },
    },
    '../lib/local-voice': { DuplexVoiceService: class {} },
    '../lib/actions': {
      ActionService: class {
        cancel = cancel;
      },
      createCatalog: () => [],
    },
    '../lib/permissions': {
      isAppURL: () => true,
      MicrophoneGate: class {
        set() {}
        allows() {
          return false;
        }
      },
    },
    '../lib/secret-store': {
      SecretStore: class {
        read() {
          return '';
        }
      },
    },
    '../lib/wakeword': {
      WakeWordService: class {
        stop = cancel;
        dispose() {}
      },
    },
  };
  if (actionOptions) {
    const actionFile = require.resolve('../dist/lib/actions.js');
    const actionExports = {};
    vm.runInNewContext(fs.readFileSync(actionFile, 'utf8'), {
      exports: actionExports,
      console,
      process,
      setTimeout,
      clearTimeout,
      require: (name) =>
        name === 'node:child_process'
          ? { ...require(name), spawn: actionOptions.spawn || require(name).spawn }
          : name.startsWith('.')
            ? require(path.resolve(path.dirname(actionFile), name))
            : require(name),
    });
    modules['../lib/actions'] = {
      ActionService: class extends actionExports.ActionService {
        constructor(options) {
          super({ ...options, environment: { restricted: false } });
        }
      },
      createCatalog: () => actionOptions.catalog,
    };
  }
  const file = require.resolve('../dist/desktop/main.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports: {},
    __dirname: path.dirname(file),
    console,
    queueMicrotask,
    process: { env: { JARVIS_TEST_DATA: directory, JARVIS_TEST_HIDE: '1' }, resourcesPath: directory },
    require: (name) =>
      modules[name] ||
      (name.startsWith('.') ? require(path.resolve(path.dirname(file), name)) : require(name)),
  });
  await new Promise((resolve) => setImmediate(resolve));
  async function invoke(name, arg) {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    return handlers.get('jarvis:' + name)({ sender, senderFrame: sender.mainFrame }, arg);
  }
  return { app, created, active: () => BrowserWindow.getAllWindows(), invoke, cleanup };
}

test('compiled desktop closes the complete workspace and restores stable window identities on next launch', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-desktop-session-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = await boot(directory);
  assert.equal(first.active().length, 1);
  await first.invoke('panel', 'tasks');
  await first.invoke('panel', 'notes');
  await first.invoke('workspace');
  await new Promise((resolve) => setImmediate(resolve));
  const before = first.active();
  before[1].close();
  before[0].bounds = { x: 70, y: 80, width: 1300, height: 900 };
  before[0].maximized = true;
  before[2].bounds = { x: 200, y: 150, width: 800, height: 620 };
  before[2].fullscreen = true;
  const expectedIds = first.active().map((win) => win.query.window);
  before[0].close();
  assert.equal(first.active().length, 0);
  for (const win of before) assert.ok(first.cleanup.includes(win.webContents.id));
  const second = await boot(directory);
  assert.deepEqual(
    second.active().map((win) => win.query.window),
    expectedIds,
  );
  assert.deepEqual(second.active()[0].bounds, { x: 70, y: 80, width: 1300, height: 900 });
  assert.equal(second.active()[0].maximized, true);
  assert.deepEqual(second.active()[1].bounds, { x: 200, y: 150, width: 800, height: 620 });
  assert.equal(second.active()[1].fullscreen, true);
  assert.equal(second.active()[1].query.panel, 'notes');
  assert.equal(second.active()[1].query.secondary, '1');
  second.app.emit('before-quit');
  assert.equal(second.active().length, 0);
});

test('compiled desktop executes the actual catalog launcher for registered apps, binaries, shortcuts and folders', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-desktop-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const catalog = [
    {
      id: 'registered',
      label: 'Registered Application',
      kind: 'app',
      command: 'C:\\Windows\\explorer.exe',
      args: ['shell:AppsFolder\\Example.Package!App'],
    },
    {
      id: 'executable',
      label: 'An Executable',
      kind: 'app',
      command: 'C:\\Program Files\\Example Editor\\editor.exe',
      args: ['--new-window', 'C:\\My Projects'],
    },
    {
      id: 'shortcut',
      label: 'A Shortcut',
      kind: 'app',
      command: 'C:\\Windows\\explorer.exe',
      args: ['C:\\Start Menu\\Example Editor.lnk'],
    },
    {
      id: 'folder',
      label: 'A Folder',
      kind: 'folder',
      command: 'C:\\Windows\\explorer.exe',
      args: ['C:\\My Documents'],
    },
  ].map((item) => ({ ...item, target: item.args[0], available: true }));
  const desktop = await boot(directory, {
    catalog,
    spawn: (command, args, options) => {
      calls.push({ command, args: Array.from(args), options });
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('exit', 0));
      return child;
    },
  });
  t.after(() => desktop.app.emit('before-quit'));
  for (const target of catalog) {
    const prepared = await desktop.invoke('actions-prepare', target.id);
    assert.equal(prepared.ok, true);
    const result = await desktop.invoke('actions-execute', prepared.value.token);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.value.status, 'sent');
    const call = calls.at(-1);
    assert.equal(call.command, target.command);
    assert.deepEqual(call.args, target.args);
    assert.equal(call.options.shell, false);
    assert.equal((await desktop.invoke('actions-execute', prepared.value.token)).ok, false);
  }
  assert.equal((await desktop.invoke('actions-prepare', 'not-in-catalog')).ok, false);
  assert.equal(calls.length, catalog.length);
});

test('compiled desktop launches a real disposable process with intact arguments through action IPC', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-desktop-real-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'argument result.txt');
  const desktop = await boot(directory, {
    catalog: [
      {
        id: 'probe',
        label: 'Disposable Test Process',
        kind: 'app',
        available: true,
        command: process.execPath,
        target: process.execPath,
        args: [
          '-e',
          "require('node:fs').writeFileSync(process.argv[1],process.argv[2])",
          output,
          'argument with spaces',
        ],
      },
    ],
  });
  t.after(() => desktop.app.emit('before-quit'));
  const prepared = await desktop.invoke('actions-prepare', 'probe');
  const result = await desktop.invoke('actions-execute', prepared.value.token);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.status, 'sent');
  assert.equal(fs.readFileSync(output, 'utf8'), 'argument with spaces');
});

test('compiled desktop reports process creation and exit failures instead of confirming an opening', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-desktop-launch-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let failure = 'error';
  const desktop = await boot(directory, {
    catalog: [
      {
        id: 'failing',
        label: 'Unavailable Application',
        kind: 'app',
        command: 'example.exe',
        args: [],
        target: 'example.exe',
        available: true,
      },
    ],
    spawn: () => {
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() =>
        failure === 'error' ? child.emit('error', new Error('ENOENT')) : child.emit('exit', 1),
      );
      return child;
    },
  });
  t.after(() => desktop.app.emit('before-quit'));
  for (const mode of ['error', 'exit']) {
    failure = mode;
    const prepared = await desktop.invoke('actions-prepare', 'failing');
    const result = await desktop.invoke('actions-execute', prepared.value.token);
    assert.equal(result.ok, false);
    assert.match(result.error, mode === 'error' ? /iniciar/ : /recusou/);
  }
});
