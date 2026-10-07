import { Modal } from "../modal/Modal";
export function ConfirmDialog({
  title,
  description,
  onCancel,
  onConfirm,
  busy = false,
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{description}</p>
      <footer className="form-actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
          {busy ? "Aguarde…" : "Confirmar"}
        </button>
      </footer>
    </Modal>
  );
}
