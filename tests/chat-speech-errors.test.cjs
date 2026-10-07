'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { chatMessages } = require('../dist/features/chat/conversation.js');

function controller(chat, overrides = {}) {
  const calls = [],
    states = [];
  const speech = Object.fromEntries(
    ['read', 'begin', 'feed', 'finish', 'stop'].map((name) => [
      name,
      (...args) => calls.push([name, ...args]),
    ]),
  );
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync('features/chat/useChat.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: module.exports,
    require: (name) => {
      if (name === 'react')
        return {
          useEffect: () => {},
          useRef: (current) => ({ current }),
          useState: (value) => [value, (next) => states.push(next)],
        };
      if (name === '../../client/api') return { getAPI: () => ({ chat, cancel: async () => {} }) };
      if (name === '../../client/storage') return { readStored: () => [] };
      if (name === '../../client/text') return { withoutEmoji: (value) => value };
      if (name === './conversation') return { chatMessages };
      if (name === '../../shared/chat-speech-policy')
        return require('../dist/shared/chat-speech-policy.js');
      throw new Error('Unexpected import: ' + name);
    },
  });
  const hook = module.exports.useChat({
    ai: { model: 'fake-model', config: { provider: 'cloud' }, ready: false },
    profile: 'eco',
    personalProfile: {},
    speech,
    actions: { execute: async () => 'Aberto.' },
    readTasks: () => [],
    onMissingModel: assert.fail,
    command: () => null,
    addTask: assert.fail,
    updateTask: assert.fail,
    checkTask: assert.fail,
    completeTask: assert.fail,
    ...overrides,
  });
  return { hook, calls, states };
}

test('spoken turns keep provider, transport, incomplete and executor errors visible but silent', async () => {
  for (const mode of ['provider', 'transport', 'incomplete', 'executor', 'local']) {
    const error = 'Technical error: invalid schema or unavailable service';
    const state = controller(
      async (_request, emit) => {
        if (mode === 'transport') throw new Error(error);
        emit({ type: 'delta', text: 'Uma resposta parcial.' });
        if (mode === 'provider') {
          emit({ type: 'error', message: error });
          assert.ok(
            state.calls.some(([name]) => name === 'stop'),
            'cancel audio immediately',
          );
        }
        if (mode === 'executor') {
          emit({ type: 'action', id: 'unknown-app', label: 'Aplicativo' });
          emit({ type: 'done', durationMs: 1 });
        }
      },
      {
        command: () => {
          if (mode === 'local') throw new Error(error);
          return null;
        },
        actions: {
          execute: async () => {
            throw new Error(error);
          },
        },
      },
    );
    await state.hook.send('Abra um aplicativo', true);
    assert.ok(
      state.calls.some(([name]) => name === 'stop'),
      mode,
    );
    assert.ok(!state.calls.some(([name]) => name === 'read' || name === 'finish'), mode);
    assert.ok(!state.calls.some((call) => call.includes(error)), mode);
    const history = state.states.findLast((value) => value?.messages);
    assert.equal(history.messages.at(-1).status, 'error');
    assert.ok(history.messages.at(-1).text);
  }
});

test('successful spoken replies still play while cancelled replies remain silent', async () => {
  for (const terminal of ['done', 'cancelled']) {
    const state = controller(async (_request, emit) => {
      emit({ type: 'delta', text: 'Olá, tudo bem?' });
      emit({ type: terminal, durationMs: 1 });
    });
    await state.hook.send('Olá', true);
    assert.equal(
      state.calls.some(([name]) => name === 'finish'),
      terminal === 'done',
    );
    assert.equal(
      state.calls.some(([name]) => name === 'stop'),
      terminal === 'cancelled',
    );
  }
});
