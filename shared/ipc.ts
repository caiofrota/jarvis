import type { JarvisAPI, DesktopAPI } from './types';
export interface IPCChannels {
  actions: JarvisAPI['actions'];
  'actions-prepare': JarvisAPI['prepareAction'];
  'actions-execute': JarvisAPI['executeAction'];
  'actions-cancel': JarvisAPI['cancelAction'];
  'voice-local-warm': JarvisAPI['warmLocalVoice'];
  'voice-local-status': JarvisAPI['localVoiceStatus'];
  'voice-local-install': JarvisAPI['installLocalVoice'];
  speak: JarvisAPI['speak'];
  'stop-speech': JarvisAPI['stopSpeech'];
  transcribe: JarvisAPI['transcribe'];
  'voice-cancel': JarvisAPI['cancelVoice'];
  microphone: JarvisAPI['microphone'];
  wakeword: JarvisAPI['wakeword'];
  'wakeword-status': JarvisAPI['wakewordStatus'];
  hardware: JarvisAPI['hardware'];
  status: JarvisAPI['status'];
  warm: JarvisAPI['warm'];
  models: JarvisAPI['models'];
  key: JarvisAPI['setKey'];
  cancel: JarvisAPI['cancel'];
  panel: DesktopAPI['openPanel'];
  workspace: DesktopAPI['openWorkspace'];
  chat: (request: Parameters<JarvisAPI['chat']>[0]) => Promise<unknown>;
}
