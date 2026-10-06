'use client';
import type { Preferences, PanelId, DialogId } from '../../shared/types';
import { useEffect, useRef, useState } from 'react';
import { useWorkspacePreferences } from '../../features/workspace/useWorkspacePreferences';
import type { WorkspaceIdentity } from '../../features/workspace/window-layout';
import { useIntelligence } from '../../features/ai/useIntelligence';
import { useActions } from '../../features/actions/useActions';
import { useVoiceInput } from '../../features/voice/useVoiceInput';
import { useSpeech } from '../../features/voice/useSpeech';
import { useChat } from '../../features/chat/useChat';
import { localCommand } from '../../features/chat/local-commands';
import { saveTask, updateTask, checkTask, completeTask } from '../../features/tasks/task-actions';
import { readWorkspaceTasks } from '../../features/workspace/task-state';
import Shell from './Shell';
import WorkspaceStage from './WorkspaceStage';
import WorkspaceDialogs from './WorkspaceDialogs';
import type { AssistantTab } from '../../features/chat/AssistantTabs';
import ChatPanel from '../../features/chat/ChatPanel';
import TasksPanel from '../../features/tasks/TasksPanel';
import NotesPanel from '../../features/notes/NotesPanel';
import CalendarPanel from '../../features/calendar/CalendarPanel';
import SystemPanel from '../../features/system/SystemPanel';
import ComputerPanel from '../../features/actions/ComputerPanel';
import { usePersonalProfile } from '../../features/profile/usePersonalProfile';

export default function WorkspaceView({ identity }: { identity: WorkspaceIdentity }) {
  const [prefs, setPrefs, ready, error] = useWorkspacePreferences(identity);
  const [personalProfile, savePersonalProfile, profileReady, profileError] = usePersonalProfile();
  const [assistantTab, setAssistantTab] = useState<AssistantTab>('voice');
  const [dialog, setDialog] = useState<DialogId | null>(null),
    [focused, setFocused] = useState(false),
    drag = useRef<PanelId | null>(null);
  const ai = useIntelligence(),
    actions = useActions(),
    speech = useSpeech();
  const addTask = (title: string) => saveTask(setPrefs, title);
  const chat = useChat({
    ai,
    profile: prefs.profile,
    personalProfile,
    actions,
    speech,
    readTasks: readWorkspaceTasks,
    addTask,
    updateTask: (id, title, previousTitle) => updateTask(setPrefs, id, title, previousTitle),
    checkTask: (title) => checkTask(readWorkspaceTasks, title),
    completeTask: (id, title) => completeTask(setPrefs, id, title),
    onMissingModel: () => open('intelligence'),
    command: (text) =>
      localCommand(text, {
        tasks: readWorkspaceTasks(),
        focus: () => setFocused(true),
        addTask,
      }),
  });
  const voice = useVoiceInput({ ai, chat, speech, profile: prefs.profile, conversation: true });
  useEffect(() => {
    if (ready && prefs.hidden.includes('assistant') && (voice.recording || voice.processing))
      void voice.stop();
  }, [ready, prefs.hidden]);
  function open(id: DialogId | null) {
    if (id === 'conversation') {
      if (!identity.primary) return;
      setAssistantTab('voice');
      setPrefs((current) => ({ ...current, hidden: current.hidden.filter((id) => id !== 'assistant') }));
      setDialog(null);
      requestAnimationFrame(() => document.getElementById('jarvis-orb')?.focus());
      if (!voice.recording && !voice.processing && ai.model && (!voice.needsLocal || voice.local.ready))
        void voice.start();
      return;
    }
    setDialog(id);
  }
  const patch = (values: Partial<Preferences>) => setPrefs((current) => ({ ...current, ...values }));
  useEffect(() => {
    if (!identity.primary || !ready || !ai.ready || ai.config.provider !== 'local' || !ai.model) return;
    const prepare = () => {
      void ai.warm(prefs.profile).catch(() => {});
    };
    prepare();
    if (!ai.config.keepReady) return;
    const timer = setInterval(prepare, 60000);
    return () => clearInterval(timer);
  }, [ready, ai.ready, ai.config.provider, ai.config.keepReady, ai.model, prefs.profile]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open('commands');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    document.body.dataset.profile = prefs.profile;
    document.body.classList.toggle('low-motion', !prefs.motion);
    document.body.classList.toggle('focus-mode', focused);
    document.body.classList.remove('detached');
    const colors = {
      mint: ['#7ae3d3', '122,227,211'],
      blue: ['#8cc8ff', '140,200,255'],
      violet: ['#b6a1ff', '182,161,255'],
    };
    document.documentElement.style.setProperty('--accent', colors[prefs.color][0]);
    document.documentElement.style.setProperty('--accent-rgb', colors[prefs.color][1]);
  }, [prefs.profile, prefs.motion, prefs.color, focused]);
  if (!ready || !profileReady)
    return (
      <main aria-busy="true">
        <p className="eyebrow">JARVIS STUDIO</p>
        <h1>Preparando seu espaço…</h1>
      </main>
    );
  const contents = {
    assistant: (
      <ChatPanel
        chat={chat}
        ai={ai}
        open={open}
        voice={voice}
        speech={speech}
        prefs={prefs}
        tab={assistantTab}
        setTab={setAssistantTab}
      />
    ),
    calendar: <CalendarPanel />,
    tasks: <TasksPanel tasks={prefs.tasks} update={(tasks) => patch({ tasks })} />,
    notes: <NotesPanel value={prefs.notes} onChange={(notes) => patch({ notes })} error={error} />,
    system: <SystemPanel prefs={prefs} ai={ai} open={open} />,
    computer: <ComputerPanel actions={actions} />,
  };
  return (
    <>
      <Shell
        primary={identity.primary}
        open={open}
        focused={focused}
        setFocused={(value) => {
          if (value) patch({ hidden: prefs.hidden.filter((id) => id !== 'assistant') });
          setFocused(value);
        }}
        error={error}
      >
        <WorkspaceStage
          primary={identity.primary}
          contents={contents}
          prefs={prefs}
          patch={patch}
          drag={drag}
          openPanels={() => open('panels')}
        />
      </Shell>
      <WorkspaceDialogs
        primary={identity.primary}
        dialog={dialog}
        open={open}
        prefs={prefs}
        patch={patch}
        personalProfile={personalProfile}
        savePersonalProfile={savePersonalProfile}
        profileError={profileError}
        ai={ai}
        chat={chat}
        speech={speech}
        actions={actions}
        voice={voice}
      />
    </>
  );
}
