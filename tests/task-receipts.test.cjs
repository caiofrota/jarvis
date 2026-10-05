'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../dist/lib/ai.js');
const { parseDecision } = require('../dist/lib/chat-decision.js');
const { commitStoredValue } = require('../dist/client/stored-value.js');
const { saveTask } = require('../dist/features/tasks/task-actions.js');
const { chatMessages } = require('../dist/features/chat/conversation.js');
const { localCommand } = require('../dist/features/chat/local-commands.js');

function workspace() {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const read = () => JSON.parse(storage.getItem('prefs') || '{"tasks":[]}');
  return {
    storage,
    read,
    update: (update) => commitStoredValue('prefs', update, { tasks: [] }, (x) => x, storage),
  };
}
const local = (decision) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify({ decision }) }, done: true }) + '\n');
const request = { provider: 'local', model: 'fixture', profile: 'balanced' };

test('colloquial spoken commands use validated decisions rather than plain conversation', async () => {
  for (const phrase of [
    'Jarvis, adiciona comprar pão',
    'Anota comprar café',
    'Bota comprar leite',
    'Inclui pagar a conta',
  ]) {
    let payload;
    const ai = new AIService({
      fetchImpl: async (url, options) => {
        if (url.endsWith('/show')) return new Response('{}');
        payload = JSON.parse(options.body);
        return local({ type: 'add_task', title: 'Comprar pão' });
      },
    });
    const events = [];
    await ai.chat({ ...request, voice: true, messages: [{ role: 'user', content: phrase }] }, (event) =>
      events.push(event),
    );
    assert.ok(payload.format, phrase);
    assert.equal(events.filter((event) => event.type === 'task').length, 1);
    assert.equal(events.at(-1).type, 'done');
  }
});

async function turn(ai, state, history, text, extra = {}) {
  history.push({ role: 'user', text, status: 'done' });
  const events = [];
  await ai.chat(
    { ...request, ...extra, messages: chatMessages(history), tasks: state.read().tasks },
    (event) => events.push(event),
  );
  const action = events.find((event) => event.type === 'task');
  const result = action
    ? saveTask(state.update, action.title)
    : {
        text: events
          .filter((event) => event.type === 'delta')
          .map((event) => event.text)
          .join(''),
      };
  history.push({ role: 'assistant', status: 'done', ...result });
  return { events, ...result };
}

test('two consecutive reminders create two records and distinct receipts after rereading', async () => {
  const state = workspace(),
    history = [],
    requests = [];
  const titles = ['Ir ao supermercado', 'Escovar os dentes'];
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return new Response('{}');
      requests.push(JSON.parse(options.body));
      return local({ type: 'add_task', title: titles[requests.length - 1] });
    },
  });
  const first = await turn(ai, state, history, 'eita, lembrei agora que esqueci de ir ao supermercado');
  const second = await turn(ai, state, history, 'eita, lembrei agora que esqueci de escovar os denste');
  assert.deepEqual(
    state.read().tasks.map((task) => task.text),
    titles,
  );
  assert.notEqual(first.receipt.id, second.receipt.id);
  assert.equal(second.receipt.status, 'saved');
  assert.equal(
    first.events.some((event) => event.type === 'delta'),
    false,
    'modelo não emite confirmação antecipada',
  );
  assert.match(requests[1].messages[1].content, /supermercado/);
  assert.equal(JSON.parse(requests[1].messages[2].content).result.status, 'saved');
  assert.match(requests[1].messages[0].content, /Ir ao supermercado/);
  assert.ok(requests[1].format.properties.decision.anyOf);
  assert.equal(requests[1].tools, undefined);
});

test('failure on the second record creates no confirmation and preserves the first task', () => {
  const state = workspace();
  saveTask(state.update, 'Ir ao supermercado');
  state.storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(() => saveTask(state.update, 'Escovar os dentes'), /Quota/);
  assert.deepEqual(
    state.read().tasks.map((task) => task.text),
    ['Ir ao supermercado'],
  );
  assert.throws(() => saveTask(() => null, 'Escovar os dentes'), /Não consegui salvar/);
});

test('recording reads the latest persisted value and avoids duplicates', () => {
  const state = workspace();
  const first = saveTask(state.update, 'Ir ao supermercado');
  const otherWindow = {
    tasks: [...state.read().tasks, { id: 'other', text: 'Fazer almoço', done: false }],
    notes: 'Manter',
  };
  state.storage.setItem('prefs', JSON.stringify(otherWindow));
  saveTask(state.update, 'Escovar os dentes');
  const duplicate = saveTask(state.update, 'ir ao supermercado');
  assert.equal(duplicate.receipt.status, 'existing');
  assert.equal(duplicate.receipt.id, first.receipt.id);
  assert.equal(state.read().tasks.length, 3);
  assert.equal(state.read().notes, 'Manter');
});

test('an actionless promise is rejected and repaired without exposing or speaking the promise', async () => {
  let calls = 0;
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show')
        ? new Response('{}')
        : ++calls === 1
          ? local({ type: 'reply', text: 'Adicionei “Escovar os dentes” à sua lista de tarefas.' })
          : local({ type: 'add_task', title: 'Escovar os dentes' }),
  });
  const state = workspace();
  const result = await turn(ai, state, [], 'Lembrei que falta escovar os dentes');
  assert.equal(calls, 2);
  assert.equal(
    result.events.some((event) => ['delta', 'replace'].includes(event.type)),
    false,
  );
  assert.equal(result.receipt.status, 'saved');
  assert.equal(state.read().tasks.length, 1);
});

test('repeated invalid responses and incomplete JSON never create an action or confirmation', async () => {
  for (const content of [
    'Adicionei “Escovar os dentes” à sua lista.',
    '{"decision":{"type":"add_task","title":"Escovar',
  ]) {
    const events = [];
    const ai = new AIService({
      fetchImpl: async (url) =>
        url.endsWith('/show')
          ? new Response('{}')
          : new Response(JSON.stringify({ message: { content }, done: true }) + '\n'),
    });
    await assert.rejects(
      ai.chat(
        { ...request, messages: [{ role: 'user', content: 'Lembrei de escovar os dentes' }] },
        (event) => events.push(event),
      ),
      /validar/,
    );
    assert.equal(
      events.some((event) => ['task', 'action', 'delta', 'replace'].includes(event.type)),
      false,
    );
  }
});

test('a conversation decision does not change the list and past claims bypass no local heuristic', async () => {
  const state = workspace();
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show')
        ? new Response('{}')
        : local({ type: 'reply', text: 'Entendi, isso já foi resolvido.' }),
  });
  const message = 'Lembrei que ontem esqueci de fazer o almoço, mas já resolvi.';
  assert.equal(
    localCommand(message, {
      tasks: [],
      addTask: () => assert.fail('Não deve inferir por palavra'),
      focus() {},
    }),
    null,
  );
  await turn(ai, state, [], message);
  assert.equal(state.read().tasks.length, 0);
});

test('validation rejects extra fields and arbitrary operations without interpreting text as an action', () => {
  for (const decision of [
    { type: 'add_task', title: 'Teste', execute: true },
    { type: 'exec', command: 'shutdown' },
  ])
    assert.throws(() => parseDecision(JSON.stringify({ decision })));
});

test(
  'real Ollama: two user phrases persist and past reports do not create tasks',
  { skip: !process.env.JARVIS_TEST_LOCAL_MODEL, timeout: 180000 },
  async () => {
    const { ActionService } = require('../dist/lib/actions.js');
    const catalog = new ActionService().list();
    const installedApps = [...catalog.items, ...catalog.apps]
      .filter((item) => item.kind === 'app' && item.available)
      .map((item) => item.label)
      .slice(0, 100);
    const state = workspace(),
      history = [],
      ai = new AIService();
    const config = { model: process.env.JARVIS_TEST_LOCAL_MODEL, installedApps };
    await turn(ai, state, history, 'eita, lembrei agora que esqueci de ir ao supermercado', config);
    await turn(ai, state, history, 'eita, lembrei agora que esqueci de escovar os denste', config);
    assert.deepEqual(
      state.read().tasks.map((task) => task.text.toLowerCase()),
      ['ir ao supermercado', 'escovar os dentes'],
    );
    await turn(
      ai,
      state,
      history,
      'Quando eu era criança eu esquecia de escovar os dentes, mas isso já passou.',
      config,
    );
    await turn(ai, state, history, 'Esqueci o nome daquele ator.', config);
    assert.equal(state.read().tasks.length, 2);
  },
);
