"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Field } from "../../components/field/Field";
import { PasswordField } from "../../components/password-field/PasswordField";
import { Tabs } from "../../components/tabs/Tabs";
import { type Options, request, type Status } from "../../lib/api-client";
import { HomeAssistantImport } from "./HomeAssistant";
import { InteractionTest } from "./InteractionTest";

type Values = {
  homeAssistantEnabled: boolean;
  homeAssistantAutomaticCatalog: boolean;
  homeAssistantUrl: string;
  homeAssistantToken: string;
  homeAssistantHomeId: string;
  interactionMqttEnabled: boolean;
  interactionMqttPrefix: string;
  mqttEnabled: boolean;
  weatherEnabled: boolean;
  webSearchEnabled: boolean;
  webSearchMonthlyBudgetUsd: number;
  webSearchCacheEnabled: boolean;
  sttModel: string;
  mqttHost: string;
  mqttPort: number;
  mqttUsername: string;
  mqttPassword: string;
  mqttTls: boolean;
  openaiKey: string;
  deepseekKey: string;
  credentials: Record<string, boolean>;
};
export function Settings({ status, refresh }: { status?: Status; refresh: () => Promise<void> }) {
  const authorizationHandled = useRef(false);
  const [options, setOptions] = useState<Options>({}),
    [value, setValue] = useState<Values>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    request<Values>("/settings")
      .then(setValue)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ha_auth") !== "1" || authorizationHandled.current) return;
    authorizationHandled.current = true;
    window.history.replaceState(null, "", "/settings");
    if (!params.get("code") || !params.get("state")) {
      setError("Autorização do Home Assistant não concluída.");
      return;
    }
    setBusy(true);
    void request("/home-assistant/authorization", {
      method: "POST",
      body: JSON.stringify({ state: params.get("state"), code: params.get("code") }),
    })
      .then(() => {
        load();
        setNotice("Home Assistant autorizado. Token criado e salvo automaticamente.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [load]);
  useEffect(() => {
    void request<Options>("/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, []);
  const set = (key: string, next: unknown) =>
    setValue((old) => (old ? { ...old, [key]: next } : old));
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">PREFERÊNCIAS DA INSTALAÇÃO</p>
          <h1>Voz e conexões</h1>
          <p>Vozes e serviços dos assistentes. Credenciais protegidas neste servidor.</p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!value ? (
        <section className="panel">
          <p>Carregando configurações…</p>
          {error && (
            <button type="button" onClick={load}>
              Tentar novamente
            </button>
          )}
        </section>
      ) : (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await request("/settings", { method: "PUT", body: JSON.stringify(value) });
              load();
              await refresh();
              setNotice("Configurações salvas.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Tabs
            label="Configurações de voz e conexões"
            items={[
              {
                id: "voice",
                label: "Voz",
                content: (
                  <>
                    <h2>Voz</h2>
                    <p>
                      {status?.speech.ready
                        ? "Reconhecimento da fala e vozes locais disponíveis."
                        : "O serviço de fala local está indisponível."}
                    </p>
                    <p>
                      Escolha a voz em Assistentes → Editar. Cada assistente pode usar uma voz local
                      ou Home Assistant Cloud.
                    </p>
                    <p role="status">
                      {status?.speech.voices.some((id) => id.startsWith("ha-cloud-"))
                        ? "Home Assistant Cloud disponível. O uso é opcional e incluído na assinatura ativa; gera áudio a partir do texto da resposta pela internet."
                        : status?.speech.cloudError ||
                          "Consultando disponibilidade do Home Assistant Cloud…"}
                    </p>
                    <Field
                      label="Reconhecimento da fala"
                      type="select"
                      value={value.sttModel}
                      onChange={(x) => set("sttModel", x)}
                      options={[
                        { id: "tiny", name: "Tiny · mais rápido" },
                        { id: "base", name: "Base · equilibrado" },
                        { id: "small", name: "Small · mais exigente" },
                      ]}
                    />
                    <p className="field-hint">
                      O reconhecimento continua local, mesmo ao escolher uma voz da nuvem. Um modelo
                      maior precisa de mais memória e tempo de processamento.
                    </p>
                  </>
                ),
              },
              {
                id: "conversation",
                label: "Conversa",
                content: (
                  <>
                    <h2>Conversa</h2>
                    <Link href="/assistant-default">Configurar Jarvis padrão</Link>
                    <p>
                      A chave é compartilhada pelos robôs que usam o mesmo provedor. Deixe em branco
                      para manter a chave atual.
                    </p>
                    {(["openaiKey", "deepseekKey"] as const).map((key) => (
                      <div key={key}>
                        <PasswordField
                          label={key === "openaiKey" ? "Chave da OpenAI" : "Chave da DeepSeek"}
                          value={value[key]}
                          onChange={(x) => set(key, x)}
                        />
                        <p className="field-hint">
                          {value.credentials[key] ? "Chave configurada" : "Chave não configurada"}
                        </p>
                      </div>
                    ))}
                  </>
                ),
              },
              {
                id: "search",
                label: "Busca na internet",
                content: (
                  <>
                    <h2>Addon Busca na internet</h2>
                    <p>
                      Pesquisa eventos, notícias e ofertas publicadas usando a chave da OpenAI já
                      configurada.
                    </p>
                    <Field
                      label="Ativar busca na internet"
                      type="checkbox"
                      value={value.webSearchEnabled}
                      onChange={(x) => set("webSearchEnabled", x)}
                    />
                    <Field
                      label="Orçamento mensal da busca (US$)"
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={value.webSearchMonthlyBudgetUsd}
                      onChange={(x) => set("webSearchMonthlyBudgetUsd", x)}
                      hint="Compartilhado por todas as caixinhas e pelo teste no painel. Zero bloqueia novas buscas pagas. Renova no primeiro dia do mês, à meia-noite de Fortaleza."
                    />
                    <p role="status">
                      {status?.webSearch
                        ? `Mês ${status.webSearch.month}: US$ ${status.webSearch.accountedUsd.toFixed(3)} contabilizados de US$ ${status.webSearch.budgetUsd.toFixed(2)} · US$ ${status.webSearch.remainingUsd.toFixed(3)} disponíveis · ${status.webSearch.requests} tentativas de pesquisa.`
                        : "Carregando consumo de buscas…"}
                    </p>
                    {!!status?.webSearch.reservedUsd && (
                      <p className="hint">
                        Do valor contabilizado, US$ {status.webSearch.reservedUsd.toFixed(3)} estão
                        reservados para pesquisas em andamento ou sem consumo confirmado.
                      </p>
                    )}
                    <Field
                      label="Reutilizar pesquisas recentes (cache)"
                      type="checkbox"
                      value={value.webSearchCacheEnabled}
                      onChange={(x) => set("webSearchCacheEnabled", x)}
                      hint="Reaproveita a mesma consulta na mesma casa, respeitando cidade, datas e critérios. Diga ‘pesquise de novo’ para atualizar."
                    />
                    <p>
                      {status?.webSearch.cacheHits ?? 0} respostas reaproveitadas neste mês ·{" "}
                      {status?.webSearch.cacheEntries ?? 0} pesquisas válidas em memória.
                    </p>
                    <p className="hint">
                      Validade máxima: informações ao vivo, 30 segundos; passagens, 2 minutos;
                      notícias e preços, 5 minutos; eventos, 1 hora; endereços e horários, 6 horas;
                      outros assuntos, 15 minutos. O cache é apagado ao reiniciar; o consumo
                      permanece salvo.
                    </p>
                    {!value.credentials.openaiKey && (
                      <p className="hint">
                        Configure a chave da OpenAI na aba Conversa para usar a busca.
                      </p>
                    )}
                    <p>
                      Até uma busca paga por mensagem, sem repetição automática. Cada pesquisa
                      reserva US$ 0,065 e ajusta esse valor pelo consumo informado. Falhas sem
                      consumo confirmado mantêm a reserva. O saldo precisa cobrir a reserva para
                      iniciar uma nova pesquisa.
                    </p>
                    <p>
                      O orçamento inclui US$ 0,01 por chamada e os tokens da própria pesquisa no
                      GPT-4.1-mini. A conversa normal é cobrada separadamente, inclusive quando
                      aproveita o cache. Este controle usa preços estimados no servidor; não limita
                      outros usos da sua conta OpenAI.{" "}
                      <a
                        href="https://developers.openai.com/api/docs/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Consultar preços da OpenAI
                      </a>
                      .
                    </p>
                    <p className="hint">
                      Links aparecem junto da resposta e na última consulta por voz. Preços de
                      passagens publicados não garantem a tarifa final ou disponibilidade.
                    </p>
                  </>
                ),
              },
              {
                id: "home-assistant",
                label: "Home Assistant",
                content: (
                  <>
                    <h2>Addon Home Assistant</h2>
                    <p>
                      Conecta dispositivos, sensores, cenas e scripts da sua instalação. Selecione o
                      que a Rosie poderá usar.
                    </p>
                    <Field
                      label="Ativar Home Assistant"
                      type="checkbox"
                      value={value.homeAssistantEnabled}
                      onChange={(v) => set("homeAssistantEnabled", v)}
                    />
                    <Field
                      label="Endereço do Home Assistant"
                      value={value.homeAssistantUrl}
                      onChange={(v) => set("homeAssistantUrl", v)}
                      hint="Exemplo: http://192.168.20.11:8123"
                    />
                    <PasswordField
                      label="Token do Home Assistant"
                      value={value.homeAssistantToken}
                      onChange={(v) => set("homeAssistantToken", v)}
                    />
                    <p className="field-hint">
                      {value.credentials.homeAssistantToken
                        ? "Token cadastrado. Deixe em branco para manter."
                        : "Crie um token em seu perfil no Home Assistant, na seção Segurança."}
                    </p>
                    <Field
                      label="Casa deste Home Assistant"
                      type="select"
                      value={value.homeAssistantHomeId}
                      onChange={(v) => set("homeAssistantHomeId", v)}
                      options={options.homes ?? []}
                    />
                    <button
                      type="button"
                      disabled={busy || !value.homeAssistantUrl || !value.homeAssistantHomeId}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await request<{ url: string }>(
                            "/home-assistant/authorize",
                            {
                              method: "POST",
                              body: JSON.stringify({
                                url: value.homeAssistantUrl,
                                homeId: value.homeAssistantHomeId,
                              }),
                            },
                          );
                          window.location.assign(result.url);
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(false);
                        }
                      }}
                    >
                      Conectar com Home Assistant
                    </button>
                    <p className="hint">
                      Entre no próprio Home Assistant para autorizar. A Rosie cria e salva o token
                      automaticamente. O campo de token acima é uma alternativa manual; outras
                      alterações ainda não salvas serão descartadas ao sair desta página.
                    </p>
                    <p role="status">
                      {status?.homeAssistant?.ready
                        ? "Conectado ao Home Assistant"
                        : status?.homeAssistant?.error || "Salve para conectar."}
                    </p>
                    <Field
                      label="Usar catálogo automático do Home Assistant"
                      type="checkbox"
                      value={value.homeAssistantAutomaticCatalog}
                      onChange={(v) => set("homeAssistantAutomaticCatalog", v)}
                      hint="Os dispositivos expostos ao Assist aparecem automaticamente nos ambientes vinculados às áreas do HA. Salve para aplicar."
                    />
                    {value.homeAssistantAutomaticCatalog ? (
                      <p className="hint">
                        Gerencie nomes, áreas e exposição dos dispositivos no Home Assistant. Em
                        Ambientes, vincule cada ambiente à área correspondente. Os cadastros
                        anteriores ficam preservados para voltar ao modo manual.
                      </p>
                    ) : (
                      <HomeAssistantImport
                        homeId={value.homeAssistantHomeId}
                        ready={Boolean(status?.homeAssistant?.ready)}
                      />
                    )}
                  </>
                ),
              },
              {
                id: "interactions",
                label: "Falas e perguntas",
                content: (
                  <>
                    <h2>Interações com automações</h2>
                    <p>
                      O Home Assistant e outros sistemas podem enviar avisos e perguntas por MQTT.
                      Cada caixinha tem volume e horário silencioso próprios.
                    </p>
                    <Field
                      label="Receber falas e perguntas por MQTT"
                      type="checkbox"
                      value={value.interactionMqttEnabled}
                      onChange={(v) => set("interactionMqttEnabled", v)}
                    />
                    <Field
                      label="Prefixo MQTT da Rosie"
                      value={value.interactionMqttPrefix}
                      onChange={(v) => set("interactionMqttPrefix", v)}
                      hint="Use rosie, ou outro nome exclusivo desta instalação."
                    />
                    <p>
                      Pedidos usam o tópico prefixo/casa/caixinha/request; resultados voltam em
                      prefixo/casa/caixinha/result. Use os identificadores do cadastro. Mensagens
                      antigas ou retidas não são reproduzidas.
                    </p>
                    <p>
                      Ajuste as permissões, horários e volume em Caixinhas → Editar → Avisos de
                      automações. Os exemplos de scripts do HA ficam na documentação da integração.
                    </p>
                    <InteractionTest
                      options={options}
                      status={status}
                      prefix={value.interactionMqttPrefix}
                    />
                  </>
                ),
              },
              {
                id: "mqtt",
                label: "MQTT",
                content: (
                  <>
                    <h2>Addon MQTT</h2>
                    <p>
                      Conecta sensores e envia comandos aos dispositivos cadastrados. Compatível com
                      tópicos do Zigbee2MQTT e leituras publicadas pelo Home Assistant.
                    </p>
                    <Field
                      label="Ativar addon MQTT"
                      type="checkbox"
                      value={value.mqttEnabled}
                      onChange={(x) => set("mqttEnabled", x)}
                      hint="Desativar desconecta o broker e interrompe leituras e comandos, preservando o cadastro."
                    />
                    <p role="status">
                      {!value.mqttEnabled
                        ? "Desativado"
                        : status?.mqtt
                          ? "Conectado"
                          : "Sem conexão com o broker"}
                    </p>
                    <Field
                      label="Endereço do broker"
                      value={value.mqttHost}
                      onChange={(x) => set("mqttHost", x)}
                    />
                    <Field
                      label="Porta"
                      type="number"
                      min={1}
                      max={65535}
                      value={value.mqttPort}
                      onChange={(x) => set("mqttPort", x)}
                    />
                    <Field
                      label="Usuário"
                      value={value.mqttUsername}
                      onChange={(x) => set("mqttUsername", x)}
                    />
                    <PasswordField
                      label="Senha do MQTT"
                      value={value.mqttPassword}
                      onChange={(x) => set("mqttPassword", x)}
                    />
                    <p className="field-hint">
                      {value.credentials.mqttPassword
                        ? "Senha configurada. Deixe em branco para manter."
                        : "Senha não configurada."}
                    </p>
                    <Field
                      label="Conexão com TLS"
                      type="checkbox"
                      value={value.mqttTls}
                      onChange={(x) => set("mqttTls", x)}
                    />
                  </>
                ),
              },
              {
                id: "weather",
                label: "Clima",
                content: (
                  <>
                    <h2>Addon Clima da cidade</h2>
                    <Field
                      label="Ativar addon de clima"
                      type="checkbox"
                      value={value.weatherEnabled}
                      onChange={(x) => set("weatherEnabled", x)}
                    />
                    <p>
                      Condições atuais estimadas pelo{" "}
                      <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                        Open-Meteo
                      </a>
                      . Selecione o local em Casas e use a fonte nas intents. A consulta usa a
                      internet e mantém as leituras em cache por 10 minutos.
                    </p>
                    <p className="hint">
                      Os addons são módulos desta instalação. Tuya pode ser usado através do Home
                      Assistant; o acesso direto por TinyTuya ainda não está instalado.
                    </p>
                  </>
                ),
              },
            ]}
          />
          <footer className="form-actions settings-actions">
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar configurações"}
            </button>
          </footer>
        </form>
      )}
    </>
  );
}
