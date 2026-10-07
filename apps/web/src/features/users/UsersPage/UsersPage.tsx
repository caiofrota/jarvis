"use client";
import { faArrowDown, faArrowUp, faPen, faPlus, faSort } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type Account, type Actor, accountRoleLabels } from "@rosie/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IconButton } from "../../../components/icon-button/IconButton";
import { request } from "../../../lib/api-client";
import { UserEditor } from "../UserEditor/UserEditor";

type UserPage = {
  items: Account[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  direction: string;
};
const columns = [
  { key: "username", label: "Usuário" },
  { key: "name", label: "Nome" },
  { key: "role", label: "Permissão" },
  { key: "enabled", label: "Acesso" },
] as const;
export function UsersPage({ actor, onSelfChanged }: { actor: Actor; onSelfChanged: () => void }) {
  const router = useRouter(),
    path = usePathname(),
    search = useSearchParams(),
    query = search.toString();
  const [data, setData] = useState<UserPage>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<Account | "new" | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await request<UserPage>(`/users?${query}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${path}?${next}`);
  };
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">ACESSO À PLATAFORMA</p>
          <h1>Usuários</h1>
          <p>Contas do painel, independentes dos perfis de moradores.</p>
        </div>
        <button type="button" className="primary" onClick={() => setEditing("new")}>
          <FontAwesomeIcon icon={faPlus} /> Novo usuário
        </button>
      </header>
      <section className="panel">
        <form
          className="table-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            update({ q: String(new FormData(event.currentTarget).get("q") ?? ""), page: "1" });
          }}
        >
          <label className="search-field">
            Buscar por nome ou usuário
            <input key={query} name="q" defaultValue={search.get("q") ?? ""} />
          </label>
          <button type="submit">Buscar</button>
        </form>
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="error">
            {error}{" "}
            <button type="button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </p>
        )}
        {loading ? (
          <p role="status">Carregando usuários…</p>
        ) : data?.items.length ? (
          <table className="data-table">
            <caption className="sr-only">Usuários da plataforma</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      data.sort === c.key
                        ? data.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          sort: c.key,
                          direction:
                            data.sort === c.key && data.direction === "asc" ? "desc" : "asc",
                          page: "1",
                        })
                      }
                    >
                      {c.label}
                      <FontAwesomeIcon
                        icon={
                          data.sort === c.key
                            ? data.direction === "asc"
                              ? faArrowUp
                              : faArrowDown
                            : faSort
                        }
                      />
                    </button>
                  </th>
                ))}
                <th scope="col" className="actions-heading">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id}>
                  <td data-label="Usuário">
                    {user.username}
                    {user.id === actor.user.id ? " (você)" : ""}
                  </td>
                  <td data-label="Nome">{user.name}</td>
                  <td data-label="Permissão">{accountRoleLabels[user.role]}</td>
                  <td data-label="Acesso">
                    <span className={`badge ${user.enabled ? "good" : "warning"}`}>
                      {user.enabled ? "Ativo" : "Desativado"}
                    </span>
                  </td>
                  <td data-label="Ações">
                    <div className="row-actions">
                      <IconButton
                        icon={faPen}
                        tone="edit"
                        label={`Editar ${user.name}`}
                        onClick={() => setEditing(user)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !error && (
            <div className="empty">
              <h2>Nenhum usuário encontrado</h2>
              <p>Ajuste a busca ou crie uma conta.</p>
            </div>
          )
        )}
        {data && (
          <footer className="pagination">
            <label>
              Por página
              <select
                value={data.pageSize}
                onChange={(e) => update({ pageSize: e.target.value, page: "1" })}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {data.total} usuários · página {data.page} de{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <div>
              <button
                type="button"
                disabled={data.page <= 1 || loading}
                onClick={() => update({ page: String(data.page - 1) })}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={data.page * data.pageSize >= data.total || loading}
                onClick={() => update({ page: String(data.page + 1) })}
              >
                Próxima
              </button>
            </div>
          </footer>
        )}
      </section>
      {editing && (
        <UserEditor
          self={editing !== "new" && editing.id === actor.user.id}
          user={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setNotice("Usuário salvo.");
            if (id === actor.user.id) onSelfChanged();
            else void load();
          }}
        />
      )}
    </>
  );
}
