import type {
  VoiceEngine,
  Provider,
  SpeechRequest,
  TranscribeRequest,
  WarmRequest,
  ChatRequest,
} from './shared/types';
import { projectRoot } from './lib/paths';
import * as http from 'node:http';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { serveStatic } from './lib/static';
import { AIService } from './lib/ai';
import { runtimeInfo } from './lib/runtime';
import { ActionService } from './lib/actions';
import { VoiceService, MAX_AUDIO_BYTES } from './lib/voice';
function createServer({
  ai = new AIService(),
  actions = new ActionService(),
  voice = new VoiceService({
    ai,
    vocabulary: () => [
      'Jarvis',
      ...actions.items.filter((item) => item.available && item.kind === 'app').map((item) => item.label),
    ],
  }),
  fallback = null,
}: {
  ai?: AIService;
  actions?: ActionService;
  voice?: VoiceService;
  fallback?: ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null;
} = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const json = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  return http.createServer(async (req, res) => {
    const host = req.headers.host,
      expected = '127.0.0.1:' + req.socket.localPort;
    if (host !== expected) {
      json(res, 403, { error: 'Host não autorizado.' });
      return;
    }
    const url = new URL(req.url || '/', 'http://' + expected);
    if (req.method === 'GET' && url.pathname === '/api/session') {
      if (req.headers.origin && req.headers.origin !== 'http://' + expected) {
        json(res, 403, { error: 'Origem não autorizada.' });
        return;
      }
      json(res, 200, { token });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (
        req.method !== 'POST' ||
        req.headers['x-jarvis-token'] !== token ||
        (req.headers.origin && req.headers.origin !== 'http://' + expected)
      ) {
        json(res, 403, { error: 'Sessão não autorizada.' });
        return;
      }
      let raw = '';
      try {
        for await (const chunk of req) {
          raw += chunk;
          if (
            raw.length >
            (url.pathname === '/api/voice/transcribe' ? Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 1000 : 250000)
          )
            throw new Error('Solicitação muito grande.');
        }
        const body = JSON.parse(raw || '{}') as {
          owner: string;
          id: string;
          token: string;
          engine: VoiceEngine;
          provider: Provider;
          key: string;
          request: unknown;
        };
        const owner = body.owner;
        if (typeof owner !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(owner))
          throw new Error('Sessão inválida.');
        switch (url.pathname) {
          case '/api/voice/elevenlabs/status':
            json(res, 200, voice.elevenlabs.status());
            return;
          case '/api/voice/elevenlabs/key':
            json(res, 200, voice.elevenlabs.setKey(body.key));
            return;
          case '/api/voice/elevenlabs/voices':
            json(res, 200, await voice.elevenlabs.voices());
            return;
          case '/api/actions':
            json(res, 200, actions.list());
            return;
          case '/api/actions/prepare':
            json(res, 200, actions.prepare(body.id, owner));
            return;
          case '/api/actions/cancel':
            json(res, 200, { cancelled: actions.cancel(owner) });
            return;
          case '/api/actions/execute':
            json(res, 200, await actions.execute(body.token, owner));
            return;
          case '/api/voice/local-warm':
            json(res, 200, await voice.warmLocal(owner, body.engine));
            return;
          case '/api/voice/local-status':
            json(res, 200, voice.localStatus());
            return;
          case '/api/voice/local-install':
            json(res, 200, voice.installLocal());
            return;
          case '/api/voice/speak':
            res.on('close', () => voice.cancelSpeech(owner));
            json(res, 200, await voice.speak(body.request as SpeechRequest, owner));
            return;
          case '/api/voice/stop-speech':
            json(res, 200, { cancelled: voice.cancelSpeech(owner) });
            return;
          case '/api/voice/cancel':
            json(res, 200, { cancelled: voice.cancel(owner) });
            return;
          case '/api/voice/transcribe':
            res.on('close', () => voice.cancel(owner));
            json(res, 200, await voice.transcribe(body.request as TranscribeRequest, owner));
            return;
          case '/api/hardware':
            json(res, 200, ai.hardware());
            return;
          case '/api/status':
            json(res, 200, { ...ai.status(), runtime: runtimeInfo() });
            return;
          case '/api/warm':
            json(res, 200, await ai.warm(body.request as WarmRequest, owner));
            return;
          case '/api/models':
            json(res, 200, await ai.models(body.provider));
            return;
          case '/api/key':
            json(res, 200, ai.setKey(body.key));
            return;
          case '/api/cancel':
            json(res, 200, { cancelled: ai.cancel(owner) });
            return;
          case '/api/chat':
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
            res.flushHeaders();
            res.on('close', () => ai.cancel(owner));
            try {
              await ai.chat(
                {
                  ...(body.request as ChatRequest),
                  targets: [...actions.list().items, ...actions.list().apps],
                },
                (event) => {
                  if (!res.destroyed) res.write(JSON.stringify(event) + '\n');
                },
                owner,
              );
            } catch (errorCause) {
              const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
              if (!res.destroyed) res.write(JSON.stringify({ type: 'error', message: error.message }) + '\n');
            }
            res.end();
            return;
          default:
            json(res, 404, { error: 'Recurso não encontrado.' });
            return;
        }
      } catch (errorCause) {
        const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
        json(res, 400, { error: error.message });
        return;
      }
    }
    if (fallback) {
      if (url.pathname === '/index.html') req.url = '/' + url.search;
      await fallback(req, res);
      return;
    }
    serveStatic(req, res, url, path.join(projectRoot, 'out'));
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4318);
  const server = createServer();
  server.on('error', (error) => {
    console.error(
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? 'Já existe um Jarvis na porta ' + port + '. Encerre o servidor anterior antes de iniciar este.'
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Jarvis: http://127.0.0.1:' + port);
    if (runtimeInfo().restricted) console.log(runtimeInfo().message);
  });
}
export { createServer };
