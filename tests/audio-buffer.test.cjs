const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SpeechPipeline } = require('../dist/features/voice/speech-pipeline.js');
const { AudioOutput } = require('../dist/features/voice/audio-output.js');
const { PlaybackGuard } = require('../dist/features/voice/playback-guard.js');
const { BrowserRecognition } = require('../dist/features/voice/browser-recognition.js');
const { ConversationTurns } = require('../dist/features/voice/conversation-turns.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('first block plays before knowing it is last; output adds tail margin on completion', async () => {
  const edges = [];
  let done;
  const completed = new Promise((resolve) => (done = resolve));
  const p = new SpeechPipeline({
    generate: async (text) => text,
    play: async (_value, edge) => edges.push(edge),
    onDone: done,
    onError: assert.fail,
  });
  p.feed('A'.repeat(319) + '. ');
  await tick();
  p.finish();
  await completed;
  assert.deepEqual(edges, [{ first: true, last: false }]);
});

test('short response is synthesized in one block without an artificial minimum reserve wait', async () => {
  const generated = [],
    played = [];
  let done;
  const completed = new Promise((resolve) => (done = resolve));
  const p = new SpeechPipeline({
    generate: async (text) => {
      generated.push(text);
      return text;
    },
    durationMs: () => 400,
    play: async (value) => {
      played.push(value);
    },
    onDone: done,
    onError: assert.fail,
  });
  p.feed('Olá. Como posso ajudar?');
  p.finish();
  await completed;
  assert.deepEqual(generated, ['Olá. Como posso ajudar?']);
  assert.deepEqual(played, generated);
});
test('reserve precedes playback and limits synthesis and scheduled audio to three blocks', async () => {
  let calls = 0,
    second;
  const played = [],
    end = [];
  const p = new SpeechPipeline({
    generate: async (text) => {
      const id = ++calls;
      if (id === 2) await new Promise((resolve) => (second = resolve));
      return { text, id };
    },
    durationMs: (value) => (value.id === 1 ? 600 : 900),
    play: (value) => {
      played.push(value.id);
      return new Promise((resolve) => end.push(resolve));
    },
    onError: assert.fail,
  });
  p.finish('Esta frase mantém palavras inteiras e evita pequenos cortes. '.repeat(70));
  await tick();
  await tick();
  assert.equal(calls, 2);
  assert.deepEqual(played, []);
  second();
  await tick();
  await tick();
  assert.deepEqual(played, [1, 2, 3]);
  assert.equal(calls, 3);
  end[0]();
  await tick();
  await tick();
  assert.equal(calls, 4);
  p.cancel();
  for (const resolve of end) resolve();
});
test('playback schedules the next buffer exactly at the previous end and cancels all buffers', async () => {
  const sources = [];
  let settings;
  class Context {
    constructor(options) {
      settings = options;
      this.currentTime = 10;
      this.destination = {};
      this.state = 'running';
    }
    async resume() {}
    async decodeAudioData() {
      return { duration: 1 };
    }
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        start(at) {
          this.at = at;
        },
        stop() {
          this.stopped = true;
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    }
  }
  const previous = global.window;
  global.window = { AudioContext: Context };
  try {
    const output = new AudioOutput();
    await output.unlock();
    assert.equal(settings.latencyHint, 'playback');
    const first = output.play({ duration: 0.6 }),
      second = output.play({ duration: 0.8 });
    await tick();
    assert.ok(Math.abs(sources[0].at - 10.02) < 0.00001);
    assert.ok(Math.abs(sources[1].at - (sources[0].at + 0.6)) < 0.00001);
    output.stop();
    await Promise.all([first, second]);
    assert.ok(sources.every((source) => source.stopped));
  } finally {
    global.window = previous;
  }
});
test('listening guard starts before audio and preserves the margin after the final block', async () => {
  const guard = new PlaybackGuard(),
    events = [];
  guard.subscribe((value) => events.push(value));
  guard.begin('Primeira frase.');
  guard.begin('Segunda frase.');
  assert.equal(guard.blocked, true);
  assert.match(guard.text, /Primeira frase.*Segunda frase/);
  guard.end();
  assert.equal(guard.blocked, true);
  await new Promise((resolve) => setTimeout(resolve, 930));
  assert.equal(guard.blocked, false);
  assert.deepEqual(events, [false, true, true, false]);
  guard.dispose();
});
test('browser discards delayed speaker output and reopens clean recognition', () => {
  const instances = [],
    texts = [];
  class Recognition {
    constructor() {
      instances.push(this);
    }
    start() {}
    abort() {
      this.aborted = true;
    }
  }
  const r = new BrowserRecognition({ Recognition, onText: (text) => texts.push(text) });
  const event = (text) => ({
    resultIndex: 0,
    results: [Object.assign([{ transcript: text }], { isFinal: true })],
  });
  r.start();
  const old = instances[0],
    late = old.onresult;
  r.setPaused(true);
  assert.equal(old.aborted, true);
  late(event('A própria voz do Jarvis'));
  r.setPaused(false);
  assert.equal(instances.length, 2);
  late(event('Eco atrasado'));
  instances[1].onresult(event('Agora sou eu falando'));
  assert.deepEqual(texts, ['Agora sou eu falando']);
  r.stop();
});
test('speaker volume does not interrupt playback and late echo text is ignored', async () => {
  let active = true,
    stops = 0,
    sends = 0;
  const turns = new ConversationTurns({
    busy: () => active,
    speaking: () => active,
    blocked: () => active,
    spokenText: () => 'O PowerPoint está disponível neste computador.',
    stop: async () => {
      stops++;
    },
    send: async () => {
      sends++;
    },
    onError: assert.fail,
  });
  turns.speechStart();
  turns.partial('Retorno do som');
  await turns.utterance('Retorno do som');
  active = false;
  await turns.utterance('PowerPoint está disponível neste computador');
  assert.equal(stops, 0);
  assert.equal(sends, 0);
  await turns.utterance('Agora abra o Word');
  assert.equal(sends, 1);
});
test('interruption during generation invalidates pending reserve without playing stale audio', async () => {
  let resolve,
    plays = 0;
  const p = new SpeechPipeline({
    generate: () => new Promise((r) => (resolve = r)),
    play: async () => plays++,
  });
  p.finish('Uma resposta completa.');
  await tick();
  p.cancel();
  resolve('audio');
  await tick();
  assert.equal(plays, 0);
});

test('guard silence is added only at the edges and preserves every sample', async () => {
  const sources = [];
  const buffer = (channels, length, rate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      duration: length / rate,
      getChannelData: (channel) => data[channel],
    };
  };
  class Context {
    constructor() {
      this.currentTime = 1;
      this.state = 'running';
      this.destination = {};
    }
    async resume() {}
    createBuffer(...args) {
      return buffer(...args);
    }
    createBufferSource() {
      const value = {
        connect() {},
        disconnect() {},
        start(at) {
          this.at = at;
        },
        stop() {
          this.onended?.();
        },
      };
      sources.push(value);
      return value;
    }
  }
  const original = global.window;
  global.window = { AudioContext: Context };
  try {
    const output = new AudioOutput();
    await output.unlock();
    const input = buffer(2, 1000, 1000);
    input.getChannelData(0).fill(0.25);
    input.getChannelData(1).fill(-0.5);
    const first = output.play(input, { first: true, last: false }),
      last = output.play(input, { first: false, last: true });
    await tick();
    assert.equal(sources[0].buffer.length, 1220);
    assert.equal(sources[1].buffer.length, 1320);
    assert.ok(
      sources[0].buffer
        .getChannelData(0)
        .slice(0, 220)
        .every((value) => value === 0),
    );
    assert.ok(
      sources[0].buffer
        .getChannelData(1)
        .slice(220)
        .every((value) => value === -0.5),
    );
    assert.ok(
      sources[1].buffer
        .getChannelData(0)
        .slice(0, 1000)
        .every((value) => value === 0.25),
    );
    assert.ok(
      sources[1].buffer
        .getChannelData(0)
        .slice(1000)
        .every((value) => value === 0),
    );
    assert.equal(sources[1].at, sources[0].at + 1.22);
    output.stop();
    await Promise.all([first, last]);
  } finally {
    global.window = original;
  }
});

test('already played speech adds tail silence without delaying the first sentence', async () => {
  const sources = [];
  const buffer = (channels, length, rate) => ({
    numberOfChannels: channels,
    length,
    sampleRate: rate,
    duration: length / rate,
    getChannelData: () => new Float32Array(length),
  });
  class Context {
    currentTime = 1;
    state = 'running';
    destination = {};
    async resume() {}
    createBuffer(...args) {
      return buffer(...args);
    }
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        start() {},
        stop() {
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    }
  }
  const original = global.window;
  global.window = { AudioContext: Context };
  try {
    const output = new AudioOutput();
    await output.unlock();
    const speaking = output.play(buffer(1, 2000, 1000), { first: true, last: false });
    await tick();
    assert.equal(sources[0].buffer.length, 2220);
    sources[0].onended();
    await speaking;
    const finishing = output.finish();
    await tick();
    assert.equal(sources.length, 2);
    assert.equal(sources[1].buffer.length, 320);
    assert.ok(sources[1].buffer.getChannelData(0).every((x) => x === 0));
    sources[1].onended();
    await finishing;
    await output.finish();
    assert.equal(sources.length, 2, 'margem não duplica');
    const next = output.play(buffer(1, 2000, 1000), { first: true, last: false });
    await tick();
    output.stop();
    await next;
    await output.finish();
    assert.equal(sources.length, 3, 'cancelamento não agenda silêncio nem áudio depois de parar');
  } finally {
    global.window = original;
  }
});
