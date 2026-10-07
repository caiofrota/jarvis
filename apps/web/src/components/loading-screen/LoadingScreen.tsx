export function LoadingScreen({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="jarvis-loading" aria-busy={!error}>
      <div className="jarvis-loading-content">
        <div className={`jarvis-loader${error ? " stopped" : ""}`} aria-hidden="true">
          <span className="jarvis-loader-orbit" />
          <span className="jarvis-loader-orbit" />
          <span className="jarvis-loader-orbit" />
          <span className="jarvis-loader-core">J</span>
        </div>
        <p className="eyebrow">JARVIS</p>
        <h1>{error ? "Não foi possível carregar" : "Carregando"}</h1>
        <p role={error ? "alert" : "status"} aria-live="polite">
          {error || "Preparando a central…"}
        </p>
        {error && onRetry && (
          <button type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        )}
      </div>
    </main>
  );
}
