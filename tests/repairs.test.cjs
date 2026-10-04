'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { AIService, PROFILES } = require('../dist/lib/ai.js');
const { ActionService } = require('../dist/lib/actions.js');
const { VoiceService } = require('../dist/lib/voice.js');
const { forSpeech, withoutEmoji } = require('../dist/shared/text.js');
const req = {
  targets: [
    { id: 'calculator', label: 'Calculadora', kind: 'app', available: true },
    { id: 'downloads', label: 'Downloads', kind: 'folder', available: true },
  ],
  provider: 'local',
  model: 'local',
  profile: 'balanced',
  messages: [{ role: 'user', content: 'Coloca a calculadora na tela pra eu usar' }],
};
const json = (x) => new Response(JSON.stringify(x));
test('IA local emite decisão de abertura sem executar antes do cliente', async () => {
  let payload;
  const events = [];
  const ai = new AIService({
    fetchImpl: async (url, opt) => {
      if (url.endsWith('/show')) return json({ capabilities: ['completion', 'tools'] });
      payload = JSON.parse(opt.body);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({ decision: { type: 'open_computer_target', target: 'Calculadora' } }),
          },
          done: true,
          eval_count: 10,
          load_duration: 1e8,
        }) + '\n',
      );
    },
  });
  await ai.chat(req, (e) => events.push(e));
  assert.ok(payload.format.properties.decision);
  assert.equal(payload.keep_alive, '10m');
  assert.equal(events.find((e) => e.type === 'action').id, 'calculator');
  assert.equal(events.find((e) => e.type === 'action').label, 'Calculadora');
  assert.equal(events.at(-1).loadMs, 100);
});
test('decisão na nuvem reúne JSON fragmentado', async () => {
  const events = [];
  const ai = new AIService({
    fetchImpl: async () =>
      new Response(
        [
          { choices: [{ delta: { content: '{"decision":{"type":"open_computer_target","tar' } }] },
          { choices: [{ delta: { content: 'get":"downloads"}}' }, finish_reason: 'stop' }] },
        ]
          .map((x) => 'data: ' + JSON.stringify(x) + '\n\n')
          .join('') + 'data: [DONE]\n\n',
      ),
  });
  ai.setKey('fake');
  await ai.chat({ ...req, provider: 'cloud' }, (e) => events.push(e));
  assert.equal(events.find((e) => e.type === 'action').id, 'downloads');
});
test('ferramenta inválida ou destino arbitrário não vira execução', async () => {
  for (const call of [
    { name: 'exec', arguments: { command: 'shutdown' } },
    { name: 'open_computer_target', arguments: { target: 'calculator', path: 'malicious' } },
  ]) {
    const events = [];
    const ai = new AIService({
      fetchImpl: async (url) =>
        url.endsWith('/show')
          ? json({ capabilities: ['completion', 'tools'] })
          : new Response(
              JSON.stringify({
                message: { content: JSON.stringify({ decision: { type: call.name, ...call.arguments } }) },
                done: true,
              }) + '\n',
            ),
    });
    await assert.rejects(ai.chat(req, (e) => events.push(e)));
    assert.equal(
      events.some((e) => e.type === 'action'),
      false,
    );
  }
});
test('respostas são instruídas sem emoji e o texto final remove emojis', async () => {
  let payload;
  const events = [];
  const ai = new AIService({
    fetchImpl: async (url, opt) =>
      url.endsWith('/show')
        ? json({ capabilities: ['completion'] })
        : ((payload = JSON.parse(opt.body)),
          new Response(
            JSON.stringify({
              message: { content: JSON.stringify({ decision: { type: 'reply', text: 'Pronto 😊' } }) },
              done: true,
            }) + '\n',
          )),
  });
  await ai.chat(req, (e) => events.push(e));
  assert.match(payload.messages[0].content, /sem emojis/);
  assert.equal(events.find((e) => e.type === 'delta').text, 'Pronto ');
  assert.equal(withoutEmoji('Cálculos 😊🚀'), 'Cálculos ');
});
test('leitura limpa Markdown e preserva conteúdo matemático', () => {
  assert.equal(forSpeech('**Cálculos**: 45 * 12 = 540. 😊'), 'Cálculos: 45 vezes 12 = 540.');
  assert.equal(forSpeech('# Título\n- **Primeiro**\n[site](https://example.com)'), 'Título\nPrimeiro\nsite');
  assert.match(forSpeech('```js\nalert(1)\n```'), /omitido/);
});
test('servidor restrito não registra falsa abertura', async () => {
  let calls = 0;
  const actions = new ActionService({
    environment: { restricted: true, message: 'Use Iniciar Jarvis.cmd' },
    catalog: [{ id: 'calculator', label: 'Calculadora', available: true, args: [], command: 'calc' }],
    launcher: async () => calls++,
  });
  const p = actions.prepare('calculator', 'owner');
  await assert.rejects(actions.execute(p.token, 'owner'), /Iniciar Jarvis/);
  assert.equal(calls, 0);
  assert.equal(actions.history.length, 0);
  assert.equal(actions.list().runtime.restricted, true);
});
test('voz neural requer consentimento e envia texto sem marcadores', async () => {
  let payload,
    calls = 0;
  const v = new VoiceService({
    ai: { cloudKey: 'fake' },
    fetchImpl: async (_url, opt) => {
      calls++;
      payload = JSON.parse(opt.body);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
    },
  });
  const input = { provider: 'cloud', consent: true, text: '**Cálculos** 😊', voice: 'marin', speed: 1 };
  await assert.rejects(v.speak({ ...input, consent: false }, 'one'), /Confirme/);
  assert.equal(calls, 0);
  const result = await v.speak(input, 'one');
  assert.equal(payload.input, 'Cálculos');
  assert.equal(payload.model, 'gpt-4o-mini-tts');
  assert.equal(result.mime, 'audio/mpeg');
  assert.equal(result.audio, 'AQID');
  assert.equal(v.speechActive, null);
});
test('cancelar voz neural pertence à janela que solicitou', async () => {
  let ready;
  const started = new Promise((r) => (ready = r));
  const v = new VoiceService({
    ai: { cloudKey: 'fake' },
    fetchImpl: async (_url, opt) => {
      ready();
      return new Promise((_, reject) =>
        opt.signal.addEventListener('abort', () => reject(opt.signal.reason), { once: true }),
      );
    },
  });
  const p = v.speak({ provider: 'cloud', consent: true, text: 'Olá', voice: 'cedar', speed: 1 }, 'one');
  await started;
  assert.equal(v.cancelSpeech('two'), false);
  assert.equal(v.cancelSpeech('one'), true);
  await assert.rejects(p, /interrompida/);
  assert.equal(v.speechActive, null);
});
test('perfis mantêm modelo por mais tempo sem tirar liberação do econômico', () => {
  assert.equal(PROFILES.eco.keepAlive, '2m');
  assert.equal(PROFILES.balanced.keepAlive, '10m');
  assert.equal(PROFILES.full.keepAlive, '30m');
});
