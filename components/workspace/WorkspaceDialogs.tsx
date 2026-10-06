import type { DialogId, OpenDialog, PersonalProfile, Preferences, Save } from '../../shared/types';
import type {
  IntelligenceController,
  ChatController,
  SpeechController,
  ActionsController,
} from '../../features/controllers';
import Dialog from '../ui/Dialog';
import VoiceDialog from '../../features/voice/VoiceDialog';
import ComputerPanel from '../../features/actions/ComputerPanel';
import SettingsHub, { type SettingsSection } from '../../features/settings/SettingsHub/SettingsHub';
import type { ReturnTypeVoiceInput } from '../../features/voice/voice-types';
import PanelsDialog from '../../features/workspace/PanelsDialog/PanelsDialog';
const titles = {
  intelligence: 'Inteligência, à sua escolha.',
  profile: 'Seu briefing e a personalidade do Jarvis.',
  voice: 'Ditar mensagem.',
  conversation: 'Conversa por voz.',
  speech: 'Uma voz para suas ideias.',
  computer: 'Meu computador',
  settings: 'Seu ambiente, seu ritmo.',
  panels: 'Painéis desta janela',
  addons: 'Conecte suas possibilidades.',
  clear: 'Começar uma nova conversa?',
  commands: 'O que vamos fazer?',
};
export default function WorkspaceDialogs({
  dialog,
  primary,
  open,
  prefs,
  patch,
  personalProfile,
  savePersonalProfile,
  profileError,
  ai,
  chat,
  speech,
  actions,
  voice,
}: {
  dialog: DialogId | null;
  primary: boolean;
  open: OpenDialog;
  prefs: Preferences;
  patch: (values: Partial<Preferences>) => void;
  personalProfile: PersonalProfile;
  savePersonalProfile: Save<PersonalProfile>;
  profileError: string;
  ai: IntelligenceController;
  chat: ChatController;
  speech: SpeechController;
  actions: ActionsController;
  voice: ReturnTypeVoiceInput;
}) {
  if (!dialog) return null;
  if (['intelligence', 'profile', 'speech', 'settings', 'addons'].includes(dialog)) {
    return (
      <Dialog title="Configurações" className="settings-dialog" onClose={() => open(null)}>
        <SettingsHub
          key={dialog}
          initialSection={dialog as SettingsSection}
          prefs={prefs}
          patch={patch}
          personalProfile={personalProfile}
          savePersonalProfile={savePersonalProfile}
          profileError={profileError}
          ai={ai}
          chat={chat}
          speech={speech}
          voice={voice}
        />
      </Dialog>
    );
  }
  let body;
  switch (dialog) {
    case 'panels':
      body = <PanelsDialog primary={primary} prefs={prefs} patch={patch} />;
      break;
    case 'conversation':
      return null;
    case 'voice':
      body = <VoiceDialog ai={ai} profile={prefs.profile} chat={chat} speech={speech} open={open} />;
      break;
    case 'computer':
      body = <ComputerPanel actions={actions} />;
      break;
    case 'clear':
      body = (
        <>
          <p className="dialog-description">Apaga o histórico deste modelo neste dispositivo.</p>
          <button
            className="button"
            onClick={() => {
              chat.clear();
              open(null);
            }}
          >
            Limpar conversa
          </button>
        </>
      );
      break;
    case 'commands':
      body = (
        <div className="command-list">
          {[
            ['conversation', 'Conversar por voz'],
            ['computer', 'Abrir aplicativos e pastas'],
            ['settings', 'Configurações'],
          ]
            .filter(([id]) => primary || id !== 'conversation')
            .map(([id, label]) => (
              <button key={id} onClick={() => open(id as DialogId)}>
                {label}
                <span>↗</span>
              </button>
            ))}
        </div>
      );
      break;
  }
  return (
    <Dialog key={dialog} title={titles[dialog as keyof typeof titles]} onClose={() => open(null)}>
      {body}
    </Dialog>
  );
}
