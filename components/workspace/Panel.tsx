import { openWorkspaceWindow } from '../../features/workspace/open-window';
import type { PanelId, Preferences } from '../../shared/types';
import { panelNames } from '../../features/workspace/preferences';
export default function Panel({
  id,
  prefs,
  patch,
  detached,
  children,
  drag,
}: {
  id: PanelId;
  prefs: Preferences;
  patch: (p: Partial<Preferences>) => void;
  detached: PanelId | null;
  children: React.ReactNode;
  drag: React.RefObject<PanelId | null>;
}) {
  function move() {
    patch({ order: prefs.order.filter((x) => x !== id).concat(id) });
  }
  function drop(e: React.DragEvent) {
    e.preventDefault();
    const source = drag.current;
    if (!source || source === id) return;
    const order = prefs.order.filter((x) => x !== source);
    order.splice(order.indexOf(id), 0, source);
    drag.current = null;
    patch({ order });
  }
  function detach() {
    openWorkspaceWindow(id);
  }
  return (
    <section
      className={
        'panel ' + (prefs.wide.includes(id) ? 'wide ' : '') + (detached === id ? 'detached-active' : '')
      }
      data-panel={id}
      aria-label={panelNames[id]}
      onDragOver={(e) => {
        if (drag.current) e.preventDefault();
      }}
      onDrop={drop}
    >
      <header className="panel-head">
        <span className="panel-icon" aria-hidden="true">
          {id === 'assistant' ? '◉' : '▦'}
        </span>
        <h2>{panelNames[id]}</h2>
        {id === 'calendar' && <span className="badge">DEMO</span>}
        <div className="panel-tools">
          <button
            className="icon-button drag-handle"
            draggable
            onDragStart={(e) => {
              drag.current = id;
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragEnd={() => (drag.current = null)}
            onClick={move}
            aria-label={'Mover ' + panelNames[id] + ' para o final'}
            title="Arraste ou clique para mover"
          >
            ⠿
          </button>
          <button
            className="icon-button"
            onClick={() =>
              patch({
                wide: prefs.wide.includes(id) ? prefs.wide.filter((x) => x !== id) : [...prefs.wide, id],
              })
            }
            aria-label={'Dar mais espaço a ' + panelNames[id]}
          >
            ↕
          </button>
          <button className="icon-button" onClick={detach} aria-label={'Destacar ' + panelNames[id]}>
            ↗
          </button>
        </div>
      </header>
      {children}
    </section>
  );
}
