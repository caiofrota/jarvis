import { useState } from 'react';
import type { PersonalProfile, Preferences, Save } from '../../../shared/types';
import type { ChatController, IntelligenceController, SpeechController } from '../../controllers';
import type { ReturnTypeVoiceInput } from '../../voice/voice-types';
import IntelligenceDialog from '../../ai/IntelligenceDialog';
import ConversationSettings from '../../voice/ConversationSettings';
import SpeechDialog from '../../voice/SpeechDialog';
import PersonalProfileDialog from '../../profile/PersonalProfileDialog';
import SettingsDialog from '../SettingsDialog';
import PanelsDialog from '../PanelsDialog';
import AddonsDialog from '../AddonsDialog';

export type SettingsSection = 'intelligence' | 'speech' | 'profile' | 'settings' | 'panels' | 'addons';
const sections: [SettingsSection, string][] = [
  ['intelligence', 'Inteligência'],
  ['speech', 'Voz'],
  ['profile', 'Perfil'],
  ['settings', 'Aparência'],
  ['panels', 'Painéis'],
  ['addons', 'Integrações'],
];

export default function SettingsHub({
  initialSection,
  primary,
  prefs,
  patch,
  personalProfile,
  savePersonalProfile,
  profileError,
  ai,
  chat,
  speech,
  voice,
}: {
  initialSection: SettingsSection;
  primary: boolean;
  prefs: Preferences;
  patch(values: Partial<Preferences>): void;
  personalProfile: PersonalProfile;
  savePersonalProfile: Save<PersonalProfile>;
  profileError: string;
  ai: IntelligenceController;
  chat: ChatController;
  speech: SpeechController;
  voice: ReturnTypeVoiceInput;
}) {
  const [section, setSection] = useState(initialSection);
  const content = {
    intelligence: <IntelligenceDialog ai={ai} busy={chat.busy || voice.recording || voice.processing} />,
    speech: (
      <>
        <ConversationSettings voice={voice} />
        <SpeechDialog speech={speech} chat={chat} />
      </>
    ),
    profile: (
      <PersonalProfileDialog
        profile={personalProfile}
        save={savePersonalProfile}
        provider={ai.config.provider}
        error={profileError}
      />
    ),
    settings: <SettingsDialog prefs={prefs} patch={patch} />,
    panels: <PanelsDialog prefs={prefs} patch={patch} primary={primary} />,
    addons: <AddonsDialog />,
  };
  return (
    <div className="settings-hub">
      <nav className="settings-nav" aria-label="Seções de configurações">
        {sections.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {sections.map(([id, label]) => (
          <section key={id} hidden={section !== id} aria-label={label}>
            <h3>{label}</h3>
            {content[id]}
          </section>
        ))}
      </div>
    </div>
  );
}
