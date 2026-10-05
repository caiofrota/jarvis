'use client';
import { useEffect, useState } from 'react';
import { workspaceIdentity, type WorkspaceIdentity } from '../../features/workspace/window-layout';
import WorkspaceView from './WorkspaceView';

export default function Workspace() {
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  useEffect(() => {
    setIdentity(workspaceIdentity());
  }, []);
  return identity ? (
    <WorkspaceView identity={identity} />
  ) : (
    <main aria-busy="true">Preparando seu espaço…</main>
  );
}
