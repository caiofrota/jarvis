import type { IntelligenceController } from '../controllers';
import type { Provider } from '../../shared/types';
import { useState } from 'react';
export default function IntelligenceDialog({ ai, busy }: { ai: IntelligenceController; busy: boolean }) {
  const [key, setKey] = useState(''),
    [message, setMessage] = useState(''),
    [showKey, setShowKey] = useState(false);
  async function connect(value: string) {
    try {
      await ai.connect(value);
      setKey('');
      setMessage(value ? 'Chave conectada.' : 'Chave desconectada.');
    } catch (eCause) {
      const e = eCause instanceof Error ? eCause : new Error(String(eCause));
      setMessage(e.message);
    }
  }
  return (
    <>
      <p className="dialog-description">
        Conversas separadas por provedor e modelo. O histórico, as tarefas e os nomes dos aplicativos ajudam a
        IA a entender seus pedidos. No modo nuvem, esses dados são enviados ao provedor escolhido.
      </p>
      <label className="setting-row">
        <span>
          <strong>Onde a IA funciona</strong>
        </span>
        <select
          aria-label="Provedor da IA"
          value={ai.config.provider}
          disabled={busy}
          onChange={(e) => ai.setProvider(e.target.value as Provider)}
        >
          <option value="local">Neste computador · Ollama</option>
          <option value="cloud">Na nuvem · OpenAI</option>
        </select>
      </label>
      {ai.config.provider === 'cloud' ? (
        <div className="cloud-key">
          <label htmlFor="api-key">Chave da API OpenAI</label>
          <div className="key-row">
            <input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={ai.status.cloudConfigured ? 'Chave conectada' : 'Insira sua chave'}
            />
            <button className="button" onClick={() => connect(key)}>
              Conectar
            </button>
            <button
              className="button"
              type="button"
              aria-label={showKey ? 'Ocultar chave da API' : 'Mostrar chave da API'}
              aria-pressed={showKey}
              onClick={() => setShowKey((visible) => !visible)}
            >
              {showKey ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p>
            No aplicativo desktop, a chave fica protegida pelo armazenamento seguro do sistema e volta nas
            próximas inicializações. Na prévia do Chrome, ela fica no localStorage deste perfil para os testes
            e não é criptografada. Texto e histórico são enviados à OpenAI; o uso pode gerar cobranças.
          </p>
          <button className="panel-link" onClick={() => connect('')}>
            Desconectar chave
          </button>
        </div>
      ) : (
        <p className="settings-foot">
          Mantenha o Ollama aberto neste PC. Nenhum modelo de IA será baixado automaticamente.
        </p>
      )}
      {ai.config.provider === 'local' && (
        <label className="setting-row">
          <span>
            <strong>Manter IA pronta</strong>
            <small>
              Enquanto a janela principal estiver aberta. Evita recarregar entre conversas e mantém o modelo
              ocupando memória.
            </small>
          </span>
          <input
            type="checkbox"
            checked={ai.config.keepReady}
            onChange={(e) => ai.setKeepReady(e.target.checked)}
          />
        </label>
      )}
      <label className="setting-row">
        <span>
          <strong>Modelo</strong>
        </span>
        <select
          id="ai-model"
          aria-label="Modelo de IA"
          value={ai.model}
          disabled={busy || ai.loading}
          onChange={(e) => ai.setModel(e.target.value)}
        >
          <option value="">Escolha um modelo</option>
          {ai.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
              {m.size ? ' · ' + (m.size / 1e9).toFixed(1) + ' GB' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="connection-status" role="status">
        {message ||
          ai.error ||
          ai.preparationText ||
          (ai.loading ? 'Buscando modelos…' : ai.models.length + ' modelo(s) disponível(is).')}
      </p>
      <button className="button small" disabled={busy || ai.loading} onClick={ai.refresh}>
        Atualizar modelos
      </button>
    </>
  );
}
