import EnergyRing from './orb/EnergyRing';
import type { OrbPhase } from './orb/scene';
import type { ReturnTypeVoiceInput } from './voice-types';
import type { ChatController, IntelligenceController, SpeechController } from '../controllers';
import type { Profile, OpenDialog } from '../../shared/types';

interface Props {
  voice: ReturnTypeVoiceInput;
  speech: SpeechController;
  chat: ChatController;
  ai: IntelligenceController;
  profile: Profile;
  motion: boolean;
  open: OpenDialog;
}
export default function ConversationDock({ voice: v, speech, chat, ai, profile, motion, open }: Props) {
  const speaking = speech.busy && speech.status === 'Falando…';
  const busy = chat.busy || speech.busy;
  const phase: OrbPhase = speaking
    ? 'speaking'
    : v.processing
      ? 'preparing'
      : v.protectedInput && v.recording
        ? 'settling'
        : busy
          ? 'thinking'
          : v.recording
            ? 'listening'
            : 'idle';
  const labels: Record<OrbPhase, string> = {
    idle: 'Vamos conversar?',
    preparing: 'Preparando a escuta',
    listening: 'Estou ouvindo',
    thinking: 'Conectando as ideias',
    speaking: 'Falando com você',
    settling: 'Preparando a escuta…',
  };
  const blocked =
    !ai.model ||
    (v.needsLocal && (!v.local.ready || !!v.local.installing)) ||
    (v.mode === 'browser' && !v.available);
  const action = v.processing
    ? 'Cancelar preparação'
    : v.recording
      ? busy
        ? 'Interromper resposta'
        : 'Encerrar conversa'
      : 'Iniciar conversa';
  function interact() {
    if (v.processing) {
      void v.stop();
      return;
    }
    if (v.recording) {
      if (busy) void chat.stop();
      else void v.stop();
      return;
    }
    if (!ai.model) {
      open('intelligence');
      return;
    }
    if (blocked) {
      open('speech');
      return;
    }
    void v.start();
  }
  return (
    <section className="conversation-dock" data-phase={phase} aria-label="Conversa na esfera">
      <div className="orb-heading">
        <span>
          <i /> JARVIS
        </span>
        <span>
          {v.recording ? 'CONVERSA ATIVA' : v.wakeword.listening ? 'JARVIS ATIVO' : 'PRONTO PARA CONECTAR'}
        </span>
      </div>
      <div className="energy-stage">
        <span className="orb-coordinate orb-coordinate-left" aria-hidden="true">
          VOZ
          <br />
          {v.recording ? 'ON' : 'OFF'}
        </span>
        <button
          id="jarvis-orb"
          className="energy-trigger"
          onClick={interact}
          aria-label={v.recording ? 'Esfera: ' + action : action}
          title={action}
        >
          <EnergyRing phase={phase} profile={profile} motion={motion} sample={speech.visualFrame} />
          <span className="energy-center">
            <span className="energy-center-kicker">JARVIS / ASSISTENTE</span>
            <span className="energy-center-title" role="status">
              {labels[phase]}
            </span>
            <span className="energy-center-action">
              {v.recording
                ? busy
                  ? 'TOQUE PARA INTERROMPER'
                  : 'TOQUE PARA ENCERRAR'
                : v.processing
                  ? 'ATIVANDO MICROFONE'
                  : 'TOQUE PARA CONVERSAR'}
            </span>
          </span>
        </button>
        <span className="orb-coordinate orb-coordinate-right" aria-hidden="true">
          IA
          <br />
          {ai.config.provider === 'local' ? 'LOCAL' : 'NUVEM'}
        </span>
        <span className="orb-caption" aria-hidden="true">
          {phase === 'speaking'
            ? 'FALANDO'
            : phase === 'listening'
              ? 'OUVINDO'
              : phase === 'thinking'
                ? 'PROCESSANDO'
                : 'AGUARDANDO'}
        </span>
      </div>
      <div className="orb-controls">
        {(v.recording || v.processing) && (
          <button className="orb-end" onClick={() => void v.stop()} aria-label="Encerrar conversa">
            <span aria-hidden="true">■</span> Encerrar
          </button>
        )}
        {v.recording && busy && (
          <button className="orb-interrupt" onClick={() => void chat.stop()}>
            Interromper resposta
          </button>
        )}
      </div>
      {(v.error || speech.error) && (
        <p className="feature-error" role="alert">
          {v.error || speech.error}
        </p>
      )}
      {!v.recording && v.needsLocal && !v.local.ready && (
        <p className="orb-notice">
          {v.local.message || 'Voz local não instalada.'}
          <button className="panel-link" onClick={() => open('speech')}>
            Configurar voz
          </button>
        </p>
      )}
    </section>
  );
}
