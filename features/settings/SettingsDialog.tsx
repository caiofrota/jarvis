import type { Preferences, Profile, PanelId } from '../../shared/types';
import { panelNames, profiles } from '../workspace/preferences';
export function SettingsDialog({
  prefs,
  patch,
}: {
  prefs: Preferences;
  patch: (values: Partial<Preferences>) => void;
}) {
  return (
    <>
      <label className="setting-row">
        <span>
          <strong>Desempenho</strong>
          <small>Limita o contexto e a permanência do modelo na memória.</small>
        </span>
        <select
          aria-label="Desempenho"
          value={prefs.profile}
          onChange={(e) => patch({ profile: e.target.value as Profile })}
        >
          {Object.entries(profiles).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="setting-row">
        <span>
          <strong>Cor de destaque</strong>
        </span>
        <select
          aria-label="Cor de destaque"
          value={prefs.color}
          onChange={(e) => patch({ color: e.target.value as Preferences['color'] })}
        >
          <option value="mint">Menta</option>
          <option value="blue">Azul</option>
          <option value="violet">Violeta</option>
        </select>
      </label>
      <label className="setting-row">
        <span>
          <strong>Animações</strong>
          <small>O modo econômico sempre reduz os efeitos.</small>
        </span>
        <input type="checkbox" checked={prefs.motion} onChange={(e) => patch({ motion: e.target.checked })} />
      </label>
      <p className="settings-foot">
        Em computadores com 8 ou 12 GB, combine o perfil econômico com um modelo menor no Ollama. O tamanho do
        modelo é o principal fator de memória.
      </p>
    </>
  );
}
export function PanelsDialog({
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
export function AddonsDialog() {
  return (
    <>
      {[
        ['Calendário', 'A agenda ainda mostra exemplos. A conexão com sua conta será uma próxima etapa.'],
        ['Trello', 'Integração planejada. Nenhum quadro ou conta está conectado.'],
        ['Meu computador', 'Abertura direta de aplicativos e pastas disponíveis neste PC.'],
      ].map(([name, text]) => (
        <div className="addon-card" key={name}>
          <div className="addon-info">
            <strong>{name}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </>
  );
}
