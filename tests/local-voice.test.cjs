'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { VoiceService } = require('../dist/lib/voice.js');
const { LocalVoiceService } = require('../dist/lib/local-voice.js');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
test('free local voice needs no key and never uses the network adapter', async () => {
  const calls = [];
  const v = new VoiceService({
    ai: { cloudKey: '' },
    fetchImpl: () => {
      throw new Error('Network forbidden');
    },
    local: {
      request: async (op, request, owner) => {
        calls.push({ op, owner });
        return op === 'speak' ? { audio: 'UklGRg==', mime: 'audio/wav' } : { text: 'abrir calculadora' };
      },
    },
  });
  assert.equal((await v.speak({ provider: 'local', text: 'Olá', speed: 1 }, 'one')).mime, 'audio/wav');
  assert.equal((await v.transcribe({ provider: 'local', audio: 'AAAA' }, 'one')).text, 'abrir calculadora');
  assert.deepEqual(calls, [
    { op: 'speak', owner: 'one' },
    { op: 'transcribe', owner: 'one' },
  ]);
});
test('installation failure is visible and allows a retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-'));
  const v = new LocalVoiceService({ root: dir, dataDir: dir });
  let attempts = 0;
  v.setup = async () => {
    attempts++;
    throw new Error('Download interrompido');
  };
  assert.equal(v.install().installing, true);
  await new Promise((r) => setImmediate(r));
  assert.equal(v.status().installing, false);
  assert.match(v.status().error, /Download/);
  v.install();
  await new Promise((r) => setImmediate(r));
  assert.equal(attempts, 2);
  fs.rmdirSync(dir);
});
test('local cancellation affects only the correct window and operation', () => {
  const v = new LocalVoiceService();
  let killed = 0,
    rejected = 0;
  v.child = { kill: () => killed++ };
  v.pending = { owner: 'one', op: 'transcribe', reject: () => rejected++ };
  assert.equal(v.cancel('two', 'transcribe'), false);
  assert.equal(v.cancel('one', 'speak'), false);
  assert.equal(v.cancel('one', 'transcribe'), true);
  assert.equal(killed, 0);
  assert.equal(rejected, 0);
  assert.equal(v.pending.cancelled, true);
});
