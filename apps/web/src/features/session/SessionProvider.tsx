"use client";
import type { Actor } from "@rosie/types";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AdminShell } from "../../components/admin-shell/AdminShell";
import { LoadingScreen } from "../../components/loading-screen/LoadingScreen";
import { ApiError, request, type Status } from "../../lib/api-client";
import { Login } from "../login/Login";

type Session = {
  actor: Actor;
  status?: Status;
  refresh: () => Promise<void>;
  check: () => Promise<void>;
  expire: () => void;
  logout: () => void;
};
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("The authenticated layout is required.");
  return value;
}
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [actor, setActor] = useState<Actor | null>();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const generation = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const lastAnnouncement = useRef("");
  const [secondary, setSecondary] = useState<boolean>();
  const announce = useCallback(() => {
    const id = crypto.randomUUID();
    channel.current?.postMessage(id);
    try {
      localStorage.setItem("jarvis-session-change", id);
    } catch {
      /* Storage can be unavailable in restricted browsers. */
    }
  }, []);
  const expire = useCallback(() => {
    generation.current++;
    setActor(null);
    setStatus(undefined);
  }, []);
  const check = useCallback(async () => {
    const version = ++generation.current;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const next = await request<Actor>("/session", { signal: abort.signal });
      if (generation.current !== version) return;
      setActor(next);
      setError("");
    } catch (cause) {
      if (generation.current !== version) return;
      if (cause instanceof ApiError && cause.status === 401) expire();
      else
        setError(
          abort.signal.aborted
            ? "A conexão demorou a responder. Tente novamente."
            : (cause as Error).message,
        );
    } finally {
      clearTimeout(timeout);
    }
  }, [expire]);
  const refresh = useCallback(async () => {
    const version = generation.current;
    try {
      const next = await request<Status>("/status");
      if (generation.current !== version) return;
      setStatus(next);
      setError("");
    } catch (cause) {
      if (generation.current !== version) return;
      if (cause instanceof ApiError && cause.status === 401) expire();
      else setError((cause as Error).message);
    }
  }, [expire]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSecondary(
      (pathname === "/" || pathname === "/studio") &&
        (params.get("secondary") === "1" || !!params.get("panel")),
    );
  }, [pathname]);
  useEffect(() => {
    const changed = (id: string) => {
      if (lastAnnouncement.current === id) return;
      lastAnnouncement.current = id;
      generation.current++;
      setActor(undefined);
      setStatus(undefined);
      void check();
    };
    if (typeof BroadcastChannel !== "undefined") {
      const subscription = new BroadcastChannel("jarvis-session");
      channel.current = subscription;
      subscription.onmessage = (event) => {
        if (typeof event.data === "string" && event.data.length <= 100) changed(event.data);
      };
    }
    const storage = (event: StorageEvent) => {
      if (event.key === "jarvis-session-change" && event.newValue) changed(event.newValue);
    };
    const focus = () => void check();
    const visible = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, 15000);
    void check();
    return () => {
      generation.current++;
      channel.current?.close();
      channel.current = null;
      clearInterval(timer);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check]);
  useEffect(() => {
    if (!actor?.capabilities.includes("status.read")) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [actor, refresh]);
  const companion =
    (pathname === "/" || pathname === "/studio") && !!actor?.capabilities.includes("companion.use");
  useEffect(() => {
    document.body.classList.toggle("jarvis-companion", companion && !!actor);
    return () => document.body.classList.remove("jarvis-companion");
  }, [companion, actor]);
  const logout = () => {
    void request("/logout", { method: "POST" })
      .then(() => {
        expire();
        announce();
      })
      .catch((cause) => setError(cause.message));
  };
  if (secondary === undefined || actor === undefined)
    return <LoadingScreen error={error} onRetry={() => void check()} />;
  if (actor === null && secondary)
    return (
      <main className="jarvis-loading">
        <div className="jarvis-loading-content">
          <p className="eyebrow">JARVIS</p>
          <h1>Painel bloqueado</h1>
          <p role="status">Entre pelo painel principal para continuar.</p>
          {error && <p role="alert">{error}</p>}
        </div>
      </main>
    );
  if (actor === null)
    return (
      <Login
        onLogin={() => {
          announce();
          void check();
        }}
      />
    );
  const section =
    pathname?.split("/")[1] ||
    (actor.capabilities.includes("companion.use") ? "studio" : "overview");
  return (
    <SessionContext.Provider
      key={actor.user.id}
      value={{ actor, status, refresh, check, expire, logout }}
    >
      {companion ? (
        <>
          {error && <p role="alert">{error}</p>}
          {children}
        </>
      ) : (
        <AdminShell section={section} capabilities={actor.capabilities} onLogout={logout}>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {children}
        </AdminShell>
      )}
    </SessionContext.Provider>
  );
}
