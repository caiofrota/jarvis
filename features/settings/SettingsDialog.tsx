import type { Preferences, Profile } from '../../shared/types';
import { profiles } from '../workspace/preferences';

export default function SettingsDialog({
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
