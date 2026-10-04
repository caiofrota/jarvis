import type { Provider, ChatStats } from '../shared/types';
async function* lines(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new Error('O provedor não enviou uma resposta.');
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > 2000000) throw new Error('Resposta excedeu o limite de leitura.');
    let i;
    while ((i = pending.indexOf('\n')) !== -1) {
      yield pending.slice(0, i).replace(/\r$/, '');
      pending = pending.slice(i + 1);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) yield pending;
}
async function readDecisionStream(
  body: ReadableStream<Uint8Array> | null,
  provider: Provider,
  started: number,
  onText?: (text: string) => void,
) {
  let text = '',
    completed = false,
    firstTokenMs: number | null = null,
    stats: Partial<ChatStats> = {};
  for await (const line of lines(body)) {
    if (!line.trim()) continue;
    let part: {
      error?: string | { message: string };
      choices?: { delta?: { content?: string; refusal?: string }; finish_reason?: string }[];
      message?: { content?: string };
      done?: boolean;
      done_reason?: string;
      eval_count?: number;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
    };
    if (provider === 'cloud') {
      if (!line.startsWith('data:')) continue;
      const value = line.slice(5).trim();
      if (value === '[DONE]') break;
      part = JSON.parse(value);
    } else part = JSON.parse(line);
    if (part.error) throw new Error(typeof part.error === 'string' ? part.error : part.error.message);
    if (part.choices?.[0]?.delta?.refusal) throw new Error('O provedor não pôde atender esse pedido.');
    const delta =
      provider === 'local' ? part.message?.content || '' : part.choices?.[0]?.delta?.content || '';
    if (delta) {
      firstTokenMs ??= Date.now() - started;
      text += delta;
      if (text.length > 64000) throw new Error('A resposta excedeu o limite desta conversa.');
      onText?.(text);
    }
    const reason = provider === 'local' ? part.done_reason : part.choices?.[0]?.finish_reason;
    if (reason === 'length')
      throw new Error('A decisão da IA ficou incompleta. Tente um perfil com limite maior.');
    if (provider === 'local' && part.done) {
      completed = true;
      stats = {
        tokens: part.eval_count || 0,
        loadMs: Math.round((part.load_duration || 0) / 1e6),
        promptMs: Math.round((part.prompt_eval_duration || 0) / 1e6),
        generationMs: Math.round((part.eval_duration || 0) / 1e6),
      };
      break;
    }
    if (provider === 'cloud' && reason === 'stop') completed = true;
  }
  if (!completed) throw new Error('A conexão terminou antes de concluir a resposta. Tente novamente.');
  return { text, firstTokenMs, ...stats };
}
export { lines, readDecisionStream };
