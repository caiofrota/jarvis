import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { projectRoot } from './paths';
import type { Owner, WakewordStatus } from '../shared/types';

interface Options {
  root?: string;
  dataDir?: string;
  scriptsDir?: string;
  onDetected?: (owner: Owner) => void;
}

/** Owns the lightweight, local-only wakeword process. It never sends microphone audio to the renderer. */
export class WakeWordService {
  root: string;
  dataDir: string;
  scriptsDir: string;
  python: string;
  child: ChildProcessWithoutNullStreams | null = null;
  owner: Owner | null = null;
  enabled = false;
  error = '';
  message = '';
  onDetected?: (owner: Owner) => void;

  constructor({
    root = projectRoot,
    dataDir = path.join(root, '.voice-data'),
    scriptsDir = path.join(root, 'voice'),
    onDetected,
  }: Options = {}) {
    this.root = root;
    this.dataDir = dataDir;
    this.scriptsDir = scriptsDir;
    this.onDetected = onDetected;
    this.python = path.join(root, '.voice-env', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  }

  private isInstalled() {
    return (
      fs.existsSync(this.python) &&
      fs.existsSync(path.join(this.dataDir, 'wakeword.ready.json')) &&
      ['wake-models/melspectrogram.onnx', 'wake-models/embedding_model.onnx', 'wake-models/hey_jarvis_v0.1.onnx'].every(
        (file) => fs.existsSync(path.join(this.dataDir, file)),
      )
    );
  }

  status(): WakewordStatus {
    const available = this.isInstalled();
    return {
      available,
      enabled: this.enabled,
      listening: !!this.child,
      phrase: 'JARVIS',
      message:
        this.message ||
        (available ? 'Escuta local pronta. Diga JARVIS para iniciar.' : 'Instale o detector local para ativar o wakeword.'),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  start(owner: Owner): WakewordStatus {
    this.owner = owner;
    this.enabled = true;
    this.error = '';
    if (this.child) return this.status();
    if (!this.isInstalled()) {
      this.enabled = false;
      this.error = 'O detector local ainda não está instalado. Use “Instalar detector” nas opções de voz.';
      throw new Error(this.error);
    }
    const tempDir = path.join(this.dataDir, 'tmp');
    fs.mkdirSync(tempDir, { recursive: true });
    const child = spawn(this.python, ['-u', path.join(this.scriptsDir, 'wakeword.py'), this.dataDir], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        TMP: tempDir,
        TEMP: tempDir,
        TMPDIR: tempDir,
      },
    });
    this.child = child;
    let errors = '';
    child.stderr.on('data', (buffer: Buffer) => {
      errors = (errors + buffer.toString()).slice(-800);
    });
    const failure = (error?: Error) => {
      if (this.child !== child) return;
      this.child = null;
      this.enabled = false;
      this.error = error?.message || errors.trim() || 'O detector local foi encerrado.';
      this.message = 'Wakeword indisponível.';
    };
    child.once('error', failure);
    child.once('exit', (code) => {
      if (code !== 0) failure(new Error(errors.trim() || `Detector encerrado (${code ?? 'sem código'}).`));
      else failure();
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let event: { type?: string; error?: string };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'ready') {
        this.message = 'Escuta local ativa. Diga JARVIS para iniciar.';
      } else if (event.type === 'detected' && this.enabled && this.owner !== null) {
        this.onDetected?.(this.owner);
      } else if (event.type === 'error') {
        failure(new Error(event.error || 'O detector local não conseguiu acessar o microfone.'));
      }
    });
    return this.status();
  }

  stop(owner?: Owner): WakewordStatus {
    if (owner !== undefined && this.owner !== null && owner !== this.owner) return this.status();
    this.enabled = false;
    this.owner = null;
    this.child?.kill();
    this.child = null;
    this.message = 'Wakeword pausado.';
    return this.status();
  }

  dispose() {
    this.stop();
  }
}
