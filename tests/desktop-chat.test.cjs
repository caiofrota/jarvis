const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { AIService } = require('../dist/lib/ai.js');

function preload(invoke) {
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = (...args) => invoke(ipcRenderer, ...args);
  let api;
  vm.runInNewContext(readFileSync(require.resolve('../dist/desktop/preload.js'), 'utf8'), {
    exports: {},
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            api = value;
          },
        },
      };
    },
  });
  return { api, ipcRenderer };
}

test('desktop chat waits for streamed actions and terminal delivery after invoke resolves', async () => {
  const done = { type: 'done', durationMs: 12 };
  const task = { type: 'task', title: 'Comprar pão' };
  const { api, ipcRenderer } = preload(async (ipc, channel) => {
    assert.equal(channel, 'jarvis:chat');
    setImmediate(() => {
      ipc.emit('jarvis:chat-event', {}, task);
      ipc.emit('jarvis:chat-event', {}, done);
    });
    return { ok: true, value: done };
  });
  const events = [];
  await api.chat({}, (event) => events.push(event));
  assert.deepEqual(events, [task, done]);
  assert.equal(ipcRenderer.listenerCount('jarvis:chat-event'), 0);
});

test('desktop chat also waits for invocation after terminal event arrives first', async () => {
  let release;
  const { api, ipcRenderer } = preload(async (ipc) => {
    ipc.emit('jarvis:chat-event', {}, { type: 'delta', text: 'Olá.' });
    ipc.emit('jarvis:chat-event', {}, { type: 'done', durationMs: 1 });
    await new Promise((resolve) => {
      release = resolve;
    });
    return { ok: true, value: 'completed' };
  });
  const events = [];
  let finished = false;
  const pending = api
    .chat({}, (event) => events.push(event))
    .then((value) => {
      finished = true;
      return value;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  assert.equal(await pending, 'completed');
  assert.deepEqual(
    events.map((event) => event.type),
    ['delta', 'done'],
  );
  assert.equal(ipcRenderer.listenerCount('jarvis:chat-event'), 0);
});

test('desktop chat delivers errors and cancellation and removes listeners on IPC failure', async () => {
  for (const type of ['error', 'cancelled']) {
    const terminal = { type, message: 'Teste' };
    const { api, ipcRenderer } = preload(async (ipc) => {
      setImmediate(() => ipc.emit('jarvis:chat-event', {}, terminal));
      return { ok: true, value: terminal };
    });
    const events = [];
    await api.chat({}, (event) => events.push(event));
    assert.deepEqual(events, [terminal]);
    assert.equal(ipcRenderer.listenerCount('jarvis:chat-event'), 0);
  }
  const { api, ipcRenderer } = preload(async () => ({ ok: false, error: 'Ollama indisponível' }));
  await assert.rejects(api.chat({}, assert.fail), /Ollama indisponível/);
  assert.equal(ipcRenderer.listenerCount('jarvis:chat-event'), 0);
});

test('desktop chat releases listener when renderer callback fails', async () => {
  const { api, ipcRenderer } = preload(async (ipc) => {
    setImmediate(() => ipc.emit('jarvis:chat-event', {}, { type: 'done', durationMs: 1 }));
    return { ok: true, value: {} };
  });
  await assert.rejects(
    api.chat({}, () => {
      throw new Error('Falha no renderer');
    }),
    /Falha no renderer/,
  );
  assert.equal(ipcRenderer.listenerCount('jarvis:chat-event'), 0);
});

test('real AI service decisions survive delayed desktop delivery for replies, tasks and apps', async () => {
  for (const [text, decision, expected] of [
    ['Olá', { type: 'reply', text: 'Olá, tudo bem?' }, 'delta'],
    ['Adiciona comprar pão', { type: 'add_task', title: 'Comprar pão' }, 'task'],
    ['Verifique a tarefa do supermercado', { type: 'check_task', title: 'Ir ao supermercado' }, 'task-check'],
    ['Eu já fui ao supermercado', { type: 'complete_task', id: 'task-one' }, 'task-complete'],
    [
      'Eu quis dizer supermercado',
      { type: 'update_task', id: 'task-one', title: 'Ir ao supermercado' },
      'task-update',
    ],
    ['Abre a calculadora', { type: 'open_computer_target', target: 'Calculadora' }, 'action'],
  ]) {
    const service = new AIService({
      fetchImpl: async (url) =>
        url.endsWith('/show')
          ? new Response('{}')
          : new Response(
              JSON.stringify({ message: { content: JSON.stringify({ decision }) }, done: true }) + '\n',
            ),
    });
    const { api } = preload(async (ipc, _channel, request) => ({
      ok: true,
      value: await service.chat(
        request,
        (event) => setImmediate(() => ipc.emit('jarvis:chat-event', {}, event)),
        'window',
      ),
    }));
    const events = [];
    await api.chat(
      {
        provider: 'local',
        model: 'fixture',
        profile: 'balanced',
        voice: true,
        messages: [{ role: 'user', content: text }],
        tasks: [{ id: 'task-one', text: 'Ir aos bem-mercados', done: false }],
        targets: [{ id: 'calculator', label: 'Calculadora', kind: 'app', available: true }],
      },
      (event) => events.push(event),
    );
    assert.equal(events.at(-1).type, 'done', text);
    assert.equal(events.filter((event) => event.type === expected).length, 1, text);
  }
});
