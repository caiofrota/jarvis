"use client";
import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { PasswordField } from "../../components/password-field/PasswordField";
import { request } from "../../lib/api-client";
export function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(""),
    [username, setUsername] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login-wrap">
      <form
        className="login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await request("/login", {
              method: "POST",
              body: JSON.stringify({ username, password }),
            });
            setPassword("");
            onLogin();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="brand-mark">
          <FontAwesomeIcon icon={faRobot} />
        </span>
        <p className="eyebrow">JARVIS · CENTRAL DE OPERAÇÕES</p>
        <h1>Bem-vindo à sua casa.</h1>
        <p>Entre para cuidar dos seus assistentes.</p>
        <label className="field">
          Usuário
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={40}
          />
        </label>
        <PasswordField
          label="Senha"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <p className="hint">
          Primeiro acesso? Crie o administrador no servidor com <code>pnpm user:create-first</code>.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
