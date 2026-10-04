const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { localCommand } = require('../dist/features/chat/local-commands.js');
test('comandos locais preservam tarefas e não tratam pedidos de aplicativos como texto executável', () => {
  const added = [];
  const context = {
    tasks: [
      { text: 'Pendente', done: false },
      { text: 'Concluída', done: true },
    ],
    addTask: (t) => {
      added.push(t);
      return { text: 'Salvo: ' + t, receipt: { status: 'saved' } };
    },
    focus: () => {},
  };
  assert.equal(localCommand('Criar tarefa: Testar voz', context).receipt.status, 'saved');
  assert.deepEqual(added, ['Testar voz']);
  assert.match(localCommand('Minhas tarefas', context), /Pendente/);
  assert.doesNotMatch(localCommand('Minhas tarefas', context), /Concluída/);
  assert.equal(localCommand('Abra a calculadora para mim', context), null);
});
