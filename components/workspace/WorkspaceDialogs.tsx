import type { DialogId, OpenDialog, PersonalProfile, Preferences, Save } from '../../shared/types';
import type {
  IntelligenceController,
  ChatController,
  SpeechController,
  ActionsController,
} from '../../features/controllers';
import Dialog from '../ui/Dialog';
import IntelligenceDialog from '../../features/ai/IntelligenceDialog';
import VoiceDialog from '../../features/voice/VoiceDialog';
import SpeechDialog from '../../features/voice/SpeechDialog';
import ComputerPanel from '../../features/actions/ComputerPanel';
import SettingsDialog from '../../features/settings/SettingsDialog';
import PanelsDialog from '../../features/settings/PanelsDialog';
import AddonsDialog from '../../features/settings/AddonsDialog';
import PersonalProfileDialog from '../../features/profile/PersonalProfileDialog';
const titles = {
  intelligence: 'Inteligência, à sua escolha.',
  profile: 'Seu briefing e a personalidade do Jarvis.',
  voice: 'Ditar mensagem.',
  conversation: 'Conversa por voz.',
  speech: 'Uma voz para suas ideias.',
  computer: 'Meu computador',
  settings: 'Seu ambiente, seu ritmo.',
  panels: 'Seu espaço, do seu jeito.',
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
}) {
  if (!dialog) return null;
  let body;
  switch (dialog) {
    case 'intelligence':
      body = <IntelligenceDialog ai={ai} busy={chat.busy} />;
      break;
    case 'profile':
      body = (
        <PersonalProfileDialog
          profile={personalProfile}
          save={savePersonalProfile}
          provider={ai.config.provider}
          error={profileError}
        />
      );
      break;
    case 'conversation':
      return null;
    case 'voice':
      body = <VoiceDialog ai={ai} profile={prefs.profile} chat={chat} speech={speech} />;
      break;
    case 'speech':
      body = <SpeechDialog chat={chat} speech={speech} />;
      break;
    case 'computer':
      body = <ComputerPanel actions={actions} />;
      break;
    case 'settings':
      body = <SettingsDialog prefs={prefs} patch={patch} />;
      break;
    case 'panels':
      body = <PanelsDialog prefs={prefs} patch={patch} primary={primary} />;
      break;
    case 'addons':
      body = <AddonsDialog />;
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
            ['intelligence', 'Escolher inteligência'],
            ['profile', 'Configurar briefing e personalidade'],
            ['settings', 'Ajustar preferências'],
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
