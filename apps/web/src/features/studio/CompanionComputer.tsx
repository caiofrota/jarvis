"use client";
import { useEffect, useState } from "react";
import ComputerPanel from "../../../../../features/actions/ComputerPanel";
import { useActions } from "../../../../../features/actions/useActions";
import type { CompanionWindowsAPI } from "../../../../../shared/types";

function DesktopComputer({ api }: { api: CompanionWindowsAPI }) {
  const actions = useActions(api);
  return <ComputerPanel actions={actions} />;
}
export function CompanionComputer() {
  const [api, setAPI] = useState<CompanionWindowsAPI>();
  useEffect(() => setAPI(window.jarvisCompanionWindows), []);
  return api ? (
    <DesktopComputer api={api} />
  ) : (
    <div className="panel-body">
      <p className="empty">Abra o aplicativo do computador para acessar seus programas e pastas.</p>
    </div>
  );
}
