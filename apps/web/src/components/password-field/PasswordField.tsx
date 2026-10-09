"use client";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { useId, useState } from "react";
import { IconButton } from "../icon-button/IconButton";
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "off",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false),
    id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
        />
        <IconButton
          icon={visible ? faEyeSlash : faEye}
          label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          onClick={() => setVisible(!visible)}
        />
      </div>
    </div>
  );
}
