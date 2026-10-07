"use client";
import { type Account, accountRoleLabels } from "@rosie/types";
import Link from "next/link";
import { useState } from "react";
import { Field } from "../../../components/field/Field";
import { Modal } from "../../../components/modal/Modal";
import { PasswordField } from "../../../components/password-field/PasswordField";
import { request } from "../../../lib/api-client";

export function UserEditor({
  user,
  onClose,
  onSaved,
  self = false,
}: {
  user?: Account;
  onClose: () => void;
  onSaved: (id: string) => void;
  self?: boolean;
}) {
  const [name, setName] = useState(user?.name ?? ""),
    [username, setUsername] = useState(user?.username ?? "");
  const [role, setRole] = useState<Account["role"]>(user?.role ?? "member"),
    [enabled, setEnabled] = useState(user?.enabled ?? true);
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={user ? `Editar ${user.name}` : "Novo usuário"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          if (password !== confirmation) {
            setError("As senhas não coincidem.");
            return;
          }
          if ((!user || password) && password.length < 8) {
            setError("Use uma senha com pelo menos 8 caracteres.");
            return;
          }
          setBusy(true);
          try {
            const saved = await request<Account>(`/users${user ? `/${user.id}` : ""}`, {
              method: user ? "PUT" : "POST",
              body: JSON.stringify({
                name,
                username,
                role,
                enabled,
                ...(password ? { password } : {}),
                ...(user ? { revision: user.revision } : {}),
              }),
            });
            setPassword("");
            setConfirmation("");
            onSaved(saved.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <Field label="Nome" value={name} onChange={(v) => setName(String(v))} required />
          <label className="field">
            Usuário
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={40}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <Field
            label="Permissão"
            type="select"
            value={role}
            onChange={(v) => setRole(v as Account["role"])}
            required
            options={Object.entries(accountRoleLabels).map(([id, name]) => ({ id, name }))}
          />
          <p className="hint">
            Usuários pessoais conversam e gerenciam seus assistentes e integrações. Administradores
            também gerenciam a instalação. Somente leitura permite consultar cadastros e status, sem
            operar a casa.
          </p>
          <Field
            label="Acesso ativo"
            type="checkbox"
            value={enabled}
            onChange={(v) => setEnabled(Boolean(v))}
          />
          {self ? (
            <p>
              Para alterar sua senha, abra <Link href="/account">Minha conta</Link>.
            </p>
          ) : (
            <>
              <PasswordField
                label={user ? "Nova senha" : "Senha"}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              <PasswordField
                label="Confirmar senha"
                value={confirmation}
                onChange={setConfirmation}
                autoComplete="new-password"
              />
              <p className="hint">
                Use de 8 a 128 caracteres.
                {user ? " Deixe as senhas vazias para manter a atual." : ""}
              </p>
            </>
          )}
          {user && (
            <label className="field check-field">
              <input type="checkbox" required />
              Confirmo a alteração. As sessões deste usuário serão encerradas.
            </label>
          )}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
