const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  windowsRegisteredTargets,
  deduplicateApplicationTargets,
  ActionService,
} = require('../dist/lib/actions.js');
const { resolveTarget } = require('../dist/shared/target-resolver.js');
const { VoiceService } = require('../dist/lib/voice.js');

const rows = [
  { Name: 'CorelDRAW 2019 (64-Bit)', AppID: 'Corel.Draw.x64.21' },
  { Name: 'Visual Studio Code', AppID: 'Microsoft.VisualStudioCode' },
  { Name: 'Spotify', AppID: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
  { Name: 'WhatsApp', AppID: '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App' },
  { Name: 'WhatsApp', AppID: 'com.squirrel.WhatsApp.WhatsApp' },
  { Name: 'WhatsApp Web (1)', AppID: 'Chrome._crx_hnpfjngllnfapefoaidbinmjnm' },
];

test('registered Windows apps resolve canonical product names without guessing corrupt transcripts', () => {
  const catalog = windowsRegisteredTargets(rows, 'explorer.exe');
  assert.equal(resolveTarget('Corel Draw', catalog).label, 'CorelDRAW 2019 (64-Bit)');
  assert.equal(resolveTarget('Visual Studio Code', catalog).label, 'Visual Studio Code');
  assert.equal(resolveTarget('Spotify', catalog).type, 'action');
  const unfamiliar = windowsRegisteredTargets(
    { Name: 'ExampleStudio 2030', AppID: 'Example.NewApp' },
    'explorer.exe',
  );
  assert.equal(resolveTarget('Example Studio', unfamiliar).type, 'action');
  assert.equal(resolveTarget('WhatsApp', catalog).type, 'action');
  assert.equal(resolveTarget('WhatsApp Web', catalog).type, 'reply');
  for (const name of ['Buroca grau', 'Coral Drone', 'Vescolde']) {
    assert.equal(resolveTarget(name, catalog).type, 'reply');
  }
});

test('Store launch uses only the registered ID and the existing prepared-action boundary', async () => {
  const catalog = windowsRegisteredTargets(rows, 'explorer.exe');
  const calls = [];
  const service = new ActionService({
    catalog,
    launcher: async (...args) => calls.push(args),
    environment: { restricted: false },
  });
  const target = resolveTarget('WhatsApp', catalog);
  const owner = 'windows-test';
  const prepared = service.prepare(target.id, owner);
  await service.execute(prepared.token, owner);
  assert.deepEqual(calls, [
    ['explorer.exe', ['shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App']],
  ]);
});

test('registration parsing rejects malformed IDs, deduplicates and handles singleton output', () => {
  assert.equal(windowsRegisteredTargets(rows[0], 'explorer.exe').length, 1);
  assert.equal(
    windowsRegisteredTargets([rows[0], rows[0], { Name: 'Bad', AppID: 'bad\ncommand' }, null], 'explorer.exe')
      .length,
    1,
  );
});

test('catalog deduplication keeps one authoritative built-in application', () => {
  const catalog = deduplicateApplicationTargets([
    {
      id: 'calculator',
      label: 'Calculadora',
      kind: 'app',
      target: 'calc.exe',
      command: 'calc.exe',
      args: [],
      available: true,
    },
    {
      id: 'installed-app-calculator',
      label: 'Calculadora',
      kind: 'app',
      target: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
      command: 'explorer.exe',
      args: ['shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'],
      available: true,
    },
  ]);
  assert.deepEqual(
    catalog.map((item) => item.id),
    ['installed-app-calculator'],
  );
  assert.equal(
    deduplicateApplicationTargets([
      { ...catalog[0], id: 'installed-app-a', target: 'ExampleA' },
      { ...catalog[0], id: 'installed-app-b', target: 'ExampleB' },
    ]).length,
    2,
  );
});

test('recognition context is derived at runtime, not a product dictionary or renderer override', async () => {
  const calls = [];
  let vocabulary = ['Assistente Exemplo', 'Editor Desconhecido'];
  const voice = new VoiceService({
    vocabulary: () => vocabulary,
    local: {
      request: async (...args) => {
        calls.push(args);
        return { text: 'texto original' };
      },
    },
  });
  const request = {
    provider: 'local',
    audio: 'AAAA',
    mime: 'audio/wav',
    vocabulary: ['não confiar no cliente'],
  };
  assert.deepEqual(await voice.transcribe(request, 'test'), { text: 'texto original' });
  assert.deepEqual(calls[0][1].vocabulary, vocabulary);
  vocabulary = ['Aplicativo Recém Instalado'];
  await voice.transcribe(request, 'test');
  assert.deepEqual(calls[1][1].vocabulary, vocabulary);
  assert.equal(request.vocabulary[0], 'não confiar no cliente');
});
