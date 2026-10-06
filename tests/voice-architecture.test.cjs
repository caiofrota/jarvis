'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { BrowserRecognition } = require('../dist/features/voice/browser-recognition.js');
const { SpeechPipeline } = require('../dist/features/voice/speech-pipeline.js');
const { AIService } = require('../dist/lib/ai.js');
const tick = () => new Promise((r) => setImmediate(r));
test('browser provides online partials without duplicating the final result', async () => {
  let instance;
  class Recognition {
    constructor() {
      instance = this;
      this.processLocally = true;
    }
    start() {}
    abort() {}
  }
  const values = [],
    utterances = [];
  const adapter = new BrowserRecognition({
    Recognition,
    onText: (v) => values.push(v),
    onUtterance: (v) => utterances.push(v),
  });
  adapter.start();
  assert.equal(instance.processLocally, false);
  const result = (text, final) => Object.assign([{ transcript: text }], { isFinal: final });
  instance.onresult({ resultIndex: 0, results: [result('abrir a', false)] });
  assert.equal(values.at(-1), 'abrir a');
  instance.onresult({ resultIndex: 0, results: [result('abrir a calculadora', true)] });
  instance.onresult({ resultIndex: 0, results: [result('abrir a calculadora', true)] });
  await new Promise((r) => setTimeout(r, 730));
  assert.deepEqual(utterances, ['abrir a calculadora']);
  adapter.stop();
});
test('online listening failure stops without migrating to another provider', () => {
  let r;
  class Recognition {
    constructor() {
      r = this;
    }
    start() {}
    abort() {}
  }
  let error = '';
  const adapter = new BrowserRecognition({ Recognition, onError: (e) => (error = e) });
  adapter.start();
  r.onerror({ error: 'network' });
  assert.equal(adapter.running, false);
  assert.match(error, /serviço online/);
});
test('voice uses short responses without changing context or reloading the model', async () => {
  let payload;
  const ai = new AIService({
    fetchImpl: async (url, opt) =>
      url.endsWith('/show')
        ? new Response('{"capabilities":["completion"]}')
        : ((payload = JSON.parse(opt.body)),
          new Response(
            JSON.stringify({
              message: { content: JSON.stringify({ decision: { type: 'reply', text: 'Olá.' } }) },
              done: true,
            }) + '\n',
          )),
  });
  await ai.chat(
    {
      provider: 'local',
      model: 'test',
      profile: 'full',
      voice: true,
      messages: [{ role: 'user', content: 'Olá' }],
    },
    () => {},
  );
  assert.equal(payload.options.num_ctx, 2048);
  assert.equal(payload.options.num_predict, 128);
  assert.match(payload.messages[0].content, /duas frases/);
  assert.match(payload.messages[0].content, /reconhecimento de voz, não de digitação/);
  assert.match(payload.messages[0].content, /peça esclarecimento/);
  assert.match(payload.messages[0].content, /não é um pedido para abri-lo/);
});
test('preparation sends no conversation and does not charge the cloud API', async () => {
  const calls = [];
  const ai = new AIService({
    fetchImpl: async (url, opt) => {
      calls.push({ url, payload: JSON.parse(opt.body) });
      return new Response(url.endsWith('/show') ? '{}' : '{"done":true}');
    },
  });
  await ai.warm({ provider: 'cloud' }, 'one');
  assert.equal(calls.length, 0);
  await ai.warm({ provider: 'local', model: 'test', profile: 'full' }, 'one');
  assert.equal(calls[1].payload.prompt, '');
  assert.equal(calls[1].payload.options.num_ctx, 8192);
  assert.equal(calls[1].payload.keep_alive, '30m');
  assert.equal(ai.status().preparing, false);
});
