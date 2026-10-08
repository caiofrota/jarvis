"use client";
import { useCallback, useEffect, useState } from "react";
import {
  type WorkspaceIdentity,
  workspaceIdentity,
} from "../../../../../features/workspace/window-layout";
import { LoadingScreen } from "../../components/loading-screen/LoadingScreen";
import { useSession } from "../session/SessionProvider";
import { CompanionWorkspace } from "./CompanionWorkspace";
export function Studio() {
  const { actor } = useSession();
  const [identity, setIdentity] = useState<WorkspaceIdentity>();
  useEffect(() => setIdentity(workspaceIdentity(`companion:${actor.user.id}:`)), [actor.user.id]);
  const [stylesReady, setStylesReady] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reveal = useCallback(() => setWorkspaceReady(true), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each retry needs a fresh stylesheet loading deadline.
  useEffect(() => {
    if (stylesReady) return;
    const timeout = setTimeout(() => setError("O visual do Jarvis demorou a carregar."), 15000);
    return () => clearTimeout(timeout);
  }, [stylesReady, attempt]);
  return (
    <>
      <link
        key={attempt}
        rel="stylesheet"
        href="/companion.css"
        onLoad={() => {
          setError("");
          setStylesReady(true);
        }}
        onError={() => setError("Não foi possível carregar o visual do Jarvis.")}
      />
      {!workspaceReady && (
        <LoadingScreen
          error={error}
          onRetry={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        />
      )}
      {identity && stylesReady && (
        <div
          style={{ visibility: workspaceReady ? "visible" : "hidden" }}
          aria-hidden={!workspaceReady}
          inert={!workspaceReady}
        >
          <CompanionWorkspace key={actor.user.id} identity={identity} onReady={reveal} />
        </div>
      )}
    </>
  );
}
