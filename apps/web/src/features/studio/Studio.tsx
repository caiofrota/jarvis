"use client";
import { useEffect, useState } from "react";
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
  return identity ? (
    <CompanionWorkspace key={actor.user.id} identity={identity} />
  ) : (
    <LoadingScreen />
  );
}
