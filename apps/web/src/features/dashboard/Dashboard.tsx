"use client";
import { type Collection, collections } from "@rosie/types";
import Link from "next/link";
import { CatalogPage } from "../catalog/CatalogPage/CatalogPage";
import { Overview } from "../overview/Overview";
import { useSession } from "../session/SessionProvider";
import { Settings } from "../settings/Settings";
import { Studio } from "../studio/Studio";
import { MyAccount } from "../users/MyAccount/MyAccount";
import { UsersPage } from "../users/UsersPage/UsersPage";
export function Dashboard({ section = "overview" }: { section?: string }) {
  const { actor, status, refresh, check, expire } = useSession();
  const admin = actor?.user.role === "admin";
  return (
    <>
      {section === "studio" && actor?.capabilities.includes("robot.control") ? (
        <Studio />
      ) : section === "overview" ? (
        <Overview status={status} refresh={refresh} readOnly={!admin} />
      ) : section === "account" && actor ? (
        <MyAccount user={actor.user} onChanged={expire} />
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
    </>
  );
}
