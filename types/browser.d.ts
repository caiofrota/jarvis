import type { DesktopAPI } from '../shared/types';
declare global {
  interface Window { jarvisDesktop?: DesktopAPI; webkitAudioContext?: typeof AudioContext }
  interface SpeechRecognition { processLocally?: boolean }
}
export {};
