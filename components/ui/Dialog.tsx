import { useEffect, useRef } from 'react';
export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <p className="eyebrow">SEU JARVIS</p>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
