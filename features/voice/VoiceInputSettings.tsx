import type { ReturnTypeVoiceInput } from './voice-types';
import type { InputMode } from '../../shared/types';

export default function VoiceInputSettings({
  voice: v,
  continuous = false,
}: {
  voice: ReturnTypeVoiceInput;
  continuous?: boolean;
}) {
  const desktop = typeof window !== 'undefined' && !!window.jarvisDesktop;
  return (
    <>
      <label className="setting-row">
        <span>
          <strong>Reconhecimento da sua voz</strong>
        </span>
        <select
          aria-label="Reconhecimento da voz"
          value={v.mode}
          disabled={v.recording || v.processing}
          onChange={(event) => v.choose(event.target.value as InputMode)}
        >
          <option value="browser" disabled={!v.available}>
            Chrome online · grátis
          </option>
          <option value="local">Local/offline · Whisper base</option>
          <option value="cloud">OpenAI · API paga</option>
        </select>
      </label>
      <p className="voice-disclosure">
        {v.mode === 'browser'
          ? 'Áudio enviado ao serviço do navegador. Grátis.'
          : v.mode === 'local'
            ? 'Áudio processado neste computador. Grátis.'
            : continuous
              ? 'Envia cada fala à OpenAI. API paga.'
              : 'Envia a gravação à OpenAI. API paga.'}
      </p>
      <label className="setting-row">
        <span>
          <strong>Ativar ao dizer “JARVIS”</strong>
        </span>
        <input
          type="checkbox"
          aria-label="Ativar wakeword JARVIS"
          checked={desktop && v.wakeword.enabled}
          disabled={!desktop || v.recording || v.processing || !v.wakeword.available}
          onChange={(event) => void v.toggleWakeword(event.target.checked)}
        />
      </label>
      <p className="voice-disclosure">
        {!desktop
          ? 'Ativação por voz disponível no desktop.'
          : v.wakeword.listening
            ? 'Ativação por voz ligada.'
            : v.wakeword.available
              ? 'Wakeword pausado.'
              : v.wakeword.message || 'Detector local ainda não instalado.'}
      </p>
      {desktop && !v.wakeword.available && (
        <button className="button" disabled={v.local.installing} onClick={() => void v.installWakeword()}>
          {v.local.installing ? 'Instalando detector…' : 'Instalar detector local'}
        </button>
      )}
      {desktop && v.wakeword.error && <p className="feature-error">{v.wakeword.error}</p>}
      {v.needsLocal && (
        <div role="status">
          {v.local.ready
            ? 'Componentes de voz local instalados.'
            : v.local.message || 'Verificando a instalação local…'}
          {(v.local.error || v.error) && !v.local.ready && (
            <>
              {v.local.error && <p className="feature-error">{v.local.error}</p>}
              <button className="button" disabled={v.local.installing} onClick={v.retry}>
                Tentar instalar novamente
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
