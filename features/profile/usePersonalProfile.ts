import type { PersonalProfile } from '../../shared/types';
import { useStored } from '../../client/storage';

export const personalProfileKey = 'jarvis-personal-profile-v1';
export const jarvisPersonalityPreset =
  'Calmo, elegante, inteligente e proativo, com humor seco e discreto. Fale como um assistente executivo de ficção científica: direto, natural e prestativo; questione apenas quando houver ambiguidade real.';

export const emptyPersonalProfile: PersonalProfile = {
  userName: '',
  address: '',
  briefing: '',
  personality: jarvisPersonalityPreset,
  preferences: '',
};

export function validatePersonalProfile(input: unknown): PersonalProfile {
  const raw = input as Partial<PersonalProfile> | null;
  const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.slice(0, limit) : '');
  return {
    userName: text(raw?.userName, 120),
    address: text(raw?.address, 120),
    briefing: text(raw?.briefing, 2400),
    personality: typeof raw?.personality === 'string' ? text(raw.personality, 1600) : jarvisPersonalityPreset,
    preferences: text(raw?.preferences, 1600),
  };
}

export function usePersonalProfile() {
  return useStored(personalProfileKey, emptyPersonalProfile, validatePersonalProfile);
}
