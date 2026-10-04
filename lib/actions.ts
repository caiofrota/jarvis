import type {
  Target,
  Owner,
  RuntimeInfo,
  ActionRecord,
  ActionCatalog,
  PreparedAction,
  ActionResult,
} from '../shared/types';
import { projectRoot } from './paths';
export interface ExecutableTarget extends Target {
  command: string | null | undefined;
  args: string[];
  target: string;
}
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { runtimeInfo } from './runtime';
function launch(executable: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: !/(?:calc|notepad|explorer)\.exe$/i.test(executable),
    });
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.unref();
      resolve();
    }, 700);
    child.once('error', () => {
      clearTimeout(timer);
      if (!settled) reject(new Error('O sistema não permitiu iniciar esse aplicativo.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        if (code && code !== 0) reject(new Error('O aplicativo recusou a abertura.'));
        else resolve();
      }
    });
  });
}
interface CatalogOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  folders?: Partial<Record<'documents' | 'downloads' | 'desktop', string>>;
  project?: string;
}
function createCatalog({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  folders = {},
  project = projectRoot,
}: CatalogOptions = {}): ExecutableTarget[] {
  const stat = (p: string, type: 'isFile' | 'isDirectory') => {
    try {
      return fs.statSync(p)[type]();
    } catch {
      return false;
    }
  };
  const executable = (name: string) => {
    for (const base of (env.PATH || '').split(path.delimiter)) {
      if (!path.isAbsolute(base)) continue;
      const p = path.join(base, name);
      if (stat(p, 'isFile')) return p;
    }
    return null;
  };
  const windows = platform === 'win32',
    linux = platform === 'linux',
    root = env.SystemRoot || 'C:\\Windows';
  const opener = windows ? path.join(root, 'explorer.exe') : linux ? executable('xdg-open') : null;
  const app = (id: string, label: string, candidates: (string | null)[]): ExecutableTarget => {
    const command = candidates.find((p) => p && stat(p, 'isFile'));
    return { id, label, kind: 'app', target: command || '', command, args: [], available: !!command };
  };
  const apps = windows
    ? [
        app('calculator', 'Calculadora', [path.join(root, 'System32', 'calc.exe')]),
        app('text-editor', 'Bloco de notas', [path.join(root, 'System32', 'notepad.exe')]),
      ]
    : linux
      ? [
          app('calculator', 'Calculadora', [
            executable('gnome-calculator'),
            executable('kcalc'),
            executable('galculator'),
          ]),
          app('text-editor', 'Editor de texto', [
            executable('gnome-text-editor'),
            executable('gedit'),
            executable('kate'),
            executable('xed'),
            executable('mousepad'),
          ]),
        ]
      : [];
  const installedApps: ExecutableTarget[] = [];
  if (windows && opener && stat(opener, 'isFile')) {
    const roots = [
      path.join(
        env.ProgramData || path.join(root, 'ProgramData'),
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
      ),
      env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter((value): value is string => typeof value === 'string' && !!value);
    const reserved = new Set(['calculadora', 'bloco de notas']);
    const seen = new Set();
    const visit = (directory: string, depth = 0) => {
      if (depth > 5 || installedApps.length >= 600) return;
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file, depth + 1);
        else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.lnk') {
          const label = path.basename(entry.name, path.extname(entry.name)).trim(),
            normalized = label
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLocaleLowerCase('pt-BR');
          if (
            !label ||
            reserved.has(normalized) ||
            seen.has(normalized) ||
            /^(?:add a new|help for|ajuda do|administrative tools|uninstall)\b/i.test(label)
          )
            continue;
          seen.add(normalized);
          const id =
            'installed-app-' +
            crypto.createHash('sha256').update(file.toLowerCase()).digest('hex').slice(0, 16);
          installedApps.push({
            id,
            label,
            kind: 'app',
            target: file,
            command: opener,
            args: [file],
            available: true,
          });
        }
      }
    };
    for (const directory of roots) visit(directory);
  }
  let userDirs: Partial<Record<'documents' | 'downloads' | 'desktop', string>> = {};
  if (linux) {
    try {
      const config = fs.readFileSync(path.join(home, '.config/user-dirs.dirs'), 'utf8');
      for (const [key, variable] of [
        ['documents', 'DOCUMENTS'],
        ['downloads', 'DOWNLOAD'],
        ['desktop', 'DESKTOP'],
      ]) {
        const match = config.match(new RegExp('^XDG_' + variable + '_DIR="([^"\\r\\n]+)"', 'm'));
        if (match) {
          const candidate = match[1].replace(/^\$HOME(?=\/|$)/, home);
          if (path.isAbsolute(candidate) && !candidate.includes('$'))
            userDirs[key as keyof typeof userDirs] = candidate;
        }
      }
    } catch {}
  }
  return [
    ...apps,
    ...installedApps,
    ...[
      ['documents', 'Documentos', folders.documents || userDirs.documents || path.join(home, 'Documents')],
      ['downloads', 'Downloads', folders.downloads || userDirs.downloads || path.join(home, 'Downloads')],
      [
        'desktop',
        'Área de trabalho',
        folders.desktop ||
          userDirs.desktop ||
          [
            path.join(home, 'Desktop'),
            env.OneDrive && path.join(env.OneDrive, 'Desktop'),
            env.OneDrive && path.join(env.OneDrive, 'Área de Trabalho'),
          ].find((p) => p && stat(p, 'isDirectory')) ||
          path.join(home, 'Desktop'),
      ],
      ['project', 'Pasta do Jarvis', project],
    ].map<ExecutableTarget>(([id, label, target]) => ({
      id,
      label,
      kind: 'folder',
      target,
      command: opener,
      args: [target],
      available: !!opener && stat(opener, 'isFile') && stat(target, 'isDirectory'),
    })),
  ];
}
class ActionService {
  environment: RuntimeInfo;
  items: ExecutableTarget[];
  launcher: typeof launch;
  now: () => number;
  pending = new Map<string, { item: ExecutableTarget; owner: Owner; expiresAt: number }>();
  history: ActionRecord[] = [];
  constructor({
    catalog = createCatalog(),
    launcher = launch,
    now = Date.now,
    environment = runtimeInfo(),
  }: {
    catalog?: ExecutableTarget[];
    launcher?: typeof launch;
    now?: () => number;
    environment?: RuntimeInfo;
  } = {}) {
    this.environment = environment;
    this.items = catalog;
    this.launcher = launcher;
    this.now = now;
    this.pending = new Map();
    this.history = [];
  }
  list(): ActionCatalog {
    return {
      runtime: this.environment,
      items: this.items
        .filter((item) => !item.id.startsWith('installed-app-'))
        .map(({ id, label, kind, target, available }) => ({ id, label, kind, target, available })),
      apps: this.items
        .filter((item) => item.id.startsWith('installed-app-'))
        .map(({ id, label, kind, available }) => ({ id, label, kind, available })),
      history: this.history.slice(-20).reverse(),
    };
  }
  prepare(id: string, owner: Owner): PreparedAction {
    const item = this.items.find((i) => i.id === id);
    if (!item || !item.available) throw new Error('Esse destino não está disponível neste computador.');
    for (const [token, p] of this.pending)
      if (p.expiresAt <= this.now() || p.owner === owner) this.pending.delete(token);
    if (this.pending.size >= 100)
      throw new Error('Há muitas confirmações pendentes. Tente novamente em dois minutos.');
    const token = crypto.randomBytes(24).toString('hex'),
      expiresAt = this.now() + 120000;
    this.pending.set(token, { item: { ...item, args: [...item.args] }, owner, expiresAt });
    return { token, expiresAt, id: item.id, label: item.label, kind: item.kind, target: item.target };
  }
  cancel(owner: Owner) {
    for (const [token, p] of this.pending) if (p.owner === owner) this.pending.delete(token);
    return true;
  }
  async execute(token: string, owner: Owner): Promise<ActionResult> {
    const pending = this.pending.get(token);
    if (!pending || pending.owner !== owner)
      throw new Error('Confirmação inválida. Escolha a ação novamente.');
    this.pending.delete(token);
    if (pending.expiresAt <= this.now()) throw new Error('A confirmação expirou. Escolha a ação novamente.');
    const { item } = pending;
    if (this.environment.restricted) throw new Error(this.environment.message);
    const record: ActionRecord = {
      id: crypto.randomUUID(),
      label: item.label,
      at: new Date(this.now()).toISOString(),
      status: 'requested',
    };
    this.history.push(record);
    this.history = this.history.slice(-30);
    try {
      if (!item.command) throw new Error('Aplicativo indisponível.');
      await this.launcher(item.command, item.args);
      record.status = 'sent';
      return { status: 'sent', message: 'Pedido de abertura enviado ao sistema.', label: item.label };
    } catch (errorCause) {
      const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
      record.status = 'error';
      throw error;
    }
  }
}
export { ActionService, createCatalog };
