import {
  faArrowDown,
  faArrowUp,
  faCircleInfo,
  faKey,
  faPen,
  faSort,
  faTrash,
  faVolumeHigh,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { Collection } from "@rosie/types";
import { IconButton } from "../../../components/icon-button/IconButton";
import {
  expressionLabels,
  intentMatchLabels,
  intentResponseLabels,
  kindLabels,
  labels,
} from "../../../i18n/pt-BR";
import type { PageResult, RecordRow } from "../../../lib/api-client";
import { columns } from "./columns";
export function DataTable({
  collection,
  data,
  onSort,
  onEdit,
  onDelete,
  onAction,
  readOnly = false,
}: {
  collection: Collection;
  data: PageResult;
  onSort: (key: string) => void;
  onEdit: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  onAction: (row: RecordRow, action: string) => void;
  readOnly?: boolean;
}) {
  const display = (row: RecordRow, key: string) => {
    const v = row[key];
    if (key === "enabled")
      return <span className={`badge ${v ? "success" : ""}`}>{v ? "Ativo" : "Pausado"}</span>;
    if (key === "matchMode") return intentMatchLabels[String(v ?? "exact")];
    if (key === "responseMode") return intentResponseLabels[String(v ?? "template")];
    if (key === "connection") return v === "home-assistant" ? "Home Assistant" : "MQTT";
    if (key === "kind") return kindLabels[String(v)] ?? String(v);
    if (key === "expression") return expressionLabels[String(v)] ?? String(v);
    if (key === "volume") return v == null ? "Da casa" : `${v}%`;
    if (Array.isArray(v)) return v.join(" · ");
    return String(v || "—");
  };
  return (
    <table className="data-table">
      <caption className="sr-only">Cadastros de {labels[collection]}</caption>
      <thead>
        <tr>
          {columns[collection].map((c) => (
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
              <button type="button" onClick={() => onSort(c.key)}>
                {c.label}
                <FontAwesomeIcon
                  icon={
                    data.sort === c.key
                      ? data.direction === "asc"
                        ? faArrowUp
                        : faArrowDown
                      : faSort
                  }
                  aria-hidden="true"
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
        {data.items.map((row) => (
          <tr key={row.id}>
            {columns[collection].map((c) => (
              <td key={c.key} data-label={c.label}>
                {display(row, c.key)}
              </td>
            ))}
            <td data-label="Ações">
              <div className="row-actions">
                {collection === "endpoints" && (
                  <>
                    {!readOnly && (
                      <>
                        <IconButton
                          label={`Testar voz de ${row.name}`}
                          icon={faVolumeHigh}
                          tone="info"
                          onClick={() => onAction(row, "test-voice")}
                        />
                        <IconButton
                          label={`Parear ${row.name}`}
                          icon={faKey}
                          tone="success"
                          onClick={() => onAction(row, "pair-code")}
                        />
                      </>
                    )}
                    <IconButton
                      label={`Configuração efetiva de ${row.name}`}
                      icon={faCircleInfo}
                      tone="info"
                      onClick={() => onAction(row, "effective")}
                    />
                  </>
                )}
                {collection === "assistants" && !readOnly && (
                  <IconButton
                    label={`Ouvir voz de ${row.name}`}
                    icon={faVolumeHigh}
                    tone="info"
                    onClick={() => onAction(row, "preview")}
                  />
                )}
                {!readOnly && !row.managedByHa && (
                  <>
                    <IconButton
                      label={`Editar ${row.name}`}
                      icon={faPen}
                      tone="edit"
                      onClick={() => onEdit(row)}
                    />
                    <IconButton
                      label={`Excluir ${row.name}`}
                      icon={faTrash}
                      tone="danger"
                      onClick={() => onDelete(row)}
                    />
                  </>
                )}
                {Boolean(row.managedByHa) && (
                  <span className="hint">Gerenciado no Home Assistant</span>
                )}
                {readOnly && collection !== "endpoints" && (
                  <span className="hint">Somente leitura</span>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
