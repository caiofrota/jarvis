import VoiceInputSettings from './VoiceInputSettings';
import type { ReturnTypeVoiceInput } from './voice-types';
import type { SpeechController } from '../controllers';
import type { LocalVoice, OutputMode } from '../../shared/types';

export default function ConversationSettings({
  voice: v,
  speech,
}: {
  voice: ReturnTypeVoiceInput;
  speech: SpeechController;
}) {
  return (
    <div className="orb-settings-body">
      <VoiceInputSettings voice={v} continuous />
      <label className="setting-row">
        <span>
          <strong>Como você está ouvindo?</strong>
          <small>Alto-falantes protegem a escuta contra eco.</small>
        </span>
        <select
          aria-label="Dispositivo de áudio"
          value={v.device}
          disabled={v.recording || v.processing}
          onChange={(event) => v.setDevice(event.target.value as 'speakers' | 'headphones')}
        >
          <option value="speakers">Alto-falantes · proteger contra eco</option>
          <option value="headphones">Fones · interrupção por voz</option>
        </select>
      </label>
      {speech.options.mode === 'local' && (
        <label className="setting-row">
          <span>
            <strong>Voz local</strong>
            <small>Modelo Kokoro gratuito, executado neste PC, com vozes brasileiras naturais.</small>
          </span>
          <select
            aria-label="Voz local"
            value={speech.options.localVoice}
            disabled={v.recording || v.processing}
            onChange={(event) =>
              speech.setOptions({ ...speech.options, localVoice: event.target.value as LocalVoice })
            }
          >
            <option value="alex">Alex · masculino natural</option>
            <option value="santa">Santa · masculino suave</option>
            <option value="dora">Dora · feminino natural</option>
          </select>
        </label>
      )}
      <label className="setting-row">
        <span>
          <strong>Voz do Jarvis</strong>
          <small>
            {speech.options.mode === 'cloud'
              ? 'Envia texto à OpenAI. API paga.'
              : 'Áudio gerado neste computador, sem cobrança.'}
          </small>
        </span>
        <select
          aria-label="Voz do Jarvis"
          value={speech.options.mode}
          disabled={v.recording || v.processing}
          onChange={(event) =>
            speech.setOptions({ ...speech.options, mode: event.target.value as OutputMode })
          }
        >
          <option value="local">Kokoro · neural local grátis</option>
          <option value="system">Voz do sistema · grátis</option>
          <option value="cloud">OpenAI · API paga</option>
        </select>
      </label>
      <p className="voice-disclosure">
        {speech.options.mode === 'system'
          ? 'A voz do sistema usa movimento ambiente; Kokoro e OpenAI animam a esfera com o áudio real.'
          : 'O brilho e as ondas da esfera acompanham a energia e as frequências da resposta.'}
      </p>
    </div>
  );
}
