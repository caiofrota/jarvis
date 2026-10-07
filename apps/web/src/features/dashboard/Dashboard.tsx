"use client";
import { type Actor, type Collection, collections } from "@rosie/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../components/admin-shell/AdminShell";
import { LoadingScreen } from "../../components/loading-screen/LoadingScreen";
import { ApiError, request, type Status } from "../../lib/api-client";
import { CatalogPage } from "../catalog/CatalogPage/CatalogPage";
import { Login } from "../login/Login";
import { Overview } from "../overview/Overview";
import { Settings } from "../settings/Settings";
import { Studio } from "../studio/Studio";
import { MyAccount } from "../users/MyAccount/MyAccount";
import { UsersPage } from "../users/UsersPage/UsersPage";
export function Dashboard({ section = "overview" }: { section?: string }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [actor, setActor] = useState<Actor>(),
    [status, setStatus] = useState<Status>(),
    [error, setError] = useState("");
  const check = useCallback(async () => {
    try {
      setActor(await request<Actor>("/session"));
      setAuthenticated(true);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthenticated(false);
      else setError((e as Error).message);
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      setStatus(await request<Status>("/status"));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthenticated(false);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);
  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [authenticated, refresh]);
  if (authenticated === false) return <Login onLogin={() => void check()} />;
  if (authenticated === null) return <LoadingScreen error={error} onRetry={() => void check()} />;
  const admin = actor?.user.role === "admin";
  return (
    <AdminShell
      section={section}
      capabilities={actor?.capabilities ?? []}
      onLogout={() => {
        void request("/logout", { method: "POST" })
          .then(() => setAuthenticated(false))
          .catch((e) => setError(e.message));
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {section === "studio" && actor?.capabilities.includes("robot.control") ? (
        <Studio />
      ) : section === "overview" ? (
        <Overview status={status} refresh={refresh} readOnly={!admin} />
      ) : section === "account" && actor ? (
        <MyAccount user={actor.user} onChanged={() => setAuthenticated(false)} />
      ) : section === "users" && admin && actor ? (
        <UsersPage actor={actor} onSelfChanged={() => void check()} />
      ) : section === "settings" && admin ? (
        <Settings status={status} refresh={refresh} />
      ) : collections.includes(section as Collection) ? (
        <CatalogPage
          key={section}
          collection={section as Collection}
          voices={status?.speech.voices ?? []}
          cloudHomeId={status?.speech.cloudHomeId}
          readOnly={!admin}
        />
      ) : (
        <section className="panel">
          <h1>Página não encontrada</h1>
          <Link href="/">Voltar à visão geral</Link>
        </section>
      )}
    </AdminShell>
  );
}
