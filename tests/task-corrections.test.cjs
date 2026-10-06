const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../dist/lib/ai.js');
const { parseDecision, isActionRequest } = require('../dist/lib/chat-decision.js');
const { saveTask, updateTask } = require('../dist/features/tasks/task-actions.js');
const { commitStoredValue } = require('../dist/client/stored-value.js');
const { chatMessages } = require('../dist/features/chat/conversation.js');

function workspace() {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const read = () => JSON.parse(storage.getItem('prefs') || '{"tasks":[],"notes":"Manter"}');
  return { storage, read, update: (update) => commitStoredValue('prefs', update, read(), (x) => x, storage) };
}
const config = { provider: 'local', model: 'fixture', profile: 'balanced', voice: true };
const response = (decision) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify({ decision }) }, done: true }) + '\n');

test('reported supermarket dialogue corrects the original task ID without adding another task', async () => {
  const state = workspace();
  const history = [];
  const requests = [];
  const service = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return new Response('{}');
      const payload = JSON.parse(options.body);
      requests.push(payload);
      return response(
        requests.length === 1
          ? { type: 'add_task', title: 'Ir aos bem-mercados' }
          : { type: 'update_task', id: state.read().tasks[0].id, title: 'Ir ao supermercado' },
      );
    },
  });
  let firstId;
  for (const text of [
    'Esqueci de aos pirmercados, o Jarvis',
    'Eu falei que eu esqueci de ir ao supermercado.',
  ]) {
    history.push({ role: 'user', text, status: 'done' });
    const events = [];
    await service.chat({ ...config, tasks: state.read().tasks, messages: chatMessages(history) }, (event) =>
      events.push(event),
    );
    assert.equal(events.at(-1).type, 'done');
    const addition = events.find((event) => event.type === 'task');
    const correction = events.find((event) => event.type === 'task-update');
    const result = addition
      ? saveTask(state.update, addition.title)
      : updateTask(state.update, correction.id, correction.title, correction.previousTitle);
    if (addition) firstId = result.receipt.id;
    else {
      assert.equal(correction.id, firstId);
      assert.equal(correction.previousTitle, 'Ir aos bem-mercados');
      assert.equal(result.receipt.type, 'update_task');
      assert.equal(
        events.some((event) => event.type === 'delta'),
        false,
        'no confirmation before storage',
      );
    }
    history.push({ role: 'assistant', status: 'done', ...result });
  }
  assert.deepEqual(state.read().tasks, [{ id: firstId, text: 'Ir ao supermercado', done: false }]);
  assert.equal(state.read().notes, 'Manter');
  assert.match(requests[1].messages[0].content, /update_task/);
  assert.ok(requests[1].messages[0].content.includes(firstId));
  assert.equal(JSON.parse(requests[1].messages[2].content).result.id, firstId);
  assert.equal(JSON.parse(chatMessages(history).at(-1).content).result.status, 'updated');
});

test('correction persists by ID, preserves completion and unrelated tasks and can be corrected again', () => {
  const state = workspace();
  const first = saveTask(state.update, 'Ir aos bem-mercados');
  const other = saveTask(state.update, 'Pagar aluguel');
  state.update((current) => ({
    ...current,
    tasks: current.tasks.map((task) => (task.id === first.receipt.id ? { ...task, done: true } : task)),
  }));
  updateTask(state.update, first.receipt.id, 'Ir ao supermercado', first.receipt.title);
  updateTask(state.update, first.receipt.id, 'Comprar pão no supermercado', 'Ir ao supermercado');
  assert.equal(state.read().tasks.length, 2);
  assert.equal(state.read().tasks[0].done, true);
  assert.equal(state.read().tasks[1].id, other.receipt.id);
  assert.equal(state.read().tasks[1].text, 'Pagar aluguel');
});

test('deleted, concurrently changed or conflicting tasks are not overwritten or duplicated', () => {
  const state = workspace();
  const original = saveTask(state.update, 'Ir aos bem-mercados');
  saveTask(state.update, 'Ir ao supermercado');
  const before = state.read();
  assert.throws(
    () => updateTask(state.update, original.receipt.id, 'Ir ao supermercado', original.receipt.title),
    /outra tarefa/,
  );
  assert.throws(
    () => updateTask(state.update, 'missing', 'Novo título', original.receipt.title),
    /não existe/,
  );
  assert.throws(() => updateTask(state.update, original.receipt.id, 'Novo título', 'Título antigo'), /mudou/);
  assert.deepEqual(state.read(), before);
});

test('storage failure cannot confirm a correction', () => {
  const state = workspace();
  const original = saveTask(state.update, 'Ir aos bem-mercados');
  state.storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(
    () => updateTask(state.update, original.receipt.id, 'Ir ao supermercado', original.receipt.title),
    /Quota/,
  );
  assert.equal(state.read().tasks[0].text, original.receipt.title);
  assert.throws(
    () => updateTask(() => null, original.receipt.id, 'Ir ao supermercado', original.receipt.title),
    /Não consegui salvar/,
  );
});

test('unknown IDs and unsupported arguments produce no correction event', async () => {
  const service = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show')
        ? new Response('{}')
        : response({ type: 'update_task', id: 'invented', title: 'Ir ao supermercado' }),
  });
  const events = [];
  await assert.rejects(
    service.chat(
      { ...config, tasks: [], messages: [{ role: 'user', content: 'Eu falei supermercado' }] },
      (event) => events.push(event),
    ),
    /validar/,
  );
  assert.equal(
    events.some((event) => ['task', 'task-update', 'delta'].includes(event.type)),
    false,
  );
  for (const decision of [
    { type: 'update_task', id: '', title: 'Teste' },
    { type: 'update_task', id: 'one', title: '', extra: true },
    { type: 'update_task', id: 'one', title: 'Teste', command: 'exec' },
  ])
    assert.throws(() => parseDecision(JSON.stringify({ decision })));
});

test('unconfirmed corrections and already-in-list claims are rejected before streaming', () => {
  for (const text of [
    'Corrigi a tarefa para “Ir ao supermercado”.',
    'Já está na sua lista de tarefas.',
    'Atualizei sua tarefa.',
  ])
    assert.throws(() => parseDecision(JSON.stringify({ decision: { type: 'reply', text } })), /sem uma ação/);
});

test('ambiguous corrections ask without changing tasks; unrelated past speech is only a reply', async () => {
  for (const phrase of ['Eu quis dizer outra coisa, corrige isso.', 'Eu falei com minha mãe ontem.']) {
    const service = new AIService({
      fetchImpl: async (url) =>
        url.endsWith('/show')
          ? new Response('{}')
          : response({ type: 'reply', text: 'Qual tarefa você quer corrigir?' }),
    });
    const events = [];
    await service.chat({ ...config, tasks: [], messages: [{ role: 'user', content: phrase }] }, (event) =>
      events.push(event),
    );
    assert.equal(
      events.some((event) => ['task', 'task-update'].includes(event.type)),
      false,
    );
  }
  assert.equal(
    isActionRequest({ messages: [{ role: 'user', content: 'Na verdade, era supermercado.' }] }),
    true,
  );
});

test(
  'real Ollama resolves the reported correction to the existing task',
  { skip: !process.env.JARVIS_TEST_LOCAL_MODEL, timeout: 180000 },
  async () => {
    const state = workspace();
    const first = saveTask(state.update, 'Ir aos bem-mercados');
    const history = [
      { role: 'user', text: 'Esqueci de aos pirmercados, o Jarvis', status: 'done' },
      { role: 'assistant', status: 'done', ...first },
      { role: 'user', text: 'Eu falei que eu esqueci de ir ao supermercado.', status: 'done' },
    ];
    const events = [];
    await new AIService().chat(
      {
        ...config,
        model: process.env.JARVIS_TEST_LOCAL_MODEL,
        tasks: state.read().tasks,
        messages: chatMessages(history),
      },
      (event) => events.push(event),
    );
    const correction = events.find((event) => event.type === 'task-update');
    assert.ok(correction, 'model must emit a correction, not an actionless reply or new task');
    assert.equal(correction.id, first.receipt.id);
    assert.match(correction.title.toLowerCase(), /supermercado/);
    assert.equal(events.at(-1).type, 'done');
    updateTask(state.update, correction.id, correction.title, correction.previousTitle);
    assert.equal(state.read().tasks.length, 1);
  },
);
