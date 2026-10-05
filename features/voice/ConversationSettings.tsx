import VoiceInputSettings from './VoiceInputSettings';
import type { ReturnTypeVoiceInput } from './voice-types';

export default function ConversationSettings({ voice: v }: { voice: ReturnTypeVoiceInput }) {
  return (
    <div className="orb-settings-body">
      <VoiceInputSettings voice={v} continuous />
      <label className="setting-row">
        <strong>Dispositivo de áudio</strong>
        <select
          aria-label="Dispositivo de áudio"
          value={v.device}
          disabled={v.recording || v.processing}
          onChange={(event) => v.setDevice(event.target.value as 'speakers' | 'headphones')}
        >
          <option value="speakers">Alto-falantes</option>
          <option value="headphones">Fones</option>
        </select>
      </label>
    </div>
  );
}
