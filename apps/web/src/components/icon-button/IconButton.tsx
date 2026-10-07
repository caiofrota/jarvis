import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
export function IconButton({
  label,
  icon,
  tone = "neutral",
  onClick,
  disabled = false,
}: {
  label: string;
  icon: IconDefinition;
  tone?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${tone}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <FontAwesomeIcon icon={icon} aria-hidden="true" />
    </button>
  );
}
