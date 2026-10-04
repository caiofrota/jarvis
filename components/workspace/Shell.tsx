import { openWorkspaceWindow } from '../../features/workspace/open-window';
import type { OpenDialog } from '../../shared/types';
export default function Shell({
  children,
  primary,
  open,
  focused,
  setFocused,
  error,
  reset,
}: {
  children: React.ReactNode;
  primary: boolean;
  open: OpenDialog;
  focused: boolean;
  setFocused: (value: boolean) => void;
  error: string;
  reset: () => void;
}) {
  return (
    <div className="shell">
      <aside className="rail" aria-label="Navegação">
        <a className="brand" href="./index.html" aria-label="Jarvis início">
          J<span>·</span>
        </a>
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
        <button className="rail-button" onClick={() => open('addons')} aria-label="Complementos">
          ⊞
        </button>
        <div className="rail-bottom">
          <button className="rail-button" onClick={() => open('settings')} aria-label="Preferências">
            ⚙
          </button>
          <span className="avatar">J</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="wordmark">
            JARVIS <span>STUDIO / 01</span>
          </div>
          <div className="top-actions">
            <button className="button small" onClick={() => open('panels')}>
              Personalizar painéis
            </button>
            <button className="button small" onClick={() => open('profile')}>
              Meu perfil
            </button>
            <button className="button small new-workspace" onClick={() => openWorkspaceWindow()}>
              Nova janela
            </button>
            <span className="preview-status">
              <i />
              Jarvis 0.4.0
            </span>
            <button className="search-button" onClick={() => open('commands')}>
              Comandos <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>
        <main>
          <div className="page-intro">
            <div>
              <p className="eyebrow">
                {new Date()
                  .toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
                  .toUpperCase()}{' '}
                / SEU ESPAÇO
              </p>
              <h1>
                Seu Jarvis. <span>Seu espaço.</span>
              </h1>
              <p className="subtitle">Organize o dia, suas ideias e o que vem a seguir.</p>
            </div>
            <button className="button" onClick={() => open('panels')}>
              ⊞ Personalizar painéis
            </button>
          </div>
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
            <div className="workspace-tools">
              <span>{error || 'Layout salvo nesta janela'}</span>
              <button className="icon-button" aria-label="Restaurar disposição" onClick={reset}>
                ↺
              </button>
            </div>
          </div>
          {children}
          <footer>
            <span>
              <i className="status-dot" />
              IA local e nuvem · Voz à sua escolha · Abertura direta
            </span>
            <span>
              VERSÃO 0.4.0 <b>·</b> WINDOWS + LINUX
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
