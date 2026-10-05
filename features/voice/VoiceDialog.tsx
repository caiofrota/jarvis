import { useVoiceInput } from './useVoiceInput';
import type { VoiceProps } from '../controllers';
import type { OpenDialog } from '../../shared/types';

export default function VoiceDialog(props: VoiceProps & { open: OpenDialog }) {
  const v = useVoiceInput(props);
  return (
    <>
      <button className="panel-link" onClick={() => props.open('speech')}>
        Configurações de voz
      </button>
      <div className={'voice-stage ' + (v.recording ? 'recording' : '')}>
        <span className="voice-symbol" aria-hidden="true">
          ◉
        </span>
        <strong>{v.recording ? 'Ouvindo…' : v.processing ? 'Processando…' : 'Dite sua mensagem.'}</strong>
        <p role="status">{v.state}</p>
      </div>
      {v.error && (
        <p className="feature-error" role="alert">
          {v.error}
        </p>
      )}
      <div className="feature-buttons">
        <button
          className="button primary"
          onClick={v.start}
          disabled={
            v.recording ||
            v.processing ||
            (v.needsLocal && !v.local.ready) ||
            (v.mode === 'browser' && !v.available)
          }
        >
          Iniciar gravação
        </button>
        <button className="button" onClick={v.stop} disabled={!v.recording}>
          Concluir gravação
        </button>
      </div>
      <label className="transcript-label" htmlFor="voice-transcript">
        Transcrição
      </label>
      <textarea
        id="voice-transcript"
        className="voice-transcript"
        value={v.text}
        onChange={(e) => v.setText(e.target.value)}
      />
      <div className="feature-buttons">
        <button className="button" disabled={!v.text.trim() || v.processing || v.recording} onClick={v.send}>
          Enviar e ouvir resposta
        </button>
        <button className="button" onClick={props.chat.stop}>
          Interromper resposta
        </button>
      </div>
      <p className="session-status" role="status">
        {props.chat.busy ? props.chat.status : props.speech.status}
      </p>
    </>
  );
}
