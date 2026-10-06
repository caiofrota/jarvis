const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../dist/lib/ai.js');
const { parseDecision, isActionRequest } = require('../dist/lib/chat-decision.js');
const { readWorkspaceTasks } = require('../dist/features/workspace/task-state.js');
const { saveTask, checkTask, completeTask } = require('../dist/features/tasks/task-actions.js');
const { commitStoredValue } = require('../dist/client/stored-value.js');
const { defaults, validatePrefs } = require('../dist/features/workspace/preferences.js');
const { sharedPreferencesKey } = require('../dist/features/workspace/window-layout.js');
const { chatMessages } = require('../dist/features/chat/conversation.js');

function workspace() {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const update = (change) =>
    commitStoredValue(sharedPreferencesKey, change, defaults, validatePrefs, storage);
  return { storage, update, read: () => readWorkspaceTasks(storage) };
}
const request = { provider: 'local', model: 'fixture', profile: 'balanced', voice: true };
const response = (decision) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify({ decision }) }, done: true }) + '\n');

test('manual deletion overrides old conversation receipts and lookup never recreates the task', async () => {
  const state = workspace();
  const first = saveTask(state.update, 'Ir ao supermercado');
  const history = [
    { role: 'user', text: 'Esqueci de ir ao supermercado', status: 'done' },
    { role: 'assistant', status: 'done', ...first },
    { role: 'user', text: 'Essa tarefa ainda está na lista?', status: 'done' },
  ];
  state.update((current) => ({ ...current, tasks: [] }));
  let payload;
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return new Response('{}');
      payload = JSON.parse(options.body);
      return response({ type: 'check_task', title: 'Ir ao supermercado' });
    },
  });
  const events = [];
  await ai.chat({ ...request, tasks: state.read(), messages: chatMessages(history) }, (event) =>
    events.push(event),
  );
  assert.match(payload.messages[0].content, /"tasks":\[\]/);
  const lookup = events.find((event) => event.type === 'task-check');
  const result = checkTask(state.read, lookup.title);
  assert.equal(result.receipt.status, 'absent');
  assert.match(result.text, /Não encontrei/);
  assert.equal(state.read().length, 0);
  assert.equal(
    events.some((event) => ['task', 'task-complete'].includes(event.type)),
    false,
  );
});

test('query rereads storage after generation and can report present, completed and absent without writes', () => {
  const state = workspace();
  const added = saveTask(state.update, 'Ir ao supermercado');
  const raw = state.storage.getItem(sharedPreferencesKey);
  assert.equal(checkTask(state.read, added.receipt.title).receipt.done, false);
  assert.equal(state.storage.getItem(sharedPreferencesKey), raw);
  completeTask(state.update, added.receipt.id, added.receipt.title);
  assert.equal(checkTask(state.read, added.receipt.title).receipt.done, true);
  state.update((current) => ({ ...current, tasks: [] }));
  assert.equal(checkTask(state.read, added.receipt.title).receipt.status, 'absent');
});

test('completed supermarket report emits completion and saves done before confirming', async () => {
  const state = workspace();
  const added = saveTask(state.update, 'Ir ao supermercado');
  saveTask(state.update, 'Pagar aluguel');
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show') ? new Response('{}') : response({ type: 'complete_task', id: added.receipt.id }),
  });
  const events = [];
  await ai.chat(
    { ...request, tasks: state.read(), messages: [{ role: 'user', content: 'Eu já fui ao supermercado' }] },
    (event) => events.push(event),
  );
  const completion = events.find((event) => event.type === 'task-complete');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(
    events.some((event) => event.type === 'delta'),
    false,
  );
  const result = completeTask(state.update, completion.id, completion.title);
  assert.equal(result.receipt.status, 'completed');
  assert.equal(state.read()[0].done, true);
  assert.equal(state.read()[1].done, false);
  assert.equal(completeTask(state.update, completion.id, completion.title).receipt.status, 'already_done');
});

test('deleted, renamed and storage-failed tasks are never confirmed as completed', () => {
  const state = workspace();
  const added = saveTask(state.update, 'Ir ao supermercado');
  assert.throws(() => completeTask(state.update, 'deleted', added.receipt.title), /não existe/);
  assert.throws(() => completeTask(state.update, added.receipt.id, 'Título antigo'), /mudou/);
  state.storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(() => completeTask(state.update, added.receipt.id, added.receipt.title), /Quota/);
  assert.equal(state.read()[0].done, false);
  assert.throws(() => completeTask(() => null, added.receipt.id, added.receipt.title), /Não consegui salvar/);
});

test('short ambiguous continuation still receives current tasks but performs no action', async () => {
  const messages = [
    { role: 'assistant', content: 'Deseja que eu verifique a tarefa ou adicione outra?' },
    { role: 'user', content: 'Sim!' },
  ];
  assert.equal(isActionRequest({ messages }), true);
  let payload;
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return new Response('{}');
      payload = JSON.parse(options.body);
      return response({ type: 'reply', text: 'Você quer verificar ou adicionar?' });
    },
  });
  const events = [];
  await ai.chat({ ...request, tasks: [], messages }, (event) => events.push(event));
  assert.ok(payload.format);
  assert.match(payload.messages[0].content, /"tasks":\[\]/);
  assert.equal(
    events.some((event) => ['task', 'task-complete', 'task-check'].includes(event.type)),
    false,
  );
});

test('task state claims and completion promises are rejected; plain chat also gets current snapshot', async () => {
  for (const text of [
    'Você já tem uma tarefa para ir ao supermercado, deseja que eu verifique ou adicione outra?',
    'Você já tem essa tarefa na lista. Precisa que eu faça algo mais sobre isso?',
    'Entendido, vou considerar que a tarefa do supermercado está concluída.',
    'Sua lista está vazia.',
    'Não encontrei a tarefa.',
  ])
    assert.throws(() => parseDecision(JSON.stringify({ decision: { type: 'reply', text } })), /sem uma ação/);
  let payload;
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return new Response('{}');
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ message: { content: 'Bom dia.' }, done: true }) + '\n');
    },
  });
  await ai.chat({ ...request, tasks: [], messages: [{ role: 'user', content: 'Bom dia' }] }, () => {});
  assert.match(payload.messages[0].content, /"tasks":\[\]/);
});

test('invalid state and missing completion IDs fail instead of inventing an empty or completed list', async () => {
  assert.throws(() => readWorkspaceTasks({ getItem: () => '{broken' }));
  assert.throws(() => readWorkspaceTasks({ getItem: () => '{}' }), /consultar/);
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show') ? new Response('{}') : response({ type: 'complete_task', id: 'old-id' }),
  });
  const events = [];
  await assert.rejects(
    ai.chat(
      { ...request, tasks: [], messages: [{ role: 'user', content: 'Eu já fui ao supermercado' }] },
      (event) => events.push(event),
    ),
    /validar/,
  );
  assert.equal(
    events.some((event) => ['task', 'task-complete', 'delta'].includes(event.type)),
    false,
  );
  for (const decision of [
    { type: 'complete_task', id: '' },
    { type: 'complete_task', id: 'one', title: 'extra' },
    { type: 'check_task', title: '' },
  ])
    assert.throws(() => parseDecision(JSON.stringify({ decision })));
});
