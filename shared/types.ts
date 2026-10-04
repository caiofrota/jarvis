export type Provider = 'local' | 'cloud';
export type Profile = 'eco' | 'balanced' | 'full';
export type Owner = string | number;
export type PanelId = 'assistant' | 'calendar' | 'tasks' | 'notes' | 'system' | 'computer';
export type DialogId =
  | 'intelligence'
  | 'profile'
  | 'voice'
  | 'speech'
  | 'conversation'
  | 'computer'
  | 'settings'
  | 'panels'
  | 'addons'
  | 'clear'
  | 'commands';
export type OpenDialog = (dialog: DialogId | null) => void;
export interface Task {
  id: string;
  text: string;
  done: boolean;
}
export interface Preferences {
  order: PanelId[];
  hidden: PanelId[];
  wide: PanelId[];
  profile: Profile;
  color: 'mint' | 'blue' | 'violet';
  motion: boolean;
  notes: string;
  tasks: Task[];
}
export type Update<T> = T | ((current: T) => T);
export type Save<T> = (update: Update<T>) => T | null;
export interface TaskReceipt {
  type: 'add_task';
  id: string;
  title: string;
  status: 'saved' | 'existing';
}
export interface OpenReceipt {
  type: 'open_computer';
  id: string;
  label: string;
  status: 'sent';
}
export type Receipt = TaskReceipt | OpenReceipt;
export interface Message {
  role: 'user' | 'assistant';
  text: string;
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  kind?: 'local' | 'ai';
  receipt?: Receipt;
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface Target {
  id: string;
  label: string;
  kind: 'app' | 'folder';
  available: boolean;
  target?: string;
}
export interface RuntimeInfo {
  restricted: boolean;
  platform: string;
  appVersion: string;
  message: string;
}
export interface ActionRecord {
  id: string;
  label: string;
  at: string;
  status: 'requested' | 'sent' | 'error';
}
export interface ActionCatalog {
  runtime: RuntimeInfo;
  items: Target[];
  apps: Target[];
  history: ActionRecord[];
}
export interface PreparedAction {
  token: string;
  expiresAt: number;
  id: string;
  label: string;
  kind: Target['kind'];
  target: string;
}
export interface ActionResult {
  status: 'sent';
  message: string;
  label: string;
}
export interface AIConfig {
  keepReady: boolean;
  provider: Provider;
  localModel: string;
  cloudModel: string;
}
export interface PersonalProfile {
  userName: string;
  address: string;
  briefing: string;
  personality: string;
  preferences: string;
}
export interface WarmRequest {
  provider: Provider;
  model?: string;
  profile?: Profile;
}
export interface Model {
  id: string;
  kind: Provider;
  size?: number;
  parameters?: string;
}
export interface AIStatus {
  cloudConfigured: boolean;
  busy: boolean;
  preparing: boolean;
  runtime?: RuntimeInfo;
}
export interface Hardware {
  ramGiB: number;
  freeGiB: number;
  cpu: string;
  threads: number;
  platform: string;
  appMemoryMB?: number;
  profiles: Record<
    Profile,
    { context: number; maxOutput: number; historyChars: number; threads: number; keepAlive: string | number }
  >;
}
export interface ChatRequest {
  provider: Provider;
  model: string;
  profile?: Profile;
  personalProfile?: PersonalProfile;
  voice?: boolean;
  messages: ChatMessage[];
  tasks?: Task[];
  installedApps?: string[];
  targets?: Target[];
}
export interface ChatStats {
  firstVisibleMs?: number;
  durationMs: number;
  firstTokenMs: number | null;
  tokens?: number;
  loadMs?: number;
  promptMs?: number;
  generationMs?: number;
}
export type ChatEvent =
  | { type: 'start' }
  | { type: 'delta' | 'replace'; text: string }
  | { type: 'status' | 'error' | 'cancelled'; message: string }
  | { type: 'task'; title: string }
  | { type: 'action'; id: string; label: string }
  | ({ type: 'done' } & ChatStats);
export type InputMode = 'browser' | 'local' | 'cloud';
export type OutputMode = 'system' | 'local' | 'cloud';
export type LocalVoice = 'alex' | 'santa' | 'dora';
export interface SpeechSettings {
  rate: number;
  voiceURI: string;
  mode: OutputMode;
  localVoice: LocalVoice;
}
export interface SpeechRequest {
  provider: Provider;
  text: string;
  speed: number;
  voice?: string;
  consent?: boolean;
}
export interface TranscribeRequest {
  provider: Provider;
  audio: string;
  mime: string;
  live?: boolean;
  consent?: boolean;
}
export interface AudioResult {
  audio: string;
  mime: string;
}
export interface Transcript {
  text: string;
}
export interface LocalVoiceStatus {
  ready: boolean;
  warming?: boolean;
  loaded?: boolean;
  installing?: boolean;
  message?: string;
  error?: string;
  ttsLoaded?: boolean;
  sttLoaded?: boolean;
  ttsVoices?: LocalVoice[];
  wakewordReady?: boolean;
}
export interface WakewordStatus {
  available: boolean;
  enabled: boolean;
  listening: boolean;
  phrase: string;
  message?: string;
  error?: string;
}
export type VoiceEngine = 'tts' | 'stt';
export interface JarvisAPI {
  actions(): Promise<ActionCatalog>;
  prepareAction(id: string): Promise<PreparedAction>;
  executeAction(token: string): Promise<ActionResult>;
  cancelAction(): Promise<unknown>;
  warmLocalVoice(engine: VoiceEngine): Promise<{ ready: boolean }>;
  localVoiceStatus(): Promise<LocalVoiceStatus>;
  installLocalVoice(): Promise<LocalVoiceStatus>;
  speak(request: SpeechRequest): Promise<AudioResult>;
  stopSpeech(): Promise<unknown>;
  transcribe(request: TranscribeRequest): Promise<Transcript>;
  cancelVoice(): Promise<unknown>;
  microphone(enabled: boolean): Promise<boolean>;
  wakeword(enabled: boolean): Promise<WakewordStatus>;
  wakewordStatus(): Promise<WakewordStatus>;
  onWakeword(listener: () => void): () => void;
  hardware(): Promise<Hardware>;
  status(): Promise<AIStatus>;
  warm(request: WarmRequest): Promise<{ ready: boolean; message?: string }>;
  models(provider: Provider): Promise<Model[]>;
  setKey(key: string): Promise<{ configured: boolean }>;
  cancel(): Promise<unknown>;
  chat(request: ChatRequest, callback: (event: ChatEvent) => void): Promise<unknown>;
}
export interface DesktopAPI extends JarvisAPI {
  openPanel(panel: PanelId): Promise<boolean>;
  openWorkspace(): Promise<boolean>;
}
