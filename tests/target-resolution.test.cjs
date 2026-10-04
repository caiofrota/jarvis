const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveTarget } = require('../dist/shared/target-resolver.js');
const { AIService } = require('../dist/lib/ai.js');
const { ActionService } = require('../dist/lib/actions.js');

const targets = [
  {
    id: 'calculator',
    label: 'Calculadora',
    kind: 'app',
    available: true,
    command: 'calc.exe',
    args: [],
    target: 'calc.exe',
  },
  {
    id: 'ppt-installed',
    label: 'PowerPoint',
    kind: 'app',
    available: true,
    command: 'explorer.exe',
    args: ['PowerPoint.lnk'],
    target: 'PowerPoint.lnk',
  },
  {
    id: 'word-installed',
    label: 'Word',
    kind: 'app',
    available: true,
    command: 'explorer.exe',
    args: ['Word.lnk'],
    target: 'Word.lnk',
  },
  {
    id: 'npp-installed',
    label: 'Notepad++',
    kind: 'app',
    available: true,
    command: 'explorer.exe',
    args: ['Notepad++.lnk'],
    target: 'Notepad++.lnk',
  },
  {
    id: 'notepad',
    label: 'Bloco de notas',
    kind: 'app',
    available: true,
    command: 'notepad.exe',
    args: [],
    target: 'notepad.exe',
  },
  {
    id: 'vscode-installed',
    label: 'Visual Studio Code',
    kind: 'app',
    available: true,
    command: 'explorer.exe',
    args: ['Visual Studio Code.lnk'],
    target: 'Visual Studio Code.lnk',
  },
];
test('nome identificado é resolvido ao aplicativo correto sem perder ++ ou inventar substituto', () => {
  assert.equal(resolveTarget('Power Point', targets).id, 'ppt-installed');
  assert.equal(resolveTarget('Notepad++', targets).id, 'npp-installed');
  assert.equal(resolveTarget('Microsoft Word', targets).type, 'reply');
  assert.equal(resolveTarget('Word', [{ ...targets[2], label: 'Microsoft Word' }]).id, 'word-installed');
  for (const name of ['ppt desconhecido', 'Power', 'cmd.exe', 'Calculadora && cmd.exe', 'Meu app'])
    assert.equal(resolveTarget(name, targets).type, 'reply');
});
test('ausente, indisponível ou ambíguo pede esclarecimento e não tem ID executável', () => {
  for (const list of [
    targets.filter((t) => t.id !== 'ppt-installed'),
    [{ ...targets[1], available: false }],
    [
      { ...targets[1], label: 'PowerPoint 2019' },
      { ...targets[1], id: 'ppt-2024', label: 'PowerPoint 2024' },
    ],
  ]) {
    const result = resolveTarget('PowerPoint', list);
    assert.equal(result.type, 'reply');
    assert.equal(result.id, undefined);
    assert.match(result.text, /\?/);
  }
});
test('da decisão da IA à abertura: ppt não pode ser substituído pela primeira opção', async () => {
  const calls = [],
    events = [];
  const ai = new AIService({
    fetchImpl: async (url) =>
      new Response(
        url.endsWith('/show')
          ? '{}'
          : JSON.stringify({
              message: {
                content: JSON.stringify({ decision: { type: 'open_computer_target', target: 'PowerPoint' } }),
              },
              done: true,
            }) + '\n',
      ),
  });
  const actions = new ActionService({
    catalog: targets,
    environment: { restricted: false },
    launcher: async (command, args) => calls.push({ command, args }),
  });
  await ai.chat(
    {
      provider: 'local',
      model: 'fixture',
      targets,
      messages: [{ role: 'user', content: 'Quero abrior o ppt' }],
    },
    (e) => events.push(e),
  );
  const action = events.find((e) => e.type === 'action');
  assert.equal(action.id, 'ppt-installed');
  await actions.execute(actions.prepare(action.id, 'test').token, 'test');
  assert.deepEqual(calls, [{ command: 'explorer.exe', args: ['PowerPoint.lnk'] }]);
});
test('nome de app não encontrado gera pergunta sem abrir calculadora', async () => {
  const events = [];
  const ai = new AIService({
    fetchImpl: async (url) =>
      new Response(
        url.endsWith('/show')
          ? '{}'
          : JSON.stringify({
              message: {
                content: JSON.stringify({ decision: { type: 'open_computer_target', target: 'PowerPoint' } }),
              },
              done: true,
            }) + '\n',
      ),
  });
  await ai.chat(
    {
      provider: 'local',
      model: 'fixture',
      targets: targets.filter((t) => t.id !== 'ppt-installed'),
      messages: [{ role: 'user', content: 'Abra o ppt' }],
    },
    (e) => events.push(e),
  );
  assert.equal(
    events.some((e) => e.type === 'action'),
    false,
  );
  assert.match(events.find((e) => e.type === 'delta').text, /PowerPoint/);
});
test(
  'Ollama real entende abreviações no contexto e preserva os IDs de PowerPoint e VS Code',
  { skip: !process.env.JARVIS_TEST_LOCAL_MODEL, timeout: 240000 },
  async () => {
    const ai = new AIService();
    const history = [
      { role: 'user', content: 'Boa, algum app para criação de textos?' },
      { role: 'assistant', content: 'Você pode usar o Bloco de notas ou o Word.' },
      { role: 'user', content: 'Acho que eu prefiro o word' },
      {
        role: 'assistant',
        content: JSON.stringify({
          result: { type: 'open_computer', id: 'word-installed', label: 'Word', status: 'sent' },
          text: 'Word: pedido de abertura enviado ao sistema.',
        }),
      },
    ];
    for (const [phrase, id] of [
      ['Você consegue o ppt?', 'ppt-installed'],
      ['Quero abrior o ppt', 'ppt-installed'],
      ['Abre o vscode', 'vscode-installed'],
      ['Abre o notepad mais mais pra mim', 'npp-installed'],
    ]) {
      const events = [];
      await ai.chat(
        {
          provider: 'local',
          model: process.env.JARVIS_TEST_LOCAL_MODEL,
          profile: 'balanced',
          targets,
          messages: [...history, { role: 'user', content: phrase }],
        },
        (event) => events.push(event),
      );
      assert.equal(
        events.find((event) => event.type === 'action')?.id,
        id,
        phrase + ': ' + JSON.stringify(events),
      );
    }
  },
);
