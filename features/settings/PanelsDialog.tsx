import type { PanelId, Preferences } from '../../shared/types';
import { panelNames } from '../workspace/preferences';

export default function PanelsDialog({
  prefs,
  primary,
  patch,
}: {
  prefs: Preferences;
  primary: boolean;
  patch: (values: Partial<Preferences>) => void;
}) {
  return (
    <>
      {(Object.entries(panelNames) as [PanelId, string][])
        .filter(([id]) => primary || id !== 'assistant')
        .map(([id, name]) => (
          <label className="setting-row" key={id}>
            <strong>{name}</strong>
            <input
              aria-label={name}
              type="checkbox"
              checked={!prefs.hidden.includes(id)}
              onChange={(e) =>
                patch({
                  hidden: e.target.checked ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id],
                })
              }
            />
          </label>
        ))}
      <p className="settings-foot">
        Estas escolhas valem apenas para esta janela. Arraste os cards para mudar a ordem e o lado. A seta
        diagonal abre outra janela, com sua própria seleção. Tarefas e notas continuam compartilhadas.
      </p>
    </>
  );
}
