import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Rectangle } from 'electron';
import type { PanelId } from '../shared/types';

export interface WindowState {
  id: string;
  panel: PanelId | 'main';
  bounds?: Rectangle;
  maximized?: boolean;
  fullscreen?: boolean;
}
interface SessionWindow {
  isDestroyed(): boolean;
  getNormalBounds(): Rectangle;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  close(): void;
}
export const windowPanels = [
  'main',
  'assistant',
  'calendar',
  'tasks',
  'notes',
  'system',
  'computer',
] as const;

export function validateWindowSession(value: unknown): WindowState[] {
  const raw = value as { version?: unknown; windows?: unknown } | null;
  if (raw?.version !== 1 || !Array.isArray(raw.windows)) return [];
  const seen = new Set<string>();
  return raw.windows.flatMap((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
      seen.has(item.id) ||
      !windowPanels.includes(item.panel) ||
      (item.id === 'main' && item.panel !== 'main')
    )
      return [];
    seen.add(item.id);
    const bounds = item.bounds;
    const validBounds =
      bounds &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(bounds[key])) &&
      Math.abs(bounds.x) < 100000 &&
      Math.abs(bounds.y) < 100000 &&
      bounds.width >= 360 &&
      bounds.width <= 16000 &&
      bounds.height >= 420 &&
      bounds.height <= 16000;
    return [
      {
        id: item.id,
        panel: item.panel,
        ...(validBounds ? { bounds } : {}),
        maximized: item.maximized === true,
        fullscreen: item.fullscreen === true,
      },
    ];
  });
}

export function reachableBounds(bounds: Rectangle, displays: Rectangle[]): Rectangle {
  if (
    displays.some(
      (display) =>
        bounds.x >= display.x &&
        bounds.y >= display.y &&
        bounds.x + Math.min(bounds.width, 100) <= display.x + display.width &&
        bounds.y + 50 <= display.y + display.height,
    )
  )
    return bounds;
  const display = displays[0];
  if (!display) return bounds;
  return {
    x: display.x,
    y: display.y,
    width: Math.min(bounds.width, display.width),
    height: Math.min(bounds.height, display.height),
  };
}

export class WindowSession {
  closing = false;
  private panels = new Map<string, { panel: WindowState['panel']; pending?: WindowState }>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private file: string,
    private windows: Map<string, SessionWindow>,
  ) {}

  read(): WindowState[] {
    try {
      const state = validateWindowSession(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      return [
        state.find((saved) => saved.id === 'main') || { id: 'main', panel: 'main' },
        ...state.filter((item) => item.id !== 'main'),
      ];
    } catch {
      return [{ id: 'main', panel: 'main' }];
    }
  }
  register(id: string, panel: WindowState['panel'], pending?: WindowState) {
    this.panels.set(id, { panel, pending });
  }
  restored(id: string) {
    const item = this.panels.get(id);
    if (item) item.pending = undefined;
    this.changed();
  }
  changed() {
    if (this.closing) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 250);
  }
  removed(id: string) {
    this.panels.delete(id);
    if (!this.closing) this.save();
  }
  save() {
    if (this.closing) return;
    const state = [...this.windows].flatMap(([id, window]) => {
      const item = this.panels.get(id);
      return !window.isDestroyed() && item
        ? [
            {
              id,
              panel: item.panel,
              bounds: window.getNormalBounds(),
              maximized: item.pending ? item.pending.maximized === true : window.isMaximized(),
              fullscreen: item.pending ? item.pending.fullscreen === true : window.isFullScreen(),
            },
          ]
        : [];
    });
    if (!state.some((item) => item.id === 'main')) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, windows: state }), { mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (cause) {
      console.error('Unable to save the desktop window session:', cause);
    }
  }
  closeAll(except?: string) {
    if (this.closing) return;
    clearTimeout(this.timer);
    this.save();
    this.closing = true;
    for (const [id, window] of [...this.windows]) {
      if (id !== except && !window.isDestroyed()) window.close();
    }
  }
}
