import type { DesktopAPI, CompanionWindowsAPI } from '../shared/types';
declare global {
  interface Window {
    jarvisDesktop?: DesktopAPI;
    jarvisCompanionWindows?: CompanionWindowsAPI;
    webkitAudioContext?: typeof AudioContext;
  }
  interface SpeechRecognition {
    processLocally?: boolean;
  }
}
export {};
