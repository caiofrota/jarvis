import type { PersonalProfile, Provider, Save } from '../../shared/types';
import { jarvisPersonalityPreset } from './usePersonalProfile';
import Field from './ProfileField';

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
      <Field
        label="Seu nome"
        value={profile.userName}
        placeholder="Ex.: Caio"
        onChange={(value) => update('userName', value)}
      />
      <Field
        label="Como devo chamar você"
        value={profile.address}
        placeholder="Ex.: Caio, chefe, você"
        onChange={(value) => update('address', value)}
      />
      <Field
        label="Briefing pessoal"
        value={profile.briefing}
        placeholder="Ex.: Trabalho com ..., estou construindo ..., moro em ..."
        multiline
        onChange={(value) => update('briefing', value)}
      />
      <Field
        label="Personalidade do Jarvis"
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
        value={profile.preferences}
        placeholder="Ex.: responda em português, sem emojis, seja breve"
        multiline
        onChange={(value) => update('preferences', value)}
      />
      {provider === 'cloud' && (
        <p className="settings-foot profile-privacy">
          Perfil enviado à OpenAI quando a IA na nuvem estiver selecionada.
        </p>
      )}
      {error && <p className="connection-status">{error}</p>}
    </div>
  );
}
