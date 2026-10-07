"use client";
import type { IntegrationStatus, PersonalProvider } from "@rosie/types";
import { useEffect, useState } from "react";
import { Modal } from "../../components/modal/Modal";
import { PasswordField } from "../../components/password-field/PasswordField";
import { request } from "../../lib/api-client";

const base = "/personal-integrations";
const providerName = (provider: PersonalProvider) =>
  provider === "google" ? "Google" : "Microsoft";
export function IntegrationApplications() {
  const [status, setStatus] = useState<IntegrationStatus>();
  const [application, setApplication] = useState<PersonalProvider>();
  const [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function reload() {
    setStatus(await request<IntegrationStatus>(base));
  }
  useEffect(() => {
    const abort = new AbortController();
    void request<IntegrationStatus>(base, { signal: abort.signal })
      .then(setStatus)
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause.message);
      });
    return () => abort.abort();
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">CONFIGURAÇÃO DA INSTALAÇÃO</p>
          <h1>Aplicativos Google e Microsoft</h1>
          <p>
            Esta etapa habilita o Jarvis para receber conexões. Ela não conecta sua caixa de e-mail
            nem a de outra pessoa.
          </p>
        </div>
      </header>
      <section className="panel">
        <h2>Configure uma vez; cada pessoa conecta a própria conta</h2>
        <ol className="setup-steps">
          <li>
            O administrador registra o aplicativo Jarvis nos provedores e cadastra aqui o ID e o
            segredo.
          </li>
          <li>Depois, cada pessoa entra no Jarvis com seu próprio usuário.</li>
          <li>
            Em Configurações → Minhas contas, cada pessoa autoriza suas contas Google ou Microsoft.
            Os dados continuam privados por usuário.
          </li>
        </ol>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <p role="status">Carregando aplicativos…</p>
      ) : (
        <div className="cards">
          {status.providers.map((provider) => (
            <section className="panel" key={provider.provider}>
              <h2>{providerName(provider.provider)}</h2>
              <p>
                {provider.configured
                  ? "Aplicativo configurado. Os usuários já podem iniciar suas conexões pessoais."
                  : "Ainda não configurado. O administrador precisa registrar o aplicativo no provedor."}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setApplication(provider.provider);
                  setClientId(provider.clientId ?? "");
                  setSecret("");
                }}
              >
                Configurar aplicativo {providerName(provider.provider)}
              </button>
            </section>
          ))}
        </div>
      )}
      {application && status && (
        <Modal
          title={`Aplicativo ${providerName(application)}`}
          onClose={() => {
            if (!busy) {
              setApplication(undefined);
              setSecret("");
            }
          }}
        >
          <p>
            Cadastre um aplicativo OAuth de servidor no provedor. Esta configuração é compartilhada;
            as autorizações continuam individuais.
          </p>
          <p>
            URI de retorno: <code style={{ overflowWrap: "anywhere" }}>{status.callback}</code>
          </p>
          <p>
            Use um domínio HTTPS registrado no provedor ou localhost para desenvolvimento. O Google
            não aceita o IP da rede como URI de retorno.
          </p>
          <p>
            <a
              href={
                application === "google"
                  ? "https://developers.google.com/identity/protocols/oauth2/web-server"
                  : "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow"
              }
              target="_blank"
              rel="noreferrer"
            >
              Instruções oficiais de {providerName(application)}
            </a>
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await request(`${base}/applications`, {
                  method: "PUT",
                  body: JSON.stringify({
                    provider: application,
                    clientId,
                    ...(secret ? { clientSecret: secret } : {}),
                  }),
                });
                setSecret("");
                setApplication(undefined);
                await reload();
                setNotice("Aplicativo configurado. Agora cada pessoa pode conectar suas contas.");
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                ID do cliente
                <input
                  required
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  maxLength={512}
                  autoComplete="off"
                />
              </label>
              <PasswordField
                label="Segredo do cliente"
                value={secret}
                onChange={setSecret}
                autoComplete="off"
              />
              <p>Deixe o segredo vazio para manter o atual quando o ID do cliente for o mesmo.</p>
            </fieldset>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button type="submit" className="primary" disabled={busy}>
              Salvar aplicativo
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
