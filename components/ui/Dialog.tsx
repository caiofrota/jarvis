import { useEffect, useRef, useId } from 'react';
export default function Dialog({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className={className} aria-labelledby={titleId} onCancel={onClose}>
      <div className="dialog-head">
        <div>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
