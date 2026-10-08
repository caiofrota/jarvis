"use client";
import { isNativeCompanion } from "@jarvis/api-client";
import { useEffect, useRef, useState } from "react";
import { useStored } from "../../../../../client/storage";
import Dialog from "../../../../../components/ui/Dialog";
import Shell from "../../../../../components/workspace/Shell";
import WorkspaceStage from "../../../../../components/workspace/WorkspaceStage";
import AssistantTabs from "../../../../../features/chat/AssistantTabs";
import NotesPanel from "../../../../../features/notes/NotesPanel";
import TasksPanel from "../../../../../features/tasks/TasksPanel";
import EnergyRing from "../../../../../features/voice/orb/EnergyRing";
import { openWorkspaceWindow } from "../../../../../features/workspace/open-window";
import PanelsDialog from "../../../../../features/workspace/PanelsDialog/PanelsDialog";
import { useWorkspacePreferences } from "../../../../../features/workspace/useWorkspacePreferences";
import {
  defaultWindowView,
  validateWindowView,
  viewKey,
  type WorkspaceIdentity,
} from "../../../../../features/workspace/window-layout";
import type { DialogId, PanelId, Preferences } from "../../../../../shared/types";
import { LoadingScreen } from "../../components/loading-screen/LoadingScreen";
import { useSession } from "../session/SessionProvider";
import { CompanionCalendar } from "./CompanionCalendar";
import { CompanionComputer } from "./CompanionComputer";
import { useCompanionConversation } from "./useCompanionConversation";

const phaseLabels = {
  idle: "Vamos conversar?",
  preparing: "Preparando a escuta",
  listening: "Estou ouvindo",
  thinking: "Conectando as ideias",
  speaking: "Falando com você",
  settling: "Preparando a escuta…",
};
export function CompanionWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const { actor, logout } = useSession();
  const namespace = `companion:${actor.user.id}:`;
  const [prefs, savePrefs, ready, preferenceError] = useWorkspacePreferences(identity, namespace);
  const [view, saveView, viewReady, viewError] = useStored(
    namespace + viewKey(identity.id),
    defaultWindowView,
    validateWindowView,
  );
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [detachable, setDetachable] = useState(false);
  useEffect(
    () => setDetachable(!isNativeCompanion(navigator.userAgent) || !!window.jarvisCompanionWindows),
    [],
  );
  const drag = useRef<PanelId | null>(null);
  const conversation = useCompanionConversation();
  const log = useRef<HTMLDivElement>(null);
  const name =
    conversation.options.assistants.find((value) => value.id === conversation.assistantId)?.name ??
    conversation.options.name;
  const patch = (value: Partial<Preferences>) => savePrefs((current) => ({ ...current, ...value }));
  function open(value: DialogId | null) {
    setDialog(value);
  }
  const setFocused = (focused: boolean) => {
    if (focused) patch({ hidden: prefs.hidden.filter((id) => id !== "assistant") });
    saveView((current) => ({ ...current, focused }));
  };
  useEffect(() => {
    document.body.classList.toggle("focus-mode", view.focused);
    document.body.classList.toggle("low-motion", !prefs.motion);
    document.body.style.setProperty(
      "--accent",
      { mint: "#7ae3d3", blue: "#8cc8ff", violet: "#b6a1ff" }[prefs.color],
    );
    document.body.style.setProperty(
      "--accent-rgb",
      { mint: "122,227,211", blue: "140,200,255", violet: "182,161,255" }[prefs.color],
    );
    return () => {
      document.body.classList.remove("focus-mode", "low-motion");
      document.body.style.removeProperty("--accent");
      document.body.style.removeProperty("--accent-rgb");
    };
  }, [view.focused, prefs.motion, prefs.color]);
  useEffect(() => {
    if (
      view.assistantTab === "transcript" &&
      (conversation.messages.length || conversation.draft) &&
      log.current
    )
      log.current.scrollTop = log.current.scrollHeight;
  }, [conversation.messages.length, conversation.draft, view.assistantTab]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog("commands");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (prefs.hidden.includes("assistant") && conversation.active) conversation.stop();
  }, [prefs.hidden, conversation.active, conversation.stop]);
  const interact = () => {
    if (conversation.busy) conversation.interrupt();
    else if (conversation.active || conversation.phase === "preparing") conversation.stop();
    else void conversation.start();
  };
  const action = conversation.busy
    ? "Interromper resposta"
    : conversation.active
      ? "Encerrar conversa"
      : "Iniciar conversa";
  if (!ready || !viewReady) return <LoadingScreen />;
  const contents = {
    assistant: (
      <div className={`assistant-body ${conversation.messages.length ? "has-messages" : ""}`}>
        <AssistantTabs
          value={view.assistantTab}
          onChange={(assistantTab) => saveView((current) => ({ ...current, assistantTab }))}
        />
        <div
          id="assistant-panel-voice"
          role="tabpanel"
          aria-labelledby="assistant-tab-voice"
          hidden={view.assistantTab !== "voice"}
        >
          <section
            className="conversation-dock"
            data-phase={conversation.phase}
            aria-label="Conversa na esfera"
          >
            <div className="orb-heading">
              <span>
                <i /> {name.toUpperCase()}
              </span>
              <span>{conversation.active ? "CONVERSA ATIVA" : "PRONTO PARA CONECTAR"}</span>
            </div>
            <div className="energy-stage">
              <span className="orb-coordinate orb-coordinate-left" aria-hidden="true">
                VOZ
                <br />
                {conversation.active ? "ON" : "OFF"}
              </span>
              <button
                type="button"
                id="jarvis-orb"
                className="energy-trigger"
                onClick={interact}
                aria-label={action}
                title={action}
                disabled={!conversation.sessionId}
              >
                <EnergyRing
                  phase={conversation.phase}
                  profile={prefs.profile}
                  motion={prefs.motion}
                  sample={conversation.visualFrame}
                />
                <span className="energy-center">
                  <span className="energy-center-kicker">{name.toUpperCase()} / ASSISTENTE</span>
                  <span className="energy-center-title" role="status">
                    {phaseLabels[conversation.phase]}
                  </span>
                  <span className="energy-center-action">
                    {conversation.busy
                      ? "TOQUE PARA INTERROMPER"
                      : conversation.active
                        ? "TOQUE PARA ENCERRAR"
                        : "TOQUE PARA CONVERSAR"}
                  </span>
                </span>
              </button>
              <span className="orb-coordinate orb-coordinate-right" aria-hidden="true">
                IA
                <br />
                CONECTADA
              </span>
              <span className="orb-caption" aria-hidden="true">
                {conversation.phase === "speaking"
                  ? "FALANDO"
                  : conversation.phase === "listening"
                    ? "OUVINDO"
                    : conversation.busy
                      ? "PROCESSANDO"
                      : "AGUARDANDO"}
              </span>
            </div>
            <div className="orb-controls">
              {conversation.active && (
                <button type="button" className="orb-end" onClick={conversation.stop}>
                  ■ Encerrar
                </button>
              )}
              {conversation.busy && (
                <button type="button" className="orb-interrupt" onClick={conversation.interrupt}>
                  Interromper resposta
                </button>
              )}
            </div>
            {conversation.error && (
              <p className="feature-error" role="alert">
                {conversation.error}
              </p>
            )}
          </section>
        </div>
        <div
          id="assistant-panel-transcript"
          role="tabpanel"
          aria-labelledby="assistant-tab-transcript"
          hidden={view.assistantTab !== "transcript"}
        >
          <div className="conversation-transcript">
            <div className="transcript-actions">
              <button
                type="button"
                className="button small"
                onClick={() => void conversation.reset()}
                disabled={conversation.busy}
              >
                Nova conversa
              </button>
            </div>
            {!conversation.messages.length && <p className="transcript-empty">Nenhuma mensagem.</p>}
            <div className="messages" ref={log} role="log" aria-label="Conversa">
              {conversation.messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <span className="message-author">{message.role === "user" ? "Você" : name}</span>
                  {message.text}
                </div>
              ))}
            </div>
            {conversation.draft && (
              <p className="live-transcript">
                <span>Transcrevendo</span>
                {conversation.draft}
              </p>
            )}
            <form
              className="chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                void conversation.send(conversation.text);
              }}
            >
              <input
                aria-label="Mensagem"
                value={conversation.text}
                onChange={(event) => conversation.setText(event.target.value)}
                placeholder={`Converse com ${name}…`}
                maxLength={4000}
                disabled={conversation.busy}
              />
              {conversation.busy ? (
                <button
                  type="button"
                  className="send stop"
                  aria-label="Parar resposta"
                  onClick={conversation.interrupt}
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  className="send"
                  aria-label="Enviar"
                  disabled={!conversation.sessionId || !conversation.text.trim()}
                >
                  ↑
                </button>
              )}
            </form>
            <div className="voice-toolbar">
              <button
                type="button"
                className="panel-link"
                onClick={() => saveView((current) => ({ ...current, assistantTab: "voice" }))}
              >
                Conversar por voz
              </button>
            </div>
            {conversation.error && (
              <p className="feature-error" role="alert">
                {conversation.error}
              </p>
            )}
          </div>
        </div>
      </div>
    ),
    calendar: <CompanionCalendar />,
    tasks: <TasksPanel tasks={prefs.tasks} update={(tasks) => patch({ tasks })} />,
    notes: (
      <NotesPanel
        value={prefs.notes}
        onChange={(notes) => patch({ notes })}
        error={preferenceError}
      />
    ),
    system: (
      <div className="panel-body companion-status">
        <span className="eyebrow">SEU ASSISTENTE</span>
        <h3>{name}</h3>
        <p>{conversation.sessionId ? "Conectado ao cérebro central" : "Conectando…"}</p>
        <p>{conversation.active ? "Microfone ligado" : "Microfone desligado"}</p>
        <p>{actor.user.name}</p>
        <button type="button" className="button small" onClick={() => open("settings")}>
          Personalizar
        </button>
      </div>
    ),
    computer: <CompanionComputer />,
  };
  return (
    <>
      <link rel="stylesheet" href="/companion.css" />
      <Shell
        primary={identity.primary}
        open={open}
        focused={view.focused}
        setFocused={setFocused}
        error={preferenceError || viewError}
        home="/studio"
        detachable={detachable}
      >
        <WorkspaceStage
          contents={contents}
          prefs={prefs}
          patch={patch}
          drag={drag}
          openPanels={() => open("panels")}
          calendarDemo={false}
          detachable={detachable}
        />
      </Shell>
      {dialog && (
        <Dialog
          title={
            dialog === "panels" ? "Painéis" : dialog === "commands" ? "Comandos" : "Seu Jarvis"
          }
          onClose={() => open(null)}
        >
          {dialog === "panels" ? (
            <PanelsDialog prefs={prefs} primary={identity.primary} patch={patch} />
          ) : dialog === "commands" ? (
            <div className="command-list">
              <button
                type="button"
                onClick={() => {
                  setFocused(true);
                  open(null);
                }}
              >
                Entrar no modo foco
              </button>
              <button
                type="button"
                onClick={() => {
                  openWorkspaceWindow();
                  open(null);
                }}
              >
                Nova janela
              </button>
              <button type="button" onClick={() => open("panels")}>
                Organizar painéis
              </button>
              <button
                type="button"
                onClick={() => {
                  void conversation.reset();
                  open(null);
                }}
              >
                Nova conversa
              </button>
            </div>
          ) : (
            <>
              <label className="setting-row">
                <span>Assistente</span>
                <select
                  aria-label="Assistente"
                  value={conversation.assistantId}
                  disabled={conversation.active || conversation.busy}
                  onChange={(event) => {
                    conversation.setAssistantId(event.target.value);
                    conversation.setMessages([]);
                  }}
                >
                  <option value="">{conversation.options.name} · padrão</option>
                  {conversation.options.assistants.map((assistant) => (
                    <option key={assistant.id} value={assistant.id}>
                      {assistant.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-row">
                <span>Localização atual</span>
                <select
                  aria-label="Localização atual"
                  value={conversation.areaId}
                  disabled={conversation.busy}
                  onChange={(event) => {
                    conversation.interrupt();
                    conversation.setAreaId(event.target.value);
                  }}
                >
                  <option value="">Itinerante · sem cômodo fixo</option>
                  {conversation.options.areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-row">
                <span>Cor</span>
                <select
                  value={prefs.color}
                  onChange={(event) => patch({ color: event.target.value as Preferences["color"] })}
                >
                  <option value="mint">Ciano</option>
                  <option value="blue">Azul</option>
                  <option value="violet">Violeta</option>
                </select>
              </label>
              <label className="setting-row">
                <span>Animações</span>
                <input
                  type="checkbox"
                  checked={prefs.motion}
                  onChange={(event) => patch({ motion: event.target.checked })}
                />
              </label>
              <div className="command-list">
                <a href="/personal" target="_blank" rel="noreferrer">
                  Meus assistentes
                </a>
                <a href="/integrations" target="_blank" rel="noreferrer">
                  Minhas contas
                </a>
                <a href="/overview" target="_blank" rel="noreferrer">
                  Administração web
                </a>
                <button type="button" onClick={logout}>
                  Sair da conta
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
