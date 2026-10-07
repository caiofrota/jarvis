import { useId } from "react";
import type { Option } from "../../lib/api-client";

type Props = {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  type?: "text" | "number" | "time" | "textarea" | "select" | "checkbox" | "lines";
  options?: Option[];
  min?: number;
  max?: number;
  step?: number | "any";
  placeholder?: string;
  nullable?: boolean;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
};
export function Field({
  label,
  value,
  onChange,
  type = "text",
  options = [],
  min,
  max,
  step,
  placeholder,
  nullable = false,
  hint,
  required = false,
  disabled = false,
}: Props) {
  const id = useId(),
    helper = `${id}-help`,
    common = { id, "aria-describedby": hint ? helper : undefined, required, disabled };
  let control: React.ReactNode;
  if (type === "checkbox")
    control = (
      <input
        {...common}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  else if (type === "select")
    control = (
      <select
        {...common}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value || (nullable ? null : ""))}
      >
        <option value="">{nullable ? "Usar padrão" : "Selecione"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  else if (type === "textarea" || type === "lines")
    control = (
      <textarea
        {...common}
        rows={type === "lines" ? 3 : 4}
        value={type === "lines" && Array.isArray(value) ? value.join("\n") : String(value ?? "")}
        onChange={(e) => onChange(type === "lines" ? e.target.value.split("\n") : e.target.value)}
      />
    );
  else
    control = (
      <input
        {...common}
        type={type}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder ?? (nullable ? "Usar padrão" : undefined)}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(
            type === "number"
              ? e.target.value === "" && nullable
                ? null
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );
  return (
    <div className={`field ${type === "checkbox" ? "check-field" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <small id={helper}>{hint}</small>}
    </div>
  );
}
