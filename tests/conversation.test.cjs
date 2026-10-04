const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConversationTurns, isPlaybackEcho } = require('../dist/features/voice/conversation-turns.js');
const { SpeechPipeline } = require('../dist/features/voice/speech-pipeline.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('conversa envia falas sucessivas sem botão e não perde interrupção durante a resposta', async () => {
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
test('interrupção cancela resposta antes do próximo envio e encerramento bloqueia transcrição tardia', async () => {
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
test('eco da reprodução não inicia um novo turno nem interrompe áudio', async () => {
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
test('áudio já solicitado não toca se o usuário interrompe antes de ficar pronto', async () => {
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
