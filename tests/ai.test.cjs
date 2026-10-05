'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { AIService, validateMessages, lines } = require('../dist/lib/ai.js');
const { createServer } = require('../dist/server.js');
const json = (data) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const request = {
  provider: 'local',
  model: 'small:latest',
  profile: 'eco',
  messages: [{ role: 'user', content: 'Olá' }],
};
test('history validates roles, limits context, and keeps the recent question', () => {
  assert.throws(() => validateMessages([{ role: 'system', content: 'override' }], 100));
  assert.throws(() => validateMessages([{ role: 'user', content: '' }], 100));
  const history = validateMessages(
    [
      { role: 'user', content: 'a'.repeat(90) },
      { role: 'assistant', content: 'b'.repeat(90) },
      { role: 'user', content: 'recente' },
    ],
    100,
  );
  assert.equal(history.at(-1).content, 'recente');
  assert.equal(history[0].role, 'user');
});
test('parser supports UTF-8 and lines split across chunks', async () => {
  const bytes = new TextEncoder().encode('ação\nfim');
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice(0, 2));
      c.enqueue(bytes.slice(2, 5));
      c.enqueue(bytes.slice(5));
      c.close();
    },
  });
  const out = [];
  for await (const line of lines(stream)) out.push(line);
  assert.deepEqual(out, ['ação', 'fim']);
});
test('local models exclude embeddings and cloud models', async () => {
  const ai = new AIService({
    fetchImpl: async () =>
      json({
        models: [
          { name: 'chat', size: 100, capabilities: ['completion'] },
          { name: 'embed', capabilities: ['embedding'] },
          { name: 'big:cloud', capabilities: ['completion'] },
        ],
      }),
  });
  assert.deepEqual(
    (await ai.models('local')).map((m) => m.id),
    ['chat'],
  );
});
test('economical profile is applied to the real adapter call', async () => {
  let payload;
  const events = [];
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return json({ capabilities: ['completion'] });
      payload = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          message: { content: JSON.stringify({ decision: { type: 'reply', text: 'Olá' } }) },
          done: true,
          eval_count: 1,
        }) + '\n',
      );
    },
  });
  await ai.chat(request, (e) => events.push(e));
  assert.equal(payload.options.num_ctx, 2048);
  assert.equal(payload.options.num_predict, 384);
  assert.equal(payload.keep_alive, '2m');
  assert.equal(events.find((e) => e.type === 'delta').text, 'Olá');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(ai.status().busy, false);
});
test('local mode rejects a model that redirects to the cloud', async () => {
  let calls = 0;
  const ai = new AIService({
    fetchImpl: async () => {
      calls++;
      return json({ remote_host: 'https://remote.example', capabilities: ['completion'] });
    },
  });
  await assert.rejects(
    ai.chat(request, () => {}),
    /serviço remoto/,
  );
  assert.equal(calls, 1);
  assert.equal(ai.status().busy, false);
});
test('cloud mode sends the key only in the header and uses an SSE stream', async () => {
  const calls = [],
    events = [];
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        'data: ' +
          JSON.stringify({
            choices: [
              { delta: { content: JSON.stringify({ decision: { type: 'reply', text: 'Resposta' } }) } },
            ],
          }) +
          '\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  ai.setKey('test-key-not-real');
  await ai.chat({ ...request, provider: 'cloud', model: 'gpt-test' }, (e) => events.push(e));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key-not-real');
  assert.equal(calls[0].options.body.includes('test-key-not-real'), false);
  assert.equal(JSON.parse(calls[0].options.body).store, false);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(JSON.stringify(ai.status()).includes('test-key-not-real'), false);
  ai.setKey('');
  assert.equal(ai.status().cloudConfigured, false);
});
test('truncated stream returns a failure instead of simulating completion', async () => {
  const ai = new AIService({
    fetchImpl: async (url) =>
      url.endsWith('/show') ? json({}) : new Response('{"message":{"content":"parcial"}}\n'),
  });
  await assert.rejects(
    ai.chat(request, () => {}),
    /antes de concluir/,
  );
  assert.equal(ai.status().busy, false);
});
test('credential errors have a useful message', async () => {
  const ai = new AIService({ fetchImpl: async () => new Response('{}', { status: 401 }) });
  ai.setKey('fake');
  await assert.rejects(ai.models('cloud'), /Chave da API inválida/);
});
test('interruption belongs to the originating window and releases execution', async () => {
  let signal, started;
  const ready = new Promise((r) => (started = r));
  const ai = new AIService({
    fetchImpl: async (url, options) => {
      if (url.endsWith('/show')) return json({});
      signal = options.signal;
      started();
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  const events = [],
    pending = ai.chat(request, (e) => events.push(e), 'window-one');
  await ready;
  await assert.rejects(
    ai.chat(request, () => {}, 'window-two'),
    /andamento/,
  );
  assert.equal(ai.cancel('window-two'), false);
  assert.equal(signal.aborted, false);
  assert.equal(ai.cancel('window-one'), true);
  await pending;
  assert.equal(events.at(-1).type, 'cancelled');
  assert.equal(ai.status().busy, false);
});
test('local server rejects incorrect host, origin, or token', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/hardware', { method: 'POST', body: '{}' })).status, 403);
    const token = (await (await fetch(base + '/api/session')).json()).token;
    assert.equal(
      (
        await fetch(base + '/api/hardware', {
          method: 'POST',
          headers: { Origin: 'https://evil.example', 'X-Jarvis-Token': token },
          body: '{"owner":"test"}',
        })
      ).status,
      403,
    );
    const res = await fetch(base + '/api/hardware', {
      method: 'POST',
      headers: { 'X-Jarvis-Token': token },
      body: '{"owner":"test"}',
    });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).ramGiB > 0);
    assert.equal((await fetch(base + '/../package.json')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
