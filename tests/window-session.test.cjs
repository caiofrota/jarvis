const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  WindowSession,
  validateWindowSession,
  reachableBounds,
} = require('../dist/desktop/window-session.js');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-window-session-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const windows = new Map();
  const file = path.join(directory, 'session.json');
  const session = new WindowSession(file, windows);
  function add(id, panel, bounds = { x: 100, y: 120, width: 1100, height: 820 }) {
    const win = {
      destroyed: false,
      maximized: false,
      fullscreen: false,
      closes: 0,
      isDestroyed() {
        return this.destroyed;
      },
      getNormalBounds() {
        return bounds;
      },
      isMaximized() {
        return this.maximized;
      },
      isFullScreen() {
        return this.fullscreen;
      },
      close() {
        this.closes++;
        this.destroyed = true;
        windows.delete(id);
        session.removed(id);
      },
    };
    windows.set(id, win);
    session.register(id, panel);
    return win;
  }
  return { file, windows, session, add };
}

test('closing the main window saves all identities and geometry before closing secondary windows', (t) => {
  const { file, windows, session, add } = fixture(t);
  add('main', 'main', { x: 40, y: 60, width: 1440, height: 960 });
  const taskWindow = add('stable-tasks', 'tasks', { x: -1100, y: 120, width: 900, height: 700 });
  taskWindow.maximized = true;
  const notesWindow = add('stable-notes', 'notes');
  notesWindow.fullscreen = true;
  session.closeAll('main');
  assert.equal(taskWindow.closes, 1);
  assert.equal(notesWindow.closes, 1);
  assert.equal(windows.size, 1);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.windows.length, 3);
  assert.equal(saved.windows[1].id, 'stable-tasks');
  assert.deepEqual(saved.windows[1].bounds, { x: -1100, y: 120, width: 900, height: 700 });
  assert.equal(saved.windows[1].maximized, true);
  assert.equal(saved.windows[2].fullscreen, true);
  windows.delete('main');
  session.removed('main');
  session.closeAll();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved);
  assert.deepEqual(new WindowSession(file, new Map()).read(), saved.windows);
});

test('individually closed panels are excluded from the next launch; extra workspaces are preserved', (t) => {
  const { file, session, add } = fixture(t);
  add('main', 'main');
  const removed = add('closed-tasks', 'tasks');
  add('another-workspace', 'main');
  removed.close();
  session.closeAll('main');
  assert.deepEqual(
    new WindowSession(file, new Map()).read().map((item) => item.id),
    ['main', 'another-workspace'],
  );
});

test('quitting externally snapshots the whole session even when windows close in a different order', (t) => {
  const { file, session, add } = fixture(t);
  const main = add('main', 'main');
  const notes = add('notes-copy', 'notes');
  session.closeAll();
  assert.equal(main.closes, 1);
  assert.equal(notes.closes, 1);
  assert.equal(new WindowSession(file, new Map()).read().length, 2);
});

test('unfinished renderer startup cannot erase saved maximized or fullscreen state', (t) => {
  const { session, add } = fixture(t);
  add('main', 'main');
  session.register('main', 'main', { id: 'main', panel: 'main', maximized: true, fullscreen: true });
  session.closeAll('main');
  assert.equal(session.read()[0].maximized, true);
  assert.equal(session.read()[0].fullscreen, true);
});

test('session validation rejects invalid identities and panels; missing files start one primary window', (t) => {
  const { session } = fixture(t);
  assert.deepEqual(session.read(), [{ id: 'main', panel: 'main' }]);
  const rows = [
    { id: 'main', panel: 'main' },
    { id: 'tasks', panel: 'tasks' },
    { id: 'tasks', panel: 'notes' },
    { id: '../../x', panel: 'notes' },
    { id: 'bad', panel: 'unknown' },
    { id: 'main', panel: 'tasks' },
  ];
  assert.equal(validateWindowSession({ version: 1, windows: rows }).length, 2);
  assert.deepEqual(validateWindowSession({ version: 2, windows: rows }), []);
});

test('disconnected screens do not leave restored panels inaccessible; reachable positions stay unchanged', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const saved = { x: 100, y: 100, width: 900, height: 700 };
  assert.deepEqual(reachableBounds(saved, [display]), saved);
  assert.deepEqual(reachableBounds({ ...saved, x: -3000 }, [display]), { ...saved, x: 0, y: 0 });
});
