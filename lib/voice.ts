import type {
  Owner,
  VoiceEngine,
  LocalVoiceStatus,
  SpeechRequest,
  TranscribeRequest,
  AudioResult,
  Transcript,
} from '../shared/types';
import type { VoiceDriver } from './local-voice';
import { DuplexVoiceService } from './local-voice';
import { forSpeech } from '../shared/text';
import { ElevenLabsService } from './elevenlabs';
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const FORMATS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
};
class VoiceService {
  local: VoiceDriver;
  ai: { cloudKey: string };
  fetch: typeof fetch;
  active: { owner: Owner; controller: AbortController } | null;
  speechActive: { owner: Owner; controller: AbortController } | null;
  vocabulary: () => string[];
  elevenlabs: ElevenLabsService;
  constructor({
    ai = { cloudKey: '' },
    fetchImpl = fetch,
    local = new DuplexVoiceService(),
    vocabulary = () => ['Jarvis'],
  }: {
    ai?: { cloudKey: string };
    fetchImpl?: typeof fetch;
    local?: VoiceDriver;
    vocabulary?: () => string[];
  } = {}) {
    this.local = local;
    this.ai = ai;
    this.fetch = fetchImpl;
    this.elevenlabs = new ElevenLabsService(fetchImpl);
    this.active = null;
    this.speechActive = null;
    this.vocabulary = vocabulary;
  }
  warmLocal(owner: Owner, engine: VoiceEngine = 'tts') {
    return this.local.warm(owner, engine);
  }
  localStatus(): LocalVoiceStatus {
    return this.local.status();
  }
  installLocal(): LocalVoiceStatus {
    return this.local.install();
  }
  cancel(owner: Owner) {
    if (this.elevenlabs.cancel(owner, 'transcribe')) return true;
    if (this.local.cancel(owner, 'transcribe')) return true;
    if (this.active?.owner !== owner) return false;
    this.active.controller.abort();
    return true;
  }
  cancelSpeech(owner: Owner) {
    if (this.elevenlabs.cancel(owner, 'speak')) return true;
    if (this.local.cancel(owner, 'speak')) return true;
    if (this.speechActive?.owner !== owner) return false;
    this.speechActive.controller.abort();
    return true;
  }
  async speak(request: SpeechRequest, owner: Owner): Promise<AudioResult> {
    if (request?.provider === 'elevenlabs') return this.elevenlabs.speak(request, owner);
    if (request?.provider === 'local') return this.local.request('speak', request, owner);
    if (this.speechActive) throw new Error('Uma voz já está sendo gerada. Aguarde ou cancele.');
    if (request?.provider !== 'cloud' || request.consent !== true)
      throw new Error('Confirme o envio do texto para gerar a voz na nuvem.');
    if (!this.ai.cloudKey) throw new Error('Conecte sua chave OpenAI em Inteligência para usar voz neural.');
    if (
      typeof request.text !== 'string' ||
      request.text.length > 4000 ||
      !['marin', 'cedar'].includes(request.voice || '') ||
      !Number.isFinite(request.speed) ||
      request.speed < 0.7 ||
      request.speed > 1.3
    )
      throw new Error('Configuração de voz inválida.');
    const text = forSpeech(request.text);
    if (!text) throw new Error('Não há texto para ler.');
    const controller = new AbortController();
    this.speechActive = { owner, controller };
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await this.fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.ai.cloudKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: request.voice,
          input: text,
          instructions:
            'Fale em português brasileiro com voz calma, elegante, segura e levemente grave, no estilo de um assistente executivo futurista. Use ritmo natural, humor seco apenas quando couber e não pronuncie símbolos de formatação. Não imite uma pessoa real.',
          speed: request.speed,
          response_format: 'mp3',
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 401) throw new Error('Chave de API inválida. Reconecte em Inteligência.');
      if (response.status === 429) throw new Error('Limite ou saldo da API atingido.');
      if (!response.ok) throw new Error('A API recusou a geração de voz (' + response.status + ').');
      let size = 0;
      const chunks: Buffer[] = [];
      if (!response.body) throw new Error('Áudio vazio.');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          controller.abort();
          throw new Error('Áudio excedeu o limite.');
        }
        chunks.push(Buffer.from(chunk));
      }
      if (!size) throw new Error('A API retornou áudio vazio.');
      return { audio: Buffer.concat(chunks).toString('base64'), mime: 'audio/mpeg' };
    } catch (errorCause) {
      const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
      if (controller.signal.aborted) throw new Error('Geração de voz interrompida ou tempo limite atingido.');
      if (error instanceof TypeError) throw new Error('Não foi possível conectar ao serviço de voz.');
      throw error;
    } finally {
      clearTimeout(timer);
      this.speechActive = null;
    }
  }
  async transcribe(request: TranscribeRequest, owner: Owner): Promise<Transcript> {
    if (request?.provider === 'elevenlabs') return this.elevenlabs.transcribe(request, owner);
    if (request?.provider === 'local')
      return this.local.request('transcribe', { ...request, vocabulary: this.vocabulary() }, owner);
    if (this.active) throw new Error('Uma transcrição está em andamento. Aguarde ou cancele.');
    if (request?.provider !== 'cloud' || request.consent !== true)
      throw new Error('Confirme o envio do áudio para a nuvem.');
    const key = this.ai.cloudKey;
    if (!key) throw new Error('Conecte sua chave OpenAI em Inteligência antes de transcrever na nuvem.');
    const { audio, mime } = request;
    if (
      !Object.hasOwn(FORMATS, mime) ||
      typeof audio !== 'string' ||
      !audio.length ||
      audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 ||
      audio.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)
    )
      throw new Error('Áudio inválido ou maior que 4 MB. Grave uma mensagem menor.');
    const bytes = Buffer.from(audio, 'base64');
    if (bytes.length > MAX_AUDIO_BYTES || bytes.length < 32) throw new Error('Áudio vazio ou muito grande.');
    const controller = new AbortController();
    this.active = { owner, controller };
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'fala.' + FORMATS[mime]);
      form.append('model', 'gpt-4o-mini-transcribe');
      form.append('language', 'pt');
      form.append('response_format', 'json');
      const response = await this.fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key },
        body: form,
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 401) throw new Error('Chave de API inválida. Reconecte em Inteligência.');
      if (response.status === 429) throw new Error('Limite ou saldo da API atingido.');
      if (!response.ok) throw new Error('A API recusou a transcrição (' + response.status + ').');
      const result = await response.json();
      if (typeof result.text !== 'string' || !result.text.trim())
        throw new Error('Nenhuma fala foi reconhecida.');
      return { text: result.text.trim().slice(0, 16000) };
    } catch (errorCause) {
      const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
      if (controller.signal.aborted) throw new Error('Transcrição interrompida ou tempo limite atingido.');
      if (error instanceof TypeError)
        throw new Error('Não foi possível acessar o serviço de voz. Verifique a conexão.');
      throw error;
    } finally {
      clearTimeout(timer);
      bytes.fill(0);
      this.active = null;
    }
  }
}
export { VoiceService, MAX_AUDIO_BYTES };
