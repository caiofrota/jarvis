import type {
  ChatRequest,
  ChatMessage,
  ChatEvent,
  WarmRequest,
  Owner,
  Provider,
  Model,
} from '../shared/types';
import type { Decision } from './computer-tools';
import { resolveTarget } from '../shared/target-resolver';
import * as os from 'node:os';
import {
  DECISION_SCHEMA,
  DECISION_INSTRUCTIONS,
  FAST_DECISION_INSTRUCTIONS,
  REPLY_INSTRUCTIONS,
  contextForDecision,
  contextForPersonalProfile,
  isActionRequest,
  TASK_CORRECTION_INSTRUCTIONS,
  TASK_STATE_INSTRUCTIONS,
  parseDecision,
} from './chat-decision';
import { lines, readDecisionStream } from './decision-stream';
import { ReplyStream } from './reply-stream';
const PROFILES = Object.freeze({
  eco: {
    context: 2048,
    maxOutput: 384,
    historyChars: 3000,
    threads: Math.max(1, Math.floor(os.availableParallelism() / 4)),
    keepAlive: '2m',
  },
  balanced: {
    context: 4096,
    maxOutput: 512,
    historyChars: 6000,
    threads: Math.max(1, Math.floor(os.availableParallelism() / 2)),
    keepAlive: '10m',
  },
  full: {
    context: 8192,
    maxOutput: 2048,
    historyChars: 18000,
    threads: Math.max(1, os.availableParallelism() - 2),
    keepAlive: '30m',
  },
});
const LOCAL = 'http://127.0.0.1:11434';
const CLOUD = 'https://api.openai.com/v1';
function fail(message: string): never {
  throw new Error(message);
}
function validateMessages(input: ChatMessage[], limit: number): ChatMessage[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) fail('Conversa inválida.');
  const list = input.map((m) => {
    if (
      !m ||
      !['user', 'assistant'].includes(m.role) ||
      typeof m.content !== 'string' ||
      m.content.length > 32000
    )
      fail('Mensagem inválida.');
    return { role: m.role, content: m.content };
  });
  if (list.at(-1)!.role !== 'user' || !list.at(-1)!.content.trim()) fail('Escreva uma mensagem.');
  const selected: ChatMessage[] = [];
  let used = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const text = list[i].content;
    if (selected.length && used + text.length > limit) break;
    selected.unshift({ ...list[i], content: text.slice(-limit) });
    used += text.length;
    if (selected.length >= 20) break;
  }
  while (selected.length > 1 && selected[0].role !== 'user') selected.shift();
  return selected;
}
interface LocalModel {
  name: string;
  size?: number;
  capabilities?: string[];
  details?: { parameter_size?: string };
}
class AIService {
  fetch: typeof fetch;
  local: string;
  cloud: string;
  cloudKey: string;
  active: { owner: Owner; controller: AbortController } | null;
  preparing: Promise<{ ready: boolean }> | null = null;
  preparation: { owner: Owner; controller: AbortController } | null = null;
  private preparingKey = '';
  private warmed = { key: '', until: 0 };
  constructor({ fetchImpl = fetch, localBase = LOCAL, cloudBase = CLOUD } = {}) {
    this.fetch = fetchImpl;
    this.local = localBase;
    this.cloud = cloudBase;
    this.cloudKey = '';
    this.active = null;
  }
  setKey(value: string) {
    if (typeof value !== 'string' || value.length > 1000) fail('Chave inválida.');
    this.cloudKey = value.trim();
    return { configured: !!this.cloudKey };
  }
  status() {
    return { cloudConfigured: !!this.cloudKey, busy: !!this.active, preparing: !!this.preparing };
  }
  hardware() {
    return {
      ramGiB: Math.round(os.totalmem() / 1073741824),
      freeGiB: Math.round((os.freemem() / 1073741824) * 10) / 10,
      cpu: os.cpus()[0]?.model || 'Não identificado',
      threads: os.availableParallelism(),
      platform: os.platform(),
      profiles: PROFILES,
    };
  }
  async request(url: string, options: RequestInit = {}): Promise<Response> {
    let response;
    try {
      response = await this.fetch(url, { redirect: 'error', ...options });
    } catch (errCause) {
      const err = errCause instanceof Error ? errCause : new Error(String(errCause));
      if (options.signal?.aborted) throw err;
      fail(
        url.startsWith(this.local)
          ? 'Ollama não respondeu. Abra o Ollama neste computador e tente novamente.'
          : 'Não foi possível acessar a API na nuvem. Verifique sua conexão.',
      );
    }
    if (!response.ok) {
      let details;
      try {
        details = await response.json();
      } catch {}
      const providerMessage = details?.error?.message || details?.error || '';
      if (response.status === 401) fail('Chave da API inválida ou sem autorização.');
      if (response.status === 429) fail('Limite da API atingido. Verifique saldo e limites da sua conta.');
      if (response.status === 404) fail('Modelo ou recurso não encontrado. Atualize a lista de modelos.');
      fail(
        'O provedor recusou a solicitação (' +
          response.status +
          '). ' +
          (typeof providerMessage === 'string' ? providerMessage.slice(0, 250) : ''),
      );
    }
    return response;
  }
  async models(provider: Provider): Promise<Model[]> {
    if (!['local', 'cloud'].includes(provider)) fail('Provedor desconhecido.');
    if (provider === 'cloud' && !this.cloudKey) fail('Informe sua chave de API para listar os modelos.');
    const response = await this.request(
      provider === 'local' ? this.local + '/api/tags' : this.cloud + '/models',
      {
        headers: provider === 'cloud' ? { Authorization: 'Bearer ' + this.cloudKey } : {},
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = (await response.json()) as { models?: LocalModel[]; data?: { id: string }[] };
    if (provider === 'local')
      return (
        (data.models || [])
          .filter(
            (m) => !/:cloud\b/i.test(m.name) && (!m.capabilities || m.capabilities.includes('completion')),
          )
          .map((m) => ({
            id: m.name,
            size: m.size || 0,
            parameters: m.details?.parameter_size || '',
            kind: 'local' as const,
          }))
          // When no preference is saved, the first model should be the fastest
          // usable local option rather than whichever tag Ollama returned first.
          .sort((a, b) => (a.size || Number.MAX_SAFE_INTEGER) - (b.size || Number.MAX_SAFE_INTEGER))
      );
    return (data.data || [])
      .filter(
        (m) =>
          /^(gpt-|o[1-9]|chat-latest)/.test(m.id) &&
          !/audio|transcribe|realtime|image|tts|codex|embedding|search|moderation/i.test(m.id),
      )
      .map((m) => ({ id: m.id, kind: 'cloud' as const }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  warm(request: WarmRequest, owner: Owner = 'default'): Promise<{ ready: boolean; message?: string }> {
    if (request?.provider === 'cloud') return Promise.resolve({ ready: true });
    const { model, profile = 'balanced' } = request || {};
    if (
      request?.provider !== 'local' ||
      typeof model !== 'string' ||
      !model ||
      model.length > 200 ||
      !PROFILES[profile] ||
      /:cloud\b/i.test(model)
    )
      return Promise.reject(new Error('Modelo local inválido.'));
    if (this.active) return Promise.resolve({ ready: false, message: 'A IA está respondendo.' });
    const key = model + ':' + profile;
    if (this.preparing) {
      if (key === this.preparingKey) return this.preparing;
      return this.preparing.then(() => this.warm(request, owner));
    }
    if (this.warmed.key === key && this.warmed.until > Date.now()) return Promise.resolve({ ready: true });
    this.preparingKey = key;
    const controller = new AbortController();
    this.preparation = { owner, controller };
    this.preparing = (async () => {
      const timer = setTimeout(() => controller.abort(), 300000);
      try {
        const info = await (
          await this.request(this.local + '/api/show', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
            signal: controller.signal,
          })
        ).json();
        if (info.remote_host || info.remote_model) fail('Esse modelo usa nuvem.');
        const p = PROFILES[profile];
        await (
          await this.request(this.local + '/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt: '',
              stream: false,
              keep_alive: p.keepAlive,
              options: { num_ctx: p.context, num_thread: p.threads },
            }),
            signal: controller.signal,
          })
        ).json();
        this.warmed = { key, until: Date.now() + 110000 };
        return { ready: true };
      } finally {
        clearTimeout(timer);
        this.preparing = null;
        this.preparation = null;
      }
    })();
    return this.preparing;
  }
  cancel(owner: Owner) {
    if (this.preparation?.owner === owner) {
      this.preparation.controller.abort();
      return true;
    }
    if (this.active && this.active.owner === owner) {
      this.active.controller.abort();
      return true;
    }
    return false;
  }
  async chat(request: ChatRequest, onEvent: (event: ChatEvent) => void, owner: Owner = 'default') {
    if (this.preparing) {
      onEvent({ type: 'status', message: 'Preparando a IA local para a conversa…' });
      await this.preparing;
    }
    if (this.active) fail('Uma resposta já está em andamento. Aguarde ou interrompa.');
    const { provider, model, profile = 'balanced' } = request || {};
    if (
      !['local', 'cloud'].includes(provider) ||
      typeof model !== 'string' ||
      !model.trim() ||
      model.length > 200 ||
      !PROFILES[profile]
    )
      fail('Escolha um provedor, um modelo e um perfil válidos.');
    if (provider === 'cloud' && !this.cloudKey)
      fail('Conecte sua chave de API nas configurações de inteligência.');
    const p = PROFILES[profile],
      spoken = request.voice === true,
      conversation = validateMessages(
        request.messages,
        spoken ? Math.min(p.historyChars, 2500) : p.historyChars,
      );
    const structured = provider === 'cloud' || isActionRequest(request);
    const system =
      (structured
        ? provider === 'local' && spoken
          ? FAST_DECISION_INSTRUCTIONS
          : DECISION_INSTRUCTIONS
        : REPLY_INSTRUCTIONS) +
      (structured
        ? '\n' +
          TASK_STATE_INSTRUCTIONS +
          '\n' +
          TASK_CORRECTION_INSTRUCTIONS +
          contextForDecision(request, spoken || profile === 'eco')
        : contextForDecision(request, spoken || profile === 'eco')) +
      contextForPersonalProfile(request.personalProfile) +
      (spoken
        ? '\nConversa falada: em reply use até duas frases curtas. O último pedido veio de reconhecimento de voz, não de digitação. Palavras estranhas podem ser erros de transcrição. Use a lista atual e o contexto para compreender, mas não invente nomes nem execute ações se houver ambiguidade: peça esclarecimento. Uma menção a um aplicativo não é um pedido para abri-lo. Não diga que houve erro de digitação.'
        : '');
    const maxOutput = spoken ? Math.min(p.maxOutput, 128) : p.maxOutput;
    const controller = new AbortController();
    this.active = { owner, controller };
    const timeout = setTimeout(() => controller.abort(new Error('Tempo limite de resposta.')), 300000);
    const started = Date.now();
    try {
      if (provider === 'local') {
        if (/:cloud\b/i.test(model)) fail('Esse modelo usa nuvem. Escolha um modelo local.');
        const info = await (
          await this.request(this.local + '/api/show', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
            signal: controller.signal,
          })
        ).json();
        if (info.remote_host || info.remote_model)
          fail('Esse modelo usa um serviço remoto. O modo local aceita apenas modelos executados neste PC.');
        if (info.capabilities && !info.capabilities.includes('completion'))
          fail('Esse modelo não oferece chat de texto.');
      }
      const payload =
        provider === 'local'
          ? {
              model,
              messages: [{ role: 'system', content: system }, ...conversation],
              ...(structured ? { format: DECISION_SCHEMA } : {}),
              stream: true,
              think: false,
              keep_alive: p.keepAlive,
              options: {
                num_ctx: spoken ? Math.min(p.context, 2048) : p.context,
                num_predict: maxOutput,
                num_thread: p.threads,
                temperature: 0,
              },
            }
          : {
              model,
              messages: [{ role: 'system', content: system }, ...conversation],
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'jarvis_decision', strict: true, schema: DECISION_SCHEMA },
              },
              stream: true,
              max_completion_tokens: maxOutput,
              store: false,
            };
      onEvent({ type: 'status', message: 'Entendendo seu pedido…' });
      onEvent({ type: 'start' });
      let decision: Decision | undefined,
        generation: Awaited<ReturnType<typeof readDecisionStream>> | undefined;
      let firstVisibleMs: number | undefined;
      const reply = new ReplyStream((text) => {
        firstVisibleMs ??= Date.now() - started;
        onEvent({ type: 'delta', text });
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await this.request(
          provider === 'local' ? this.local + '/api/chat' : this.cloud + '/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(provider === 'cloud' ? { Authorization: 'Bearer ' + this.cloudKey } : {}),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        let streamed = 0;
        let localEnvelope = false;
        generation = await readDecisionStream(response.body, provider, started, (text) => {
          if (provider === 'local' && !structured) {
            const delta = text.slice(streamed);
            streamed = text.length;
            // Keep compatibility with models that still emit the JSON reply
            // envelope even when no format constraint was requested.
            localEnvelope ||= text.trimStart().startsWith('{');
            if (localEnvelope) reply.push(text);
            else reply.pushPlain(text, false);
            // pushPlain validates complete sentences; it emits through the same callback.
            if (!delta && !reply.text) return;
          } else reply.push(text);
        });
        try {
          if (provider === 'local' && !structured) {
            // Small local models may still return the old JSON envelope even
            // without a format constraint. Accept it, but expose only its
            // validated reply text. Plain prose follows the same validator.
            try {
              decision = parseDecision(generation.text);
            } catch {
              decision = parseDecision(
                JSON.stringify({ decision: { type: 'reply', text: generation.text } }),
              );
            }
            if (decision.type !== 'reply') throw new Error('Resposta local não é uma conversa.');
            reply.pushPlain(decision.text, true);
          } else decision = parseDecision(generation.text);
          if (decision.type === 'update-task' || decision.type === 'complete-task') {
            const id = decision.id;
            if (!request.tasks?.some((task) => task.id === id))
              throw new Error(
                'A tarefa não existe na lista atual. Consulte com check_task ou pergunte; não altere um id do histórico.',
              );
          }
          break;
        } catch (errorCause) {
          const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
          if (reply.text) fail('A resposta não passou na validação final. Nenhuma ação foi executada.');
          if (attempt === 1)
            fail('Não consegui validar a ação. Nenhuma tarefa foi adicionada ou alterada. Tente novamente.');
          // Retry a decision, never infer or execute an action from a prose claim.
          payload.messages[0].content =
            system +
            '\nCorreção obrigatória: ' +
            error.message +
            ' Reavalie a última mensagem: consulta usa check_task; conclusão usa complete_task; correção usa update_task. Só uma nova pendência usa add_task. Confirmações pertencem ao executor; em dúvida pergunte em reply. JSON somente.';
          onEvent({ type: 'status', message: 'Conferindo a ação antes de responder…' });
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!decision || !generation) fail('A IA não retornou uma decisão.');
      if (reply.text && (decision.type !== 'reply' || !decision.text.startsWith(reply.text)))
        fail('A resposta mudou durante a geração. Nenhuma ação foi executada.');
      if (decision.type === 'add-task') {
        onEvent({ type: 'status', message: 'Salvando tarefa…' });
        onEvent({ type: 'task', title: decision.title });
      } else if (decision.type === 'check-task') {
        onEvent({ type: 'task-check', title: decision.title });
      } else if (decision.type === 'complete-task') {
        const task = request.tasks?.find((task) => task.id === decision.id);
        if (!task) fail('A tarefa não existe mais. Nenhuma conclusão foi feita.');
        onEvent({ type: 'task-complete', id: task.id, title: task.text });
      } else if (decision.type === 'update-task') {
        const task = request.tasks?.find((task) => task.id === decision.id);
        if (!task) fail('A tarefa a corrigir não existe. Nenhuma alteração foi feita.');
        onEvent({ type: 'status', message: 'Corrigindo tarefa…' });
        onEvent({ type: 'task-update', id: task.id, title: decision.title, previousTitle: task.text });
      } else if (decision.type === 'open-target') {
        const target = resolveTarget(decision.name, request.targets || []);
        if (target.type === 'action') onEvent(target);
        else onEvent({ type: 'delta', text: target.text });
      } else {
        const remaining = decision.text.slice(reply.text.length);
        if (remaining) onEvent({ type: 'delta', text: remaining });
      }
      const { text: _raw, ...stats } = generation;
      const result = { type: 'done' as const, durationMs: Date.now() - started, firstVisibleMs, ...stats };
      onEvent(result);
      return result;
    } catch (errCause) {
      const err = errCause instanceof Error ? errCause : new Error(String(errCause));
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason?.message === 'Tempo limite de resposta.';
        const event: ChatEvent = {
          type: timedOut ? 'error' : 'cancelled',
          message: timedOut
            ? 'O modelo excedeu cinco minutos. Tente um modelo menor.'
            : 'Resposta interrompida.',
        };
        onEvent(event);
        return event;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      this.active = null;
    }
  }
}
export { AIService, PROFILES, validateMessages, lines };
