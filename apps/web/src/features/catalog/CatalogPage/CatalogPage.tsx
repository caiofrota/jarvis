"use client";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { Collection } from "@rosie/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../../../components/confirm-dialog/ConfirmDialog";
import { Modal } from "../../../components/modal/Modal";
import { descriptions, labels } from "../../../i18n/pt-BR";
import { type Options, type PageResult, type RecordRow, request } from "../../../lib/api-client";
import { VoicePreview } from "../../voice-preview/VoicePreview";
import { DataTable } from "../DataTable/DataTable";
import { EntityEditor } from "../EntityEditor/EntityEditor";
export function CatalogPage({
  collection,
  voices,
  cloudHomeId,
  readOnly = false,
}: {
  collection: Collection;
  voices: string[];
  cloudHomeId?: string;
  readOnly?: boolean;
}) {
  const router = useRouter(),
    path = usePathname(),
    search = useSearchParams(),
    query = search.toString();
  const [data, setData] = useState<PageResult>(),
    [options, setOptions] = useState<Options>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<RecordRow | "new" | null>(null),
    [deleting, setDeleting] = useState<RecordRow | null>(null),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<{ title: string; body: React.ReactNode } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [page, choices] = await Promise.all([
        request<PageResult>(`/catalog/${collection}?${query}`),
        request<Options>("/options"),
      ]);
      setData(page);
      setOptions(choices);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [collection, query]);
  useEffect(() => {
    void load();
  }, [load]);
  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${path}?${next}`);
  }
  async function action(row: RecordRow, kind: string) {
    setError("");
    setNotice("");
    try {
      if (kind === "preview") {
        setDetail({
          title: `Voz de ${row.name}`,
          body: <VoicePreview assistantId={row.id} name={row.name} />,
        });
        return;
      }
      const result = await request<Record<string, unknown>>(`/endpoints/${row.id}/${kind}`, {
        method: kind === "effective" ? "GET" : "POST",
      });
      if (kind === "pair-code")
        setDetail({
          title: `Parear ${row.name}`,
          body: (
            <>
              <p>Na configuração da caixinha, informe o endereço deste painel e o PIN:</p>
              <strong className="pairing-pin">{String(result.pin)}</strong>
              <p>Válido por 5 minutos e para um único pareamento.</p>
            </>
          ),
        });
      else if (kind === "effective")
        setDetail({
          title: row.name,
          body: (
            <>
              <p>
                {String(result.assistant)} · {String(result.room)}
              </p>
              <dl className="effective-list">
                {Object.entries(result.audio as Record<string, unknown>).map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {
                        (
                          {
                            volume: "Volume",
                            prefillMs: "Reserva de áudio",
                            listenSeconds: "Escuta",
                            drowsySeconds: "Sonolência",
                          } as Record<string, string>
                        )[key]
                      }
                    </dt>
                    <dd>
                      {String(value)}{" "}
                      <small>de {String((result.sources as Record<string, unknown>)[key])}</small>
                    </dd>
                  </div>
                ))}
              </dl>
              <p>Chamada instalada: {String(result.wakeWord)}</p>
            </>
          ),
        });
      else setNotice("Teste enviado à caixinha.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">SUA CASA, DO SEU JEITO</p>
          <h1>{labels[collection]}</h1>
          <p>{descriptions[collection]}</p>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="primary"
            onClick={() => setEditing("new")}
            disabled={loading}
          >
            <FontAwesomeIcon icon={faPlus} /> Novo cadastro
          </button>
        )}
      </header>
      <section className="panel">
        <form
          className="table-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            update({ q: String(form.get("q") ?? ""), page: "1" });
          }}
        >
          <label className="search-field">
            Buscar por nome
            <input
              key={search.get("q")}
              name="q"
              defaultValue={search.get("q") ?? ""}
              placeholder="Buscar…"
            />
          </label>
          <button type="submit">Buscar</button>
          {collection !== "homes" && (
            <label>
              Casa
              <select
                value={search.get("homeId") ?? ""}
                onChange={(e) => update({ homeId: e.target.value, page: "1" })}
              >
                <option value="">Todas</option>
                {(options.homes ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form>
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button type="button" onClick={() => void load()}>
              Tentar novamente
            </button>
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {busy && <p role="status">Preparando…</p>}
        {loading ? (
          <p className="empty" role="status">
            Carregando registros…
          </p>
        ) : data?.items.length ? (
          <DataTable
            readOnly={readOnly}
            collection={collection}
            data={data}
            onEdit={setEditing}
            onDelete={setDeleting}
            onAction={(row, kind) => void action(row, kind)}
            onSort={(key) =>
              update({
                sort: key,
                direction: data.sort === key && data.direction === "asc" ? "desc" : "asc",
                page: "1",
              })
            }
          />
        ) : (
          !error && (
            <div className="empty">
              <h2>Nenhum registro encontrado</h2>
              <p>Crie um cadastro ou ajuste a busca.</p>
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
              {data.total} registros · página {data.page} de{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <div>
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => update({ page: String(data.page - 1) })}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => update({ page: String(data.page + 1) })}
              >
                Próxima
              </button>
            </div>
          </footer>
        )}
      </section>
      {editing && (
        <EntityEditor
          collection={collection}
          row={editing === "new" ? undefined : editing}
          options={options}
          voices={voices}
          cloudHomeId={cloudHomeId}
          onClose={() => {
            setEditing(null);
            if (collection === "residents") void load();
          }}
          onSaved={() => {
            setEditing(null);
            setNotice("Cadastro salvo.");
            void load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Excluir ${deleting.name}?`}
          description="O cadastro será removido. Registros associados precisam ser desvinculados antes da exclusão."
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setBusy(true);
            void request(`/catalog/${collection}/${deleting.id}`, {
              method: "DELETE",
              body: JSON.stringify({ revision: deleting.revision }),
            })
              .then(() => {
                setDeleting(null);
                setNotice("Cadastro removido.");
                return load();
              })
              .catch((e) => {
                setError(e.message);
                setDeleting(null);
              })
              .finally(() => setBusy(false));
          }}
        />
      )}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          {detail.body}
        </Modal>
      )}
    </>
  );
}
