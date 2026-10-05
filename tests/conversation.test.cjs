const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConversationTurns, isPlaybackEcho } = require('../dist/features/voice/conversation-turns.js');
const { SpeechPipeline } = require('../dist/features/voice/speech-pipeline.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('conversation sends successive utterances without a button and preserves interruption during the response', async () => {
  const sent = [];
  let busy = false,
    stopped = 0;
  const turns = new ConversationTurns({
    busy: () => busy,
    speaking: () => busy,
    spokenText: () => 'Posso explicar como funciona.',
    stop: async () => {
      stopped++;
      busy = false;
    },
    send: async (text) => {
      sent.push(text);
      busy = true;
    },
    onError: assert.fail,
  });
  await turns.utterance('Boa tarde');
  turns.partial('Espere, quero');
  await turns.utterance('Espere, quero abrir o PowerPoint');
  assert.equal(stopped, 1);
  assert.deepEqual(sent, ['Boa tarde', 'Espere, quero abrir o PowerPoint']);
});
test('interruption cancels the response before the next send and ending blocks late transcription', async () => {
  let resolve,
    sent = 0,
    stopped = 0;
  const turns = new ConversationTurns({
    busy: () => true,
    speaking: () => false,
    spokenText: () => '',
    stop: () => {
      stopped++;
      return new Promise((r) => {
        resolve = r;
      });
    },
    send: async () => {
      sent++;
    },
    onError: assert.fail,
  });
  turns.speechStart();
  assert.equal(stopped, 0, 'audio energy alone must not cancel a pending reply');
  turns.partial('Mudei de ideia');
  const pending = turns.utterance('Mudei de ideia');
  assert.equal(stopped, 1);
  assert.equal(sent, 0);
  const release = resolve;
  turns.end();
  release();
  await pending;
  await turns.utterance('texto tardio');
  assert.equal(sent, 0);
});
test('microphone noise during generation does not cancel the pending action', async () => {
  let stops = 0;
  const turns = new ConversationTurns({
    busy: () => true,
    speaking: () => false,
    spokenText: () => '',
    stop: async () => {
      stops++;
    },
    send: async () => {},
    onError: assert.fail,
  });
  turns.speechStart();
  turns.partial('   ');
  assert.equal(stops, 0);
  turns.partial('Jarvis, espere');
  assert.equal(stops, 1, 'recognized interruption still cancels');
});
test('playback echo does not start a new turn or interrupt audio', async () => {
  let stops = 0,
    sends = 0;
  const turns = new ConversationTurns({
    busy: () => true,
    speaking: () => true,
    spokenText: () => 'O PowerPoint está instalado neste computador.',
    stop: async () => {
      stops++;
    },
    send: async () => {
      sends++;
    },
    onError: assert.fail,
  });
  turns.partial('O PowerPoint está instalado');
  await turns.utterance('O PowerPoint está instalado neste computador');
  assert.equal(stops, 0);
  assert.equal(sends, 0);
  assert.equal(isPlaybackEcho('Quero o Word', 'O PowerPoint está instalado'), false);
});
test('requested audio does not play when the user interrupts before it is ready', async () => {
  let resolve,
    plays = 0;
  const p = new SpeechPipeline({
    generate: () =>
      new Promise((r) => {
        resolve = r;
      }),
    play: async () => {
      plays++;
    },
  });
  p.finish('Primeira frase. ');
  await tick();
  p.cancel();
  resolve('audio');
  await tick();
  assert.equal(plays, 0);
});
