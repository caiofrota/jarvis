import type { Preferences, OpenDialog } from '../../shared/types';
import type { IntelligenceController } from '../controllers';
import { profiles } from '../workspace/preferences';
export default function SystemPanel({
  prefs,
  ai,
  open,
}: {
  prefs: Preferences;
  ai: IntelligenceController;
  open: OpenDialog;
}) {
  const values = { eco: [2048, 'Após 2 min'], balanced: [4096, 'Após 10 min'], full: [8192, 'Após 30 min'] }[
    prefs.profile
  ];
  return (
    <div className="panel-body">
      <div className="resource-hero">
        <div>
          <p>{profiles[prefs.profile]}</p>
          <small>Uma resposta por vez</small>
        </div>
        <span className="resource-mark">⌁</span>
      </div>
      {[
        ['Inteligência', ai.config.provider === 'local' ? 'Ollama local' : 'API OpenAI'],
        ['Contexto local', values[0] + ' tokens'],
        ['Liberar modelo', values[1]],
        ['RAM do PC', ai.hardware ? ai.hardware.ramGiB + ' GB' : '…'],
      ].map(([name, value]) => (
        <div className="resource-row" key={name}>
          <span>{name}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <p className="resource-note">O tamanho do modelo também determina o uso de memória.</p>
      <button className="panel-link" onClick={() => open('settings')}>
        Ajustar meu ambiente ↗
      </button>
    </div>
  );
}
