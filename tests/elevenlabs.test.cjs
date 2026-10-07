'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VoiceService } = require('../dist/lib/voice.js');
const { ElevenLabsService } = require('../dist/lib/elevenlabs.js');
const { createServer } = require('../dist/server.js');
const audio = {
  provider: 'elevenlabs',
  consent: true,
  mime: 'audio/wav',
  audio: Buffer.alloc(64).toString('base64'),
};
const speech = {
  provider: 'elevenlabs',
  consent: true,
  text: 'Olá. Uma resposta em português.',
  voice: 'UnfamiliarVoice2030',
  speed: 1.1,
};

test('ElevenLabs transcribes without OpenAI credentials or paid optional features', async () => {
  let calls = 0;
  const voice = new VoiceService({
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
      assert.equal(init.headers['xi-api-key'], 'fake-eleven-key');
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.redirect, 'error');
      assert.equal(init.body.get('model_id'), 'scribe_v2');
      assert.equal(init.body.get('language_code'), 'por');
      assert.equal(init.body.get('keyterms'), null);
      assert.equal(init.body.get('transcript_edit'), null);
      assert.equal(init.body.get('diarize'), 'false');
      assert.equal(init.body.get('tag_audio_events'), 'false');
      assert.equal(init.body.get('file').size, 64);
      return Response.json({ text: ' Fazer uma refeição. ' });
    },
  });
  assert.deepEqual(voice.elevenlabs.setKey(' fake-eleven-key '), { configured: true });
  assert.deepEqual(await voice.transcribe(audio, 'one'), { text: 'Fazer uma refeição.' });
  assert.equal(calls, 1);
});

test('ElevenLabs uses the selected voice, Portuguese and Flash without rewriting product names', async () => {
  const voice = new VoiceService({
    fetchImpl: async (url, init) => {
      assert.equal(
        url,
        'https://api.elevenlabs.io/v1/text-to-speech/UnfamiliarVoice2030?output_format=mp3_44100_128',
      );
      const body = JSON.parse(init.body);
      assert.equal(body.model_id, 'eleven_flash_v2_5');
      assert.equal(body.language_code, 'pt');
      assert.deepEqual(body.voice_settings, { speed: 1.1 });
      assert.equal(body.text, speech.text);
      return new Response(Buffer.from('fake-audio'));
    },
  });
  voice.elevenlabs.setKey('test-key');
  assert.deepEqual(await voice.speak(speech, 'one'), {
    audio: Buffer.from('fake-audio').toString('base64'),
    mime: 'audio/mpeg',
  });
});

test('ElevenLabs requires consent, its own key and valid payloads before using the network', async () => {
  const voice = new VoiceService({
    fetchImpl: () => {
      throw new Error('Network forbidden');
    },
  });
  await assert.rejects(voice.transcribe({ ...audio, consent: false }, 'one'), /Confirme/);
  await assert.rejects(voice.speak({ ...speech, consent: false }, 'one'), /Confirme/);
  await assert.rejects(voice.transcribe(audio, 'one'), /Conecte sua chave ElevenLabs/);
  voice.elevenlabs.setKey('test-key');
  for (const bad of [
    { audio: '????' },
    { mime: 'text/plain' },
    { audio: 'AAAA' },
    { audio: 'A'.repeat(5592412) },
  ])
    await assert.rejects(voice.transcribe({ ...audio, ...bad }, 'one'), /Áudio/);
  await assert.rejects(voice.speak({ ...speech, voice: '../escape' }, 'one'), /Escolha uma voz/);
  await assert.rejects(voice.speak({ ...speech, speed: NaN }, 'one'), /velocidade/);
  assert.throws(() => voice.elevenlabs.setKey('secret\nheader'), /inválida/);
  assert.deepEqual(voice.elevenlabs.status(), { configured: true });
  assert.deepEqual(voice.elevenlabs.setKey(''), { configured: false });
});

test('ElevenLabs voice catalog follows opaque pagination and filters invalid identities', async () => {
  const urls = [];
  const service = new ElevenLabsService(async (url) => {
    urls.push(url);
    return Response.json(
      urls.length === 1
        ? {
            voices: [
              { voice_id: 'NewVoice', name: 'Nome novo' },
              { voice_id: '../invalid', name: 'Inválida' },
            ],
            has_more: true,
            next_page_token: 'opaque +/=',
          }
        : {
            voices: [
              { voice_id: 'NewVoice', name: 'Duplicada' },
              { voice_id: 'OtherVoice', name: 'Outra voz' },
            ],
            has_more: false,
          },
    );
  });
  service.setKey('test-key');
  assert.deepEqual(await service.voices(), [
    { id: 'NewVoice', name: 'Nome novo' },
    { id: 'OtherVoice', name: 'Outra voz' },
  ]);
  assert.equal(new URL(urls[1]).searchParams.get('next_page_token'), 'opaque +/=');
});

test('ElevenLabs reports authentication, permissions and quota errors without exposing provider bodies', async () => {
  for (const [status, expected] of [
    [401, /acesso recusado/],
    [403, /permissão/],
    [429, /limite de requisições/],
    [500, /recusou/],
  ]) {
    const service = new ElevenLabsService(async () => new Response('secret-provider-body', { status }));
    service.setKey('test-key');
    await assert.rejects(service.transcribe(audio, 'one'), expected);
    await assert.rejects(service.speak(speech, 'one'), expected);
  }
});

test('ElevenLabs diagnoses provider codes independently of HTTP status and identifies the operation', async () => {
  for (const [code, expected] of [
    ['invalid_api_key', /chave inválida/],
    ['missing_permissions', /não tem permissão/],
    ['quota_exceeded', /saldo ou cota insuficiente/],
  ]) {
    for (const field of ['status', 'code']) {
      const service = new ElevenLabsService(async () =>
        Response.json({ detail: { [field]: code, message: 'secret-provider-body' } }, { status: 401 }),
      );
      service.setKey('test-key');
      for (const [work, operation] of [
        [() => service.transcribe(audio, 'one'), 'Speech to Text'],
        [() => service.speak(speech, 'one'), 'Text to Speech'],
        [() => service.voices(), 'catálogo de vozes'],
      ]) {
        await assert.rejects(work(), (error) => {
          assert.match(error.message, expected);
          assert.ok(error.message.includes(operation));
          assert.ok(!error.message.includes('secret-provider-body'));
          return true;
        });
      }
    }
  }
});

test('ElevenLabs bounds error bodies and does not leak unknown codes or mislabel unknown 401s', async () => {
  for (const body of [
    '',
    'not-json',
    'x'.repeat(16 * 1024 + 1),
    JSON.stringify({ detail: { status: 'secret-unknown-code', message: 'private' } }),
    'null',
  ]) {
    const service = new ElevenLabsService(async () => new Response(body, { status: 401 }));
    service.setKey('test-key');
    await assert.rejects(service.transcribe(audio, 'one'), (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /chave inválida|secret|private|not-json/);
      return true;
    });
  }
});

test('ElevenLabs cancellation is owner and operation scoped and releases the request', async () => {
  const voice = new VoiceService({
    fetchImpl: async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  voice.elevenlabs.setKey('test-key');
  const pending = voice.transcribe(audio, 'one');
  assert.equal(voice.cancel('two'), false);
  assert.equal(voice.cancelSpeech('one'), false);
  await assert.rejects(voice.transcribe(audio, 'two'), /outro pedido/);
  assert.equal(voice.cancel('one'), true);
  await assert.rejects(pending, /interrompido/);
  const spoken = voice.speak(speech, 'two');
  assert.equal(voice.cancelSpeech('one'), false);
  assert.equal(voice.cancelSpeech('two'), true);
  await assert.rejects(spoken, /interrompido/);
});

test('ElevenLabs bounds responses and does not fabricate text for silence', async () => {
  const service = new ElevenLabsService(async () => Response.json({ text: ' ' }));
  service.setKey('test-key');
  await assert.rejects(service.transcribe(audio, 'one'), /Nenhuma fala/);
  const large = new ElevenLabsService(async () => new Response(Buffer.alloc(8 * 1024 * 1024 + 1)));
  large.setKey('test-key');
  await assert.rejects(large.speak(speech, 'one'), /excedeu o limite/);
});
test('ElevenLabs server routes protect credentials and deliver STT and TTS through the same session', async () => {
  const voice = new VoiceService({
    fetchImpl: async (url) =>
      url.includes('/v2/voices')
        ? Response.json({ voices: [{ voice_id: 'UnfamiliarVoice2030', name: 'Outra voz' }], has_more: false })
        : url.includes('/speech-to-text')
          ? Response.json({ text: 'Uma fala reconhecida' })
          : new Response('audio'),
  });
  const server = createServer({ voice });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const token = (await (await fetch(base + '/api/session')).json()).token;
    async function request(route, body = {}) {
      return fetch(base + '/api/' + route, {
        method: 'POST',
        headers: { 'X-Jarvis-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: 'test', ...body }),
      });
    }
    assert.equal(
      (
        await fetch(base + '/api/voice/elevenlabs/key', {
          method: 'POST',
          body: JSON.stringify({ key: 'secret' }),
        })
      ).status,
      403,
    );
    assert.deepEqual(await (await request('voice/elevenlabs/key', { key: 'fake-key' })).json(), {
      configured: true,
    });
    assert.deepEqual(await (await request('voice/elevenlabs/status')).json(), { configured: true });
    assert.equal((await (await request('voice/elevenlabs/voices')).json())[0].name, 'Outra voz');
    assert.equal(
      (await (await request('voice/transcribe', { request: audio })).json()).text,
      'Uma fala reconhecida',
    );
    assert.equal((await (await request('voice/speak', { request: speech })).json()).mime, 'audio/mpeg');
    assert.deepEqual(await (await request('voice/elevenlabs/key', { key: '' })).json(), {
      configured: false,
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
