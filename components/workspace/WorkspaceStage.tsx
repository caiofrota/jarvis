import { useState } from 'react';
import type { PanelId, Preferences } from '../../shared/types';
import { useCardGrid } from '../../features/workspace/useCardGrid';
import Panel from './Panel';
import PanelSettings from '../../features/workspace/PanelSettings/PanelSettings';
export default function WorkspaceStage({
  contents,
  prefs,
  patch,
  drag,
  openPanels,
  calendarDemo = true,
  detachable = true,
}: {
  contents: Record<PanelId, React.ReactNode>;
  prefs: Preferences;
  patch(values: Partial<Preferences>): void;
  drag: React.RefObject<PanelId | null>;
  openPanels(): void;
  calendarDemo?: boolean;
  detachable?: boolean;
}) {
  const cards = prefs.order.filter((id) => id !== 'assistant' && !prefs.hidden.includes(id));
  const assistant = !prefs.hidden.includes('assistant');
  const grid = useCardGrid(assistant, cards.length);
  const [mobileCards, setMobileCards] = useState(false);
  const isPage = (index: number) => index >= grid.start && index < grid.start + grid.capacity;
  const visible = cards.filter((_, index) => isPage(index));
  const sideLayout = assistant && !grid.compact;
  const columns = Math.min(grid.columns, Math.max(1, visible.length));
  const tileRows = Array.from({ length: Math.max(1, Math.ceil(visible.length / columns)) }, (_, row) =>
    visible.slice(row * columns, (row + 1) * columns).some((id) => prefs.wide.includes(id))
      ? 'minmax(0,1.2fr)'
      : 'minmax(0,1fr)',
  ).join(' ');
  const renderCard = (id: PanelId, index: number) => (
    <div
      key={id}
      hidden={!isPage(index)}
      className={'workspace-card' + (prefs.wide.includes(id) ? ' expanded' : '')}
    >
      <Panel
        id={id}
        prefs={prefs}
        patch={patch}
        drag={drag}
        detached={null}
        calendarDemo={calendarDemo}
        detachable={detachable}
      >
        {contents[id]}
      </Panel>
    </div>
  );
  return (
    <div className={'workspace-stage fitted-stage' + (!assistant ? ' cards-only' : '')}>
      {assistant && (
        <section
          hidden={grid.compact && mobileCards}
          className="workspace-core"
          data-panel="assistant"
          aria-label="Assistente"
        >
          <div className="core-panel-tools">
            <PanelSettings id="assistant" prefs={prefs} patch={patch} detachable={detachable} />
          </div>
          {contents.assistant}
        </section>
      )}
      {assistant && grid.compact && (
        <button className="button small compact-card-toggle" onClick={() => setMobileCards(!mobileCards)}>
          {mobileCards ? 'Voltar ao Jarvis' : 'Mostrar cards'}
        </button>
      )}
      <div
        className={'fitted-cards ' + (sideLayout ? 'side-cards' : 'tile-cards')}
        hidden={assistant && grid.compact && !mobileCards}
        style={
          !sideLayout
            ? {
                gridTemplateColumns: 'repeat(' + columns + ', minmax(0,1fr))',
                gridTemplateRows: tileRows,
              }
            : undefined
        }
      >
        {sideLayout
          ? [0, 1].map((side) => {
              const rows = visible.filter((_, index) => index % 2 === side);
              return (
                <div
                  key={side}
                  className={'card-stack ' + (side ? 'right' : 'left')}
                  style={{
                    gridTemplateRows:
                      rows
                        .map((id) => (prefs.wide.includes(id) ? 'minmax(0,1.2fr)' : 'minmax(0,1fr)'))
                        .join(' ') || '1fr',
                  }}
                >
                  {cards.map((id, index) => (index % 2 === side ? renderCard(id, index) : null))}
                </div>
              );
            })
          : cards.map(renderCard)}
      </div>
      {grid.pages > 1 && (!assistant || !grid.compact || mobileCards) && (
        <nav className="card-pages" aria-label="Páginas de cards">
          <button
            className="button small"
            disabled={grid.current === 0}
            onClick={() => grid.setPage(grid.current - 1)}
            aria-label="Cards anteriores"
          >
            ←
          </button>
          <span>
            Cards {grid.current + 1} de {grid.pages}
          </span>
          <button
            className="button small"
            disabled={grid.current === grid.pages - 1}
            onClick={() => grid.setPage(grid.current + 1)}
            aria-label="Próximos cards"
          >
            →
          </button>
        </nav>
      )}
      {!assistant && !cards.length && (
        <div className="empty-workspace">
          <h2>Esta janela está livre.</h2>
          <button className="button" onClick={openPanels}>
            Escolher cards
          </button>
        </div>
      )}
    </div>
  );
}
