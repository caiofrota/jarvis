'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { ActionService } = require('../dist/lib/actions.js');
const { VoiceService, MAX_AUDIO_BYTES } = require('../dist/lib/voice.js');
const { createServer } = require('../dist/server.js');
const item = {
  id: 'calculator',
  label: 'Calculadora',
  kind: 'app',
  target: '/allowed/calc',
  command: '/allowed/calc',
  args: [],
  available: true,
};
const audio = {
  provider: 'cloud',
  consent: true,
  mime: 'audio/webm',
  audio: Buffer.alloc(100, 1).toString('base64'),
};
test('ações aceitam apenas catálogo, nunca texto executável ou caminhos arbitrários', () => {
  const service = new ActionService({ environment: { restricted: false }, catalog: [item] });
  for (const id of ['cmd.exe', 'calculator && shutdown', '../../shell', {}, null])
    assert.throws(() => service.prepare(id, 'one'), /disponível/);
  assert.equal(service.history.length, 0);
});
test('token interno é obrigatório, vinculado à janela e de uso único', async () => {
  const launched = [],
    service = new ActionService({
      environment: { restricted: false },
      catalog: [item],
      launcher: async (...a) => launched.push(a),
    });
  const prepared = service.prepare('calculator', 'one');
  assert.equal(launched.length, 0);
  await assert.rejects(service.execute(prepared.token, 'two'), /inválida/);
  assert.equal((await service.execute(prepared.token, 'one')).status, 'sent');
  assert.deepEqual(launched, [['/allowed/calc', []]]);
  await assert.rejects(service.execute(prepared.token, 'one'), /inválida/);
  assert.equal(launched.length, 1);
});
test('solicitação expirada, cancelada ou substituída não executa', async () => {
  let now = 100;
  const service = new ActionService({
    environment: { restricted: false },
    catalog: [item],
    now: () => now,
    launcher: async () => assert.fail('Não deveria executar'),
  });
  const expired = service.prepare('calculator', 'one');
  now += 120001;
  await assert.rejects(service.execute(expired.token, 'one'), /expirou/);
  const cancelled = service.prepare('calculator', 'one');
  service.cancel('two');
  service.cancel('one');
  await assert.rejects(service.execute(cancelled.token, 'one'), /inválida/);
  const old = service.prepare('calculator', 'one');
  service.prepare('calculator', 'one');
  await assert.rejects(service.execute(old.token, 'one'), /inválida/);
});
test('cliques simultâneos não duplicam e falha registra erro', async () => {
  let finish;
  const wait = new Promise((r) => (finish = r));
  let calls = 0;
  const service = new ActionService({
    environment: { restricted: false },
    catalog: [item],
    launcher: async () => {
      calls++;
      await wait;
      throw new Error('bloqueado');
    },
  });
  const p = service.prepare('calculator', 'one'),
    running = service.execute(p.token, 'one');
  await assert.rejects(service.execute(p.token, 'one'), /inválida/);
  finish();
  await assert.rejects(running, /bloqueado/);
  assert.equal(calls, 1);
  assert.equal(service.list().history[0].status, 'error');
});
test('voz exige consentimento, chave, formato e limite antes da rede', async () => {
  let calls = 0;
  const ai = { cloudKey: 'fake' },
    service = new VoiceService({
      ai,
      fetchImpl: async () => {
        calls++;
        throw new Error('unexpected');
      },
    });
  for (const invalid of [
    { ...audio, consent: false },
    { ...audio, provider: 'unsupported' },
    { ...audio, mime: 'text/plain' },
    { ...audio, audio: '!!!!' },
    { ...audio, audio: 'A'.repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) },
  ])
    await assert.rejects(service.transcribe(invalid, 'one'));
  ai.cloudKey = '';
  await assert.rejects(service.transcribe(audio, 'one'), /chave/);
  assert.equal(calls, 0);
});
test('transcrição envia somente gravação e recebe texto sem persistir áudio', async () => {
  let received;
  const ai = { cloudKey: 'fake-secret' },
    service = new VoiceService({
      ai,
      fetchImpl: async (url, options) => {
        received = { url, options };
        return new Response('{"text":" abrir calculadora "}');
      },
    });
  const result = await service.transcribe(audio, 'one');
  assert.equal(result.text, 'abrir calculadora');
  assert.equal(received.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(received.options.headers.Authorization, 'Bearer fake-secret');
  const form = received.options.body;
  assert.deepEqual([...form.keys()], ['file', 'model', 'language', 'response_format']);
  assert.equal(form.get('file').type, 'audio/webm');
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(service.active, null);
});
test('voz limita concorrência e cancelamento à janela correta', async () => {
  let start, signal;
  const ready = new Promise((r) => (start = r));
  const service = new VoiceService({
    ai: { cloudKey: 'fake' },
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      start();
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  const running = service.transcribe(audio, 'one');
  await ready;
  assert.equal(service.cancel('two'), false);
  assert.equal(signal.aborted, false);
  await assert.rejects(service.transcribe(audio, 'two'), /andamento/);
  assert.equal(service.cancel('one'), true);
  await assert.rejects(running, /interrompida/);
  assert.equal(service.active, null);
});
test('voz trata chave inválida, quota e transcrição vazia', async () => {
  for (const [response, message] of [
    [new Response('{}', { status: 401 }), /Chave/],
    [new Response('{}', { status: 429 }), /saldo/],
    [new Response('{"text":""}'), /Nenhuma fala/],
  ]) {
    const service = new VoiceService({ ai: { cloudKey: 'fake' }, fetchImpl: async () => response });
    await assert.rejects(service.transcribe(audio, 'one'), message);
    assert.equal(service.active, null);
  }
});
test('API de ações conserva token de uso único e rejeita origem externa', async () => {
  let launches = 0;
  const actions = new ActionService({
    environment: { restricted: false },
    catalog: [item],
    launcher: async () => launches++,
  });
  const server = createServer({ actions });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const token = (await (await fetch(base + '/api/session')).json()).token;
    const post = (route, data, extra = {}) =>
      fetch(base + '/api/' + route, {
        method: 'POST',
        headers: { 'X-Jarvis-Token': token, ...extra },
        body: JSON.stringify({ owner: 'one', ...data }),
      });
    assert.equal((await post('actions/execute', { token: 'made-up' })).status, 400);
    const prepared = await (await post('actions/prepare', { id: 'calculator' })).json();
    assert.equal(launches, 0);
    assert.equal(
      (await post('actions/execute', { token: prepared.token }, { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal((await post('actions/execute', { token: prepared.token })).status, 200);
    assert.equal(launches, 1);
    assert.equal((await post('actions/execute', { token: prepared.token })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
const { MicrophoneGate } = require('../dist/lib/permissions.js');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test('microfone desktop exige clique recente, página local e frame principal; câmera recusada', () => {
  let now = 100;
  const entry = path.resolve('test-app/index.html'),
    url = pathToFileURL(entry).href;
  const gate = new MicrophoneGate(entry, () => now),
    contents = { id: 1, isDestroyed: () => false, getURL: () => url };
  const details = { isMainFrame: true, requestingUrl: url, mediaTypes: ['audio'], mediaType: 'audio' };
  assert.equal(gate.allows(contents, 'media', details, 'request'), false);
  gate.set(1, true);
  assert.equal(gate.allows(contents, 'media', details, 'request'), true);
  assert.equal(gate.allows(contents, 'media', details, 'check'), true);
  for (const invalid of [
    { ...details, isMainFrame: false },
    { ...details, requestingUrl: 'https://example.com' },
    { ...details, mediaTypes: ['audio', 'video'] },
    { ...details, mediaTypes: [] },
    {},
  ])
    assert.equal(gate.allows(contents, 'media', invalid, 'request'), false);
  assert.equal(gate.allows(contents, 'notifications', details, 'request'), false);
  assert.equal(gate.allows(contents, 'media', { ...details, mediaType: 'video' }, 'check'), false);
  assert.equal(gate.allows({ ...contents, id: 2 }, 'media', details, 'request'), false);
  now += 75001;
  assert.equal(gate.allows(contents, 'media', details, 'request'), false);
  gate.set(1, true);
  gate.set(1, false);
  assert.equal(gate.allows(contents, 'media', details, 'check'), false);
});
test('executor real inicia processo sem janela e detecta saída de erro', async () => {
  const service = new ActionService({
    environment: { restricted: false },
    catalog: [
      { ...item, command: process.execPath, args: ['-e', 'process.exit(0)'] },
      { ...item, id: 'fail', command: process.execPath, args: ['-e', 'process.exit(7)'] },
    ],
  });
  assert.equal((await service.execute(service.prepare('calculator', 'one').token, 'one')).status, 'sent');
  await assert.rejects(service.execute(service.prepare('fail', 'one').token, 'one'), /recusou/);
});
