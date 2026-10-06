import { openWorkspaceWindow } from '../../features/workspace/open-window';
import type { OpenDialog } from '../../shared/types';
import Link from 'next/link';
export default function Shell({
  children,
  primary,
  open,
  focused,
  setFocused,
  error,
}: {
  children: React.ReactNode;
  primary: boolean;
  open: OpenDialog;
  focused: boolean;
  setFocused: (value: boolean) => void;
  error: string;
}) {
  return (
    <div className="shell">
      <aside className="rail" aria-label="Navegação">
        <Link className="brand" href="./index.html" aria-label="Jarvis início" prefetch={false}>
          J<span>·</span>
        </Link>
        <button
          className={'rail-button ' + (!focused ? 'selected' : '')}
          onClick={() => setFocused(false)}
          aria-label="Visão geral"
        >
          ◈
        </button>
        <button
          className={'rail-button ' + (focused ? 'selected' : '')}
          hidden={!primary}
          disabled={!primary}
          onClick={() => setFocused(true)}
          aria-label="Modo foco"
        >
          ◎
        </button>
        <div className="rail-bottom">
          <button className="rail-button" onClick={() => open('settings')} aria-label="Configurações">
            ⚙
          </button>
          <span className="avatar">J</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="wordmark">JARVIS</div>
          <div className="top-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => open('panels')}
              aria-label="Mostrar painéis"
              aria-haspopup="dialog"
            >
              ▦
            </button>
            <button className="button small new-workspace" onClick={() => openWorkspaceWindow()}>
              Nova janela
            </button>
            <button className="search-button" onClick={() => open('commands')}>
              Comandos <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>
        <main>
          <div className="workspace-bar">
            {!primary && <span className="window-kind">Cards desta janela</span>}
            <div className="workspace-tabs" hidden={!primary}>
              <button className={'tab ' + (!focused ? 'active' : '')} onClick={() => setFocused(false)}>
                Visão geral
              </button>
              <button className={'tab ' + (focused ? 'active' : '')} onClick={() => setFocused(true)}>
                Foco
              </button>
            </div>
            <div className="workspace-tools">{error && <span role="alert">{error}</span>}</div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
