import type { ActionsController } from '../controllers';
import { useEffect, useState } from 'react';
import Dialog from '../../components/ui/Dialog';
import { relevantApplications } from '../../shared/action-relevance';
export default function ComputerPanel({ actions }: { actions: ActionsController }) {
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    const load = () => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem('jarvis-favorite-apps') || '[]');
        setFavorites(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
      } catch {
        setFavorites([]);
      }
    };
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((value) => value !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem('jarvis-favorite-apps', JSON.stringify(next));
    } catch {
      /* Session favorites remain usable. */
    }
  }
  const targets = [...actions.items, ...actions.apps];
  const relevant = relevantApplications(targets, actions.history, favorites);
  const visible = expanded
    ? targets.filter((item) =>
        item.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')),
      )
    : relevant;
  function tiles() {
    return visible.map((item) => (
      <div key={item.id} className="computer-app">
        <button
          className="action-tile"
          disabled={!item.available || actions.busy}
          onClick={async () => {
            try {
              setMessage(await actions.execute(item.id));
            } catch {
              setMessage('');
            }
          }}
        >
          <span>{item.kind === 'folder' ? '▤' : '⌘'}</span>
          <strong>{item.label}</strong>
          <small>{item.available ? 'Abrir' : 'Indisponível'}</small>
        </button>
        {item.kind === 'app' && (
          <button
            type="button"
            className="panel-link"
            aria-label={`${favorites.includes(item.id) ? 'Desafixar' : 'Fixar'} ${item.label}`}
            aria-pressed={favorites.includes(item.id)}
            onClick={() => toggleFavorite(item.id)}
          >
            {favorites.includes(item.id) ? '★ Fixado' : '☆ Fixar'}
          </button>
        )}
      </div>
    ));
  }
  return (
    <div className="panel-body computer-body">
      {actions.runtime?.restricted && <p className="runtime-warning">{actions.runtime.message}</p>}
      <div className="action-grid">{!expanded && tiles()}</div>
      {!relevant.length && (
        <p className="empty">
          Seus aplicativos mais usados aparecerão aqui. Abra ou fixe um aplicativo no catálogo para começar.
        </p>
      )}
      <button type="button" className="panel-link" onClick={() => setExpanded(true)}>
        Todos os aplicativos e pastas ({targets.length})
      </button>
      {expanded && (
        <Dialog title="Aplicativos e pastas" onClose={() => setExpanded(false)}>
          <input
            aria-label="Buscar aplicativos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar…"
          />
          <div className="action-grid computer-catalog">{tiles()}</div>
          {!visible.length && <p className="empty">Nenhum resultado.</p>}
        </Dialog>
      )}
      <p role="status" className={actions.error ? 'feature-error' : 'connection-status'}>
        {actions.error || message}
      </p>
      {actions.history.length > 0 && (
        <div className="activity">
          <h3>Atividade recente</h3>
          {actions.history.slice(0, 5).map((item) => (
            <p key={item.id}>
              <span>{item.label}</span>
              <small>
                {item.status === 'sent' ? 'Pedido enviado' : 'Falha'} ·{' '}
                {new Date(item.at).toLocaleTimeString('pt-BR')}
              </small>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
