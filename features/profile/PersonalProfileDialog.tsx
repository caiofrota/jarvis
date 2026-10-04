import type { PersonalProfile, Provider, Save } from '../../shared/types';
import { jarvisPersonalityPreset } from './usePersonalProfile';

function Field({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="profile-field">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export default function PersonalProfileDialog({
  profile,
  save,
  provider,
  error,
}: {
  profile: PersonalProfile;
  save: Save<PersonalProfile>;
  provider: Provider;
  error?: string;
}) {
  const update = (key: keyof PersonalProfile, value: string) => {
    save((current) => ({ ...current, [key]: value }));
  };
  return (
    <div className="personal-profile">
      <p className="dialog-description">
        Este perfil orienta o jeito do Jarvis conversar e dá contexto para suas decisões. Ele fica salvo neste
        dispositivo e não treina o modelo.
      </p>
      <Field
        label="Seu nome"
        hint="Como você quer se identificar"
        value={profile.userName}
        placeholder="Ex.: Caio"
        onChange={(value) => update('userName', value)}
      />
      <Field
        label="Como devo chamar você"
        hint="Apelido ou forma preferida"
        value={profile.address}
        placeholder="Ex.: Caio, chefe, você"
        onChange={(value) => update('address', value)}
      />
      <Field
        label="Briefing pessoal"
        hint="Seu trabalho, projetos, rotina e contexto que ajudam nas respostas"
        value={profile.briefing}
        placeholder="Ex.: Trabalho com ..., estou construindo ..., moro em ..."
        multiline
        onChange={(value) => update('briefing', value)}
      />
      <Field
        label="Personalidade do Jarvis"
        hint="Tom, iniciativa e comportamento desejados"
        value={profile.personality}
        placeholder="Ex.: direto, proativo, natural e questiona apenas quando houver ambiguidade"
        multiline
        onChange={(value) => update('personality', value)}
      />
      <button
        className="button small profile-preset"
        onClick={() => update('personality', jarvisPersonalityPreset)}
      >
        Aplicar estilo Jarvis
      </button>
      <Field
        label="Preferências e limites"
        hint="Formato de resposta, assuntos sensíveis ou coisas que ele deve considerar"
        value={profile.preferences}
        placeholder="Ex.: responda em português, sem emojis, seja breve"
        multiline
        onChange={(value) => update('preferences', value)}
      />
      {provider === 'cloud' && (
        <p className="settings-foot profile-privacy">
          A IA na nuvem recebe este perfil junto com a conversa. Para mantê-lo somente neste PC, selecione IA
          local em Inteligência.
        </p>
      )}
      {error && <p className="connection-status">{error}</p>}
    </div>
  );
}
