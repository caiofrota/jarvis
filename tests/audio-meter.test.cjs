const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AudioMeter } = require('../dist/features/voice/audio-meter.js');
const { AudioOutput } = require('../dist/features/voice/audio-output.js');

test('análise acompanha amostras e bandas reais, com silêncio sem reprodução', () => {
  let level = 128,
    frequency = 0,
    connections = 0;
  const input = {
    connect() {
      connections++;
    },
    getByteTimeDomainData(data) {
      data.fill(level);
    },
    getByteFrequencyData(data) {
      data.fill(frequency);
    },
  };
  const meter = new AudioMeter();
  const context = { destination: {}, createAnalyser: () => input };
  meter.attach(context);
  meter.attach(context);
  assert.equal(connections, 1);
  assert.equal(meter.sample(true).level, 0);
  level = 160;
  frequency = 128;
  const frame = meter.sample(true);
  assert.equal(frame.level, 0.75);
  assert.ok(Math.abs(frame.mid - 128 / 255) < 1e-8);
  assert.equal(meter.sample(false).level, 0);
  level = 128;
  frequency = 0;
  assert.deepEqual(meter.sample(true), { level: 0, bass: 0, mid: 0, high: 0 });
});

test('medidor permanece em uma única rota de saída e não mantém energia após parar', async () => {
  const previous = global.window;
  const connections = [];
  const input = {
    connect(to) {
      connections.push(['meter', to]);
    },
    getByteTimeDomainData(data) {
      data.fill(150);
    },
    getByteFrequencyData(data) {
      data.fill(100);
    },
  };
  const destination = {};
  let source;
  global.window = {
    AudioContext: class {
      constructor() {
        this.destination = destination;
        this.currentTime = 0;
        this.state = 'running';
      }
      async resume() {}
      createAnalyser() {
        return input;
      }
      createBufferSource() {
        source = {
          connect(to) {
            connections.push(['source', to]);
          },
          disconnect() {},
          start() {},
          stop() {
            this.onended();
          },
        };
        return source;
      }
    },
  };
  try {
    const output = new AudioOutput();
    await output.unlock();
    await output.unlock();
    const playing = output.play({ duration: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(connections, [
      ['meter', destination],
      ['source', input],
    ]);
    assert.ok(output.visualFrame().level > 0);
    output.stop();
    await playing;
    assert.equal(output.visualFrame().level, 0);
  } finally {
    global.window = previous;
  }
});
