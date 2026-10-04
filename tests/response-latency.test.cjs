const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../dist/lib/ai.js');
const { ReplyStream } = require('../dist/lib/reply-stream.js');
const { SpeechPipeline } = require('../dist/features/voice/speech-pipeline.js');
const tick = () => new Promise((r) => setImmediate(r));
const req = { provider: 'local', model: 'test', messages: [{ role: 'user', content: 'Explique as cores.' }] };
const line = (value) => new TextEncoder().encode(JSON.stringify(value) + '\n');
test('resposta validada chega antes do fim do stream, sem JSON nem duplicação', async () => {
  let controller;
  const events = [];
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show')
        ? new Response('{}')
        : new Response(
            new ReadableStream({
              start(c) {
                controller = c;
              },
            }),
          ),
  });
  const pending = ai.chat(req, (e) => events.push(e));
  await tick();
  controller.enqueue(
    line({ message: { content: '{"decision":{"type":"reply","text":"A luz se espalha na atmosfera. ' } }),
  );
  await tick();
  assert.equal(
    events
      .filter((e) => e.type === 'delta')
      .map((e) => e.text)
      .join(''),
    'A luz se espalha na atmosfera.',
  );
  assert.equal(
    events.some((e) => e.type === 'done'),
    false,
  );
  controller.enqueue(line({ message: { content: 'O azul se espalha mais."}}' }, done: true }));
  controller.close();
  await pending;
  assert.equal(
    events
      .filter((e) => e.type === 'delta')
      .map((e) => e.text)
      .join(''),
    'A luz se espalha na atmosfera. O azul se espalha mais.',
  );
  assert.equal(typeof events.at(-1).firstVisibleMs, 'number');
});
test('parser incremental preserva escapes, acentos e não publica ação ou confirmação inventada', () => {
  const out = [];
  const stream = new ReplyStream((t) => out.push(t));
  const raw = JSON.stringify({ decision: { type: 'reply', text: 'Uma palavra: "ação". Outra explicação.' } });
  for (let i = 1; i <= raw.length; i++) stream.push(raw.slice(0, i));
  assert.equal(out.join(''), 'Uma palavra: "ação". Outra explicação.');
  for (const decision of [
    { type: 'add_task', title: 'Almoço' },
    { type: 'open_computer_target', target: 'Word' },
    { type: 'reply', text: 'Adicionei a tarefa à sua lista.' },
  ]) {
    const values = [];
    const s = new ReplyStream((t) => values.push(t));
    const data = JSON.stringify({ decision });
    for (let i = 1; i <= data.length; i++) s.push(data.slice(0, i));
    assert.deepEqual(values, []);
  }
});
test('ação parcial ou stream truncado nunca executa ferramenta', async () => {
  const events = [];
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show')
        ? new Response('{}')
        : new Response(line({ message: { content: '{"decision":{"type":"add_task","title":"Almoço"}}' } })),
  });
  await assert.rejects(
    ai.chat(req, (e) => events.push(e)),
    /antes de concluir/,
  );
  assert.equal(
    events.some((e) => e.type === 'task' || e.type === 'action'),
    false,
  );
});
test('voz prepara primeira frase antes da conclusão e mantém margem no último bloco', async () => {
  const generated = [],
    edges = [];
  let done;
  const end = new Promise((r) => (done = r));
  const p = new SpeechPipeline({
    generate: async (text) => {
      generated.push(text);
      return text;
    },
    durationMs: () => 2000,
    play: async (_, edge) => edges.push(edge),
    onDone: done,
  });
  const first =
    'Esta primeira frase tem conteúdo suficiente para preparar uma fala natural sem cortar palavras no meio.';
  p.feed(first);
  await tick();
  await tick();
  assert.deepEqual(generated, [first]);
  assert.deepEqual(edges, [{ first: true, last: false }]);
  p.feed(' A segunda frase completa a explicação.');
  p.finish();
  await end;
  assert.equal(generated.join(' '), first + ' A segunda frase completa a explicação.');
  assert.equal(edges[0].first, true);
  assert.equal(edges.length, 2);
});
