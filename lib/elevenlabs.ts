import type { AudioResult, Owner, SpeechRequest, TranscribeRequest, Transcript } from '../shared/types';
import { forSpeech } from '../shared/text';

const API = 'https://api.elevenlabs.io';
const FORMATS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
};
type Operation = 'speak' | 'transcribe';

export class ElevenLabsService {
  private key = '';
  private active = new Map<Operation, { owner: Owner; controller: AbortController }>();
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  status() {
    return { configured: !!this.key };
  }
  setKey(value: string) {
    if (typeof value !== 'string' || value.length > 512 || /[\r\n]/.test(value))
      throw new Error('Chave ElevenLabs inválida.');
    for (const pending of this.active.values()) pending.controller.abort();
    this.key = value.trim();
    return this.status();
  }
  cancel(owner: Owner, operation: Operation) {
    const pending = this.active.get(operation);
    if (!pending || pending.owner !== owner) return false;
    pending.controller.abort();
    return true;
  }
  private async request(path: string, init: RequestInit, signal: AbortSignal) {
    if (!this.key) throw new Error('Conecte sua chave ElevenLabs em Configurações → Voz.');
    const response = await this.fetchImpl(API + path, {
      ...init,
      headers: { ...init.headers, 'xi-api-key': this.key },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401)
        throw new Error('Chave ElevenLabs inválida. Reconecte em Configurações → Voz.');
      if (response.status === 403)
        throw new Error('A chave ElevenLabs não tem permissão para esta operação.');
      if (response.status === 429) throw new Error('Limite ou saldo da ElevenLabs atingido.');
      throw new Error('A ElevenLabs recusou o pedido (' + response.status + ').');
    }
    return response;
  }
  private async bytes(response: Response, limit: number) {
    if (!response.body) throw new Error('A ElevenLabs retornou uma resposta vazia.');
    const reader = response.body.getReader(),
      chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new Error('A resposta da ElevenLabs excedeu o limite.');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    if (!size) throw new Error('A ElevenLabs retornou uma resposta vazia.');
    return Buffer.concat(chunks);
  }
  private async run<T>(operation: Operation, owner: Owner, work: (signal: AbortSignal) => Promise<T>) {
    if (this.active.has(operation))
      throw new Error('A ElevenLabs está processando outro pedido. Aguarde ou cancele.');
    const controller = new AbortController();
    this.active.set(operation, { owner, controller });
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      return await work(controller.signal);
    } catch (cause) {
      if (controller.signal.aborted)
        throw new Error('Pedido ElevenLabs interrompido ou tempo limite atingido.');
      if (cause instanceof TypeError) throw new Error('Não foi possível conectar à ElevenLabs.');
      throw cause;
    } finally {
      clearTimeout(timer);
      this.active.delete(operation);
    }
  }
  async voices(): Promise<{ id: string; name: string }[]> {
    const signal = AbortSignal.timeout(15000),
      result: { id: string; name: string }[] = [];
    let token = '';
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ page_size: '100' });
      if (token) params.set('next_page_token', token);
      const response = await this.request('/v2/voices?' + params, {}, signal);
      const data = JSON.parse((await this.bytes(response, 2 * 1024 * 1024)).toString());
      if (!Array.isArray(data.voices)) throw new Error('Catálogo ElevenLabs inválido.');
      for (const voice of data.voices) {
        if (
          typeof voice?.voice_id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(voice.voice_id) ||
          typeof voice.name !== 'string'
        )
          continue;
        if (!result.some((item) => item.id === voice.voice_id))
          result.push({ id: voice.voice_id, name: voice.name.slice(0, 150) });
      }
      if (!data.has_more) return result;
      if (
        typeof data.next_page_token !== 'string' ||
        !data.next_page_token ||
        data.next_page_token.length > 2000 ||
        seen.has(data.next_page_token)
      )
        throw new Error('Paginação ElevenLabs inválida.');
      token = data.next_page_token;
      seen.add(token);
    }
    throw new Error('Catálogo ElevenLabs muito grande. Reduza as vozes salvas na conta.');
  }
  async speak(request: SpeechRequest, owner: Owner): Promise<AudioResult> {
    if (request.consent !== true) throw new Error('Confirme o envio de texto à ElevenLabs. API paga.');
    if (
      typeof request.text !== 'string' ||
      request.text.length > 4000 ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(request.voice || '') ||
      !Number.isFinite(request.speed) ||
      request.speed < 0.7 ||
      request.speed > 1.3
    )
      throw new Error('Escolha uma voz ElevenLabs e uma velocidade válida.');
    const text = forSpeech(request.text);
    if (!text) throw new Error('Não há texto para ler.');
    return this.run('speak', owner, async (signal) => {
      const response = await this.request(
        '/v1/text-to-speech/' + request.voice + '?output_format=mp3_44100_128',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: 'eleven_flash_v2_5',
            language_code: 'pt',
            voice_settings: { speed: request.speed },
          }),
        },
        signal,
      );
      return { audio: (await this.bytes(response, 8 * 1024 * 1024)).toString('base64'), mime: 'audio/mpeg' };
    });
  }
  async transcribe(request: TranscribeRequest, owner: Owner): Promise<Transcript> {
    if (request.consent !== true) throw new Error('Confirme o envio de áudio à ElevenLabs. API paga.');
    if (
      !Object.hasOwn(FORMATS, request.mime) ||
      typeof request.audio !== 'string' ||
      request.audio.length > 5592408 ||
      request.audio.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(request.audio)
    )
      throw new Error('Áudio inválido ou maior que 4 MB.');
    const bytes = Buffer.from(request.audio, 'base64');
    if (bytes.length < 32 || bytes.length > 4 * 1024 * 1024) throw new Error('Áudio vazio ou muito grande.');
    try {
      return await this.run('transcribe', owner, async (signal) => {
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(bytes)], { type: request.mime }),
          'fala.' + FORMATS[request.mime],
        );
        form.append('model_id', 'scribe_v2');
        form.append('language_code', 'por');
        form.append('tag_audio_events', 'false');
        form.append('diarize', 'false');
        form.append('timestamps_granularity', 'none');
        const response = await this.request('/v1/speech-to-text', { method: 'POST', body: form }, signal);
        const data = JSON.parse((await this.bytes(response, 256 * 1024)).toString());
        if (typeof data.text !== 'string' || !data.text.trim())
          throw new Error('Nenhuma fala foi reconhecida.');
        return { text: data.text.trim().slice(0, 16000) };
      });
    } finally {
      bytes.fill(0);
    }
  }
}
