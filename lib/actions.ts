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

function applicationNameKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+\(\d+\)$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isBrowserHostedAppId(appId: string) {
  return /(?:^|[._-])_?crx_/iu.test(appId);
}

function preferApplication(existing: ExecutableTarget, candidate: ExecutableTarget) {
  if (existing.available !== candidate.available) return candidate.available ? candidate : existing;
  const existingHasWindowsSuffix = /\s+\(\d+\)$/u.test(existing.label);
  const candidateHasWindowsSuffix = /\s+\(\d+\)$/u.test(candidate.label);
  return existingHasWindowsSuffix && !candidateHasWindowsSuffix ? candidate : existing;
}

export function deduplicateApplicationTargets(targets: ExecutableTarget[]) {
  const groups = new Map<string, ExecutableTarget[]>();
  const order: (string | ExecutableTarget)[] = [];
  for (const target of targets) {
    if (target.kind !== 'app') {
      order.push(target);
      continue;
    }
    const key = applicationNameKey(target.label);
    if (!key) {
      order.push(target);
      continue;
    }
    if (!groups.has(key)) order.push(key);
    groups.set(key, [...(groups.get(key) || []), target]);
  }
  return order.flatMap((entry) => {
    if (typeof entry !== 'string') return [entry];
    const group = groups.get(entry) || [];
    const packaged = group.filter((target) => target.target.includes('!'));
    if (packaged.length) {
      // A packaged Windows identity is the authoritative launcher for the
      // same display name, including the built-in executable alias.
      return packaged;
    }
    const builtIns = group.filter((target) => !target.id.startsWith('installed-app-'));
    if (builtIns.length) {
      return [builtIns.reduce((chosen, candidate) => preferApplication(chosen, candidate))];
    }
    // Two legacy identities remain ambiguous and must be shown to the user.
    return group;
  });
}
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { runtimeInfo } from './runtime';
function activateExisting(executable: string, args: string[]) {
  if (process.platform !== 'win32') return false;
  const argument = args[0] || '';
  const root = process.env.SystemRoot || 'C:\\Windows';
  const explorer = path.join(root, 'explorer.exe');
  if (
    executable.toLowerCase() === explorer.toLowerCase() &&
    !/^shell:AppsFolder\\/i.test(argument) &&
    !/\.lnk$/i.test(argument)
  )
    return false;
  try {
    const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JarvisWindowActivation {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
$command = $env:JARVIS_ACTIVATE_COMMAND
$argument = $env:JARVIS_ACTIVATE_ARGUMENT
$paths = @()
if ($command) { $paths += $command }
if ($argument -match '^shell:AppsFolder\\([^!]+)!') {
  $family = $Matches[1]
  $package = Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue | Where-Object PackageFamilyName -eq $family | Select-Object -First 1
  if ($package.InstallLocation) { $paths += $package.InstallLocation }
}
if ($argument -like '*.lnk') {
  try {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($argument)
    if ($shortcut.TargetPath) { $paths += $shortcut.TargetPath }
  } catch {}
}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $process = $_
  $handle = $process.MainWindowHandle
  if ($handle -eq 0) { return }
  try { $processPath = $process.Path } catch { return }
  if (!$processPath) { return }
  foreach ($pathCandidate in $paths) {
    if (!$pathCandidate) { continue }
    $prefix = $pathCandidate.TrimEnd('\\') + '\\'
    if ($processPath -ieq $pathCandidate -or $processPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      [JarvisWindowActivation]::ShowWindowAsync($handle, 9) > $null
      [JarvisWindowActivation]::SetForegroundWindow($handle) > $null
      exit 0
    }
  }
}
exit 1
`;
    execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      env: {
        ...process.env,
        JARVIS_ACTIVATE_COMMAND: executable,
        JARVIS_ACTIVATE_ARGUMENT: argument,
      },
      encoding: 'utf8',
      timeout: 1200,
      windowsHide: true,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}
function launch(executable: string, args: string[], newInstance = false): Promise<void> {
  if (!newInstance && activateExisting(executable, args)) return Promise.resolve();
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
  registeredApps?: unknown;
}
export function windowsRegisteredTargets(value: unknown, opener: string): ExecutableTarget[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  const candidates = rows.slice(0, 600).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const { Name: label, AppID: appId } = row;
    if (
      typeof label !== 'string' ||
      !label.trim() ||
      label.length > 200 ||
      typeof appId !== 'string' ||
      !appId ||
      appId.length > 1000 ||
      /[\p{Cc}"]/u.test(appId) ||
      isBrowserHostedAppId(appId) ||
      seen.has(appId.toLowerCase())
    )
      return [];
    seen.add(appId.toLowerCase());
    return [
      {
        id:
          'installed-app-' +
          crypto.createHash('sha256').update(appId.toLowerCase()).digest('hex').slice(0, 16),
        label: label.trim(),
        kind: 'app' as const,
        target: appId,
        command: opener,
        args: ['shell:AppsFolder\\' + appId],
        available: true,
      },
    ];
  });
  return deduplicateApplicationTargets(candidates);
}
function createCatalog({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  folders = {},
  project = projectRoot,
  registeredApps,
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
    let registrations = registeredApps;
    if (registrations === undefined) {
      try {
        const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        registrations = JSON.parse(
          execFileSync(
            powershell,
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; @(Get-StartApps | Select-Object Name, AppID) | ConvertTo-Json -Compress',
            ],
            { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true },
          ),
        );
      } catch {
        // Start-menu shortcuts remain usable when registration discovery is unavailable.
      }
    }
    installedApps.push(...windowsRegisteredTargets(registrations, opener));
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
    const seen = new Set(installedApps.map((item) => applicationNameKey(item.label)));
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
            normalized = applicationNameKey(label),
            parent = path.basename(path.dirname(file));
          if (
            !label ||
            reserved.has(normalized) ||
            seen.has(normalized) ||
            /\s+Apps$/iu.test(parent) ||
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
  const userDirs: Partial<Record<'documents' | 'downloads' | 'desktop', string>> = {};
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
    ...deduplicateApplicationTargets([...apps, ...installedApps]),
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
  pending = new Map<
    string,
    {
      item: ExecutableTarget;
      owner: Owner;
      expiresAt: number;
      newInstance: boolean;
    }
  >();
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
  prepare(id: string, owner: Owner, newInstance = false): PreparedAction {
    if (typeof newInstance !== 'boolean') throw new Error('Opção de nova instância inválida.');
    const item = this.items.find((i) => i.id === id);
    if (!item || !item.available) throw new Error('Esse destino não está disponível neste computador.');
    for (const [token, p] of this.pending)
      if (p.expiresAt <= this.now() || p.owner === owner) this.pending.delete(token);
    if (this.pending.size >= 100)
      throw new Error('Há muitas confirmações pendentes. Tente novamente em dois minutos.');
    const token = crypto.randomBytes(24).toString('hex'),
      expiresAt = this.now() + 120000;
    this.pending.set(token, {
      item: { ...item, args: [...item.args] },
      owner,
      expiresAt,
      newInstance,
    });
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
      if (pending.newInstance) await this.launcher(item.command, item.args, true);
      else await this.launcher(item.command, item.args);
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
