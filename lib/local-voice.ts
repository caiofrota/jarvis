import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { forSpeech } from '../shared/text';
import { projectRoot } from './paths';
import type {
  Owner,
  LocalVoice,
  VoiceEngine,
  LocalVoiceStatus,
  SpeechRequest,
  TranscribeRequest,
  AudioResult,
  Transcript,
} from '../shared/types';

const LOCAL_VOICE_MODELS: Record<LocalVoice, string> = {
  alex: 'pm_alex',
  santa: 'pm_santa',
  dora: 'pf_dora',
};
const LOCAL_VOICE_IDS = Object.keys(LOCAL_VOICE_MODELS) as LocalVoice[];

type Operation = 'warm' | 'speak' | 'transcribe';
type Requests = { warm: Record<string, never>; speak: SpeechRequest; transcribe: TranscribeRequest };
type Results = { warm: { ready: boolean }; speak: AudioResult; transcribe: Transcript };
interface Options {
  root?: string;
  dataDir?: string;
  scriptsDir?: string;
  engine?: VoiceEngine | 'both';
}
interface Pending {
  child: ChildProcessWithoutNullStreams;
  owner: Owner;
  op: Operation;
  cancelled?: boolean;
  finished: Promise<void>;
  release(): void;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
export interface VoiceDriver {
  status(): LocalVoiceStatus;
  install(): LocalVoiceStatus;
  warm(owner: Owner, engine?: VoiceEngine): Promise<{ ready: boolean }>;
  request<K extends Operation>(op: K, request: Requests[K], owner: Owner): Promise<Results[K]>;
  cancel(owner: Owner, op: Operation): boolean;
  dispose(): void;
}
export class LocalVoiceService {
  root: string;
  dataDir: string;
  scriptsDir: string;
  engine: VoiceEngine | 'both';
  python: string;
  child: ChildProcessWithoutNullStreams | null = null;
  pending: Pending | null = null;
  idle: ReturnType<typeof setTimeout> | undefined;
  warming: Promise<{ ready: boolean }> | null = null;
  warmed = false;
  installing = false;
  message = '';
  error = '';
  constructor({
    root = projectRoot,
    dataDir = path.join(root, '.voice-data'),
    scriptsDir = path.join(root, 'voice'),
    engine = 'both',
  }: Options = {}) {
    Object.assign(this, { root, dataDir, scriptsDir, engine });
    this.root = root;
    this.dataDir = dataDir;
    this.scriptsDir = scriptsDir;
    this.engine = engine;
    this.python = path.join(
      root,
      '.voice-env',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  }
  private tempDir(): string {
    const directory = path.join(this.dataDir, 'tmp');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }
  status(): LocalVoiceStatus {
    let ttsVoices: LocalVoice[] = [];
    try {
      const ready = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'kokoro.ready.json'), 'utf8')) as {
        engine?: string;
        voices?: unknown;
      };
      if (ready.engine === 'kokoro' && Array.isArray(ready.voices)) {
        const voices = ready.voices as string[];
        ttsVoices = LOCAL_VOICE_IDS.filter((id) => voices.includes(LOCAL_VOICE_MODELS[id]));
      }
    } catch {
      ttsVoices = [];
    }
    const ready =
      fs.existsSync(this.python) &&
      ttsVoices.length === LOCAL_VOICE_IDS.length &&
      ['whisper-base/model.bin', 'whisper-base/config.json', 'whisper-base/tokenizer.json'].every((p) =>
        fs.existsSync(path.join(this.dataDir, p)),
      );
    const wakewordReady =
      fs.existsSync(path.join(this.dataDir, 'wakeword.ready.json')) &&
      [
        'wake-models/melspectrogram.onnx',
        'wake-models/embedding_model.onnx',
        'wake-models/hey_jarvis_v0.1.onnx',
      ].every((p) => fs.existsSync(path.join(this.dataDir, p)));
    return {
      ready,
      warming: !!this.warming,
      loaded: !!this.child && this.warmed,
      installing: this.installing,
      message: this.message,
      error: this.error,
      ttsVoices,
      wakewordReady,
    };
  }
  install(): LocalVoiceStatus {
    const current = this.status();
    if (
      this.installing ||
      (current.ready && current.ttsVoices?.length === LOCAL_VOICE_IDS.length && current.wakewordReady)
    )
      return current;
    this.installing = true;
    this.error = '';
    this.message = 'Preparando Kokoro local gratuito…';
    this.setup()
      .catch((error: Error) => {
        this.error = error.message;
        this.message = 'Não foi possível concluir a instalação.';
      })
      .finally(() => {
        this.installing = false;
      });
    return this.status();
  }
  run(command: string, args: string[], environment: Record<string, string | undefined> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const tempDir = this.tempDir();
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...environment,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          HF_HUB_DISABLE_TELEMETRY: '1',
          TMP: tempDir,
          TEMP: tempDir,
          TMPDIR: tempDir,
        },
      });
      let errors = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Instalação excedeu 15 minutos. Tente novamente.'));
      }, 900000);
      readline.createInterface({ input: child.stdout }).on('line', (line: string) => {
        try {
          this.message = JSON.parse(line).message || this.message;
        } catch {
          if (line.trim()) this.message = line.slice(0, 180);
        }
      });
      child.stderr.on('data', (buffer: Buffer) => {
        errors = (errors + buffer.toString()).slice(-1500);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error('Falha na instalação local: ' + errors.slice(-700)));
      });
    });
  }
  async setup(): Promise<void> {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.message = 'Instalando componentes gratuitos do Kokoro e Whisper…';
    try {
      await this.run(
        process.platform === 'win32' ? 'uv.exe' : 'uv',
        ['sync', '--project', this.scriptsDir, '--locked', '--no-dev', '--python', '3.11'],
        { UV_PROJECT_ENVIRONMENT: path.join(this.root, '.voice-env') },
      );
    } catch {
      throw new Error('Instale Python 3.11 e uv, reinicie o Jarvis e clique em Tentar instalar novamente.');
    }
    await this.run(this.python, [path.join(this.scriptsDir, 'download.py'), this.dataDir]);
  }
  start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const tempDir = this.tempDir();
    const child = spawn(this.python, ['-u', path.join(this.scriptsDir, 'worker.py'), this.dataDir], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        HF_HUB_OFFLINE: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
        TMP: tempDir,
        TEMP: tempDir,
        TMPDIR: tempDir,
      },
    });
    this.child = child;
    let errorLog = '';
    child.stderr.on('data', (buffer: Buffer) => {
      errorLog = (errorLog + buffer.toString()).slice(-600);
    });
    const failure = (error: Error) => {
      if (this.child === child) {
        this.child = null;
        this.warmed = false;
      }
      if (this.pending?.child === child) {
        this.pending.release();
        this.pending.reject(error);
        this.pending = null;
      }
    };
    child.on('error', failure);
    child.stdin.on('error', failure);
    child.on('exit', () => failure(new Error('O motor local foi encerrado. ' + errorLog)));
    readline.createInterface({ input: child.stdout }).on('line', (line: string) => {
      if (this.pending?.child !== child) return;
      let result: { ok: boolean; value: unknown; error?: string };
      try {
        result = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending;
      this.pending = null;
      pending.release();
      if (pending.cancelled) pending.reject(new Error('Operação de voz cancelada.'));
      else if (result.ok) pending.resolve(result.value);
      else pending.reject(new Error(result.error));
    });
    return child;
  }
  warm(owner: Owner): Promise<{ ready: boolean }> {
    if (this.warming) return this.warming;
    if (this.warmed && this.child) return Promise.resolve({ ready: true });
    this.warming = this.request('warm', {}, owner)
      .then((value) => {
        this.warmed = true;
        return value;
      })
      .finally(() => {
        this.warming = null;
      });
    return this.warming;
  }
  async request<K extends Operation>(op: K, request: Requests[K], owner: Owner): Promise<Results[K]> {
    if (op !== 'warm' && this.warming) await this.warming;
    if (!this.status().ready)
      throw new Error(
        'A voz local Kokoro ainda não está instalada. Abra Conversar para acompanhar a instalação.',
      );
    if (this.pending?.cancelled) await this.pending.finished;
    if (this.pending) throw new Error('A voz local está processando outro pedido. Aguarde ou cancele.');
    const payload: {
      op: Operation;
      engine: string;
      text?: string;
      speed?: number;
      voice?: string;
      audio?: string;
      live?: boolean;
      vocabulary?: string[];
    } = { op, engine: this.engine };
    if (op === 'speak') {
      const input = request as SpeechRequest;
      if (
        typeof input.text !== 'string' ||
        input.text.length > 4000 ||
        !Number.isFinite(input.speed) ||
        input.speed < 0.7 ||
        input.speed > 1.3
      )
        throw new Error('Texto ou velocidade inválidos.');
      payload.text = forSpeech(input.text);
      payload.speed = input.speed;
      const voice = input.voice && LOCAL_VOICE_IDS.includes(input.voice as LocalVoice) ? input.voice : 'alex';
      if (!this.status().ttsVoices?.includes(voice as LocalVoice))
        throw new Error('A voz Kokoro escolhida ainda não está instalada. Use Tentar instalar novamente.');
      payload.voice = voice;
      if (!payload.text) throw new Error('Não há texto para ler.');
    } else if (op === 'transcribe') {
      const input = request as TranscribeRequest;
      if (
        typeof input.audio !== 'string' ||
        input.audio.length > 5592408 ||
        !input.audio.length ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio)
      )
        throw new Error('Áudio inválido ou maior que 4 MB.');
      payload.audio = input.audio;
      payload.live = input.live === true;
      payload.vocabulary = Array.isArray(input.vocabulary)
        ? input.vocabulary.filter((word) => typeof word === 'string').slice(0, 100)
        : [];
    }
    clearTimeout(this.idle);
    const child = this.start();
    try {
      return await new Promise<Results[K]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const pending = this.pending;
          if (pending?.owner === owner && pending.op === op) {
            this.pending = null;
            pending.release();
            pending.reject(new Error('A voz local excedeu o tempo limite.'));
            this.dispose();
          }
        }, 120000);
        let release = () => {};
        const finished = new Promise<void>((done) => {
          release = done;
        });
        this.pending = {
          child,
          owner,
          op,
          finished,
          release,
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value as Results[K]);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        };
        child.stdin.write(JSON.stringify(payload) + '\n');
      });
    } finally {
      this.idle = setTimeout(() => this.dispose(), 300000);
      this.idle.unref();
    }
  }
  cancel(owner: Owner, op: Operation): boolean {
    if (!this.pending || this.pending.owner !== owner || this.pending.op !== op) return false;
    this.pending.cancelled = true;
    return true;
  }
  dispose(): void {
    this.warmed = false;
    clearTimeout(this.idle);
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
export class DuplexVoiceService implements VoiceDriver {
  tts: LocalVoiceService;
  stt: LocalVoiceService;
  constructor(options: Options = {}) {
    this.tts = new LocalVoiceService({ ...options, engine: 'tts' });
    this.stt = new LocalVoiceService({ ...options, engine: 'stt' });
  }
  status(): LocalVoiceStatus {
    const a = this.tts.status(),
      b = this.stt.status();
    return {
      ...a,
      loaded: a.loaded && b.loaded,
      ttsLoaded: a.loaded,
      sttLoaded: b.loaded,
      ttsVoices: a.ttsVoices,
      warming: a.warming || b.warming,
      wakewordReady: a.wakewordReady || b.wakewordReady,
    };
  }
  install() {
    return this.tts.install();
  }
  warm(owner: Owner, engine: VoiceEngine = 'tts') {
    if (!['stt', 'tts'].includes(engine)) throw new Error('Motor de voz inválido.');
    return this[engine].warm(owner);
  }
  request<K extends Operation>(op: K, request: Requests[K], owner: Owner) {
    return (op === 'speak' ? this.tts : this.stt).request(op, request, owner);
  }
  cancel(owner: Owner, op: Operation) {
    return (op === 'speak' ? this.tts : this.stt).cancel(owner, op);
  }
  dispose() {
    this.tts.dispose();
    this.stt.dispose();
  }
}
