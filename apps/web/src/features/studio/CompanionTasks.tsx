"use client";
import { type PersonalTaskStatus, personalTaskStatusSchema } from "@rosie/types";
import { useEffect, useRef, useState } from "react";
import TasksPanel from "../../../../../features/tasks/TasksPanel";
import type { Task } from "../../../../../shared/types";
import { request } from "../../lib/api-client";
export function CompanionTasks({
  legacyTasks,
  onImported,
}: {
  legacyTasks: Task[];
  onImported: () => void;
}) {
  const [status, setStatus] = useState<PersonalTaskStatus>({ tasks: [], revision: null });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const latest = useRef(status);
  latest.current = status;
  const saving = useRef(false);
  const initial = useRef({ legacyTasks, onImported });
  useEffect(() => {
    const abort = new AbortController();
    async function refresh() {
      if (saving.current) return;
      try {
        let value = personalTaskStatusSchema.parse(
          await request("/companion/tasks", { signal: abort.signal }),
        );
        if (initial.current.legacyTasks.length) {
          try {
            value = personalTaskStatusSchema.parse(
              await request("/companion/tasks/import", {
                method: "POST",
                body: JSON.stringify({ tasks: initial.current.legacyTasks }),
                signal: abort.signal,
              }),
            );
            if (abort.signal.aborted) return;
            initial.current.onImported();
            initial.current.legacyTasks = [];
            setImportError("");
          } catch (cause) {
            if (!abort.signal.aborted)
              setImportError(
                `As tarefas deste dispositivo foram preservadas, mas a importação falhou: ${(cause as Error).message}`,
              );
          }
        }
        if (!abort.signal.aborted) {
          setStatus(value);
          setError("");
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError((cause as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const changed = () => void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) changed();
    }, 10000);
    window.addEventListener("jarvis-personal-tasks-changed", changed);
    return () => {
      abort.abort();
      clearInterval(interval);
      window.removeEventListener("jarvis-personal-tasks-changed", changed);
    };
  }, []);
  async function save(tasks: Task[]) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const value = personalTaskStatusSchema.parse(
        await request("/companion/tasks", {
          method: "PUT",
          body: JSON.stringify({ tasks, revision: latest.current.revision }),
        }),
      );
      latest.current = value;
      setStatus(value);
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      try {
        setStatus(personalTaskStatusSchema.parse(await request("/companion/tasks")));
      } catch {}
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {loading ? (
        <p className="panel-body connection-status" role="status">
          Carregando sua lista…
        </p>
      ) : (
        <TasksPanel tasks={status.tasks} update={save} disabled={busy || !!error} />
      )}
      {importError && (
        <p className="panel-body feature-error" role="alert">
          {importError}
        </p>
      )}
      {error && (
        <p className="panel-body feature-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
