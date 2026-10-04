const root = globalThis;
interface RecognitionOptions {
  Recognition?: typeof SpeechRecognition;
  onText?: (text: string) => void;
  onUtterance?: (text: string) => void;
  onError?: (message: string) => void;
  onState?: (message: string) => void;
}
class BrowserRecognition {
  Recognition: typeof SpeechRecognition | undefined;
  onText: (text: string) => void;
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
  onState: (message: string) => void;
  running: boolean;
  paused = false;
  prefix: string;
  results: Map<number, { text: string; final: boolean }>;
  pending: string;
  lastFinal: number;
  restarts: number[];
  text = '';
  recognition: SpeechRecognition | null = null;
  settle: ReturnType<typeof setTimeout> | undefined;
  restart: ReturnType<typeof setTimeout> | undefined;
  constructor({
    Recognition = root.SpeechRecognition || root.webkitSpeechRecognition,
    onText = () => {},
    onUtterance = () => {},
    onError = () => {},
    onState = () => {},
  }: RecognitionOptions = {}) {
    this.Recognition = Recognition;
    this.onText = onText;
    this.onUtterance = onUtterance;
    this.onError = onError;
    this.onState = onState;
    this.running = false;
    this.prefix = '';
    this.results = new Map();
    this.pending = '';
    this.lastFinal = -1;
    this.restarts = [];
  }
  start() {
    if (!this.Recognition)
      throw new Error('Reconhecimento do navegador indisponível. Use Chrome ou escolha Local/offline.');
    if (this.running) return;
    this.running = true;
    this.open();
  }
  open() {
    if (!this.running || this.paused) return;
    if (!this.Recognition) return;
    const r = new this.Recognition();
    this.recognition = r;
    this.results.clear();
    this.lastFinal = -1;
    r.lang = 'pt-BR';
    r.continuous = true;
    r.interimResults = true;
    if ('processLocally' in r) r.processLocally = false;
    r.onstart = () => this.onState('Ouvindo pelo navegador online…');
    r.onspeechstart = () => clearTimeout(this.settle);
    r.onresult = (e) => {
      if (!this.running || this.paused || this.recognition !== r) return;
      clearTimeout(this.settle);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const item = e.results[i];
        this.results.set(i, { text: item[0].transcript.trim(), final: item.isFinal });
        if (item.isFinal && i > this.lastFinal) {
          this.pending = (this.pending + ' ' + item[0].transcript).trim();
          this.lastFinal = i;
        }
      }
      this.text = [this.prefix, ...this.results.values()]
        .map((x) => (typeof x === 'string' ? x : x.text))
        .filter(Boolean)
        .join(' ')
        .trim();
      this.onText(this.text);
      if (this.pending && ![...this.results.values()].some((x) => !x.final)) {
        const delay = /\b(e|ou|mas|porque|para|de|do|da|com|um|uma|o|a)$/i.test(this.pending) ? 1600 : 700;
        this.settle = setTimeout(() => {
          const text = this.pending;
          this.pending = '';
          if (this.running && text) this.onUtterance(text);
        }, delay);
      }
    };
    r.onerror = (e) => {
      if (!this.running || this.paused || this.recognition !== r) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.stop();
      this.onError(
        e.error === 'not-allowed'
          ? 'Permissão de microfone não concedida.'
          : e.error === 'network'
            ? 'O serviço online do navegador não respondeu. Confira sua conexão ou escolha o modo local.'
            : 'Reconhecimento indisponível: ' + e.error,
      );
    };
    r.onend = () => {
      if (!this.running || this.paused || this.recognition !== r) return;
      this.prefix = this.text || this.prefix;
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 10000);
      if (this.restarts.length >= 4) {
        this.stop();
        this.onError(
          'O navegador interrompeu a escuta repetidamente. Clique em Iniciar para tentar novamente.',
        );
        return;
      }
      this.restarts.push(now);
      this.restart = setTimeout(() => this.open(), 150);
    };
    try {
      r.start();
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      this.running = false;
      this.onError(e.message);
    }
  }
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    clearTimeout(this.settle);
    clearTimeout(this.restart);
    const old = this.recognition;
    this.recognition = null;
    if (old) {
      old.onend = null;
      old.onresult = null;
      old.onerror = null;
      old.abort();
    }
    this.pending = '';
    this.resetText();
    if (!paused && this.running) this.open();
  }
  resetText() {
    this.prefix = '';
    this.text = '';
    this.results.clear();
  }
  abort() {
    return this.stop();
  }
  stop() {
    this.running = false;
    clearTimeout(this.settle);
    clearTimeout(this.restart);
    if (this.recognition) {
      const r = this.recognition;
      this.recognition = null;
      r.onend = null;
      try {
        r.abort();
      } catch {}
    }
    return this.text || '';
  }
}

export { BrowserRecognition };
