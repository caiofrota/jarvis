import ConversationDock from '../voice/ConversationDock';
import type { ReturnTypeVoiceInput } from '../voice/voice-types';
import type { ChatController, IntelligenceController, SpeechController } from '../controllers';
import type { OpenDialog, Preferences } from '../../shared/types';
import AssistantTabs, { type AssistantTab } from './AssistantTabs';
import ConversationTranscript from './ConversationTranscript';
export default function ChatPanel({
  chat,
  ai,
  open,
  voice,
  speech,
  prefs,
  tab,
  setTab,
}: {
  chat: ChatController;
  ai: IntelligenceController;
  open: OpenDialog;
  voice: ReturnTypeVoiceInput;
  speech: SpeechController;
  prefs: Preferences;
  tab: AssistantTab;
  setTab(tab: AssistantTab): void;
}) {
  return (
    <div className={'assistant-body ' + (chat.messages.length ? 'has-messages' : '')}>
      <AssistantTabs value={tab} onChange={setTab} />
      <div
        id="assistant-panel-voice"
        role="tabpanel"
        aria-labelledby="assistant-tab-voice"
        hidden={tab !== 'voice'}
      >
        <ConversationDock
          voice={voice}
          speech={speech}
          chat={chat}
          ai={ai}
          profile={prefs.profile}
          motion={prefs.motion}
          open={open}
        />
      </div>
      <div
        id="assistant-panel-transcript"
        role="tabpanel"
        aria-labelledby="assistant-tab-transcript"
        hidden={tab !== 'transcript'}
      >
        {(voice.recording || voice.processing) && (
          <div className="transcript-session">
            <span role="status">
              {voice.processing
                ? 'Preparando a voz…'
                : voice.protectedInput
                  ? 'Conversa ativa · escuta protegida'
                  : 'Conversa ativa · microfone ligado'}
            </span>
            {(chat.busy || speech.busy) && (
              <button className="button small" onClick={chat.stop}>
                Interromper resposta
              </button>
            )}
            <button className="button small" onClick={() => void voice.stop()}>
              Encerrar conversa
            </button>
          </div>
        )}
        <ConversationTranscript chat={chat} voice={voice} open={open} visible={tab === 'transcript'} />
      </div>
      {(chat.status || ai.error) && (
        <div className="assistant-foot">
          <span role="status">{chat.status || ai.error}</span>
        </div>
      )}
    </div>
  );
}
