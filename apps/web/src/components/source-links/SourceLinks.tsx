import type { WebReferences } from "@rosie/types";

export function SourceLinks({ web }: { web?: WebReferences }) {
  if (!web) return null;
  return (
    <span className="source-links">
      {" "}
      Fontes:{" "}
      {web.sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 && "; "}
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title}
          </a>
        </span>
      ))}
      .{" "}
      <small>
        {web.cache === "hit"
          ? "Reutilizada do cache. "
          : web.cache === "shared"
            ? "Pesquisa compartilhada com outra consulta simultânea. "
            : ""}
        Consulta em {new Date(web.checkedAt).toLocaleString("pt-BR")}.
      </small>
    </span>
  );
}
