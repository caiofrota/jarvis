import { useEffect, useRef, useState } from 'react';
import { getAPI } from '../../client/api';
import { readStored } from '../../client/storage';
import { withoutEmoji } from '../../client/text';
import { chatMessages } from './conversation';
import type {
  Message,
  PersonalProfile,
  Profile,
  Task,
  TaskReceipt,
  TaskUpdateReceipt,
} from '../../shared/types';
import type { IntelligenceController, ActionsController, SpeechController } from '../controllers';
import type { LocalReply } from './local-commands';

interface Options {
  ai: IntelligenceController;
  profile: Profile;
  personalProfile: PersonalProfile;
  actions: ActionsController;
  speech: SpeechController;
  tasks: Task[];
  onMissingModel(): void;
  command(text: string, history: Message[]): LocalReply;
  addTask(title: string): { text: string; receipt: TaskReceipt };
  updateTask(id: string, title: string, previousTitle: string): { text: string; receipt: TaskUpdateReceipt };
}
export function useChat({
  ai,
  profile,
  personalProfile,
  actions,
  speech,
  onMissingModel,
  command,
  tasks,
  addTask,
  updateTask,
}: Options) {
  const key = 'jarvis-chat-v2:' + ai.config.provider + ':' + ai.model;
  const [history, setHistory] = useState<{ key: string; messages: Message[] }>({ key: '', messages: [] });
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false),
    epoch = useRef(0),
    finished = useRef(Promise.resolve());
  const currentMessages = useRef<Message[]>([]),
    currentKey = useRef(key);
  currentKey.current = key;
  const messages = history.key === key ? history.messages : [];
  function publish(next: Message[]) {
    if (currentKey.current !== key) return;
    currentMessages.current = next.slice(-60);
    setHistory({ key, messages: currentMessages.current });
  }
  useEffect(() => {
    if (!ai.ready) return;
    const saved = readStored<Message[]>(key, []);
    publish(
      Array.isArray(saved)
        ? saved
            .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string')
            .slice(-60)
            .map((m) => ({
              ...m,
              text: m.role === 'assistant' ? withoutEmoji(m.text) : m.text,
              status: m.status === 'streaming' ? 'cancelled' : m.status,
            }))
        : [],
    );
  }, [key, ai.ready]);
  useEffect(() => {
    if (history.key)
      try {
        localStorage.setItem(history.key, JSON.stringify(history.messages.slice(-60)));
      } catch {
        setStatus('Sem espaço para salvar o histórico.');
      }
  }, [history]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key && !active.current) {
        const next = readStored<Message[]>(key, []);
        if (Array.isArray(next)) publish(next.filter((m) => m && typeof m.text === 'string'));
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  async function stop() {
    epoch.current++;
    speech.stop();
    await getAPI().cancel();
  }
  async function send(input: string, spoken = false) {
    const text = input.trim();
    if (!text) return;
    if (active.current) {
      if (!spoken) return;
      await stop();
      await finished.current;
    }
    setError('');
    const previous = currentMessages.current;
    const user: Message = { role: 'user', text, kind: 'ai', status: 'done' };
    let local: LocalReply;
    try {
      local = command(text, previous);
    } catch (errorCause) {
      const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
      const message = error instanceof Error ? error.message : String(error);
      publish([...previous, user, { role: 'assistant', text: message, kind: 'local', status: 'error' }]);
      setStatus(message);
      setError(message);
      if (spoken) speech.read(message);
      return;
    }
    if (local !== null && local !== undefined) {
      const answer = typeof local === 'string' ? { text: local } : local;
      publish([
        ...previous,
        user,
        {
          role: 'assistant',
          kind: 'local',
          status: 'done',
          text: answer.text,
          receipt: 'receipt' in answer ? answer.receipt : undefined,
        },
      ]);
      if (spoken) speech.read(answer.text);
      return;
    }
    if (!ai.model) {
      onMissingModel();
      return;
    }
    const turn = ++epoch.current;
    active.current = true;
    setBusy(true);
    setStatus('Preparando resposta…');
    let release = () => {};
    finished.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const response: Message = { role: 'assistant', text: '', kind: 'ai', status: 'streaming' };
    const next = [...previous, user];
    let action: { id: string; label: string } | undefined, taskTitle: string | undefined;
    let taskUpdate: { id: string; title: string; previousTitle: string } | undefined;
    const paint = () => publish([...next, { ...response }]);
    paint();
    if (spoken) speech.begin();
    try {
      await getAPI().chat(
        {
          provider: ai.config.provider,
          model: ai.model,
          profile,
          personalProfile,
          voice: spoken,
          tasks,
          messages: chatMessages(next),
        },
        (event) => {
          if (turn !== epoch.current) return;
          if (event.type === 'delta') {
            response.text += event.text;
            if (spoken) speech.feed(event.text);
            paint();
          }
          if (event.type === 'replace') {
            response.text = event.text;
            paint();
          }
          if (event.type === 'action') action = { id: event.id, label: event.label };
          if (event.type === 'task') taskTitle = event.title;
          if (event.type === 'task-update') taskUpdate = event;
          if (event.type === 'status') setStatus(event.message);
          if (event.type === 'done') {
            response.status = 'done';
            const first = event.firstVisibleMs;
            setStatus(
              (first === undefined ? '' : 'Começou em ' + (first / 1000).toFixed(1) + ' s · ') +
                (event.durationMs / 1000).toFixed(1) +
                ' s no total',
            );
          }
          if (event.type === 'error') {
            response.status = 'error';
            response.text = event.message;
          }
          if (event.type === 'cancelled') response.status = 'cancelled';
        },
      );
      if (turn !== epoch.current) {
        response.status = 'cancelled';
        response.text ||= 'Resposta interrompida.';
      }
      if (response.status === 'done' && turn === epoch.current) {
        if ([action, taskTitle, taskUpdate].filter(Boolean).length > 1)
          throw new Error('A resposta trouxe ações incompatíveis. Nada foi executado.');
        if (action) {
          response.text = await actions.execute(action.id);
          response.receipt = { type: 'open_computer', ...action, status: 'sent' };
        }
        if (taskTitle) {
          const result = addTask(taskTitle);
          response.text = result.text;
          response.receipt = result.receipt;
        }
        if (taskUpdate) {
          const result = updateTask(taskUpdate.id, taskUpdate.title, taskUpdate.previousTitle);
          response.text = result.text;
          response.receipt = result.receipt;
        }
      }
    } catch (errorCause) {
      const error = errorCause instanceof Error ? errorCause : new Error(String(errorCause));
      response.status = 'error';
      response.text = error instanceof Error ? error.message : String(error);
    } finally {
      if (response.status === 'streaming') {
        response.status = 'error';
        response.text ||= 'A conexão terminou antes de concluir a resposta. Tente novamente.';
      }
      response.text = withoutEmoji(response.text);
      if (response.status === 'error') {
        setError(response.text);
        setStatus(response.text);
      }
      paint();
      active.current = false;
      setBusy(false);
      if (spoken && turn === epoch.current) {
        if (response.status === 'done') speech.finish(response.text);
        else if (response.status === 'error') speech.read(response.text);
        else speech.stop();
      }
      release();
    }
  }
  return {
    messages,
    busy,
    status,
    error,
    send,
    stop,
    clear: () => {
      if (!active.current) publish([]);
    },
    latest: messages.findLast((m) => m.role === 'assistant' && m.status === 'done')?.text || '',
  };
}
