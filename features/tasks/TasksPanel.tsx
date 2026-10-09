import type { Task } from '../../shared/types';
import { useState } from 'react';
export default function TasksPanel({
  tasks,
  update,
  disabled = false,
}: {
  tasks: Task[];
  update: (tasks: Task[]) => unknown | Promise<boolean>;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(''),
    done = tasks.filter((t) => t.done).length;
  return (
    <div className="panel-body">
      <div className="task-summary">
        <div>
          <strong>{String(tasks.length - done).padStart(2, '0')}</strong> pendentes
        </div>
        <span>
          {done}/{tasks.length} feitas
        </span>
      </div>
      <div className="progress-track">
        <div style={{ width: (tasks.length ? (done / tasks.length) * 100 : 0) + '%' }} />
      </div>
      <div className="task-list">
        {tasks.length ? (
          tasks.map((t) => (
            <div key={t.id} className={'task-row ' + (t.done ? 'completed' : '')}>
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={t.done}
                  onChange={(e) =>
                    update(
                      tasks.map((item) => (item.id === t.id ? { ...item, done: e.target.checked } : item)),
                    )
                  }
                />
                <span>{t.text}</span>
              </label>
              <button
                className="delete"
                disabled={disabled}
                aria-label={'Excluir ' + t.text}
                onClick={() => update(tasks.filter((x) => x.id !== t.id))}
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <p className="empty">Adicione sua primeira tarefa.</p>
        )}
      </div>
      <form
        className="task-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (draft.trim() && tasks.length < 100) {
            const saved = await update([
              ...tasks,
              { id: crypto.randomUUID(), text: draft.trim(), done: false },
            ]);
            if (saved !== false) setDraft('');
          }
        }}
      >
        <input
          aria-label="Nova tarefa"
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={180}
          placeholder="Adicionar tarefa…"
          required
        />
        <button aria-label="Adicionar tarefa" disabled={disabled || tasks.length >= 100}>
          +
        </button>
      </form>
    </div>
  );
}
