"use client";
import { type Account, accountRoleLabels } from "@rosie/types";
import { useState } from "react";
import { PasswordField } from "../../../components/password-field/PasswordField";
import { request } from "../../../lib/api-client";
export function MyAccount({ user, onChanged }: { user: Account; onChanged: () => void }) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Minha conta</h1>
          <p>
            {user.name} · {user.username} · {accountRoleLabels[user.role]}
          </p>
        </div>
      </header>
      <section className="panel">
        <h2>Alterar senha</h2>
        <p>
          Após salvar, entre novamente com a nova senha. As outras sessões também serão encerradas.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (password !== confirmation) {
              setError("As senhas não coincidem.");
              return;
            }
            setBusy(true);
            try {
              await request("/me/password", {
                method: "POST",
                body: JSON.stringify({ currentPassword: current, password }),
              });
              setCurrent("");
              setPassword("");
              setConfirmation("");
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <PasswordField
              label="Senha atual"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
            <PasswordField
              label="Nova senha"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirmar nova senha"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
            />
            <p className="hint">Use de 8 a 128 caracteres.</p>
          </fieldset>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Alterar senha"}
          </button>
        </form>
      </section>
    </>
  );
}
