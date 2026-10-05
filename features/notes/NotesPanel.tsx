export default function NotesPanel({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (notes: string) => void;
  error: string;
}) {
  return (
    <div className="panel-body">
      <textarea
        className="notes-area"
        aria-label="Suas notas"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={30000}
        placeholder="Uma ideia, uma lista, um plano…"
      />
      {error && (
        <p className="note-status" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
