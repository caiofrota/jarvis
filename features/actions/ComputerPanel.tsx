import type { ActionsController } from '../controllers';
import { useState } from 'react';
export default function ComputerPanel({ actions }: { actions: ActionsController }) {
  const [message, setMessage] = useState('');
  return (
    <div className="panel-body computer-body">
      {actions.runtime?.restricted && <p className="runtime-warning">{actions.runtime.message}</p>}
      <div className="action-grid">
        {[...actions.items, ...actions.apps].map((item) => (
          <button
            key={item.id}
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
        ))}
      </div>
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
