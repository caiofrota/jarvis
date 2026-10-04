import type { useIntelligence } from './ai/useIntelligence';
import type { useChat } from './chat/useChat';
import type { useSpeech } from './voice/useSpeech';
import type { useActions } from './actions/useActions';
import type { Profile } from '../shared/types';
export type IntelligenceController = ReturnType<typeof useIntelligence>;
export type ChatController = ReturnType<typeof useChat>;
export type SpeechController = ReturnType<typeof useSpeech>;
export type ActionsController = ReturnType<typeof useActions>;
export interface VoiceProps {
  ai: IntelligenceController;
  chat: ChatController;
  speech: SpeechController;
  profile: Profile;
  conversation?: boolean;
}
