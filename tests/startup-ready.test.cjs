const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../dist/lib/ai.js');
const req = { provider: 'local', model: 'small', profile: 'eco' };
const json = (x) => new Response(JSON.stringify(x));
test('repeated preparation reuses recent loading but renews after the interval', async () => {
  const calls = [];
  const ai = new AIService({
    fetchImpl: async (url, o) => {
      calls.push({ url, body: JSON.parse(o.body) });
      return json({});
    },
  });
  await ai.warm(req);
  await ai.warm(req);
  assert.equal(calls.filter((c) => c.url.endsWith('/generate')).length, 1);
  ai.warmed.until = 0;
  await ai.warm(req);
  assert.equal(calls.filter((c) => c.url.endsWith('/generate')).length, 2);
  await ai.warm({ ...req, profile: 'balanced' });
  assert.equal(calls.at(-1).body.options.num_ctx, 4096);
  await ai.warm({ ...req, model: 'other' });
  assert.equal(calls.at(-1).body.model, 'other');
});
test('simultaneous preparation of different models does not report false readiness', async () => {
  let release;
  const loaded = [];
  const ai = new AIService({
    fetchImpl: async (url, o) => {
      const body = JSON.parse(o.body);
      if (url.endsWith('/generate')) {
        loaded.push(body.model);
        if (body.model === 'small') await new Promise((r) => (release = r));
      }
      return json({});
    },
  });
  const one = ai.warm(req);
  await new Promise((r) => setImmediate(r));
  const two = ai.warm({ ...req, model: 'other' });
  release();
  await Promise.all([one, two]);
  assert.deepEqual(loaded, ['small', 'other']);
});
test('preparation failure allows a retry instead of marking the model ready', async () => {
  let failing = true;
  const ai = new AIService({
    fetchImpl: async () => {
      if (failing) throw Error('offline');
      return json({});
    },
  });
  await assert.rejects(ai.warm(req));
  failing = false;
  assert.equal((await ai.warm(req)).ready, true);
});
