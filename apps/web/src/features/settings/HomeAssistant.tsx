"use client";
import { faDownload, faSort } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { homeAssistantDeviceKinds } from "@rosie/types";
import { useEffect, useState } from "react";
import { Field } from "../../components/field/Field";
import { IconButton } from "../../components/icon-button/IconButton";
import { Modal } from "../../components/modal/Modal";
import { kindLabels } from "../../i18n/pt-BR";
import { type Options, request } from "../../lib/api-client";

type Entity = {
  id: string;
  name: string;
  kind: string;
  areaName: string;
  state: string;
  imported: boolean;
};
export function HomeAssistantImport({ homeId, ready }: { homeId: string; ready: boolean }) {
  const [options, setOptions] = useState<Options>({}),
    [rows, setRows] = useState<Entity[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10),
    [sort, setSort] = useState("name"),
    [direction, setDirection] = useState("asc"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Entity>(),
    [room, setRoom] = useState(""),
    [kind, setKind] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    void request<Options>("/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let current = true;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      refresh: String(version),
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction,
      q: search,
    });
    void request<{ items: Entity[]; total: number }>(`/home-assistant/entities?${params}`)
      .then((v) => {
        if (current) {
          setRows(v.items);
          setTotal(v.total);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [ready, page, pageSize, sort, direction, search, version]);
  const columns = [
    { key: "name", label: "Nome" },
    { key: "kind", label: "Tipo" },
    { key: "areaName", label: "Área no HA" },
    { key: "state", label: "Estado" },
  ];
  return (
    <>
      <h3>Escolher dispositivos do Home Assistant</h3>
      <p>
        Importar cria um cadastro na Rosie. Depois ajuste apelidos e a luz padrão do ambiente. Cenas
        e scripts podem ser usados como etapas de uma rotina.
      </p>
      {!ready ? (
        <p className="hint">
          Salve a conexão e aguarde o estado “Conectado” para carregar os dispositivos.
        </p>
      ) : (
        <>
          <div className="table-toolbar">
            <Field
              label="Buscar no Home Assistant"
              value={query}
              onChange={(v) => setQuery(String(v))}
            />
            <button
              type="button"
              onClick={() => {
                setPage(1);
                setSearch(query);
                setVersion((v) => v + 1);
              }}
            >
              Buscar
            </button>
          </div>
          {busy ? (
            <p role="status">Carregando entidades…</p>
          ) : (
            <table className="data-table">
              <caption className="sr-only">Entidades disponíveis no Home Assistant</caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={
                        sort === c.key ? (direction === "asc" ? "ascending" : "descending") : "none"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPage(1);
                          setSort(c.key);
                          setDirection(sort === c.key && direction === "asc" ? "desc" : "asc");
                        }}
                      >
                        {c.label}
                        <FontAwesomeIcon icon={faSort} aria-hidden="true" />
                      </button>
                    </th>
                  ))}
                  <th className="actions-heading">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c.key} data-label={c.label}>
                        {String(row[c.key as keyof Entity] || "—")}
                        {c.key === "name" && <small className="field-hint">{row.id}</small>}
                      </td>
                    ))}
                    <td data-label="Ações">
                      <div className="row-actions">
                        <IconButton
                          icon={faDownload}
                          tone="success"
                          label={row.imported ? `${row.name} já importado` : `Importar ${row.name}`}
                          disabled={row.imported}
                          onClick={() => {
                            setSelected(row);
                            setName(row.name);
                            setRoom("");
                            setKind(homeAssistantDeviceKinds(row.id)[0]);
                            setError("");
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!busy && !rows.length && !error && <p className="empty">Nenhuma entidade encontrada.</p>}
          <div className="pagination">
            <label>
              Por página
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <span>
              {total} entidades · página {page} de {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <div>
              <button
                type="button"
                disabled={page <= 1 || busy}
                onClick={() => setPage((v) => v - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page * pageSize >= total || busy}
                onClick={() => setPage((v) => v + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {selected && (
        <Modal title={`Importar ${selected.name}`} onClose={() => setSelected(undefined)}>
          <Field label="Nome na Rosie" value={name} onChange={(v) => setName(String(v))} />
          <Field
            label="Tipo de dispositivo"
            type="select"
            value={kind}
            onChange={(v) => setKind(String(v))}
            options={homeAssistantDeviceKinds(selected.id).map((id) => ({
              id,
              name: kindLabels[id],
            }))}
            hint="Escolha o que ele controla. Se o interruptor acende uma luz, selecione Luz."
            required
          />
          <Field
            label="Ambiente na Rosie"
            type="select"
            value={room}
            onChange={(v) => setRoom(String(v))}
            options={(options.rooms ?? []).filter((v) => v.homeId === homeId)}
          />
          <p>
            Área informada pelo HA: {selected.areaName || "sem área"}. Nenhum comando será enviado
            ao importar.
          </p>
          <footer className="form-actions">
            <button type="button" onClick={() => setSelected(undefined)}>
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !room || !kind || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await request("/home-assistant/import", {
                    method: "POST",
                    body: JSON.stringify({ entityId: selected.id, roomId: room, name, kind }),
                  });
                  setNotice(`${name} importado.`);
                  setSelected(undefined);
                  setVersion((v) => v + 1);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Importar dispositivo
            </button>
          </footer>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
