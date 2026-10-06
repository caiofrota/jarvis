'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs');
function harness() {
  let node;
  class AudioContext {
    constructor() {
      this.sampleRate = 16000;
      this.audioWorklet = { addModule: async () => {} };
      this.destination = {};
    }
    async resume() {}
    async close() {}
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
  }
  class AudioWorkletNode {
    constructor() {
      node = this;
      this.port = { postMessage: () => queueMicrotask(() => this.port.onmessage({ data: 'flushed' })) };
    }
    connect() {}
    disconnect() {}
  }
  const scope = {
    exports: {},
    require: require('node:module').createRequire(require.resolve('../dist/features/voice/local-capture.js')),
    AudioContext,
    AudioWorkletNode,
    Float32Array,
    ArrayBuffer,
    DataView,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../dist/features/voice/local-capture.js'), 'utf8'),
    scope,
  );
  return { api: scope.exports, feed: (samples) => node.port.onmessage({ data: samples }) };
}
test('uncertain speech is not submitted as a command and context is read for each request', async () => {
  const h = harness(),
    utterances = [],
    reviews = [],
    requests = [];
  let context = ['Preparar uma refeição'];
  const session = await h.api.capture({
    stream: {},
    recognitionContext: () => context,
    api: {
      transcribe: async (request) => {
        requests.push(request);
        return { text: 'Uma atividade desconhecida', needsReview: true };
      },
      cancelVoice: async () => {},
    },
    onText() {},
    onError(error) {
      throw new Error(error);
    },
    onReview: (message) => reviews.push(message),
    onUtterance: (text) => utterances.push(text),
  });
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((resolve) => setImmediate(resolve));
  context = ['Nova tarefa persistida'];
  h.feed(new Float32Array(14400));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(utterances, []);
  assert.equal(reviews.length, 1);
  assert.deepEqual(requests[0].context, ['Preparar uma refeição']);
  assert.deepEqual(requests.at(-1).context, context);
  session.cancel();
});
test('dictation cannot submit an uncertain transcript on stop', async () => {
  const h = harness(),
    reviews = [];
  const session = await h.api.capture({
    stream: {},
    api: {
      transcribe: async () => ({ text: 'Texto incerto', needsReview: true }),
      cancelVoice: async () => {},
    },
    onText() {},
    onError(error) {
      throw new Error(error);
    },
    onReview: (message) => reviews.push(message),
  });
  h.feed(new Float32Array(24000).fill(0.1));
  assert.equal(await session.stop(), '');
  assert.equal(reviews.length, 1);
});
test('final transcription supersedes an uncertain partial', async () => {
  const h = harness(),
    utterances = [];
  let calls = 0;
  const session = await h.api.capture({
    stream: {},
    api: {
      transcribe: async () => ({ text: 'Preparar a refeição', needsReview: ++calls === 1 }),
      cancelVoice: async () => {},
    },
    onText() {},
    onError(error) {
      throw new Error(error);
    },
    onUtterance: (text) => utterances.push(text),
  });
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((resolve) => setImmediate(resolve));
  h.feed(new Float32Array(14400));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(utterances, ['Preparar a refeição']);
  session.cancel();
});
test('transcription sends a segment while recording continues and preserves text on stop', async () => {
  const h = harness();
  let calls = 0,
    text = '';
  const capture = await h.api.capture({
    stream: {},
    api: {
      transcribe: async (request) => {
        calls++;
        assert.equal(request.provider, 'local');
        assert.equal(request.live, true);
        assert.equal(Buffer.from(request.audio, 'base64').toString('ascii', 0, 4), 'RIFF');
        return { text: 'Abra a calculadora' };
      },
      cancelVoice: async () => {},
    },
    onText: (value) => (text = value),
    onError: (e) => {
      throw new Error(e);
    },
  });
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.equal(text, 'Abra a calculadora');
  assert.equal(await capture.stop(), 'Abra a calculadora');
});
test('silence does not send segments to the recognizer', async () => {
  const h = harness();
  let calls = 0;
  const capture = await h.api.capture({
    stream: {},
    api: { transcribe: async () => calls++, cancelVoice: async () => {} },
    onText() {},
    onError() {},
  });
  h.feed(new Float32Array(32000));
  await capture.stop();
  assert.equal(calls, 0);
});
test('long responses are split so speech starts before all audio is ready', () => {
  const { api } = harness();
  const parts = api.chunks('Olá. ' + 'Uma resposta com várias palavras. '.repeat(20));
  assert.equal(parts[0], 'Olá.');
  assert.ok(parts.length > 1);
  assert.ok(parts.every((s) => s.length <= 180));
});

test('a pause sends a complete utterance, preserves partials, and receives another utterance', async () => {
  const h = harness(),
    utterances = [],
    partials = [];
  let starts = 0,
    transcriptions = 0;
  const session = await h.api.capture({
    stream: {},
    api: {
      transcribe: async () => ({ text: ++transcriptions <= 2 ? 'Abra o PowerPoint' : 'Agora o Word' }),
      cancelVoice: async () => {},
    },
    onText: (value) => partials.push(value),
    onError: assert.fail,
    onSpeechStart: () => starts++,
    onUtterance: (value) => utterances.push(value),
  });
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((r) => setImmediate(r));
  assert.equal(utterances.length, 0);
  assert.equal(partials.at(-1), 'Abra o PowerPoint');
  h.feed(new Float32Array(14400));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(utterances, ['Abra o PowerPoint']);
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((r) => setImmediate(r));
  h.feed(new Float32Array(14400));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(utterances, ['Abra o PowerPoint', 'Agora o Word']);
  assert.equal(starts, 2);
  session.cancel();
});
test('cloud mode sends audio only after each utterance ends with explicit consent', async () => {
  const h = harness();
  let calls = 0;
  const session = await h.api.capture({
    stream: {},
    provider: 'cloud',
    api: {
      transcribe: async (request) => {
        calls++;
        assert.equal(request.provider, 'cloud');
        assert.equal(request.consent, true);
        return { text: 'Olá' };
      },
      cancelVoice: async () => {},
    },
    onText() {},
    onError: assert.fail,
    onUtterance() {},
  });
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
  h.feed(new Float32Array(14400));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  session.cancel();
});
test('ElevenLabs sends each ended utterance once, with consent, and ignores playback audio', async () => {
  const h = harness(),
    requests = [],
    utterances = [];
  const session = await h.api.capture({
    stream: {},
    provider: 'elevenlabs',
    api: {
      transcribe: async (request) => {
        requests.push(request);
        return { text: 'Preparar uma refeição' };
      },
      cancelVoice: async () => {},
    },
    onText() {},
    onError: assert.fail,
    onUtterance: (text) => utterances.push(text),
  });
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 0);
  h.feed(new Float32Array(14400));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].provider, 'elevenlabs');
  assert.equal(requests[0].consent, true);
  assert.equal(requests[0].live, false);
  assert.deepEqual(utterances, ['Preparar uma refeição']);
  session.setPaused(true);
  h.feed(new Float32Array(24000).fill(0.1));
  h.feed(new Float32Array(14400));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  session.cancel();
});

test('capture preserves 240 ms before speech and the silence margin at the end', async () => {
  const h = harness(),
    recordings = [];
  const session = await h.api.capture({
    stream: {},
    api: {
      transcribe: async (request) => {
        recordings.push(Buffer.from(request.audio, 'base64'));
        return { text: 'Uma fala' };
      },
      cancelVoice: async () => {},
    },
    onText() {},
    onError: assert.fail,
  });
  h.feed(new Float32Array(10000).fill(0.001));
  h.feed(new Float32Array(24000).fill(0.1));
  await new Promise((resolve) => setImmediate(resolve));
  h.feed(new Float32Array(14400));
  await new Promise((resolve) => setImmediate(resolve));
  const pcm = recordings.at(-1);
  assert.equal(pcm.readUInt32LE(40) / 2, 3840 + 24000 + 14400);
  assert.equal(pcm.readInt16LE(44), 32);
  assert.equal(pcm.readInt16LE(44 + 3840 * 2), 3276);
  assert.equal(pcm.readInt16LE(pcm.length - 2), 0);
  session.cancel();
});
test('pausing capture discards in-flight transcription and does not process Jarvis audio', async () => {
  const h = harness(),
    texts = [];
  let finish,
    calls = 0;
  const session = await h.api.capture({
    stream: {},
    api: {
      transcribe: async () => {
        calls++;
        return await new Promise((resolve) => (finish = resolve));
      },
      cancelVoice: async () => {},
    },
    onText: (text) => texts.push(text),
    onError: assert.fail,
  });
  h.feed(new Float32Array(24000).fill(0.1));
  session.setPaused(true);
  h.feed(new Float32Array(24000).fill(0.1));
  finish({ text: 'Voz do Jarvis' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(texts, []);
  session.setPaused(false);
  h.feed(new Float32Array(24000).fill(0.1));
  finish({ text: 'Voz da pessoa' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(texts, ['Voz da pessoa']);
  session.cancel();
});
