import { useState } from 'react';
import type { PanelId, Preferences } from '../../../shared/types';
import Dialog from '../../../components/ui/Dialog';
import { panelNames } from '../preferences';
import { openWorkspaceWindow } from '../open-window';

export default function PanelSettings({
  id,
  prefs,
  patch,
}: {
  id: PanelId;
  prefs: Preferences;
  patch(values: Partial<Preferences>): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-button panel-settings-button"
        aria-label={'Configurar ' + panelNames[id]}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open && (
        <Dialog title={panelNames[id]} onClose={() => setOpen(false)}>
          {id !== 'assistant' && (
            <label className="setting-row">
              <span>Ampliar painel</span>
              <input
                type="checkbox"
                checked={prefs.wide.includes(id)}
                onChange={(event) =>
                  patch({
                    wide: event.target.checked
                      ? [...new Set([...prefs.wide, id])]
                      : prefs.wide.filter((item) => item !== id),
                  })
                }
              />
            </label>
          )}
          <div className="command-list">
            {id !== 'assistant' && (
              <button
                type="button"
                onClick={() => {
                  patch({ order: prefs.order.filter((item) => item !== id).concat(id) });
                  setOpen(false);
                }}
              >
                Mover para o final
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                openWorkspaceWindow(id);
                setOpen(false);
              }}
            >
              Abrir em nova janela
            </button>
            {id !== 'assistant' && (
              <button
                type="button"
                onClick={() => {
                  patch({ hidden: [...new Set([...prefs.hidden, id])] });
                  setOpen(false);
                }}
              >
                Ocultar painel
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
