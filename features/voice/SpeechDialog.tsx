import type { ChatController, SpeechController } from '../controllers';
import type { LocalVoice, OutputMode } from '../../shared/types';
export default function SpeechDialog({ speech, chat }: { speech: SpeechController; chat: ChatController }) {
  const { options, setOptions } = speech;
  return (
    <>
      <label className="setting-row">
        <span>
          <strong>Voz de resposta</strong>
        </span>
        <select
          aria-label="Voz de resposta"
          value={options.mode}
          onChange={(e) => {
            speech.stop();
            setOptions({ ...options, mode: e.target.value as OutputMode });
          }}
        >
          <option value="local">Kokoro · neural local grátis</option>
          <option value="system">Vozes locais do sistema · grátis</option>
          <option value="cloud">OpenAI · API paga</option>
        </select>
      </label>
      <p className="voice-disclosure">
        {options.mode === 'local'
          ? 'Local, sem cobrança.'
          : options.mode === 'system'
            ? 'Usa as vozes instaladas neste dispositivo.'
            : 'Envia texto à OpenAI. API paga.'}
      </p>
      {options.mode === 'system' && (
        <label className="setting-row">
          <span>Voz instalada</span>
          <select
            aria-label="Voz instalada"
            value={options.voiceURI}
            onChange={(e) => setOptions({ ...options, voiceURI: e.target.value })}
          >
            <option value="">Português padrão</option>
            {speech.voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {options.mode === 'local' && (
        <>
          <label className="setting-row">
            <span>
              <strong>Voz local</strong>
            </span>
            <select
              aria-label="Voz local"
              value={options.localVoice}
              onChange={(e) => setOptions({ ...options, localVoice: e.target.value as LocalVoice })}
            >
              <option value="alex">Alex · masculino natural</option>
              <option value="santa">Santa · masculino suave</option>
              <option value="dora">Dora · feminino natural</option>
            </select>
          </label>
          {speech.localVoiceStatus && !speech.localVoiceStatus.ttsVoices?.includes(options.localVoice) && (
            <p className="voice-disclosure">Voz não instalada. Use a instalação local acima.</p>
          )}
        </>
      )}
      <label className="setting-row">
        <span>Velocidade · {options.rate.toFixed(1)}×</span>
        <input
          aria-label="Velocidade da voz"
          type="range"
          min="0.7"
          max="1.3"
          step="0.1"
          value={options.rate}
          onChange={(e) => setOptions({ ...options, rate: Number(e.target.value) })}
        />
      </label>
      <div className="feature-buttons">
        <button
          className="button primary"
          disabled={!chat.latest || speech.busy}
          onClick={() => speech.read(chat.latest)}
        >
          Ouvir última resposta
        </button>
        <button className="button" onClick={speech.stop}>
          Parar áudio
        </button>
      </div>
      <p className="session-status" role="status">
        {speech.status}
      </p>
    </>
  );
}
