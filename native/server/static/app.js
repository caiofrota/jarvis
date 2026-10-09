const $ = (id) => document.getElementById(id);
let catalog,
  status,
  voices,
  previewUrl,
  page = "overview",
  credential = sessionStorage.getItem("rosie-auth") || "",
  dirty = false;
const labels = {
  overview: "Visão geral",
  rooms: "Cômodos",
  robots: "Robôs",
  devices: "Dispositivos",
  routines: "Rotinas",
  intents: "Intents e humor",
  settings: "Voz e conexões",
  events: "Atividade",
};
const expressionChoices = [
  ["neutral", "Neutra"],
  ["happy", "Feliz"],
  ["sad", "Triste"],
  ["angry", "Irritada"],
  ["surprised", "Surpresa"],
  ["curious", "Curiosa"],
  ["confused", "Confusa"],
  ["excited", "Empolgada"],
  ["shy", "Tímida"],
  ["skeptical", "Desconfiada"],
  ["proud", "Orgulhosa"],
  ["affectionate", "Carinhosa"],
].map(([value, label]) => ({ value, label }));
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
function message(text) {
  $("message").textContent = text;
}
async function api(path, options = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    headers: {
      Authorization: credential,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.detail || "Falha na solicitação");
  return body;
}
function button(text, fn, cls) {
  const b = el("button", text, cls);
  b.type = "button";
  b.onclick = () => Promise.resolve(fn()).catch((e) => message(e.message));
  return b;
}
function mark() {
  dirty = true;
  $("save").hidden = false;
}
function roomName(id) {
  return (
    catalog.rooms.find((r) => r.id === id)?.name || id || "Todos os cômodos"
  );
}
const options = (items) => items.map((x) => ({ value: x.id, label: x.name }));
function field(parent, key, label, value, type = "text", choices = []) {
  const l = el("label", label);
  let input;
  if (type === "select") {
    input = el("select");
    for (const o of choices) {
      const n = el("option", o.label);
      n.value = o.value;
      input.append(n);
    }
  } else input = el(type === "textarea" ? "textarea" : "input");
  input.name = key;
  if (input.tagName === "INPUT") input.type = type;
  input.value = value ?? "";
  if (type === "checkbox") input.checked = !!value;
  l.append(input);
  parent.append(l);
  return input;
}
function show() {
  if (!catalog) return;
  const previousAudio = $("content").querySelector("audio");
  if (previousAudio) previousAudio.pause();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("login").hidden = true;
  $("content").hidden = false;
  $("title").textContent = labels[page];
  $("nav").replaceChildren(
    ...Object.entries(labels).map(([k, v]) =>
      button(
        v,
        () => {
          page = k;
          show();
        },
        k === page ? "active" : "",
      ),
    ),
  );
  const c = $("content");
  c.replaceChildren();
  if (page === "overview") {
    const grid = el("div", undefined, "grid");
    for (const [name, value] of [
      ["Robôs conectados", Object.keys(status?.robots || {}).length],
      ["Cômodos", catalog.rooms.length],
      ["MQTT", status?.mqtt ? "Conectado" : "Desconectado"],
      ["Voz local", status?.tts_ready ? "Pronta" : "Baixar modelo"],
    ]) {
      const card = el("div", undefined, "card");
      card.append(el("p", name), el("div", String(value), "value"));
      grid.append(card);
    }
    c.append(grid);
    const card = el("div", undefined, "card");
    card.style.marginTop = "24px";
    card.append(
      el("h2", "Experimente uma frase"),
      el(
        "p",
        "Intents são locais. Comandos de automação neste teste enviam MQTT de verdade aos dispositivos cadastrados.",
      ),
    );
    const select = field(
      card,
      "robot",
      "Robô e seu ambiente",
      "",
      "select",
      options(catalog.robots),
    );
    const text = field(card, "text", "O que você diria?", "Liga a luz");
    const result = el("p");
    card.append(
      button("Enviar", async () => {
        result.textContent = "Pensando…";
        result.textContent = (
          await api("/test", {
            method: "POST",
            body: JSON.stringify({ robot: select.value, text: text.value }),
          })
        ).answer;
      }),
      result,
    );
    c.append(card);
    return;
  }
  if (page === "events") {
    const table = el("table");
    for (const e of status?.events || []) {
      const tr = el("tr");
      tr.append(
        el("td", e.time),
        el("td", e.kind),
        el("td", JSON.stringify(e.detail)),
      );
      table.append(tr);
    }
    c.append(table);
    return;
  }
  if (page === "settings") {
    renderSettings(c);
    return;
  }
  c.append(
    el(
      "p",
      {
        rooms: "Nomes e apelidos ajudam a entender “na cozinha” e “na sala”.",
        robots:
          "O ambiente cadastrado define o alcance dos comandos sem cômodo explícito.",
        devices:
          "Cadastre os tópicos exatos usados pelo seu broker. Nenhum dispositivo é importado ou controlado automaticamente.",
        routines:
          "Uma rotina pertence a um cômodo. Todas as suas etapas devem usar dispositivos desse mesmo ambiente.",
        intents:
          "As respostas são sorteadas localmente. Use {valor}, {nome} e {ambiente} para inserir dados.",
      }[page],
    ),
  );
  c.append(button("Adicionar", () => edit(page, null)));
  const grid = el("div", undefined, "grid");
  grid.style.marginTop = "20px";
  for (const item of catalog[page]) {
    const card = el("div", undefined, "card");
    card.append(
      el("h3", item.name),
      el("span", page === "rooms" ? item.id : roomName(item.room), "badge"),
    );
    if (item.aliases?.length)
      card.append(el("p", item.aliases.join(" · "), "hint"));
    if (page === "robots")
      card.append(
        el("p", "Estado: " + (status?.robots[item.id] || "desconectado")),
      );
    const a = el("div", undefined, "actions");
    a.append(
      button("Editar", () => edit(page, item), "secondary"),
      button(
        "Remover",
        () => {
          if (confirm("Remover " + item.name + "?")) {
            catalog[page] = catalog[page].filter((x) => x.id !== item.id);
            mark();
            show();
          }
        },
        "danger",
      ),
    );
    if (page === "robots") {
      a.append(
        button(
          "Vincular por PIN",
          async () => {
            const value = await api("/robots/" + item.id + "/pair_code", {
              method: "POST",
            });
            const previous = card.querySelector(".pairing-code");
            if (previous) previous.remove();
            const info = el("div", undefined, "pairing-code");
            info.append(
              el(
                "p",
                "No portal da Rosie, informe este endereço do painel e o PIN. Válido por 5 minutos, uma única vez.",
              ),
            );
            field(
              info,
              "panel-address",
              "Endereço do painel",
              location.origin,
            ).readOnly = true;
            field(info, "panel-pin", "PIN do painel", value.pin).readOnly =
              true;
            card.append(info);
          },
          "secondary",
        ),
        button(
          "Trocar Wi-Fi",
          () => {
            message(
              "Segure BOOT por 3 segundos. Conecte-se à rede Rosie usando a senha mostrada no OLED. Informe a nova rede Wi-Fi e sua senha. Mantenha o endereço deste painel e deixe o PIN vazio para preservar o vínculo. Se a página não abrir sozinha, acesse 192.168.4.1.",
            );
          },
          "secondary",
        ),
        button(
          "Testar voz",
          () => api("/robots/" + item.id + "/test_voice", { method: "POST" }),
          "secondary",
        ),
        button(
          "Conversar",
          () => api("/robots/" + item.id + "/listen", { method: "POST" }),
          "secondary",
        ),
        button(
          "Mudo",
          () => api("/robots/" + item.id + "/mute", { method: "POST" }),
          "secondary",
        ),
      );
    }
    card.append(a);
    if (page === "robots") {
      const expression = field(
        card,
        "expression",
        "Expressão dos olhos",
        "neutral",
        "select",
        expressionChoices,
      );
      card.append(
        button(
          "Testar expressão",
          () =>
            api(
              "/robots/" +
                item.id +
                "/test_expression?expression=" +
                expression.value,
              { method: "POST" },
            ),
          "secondary",
        ),
      );
      card.append(
        el(
          "p",
          "Mostra a expressão por 3 segundos, sem falar. Durante uma resposta, a expressão acompanha o tom da fala.",
          "hint",
        ),
      );
    }
    grid.append(card);
  }
  c.append(grid);
}
function edit(kind, item) {
  const data = item
    ? structuredClone(item)
    : { id: "", name: "", aliases: [], room: catalog.rooms[0]?.id || "" };
  const f = $("fields");
  f.replaceChildren();
  $("edit-title").textContent = (item ? "Editar · " : "Novo · ") + labels[kind];
  field(
    f,
    "id",
    "Identificador (letras minúsculas, números e hífen)",
    data.id,
  ).disabled = !!item;
  field(f, "name", "Nome", data.name);
  field(
    f,
    "aliases",
    "Outros nomes (separados por vírgula)",
    data.aliases.join(", "),
  );
  if (kind !== "rooms")
    field(
      f,
      "room",
      "Cômodo",
      data.room,
      "select",
      kind === "intents"
        ? [{ value: "", label: "Todos os cômodos" }, ...options(catalog.rooms)]
        : options(catalog.rooms),
    );
  if (kind === "devices") {
    field(
      f,
      "kind",
      "Tipo",
      data.kind || "light",
      "select",
      [
        ["light", "Luz"],
        ["switch", "Tomada / interruptor"],
        ["fan", "Ventilador"],
        ["climate", "Climatização"],
        ["sensor", "Sensor"],
        ["other", "Outro"],
      ].map(([value, label]) => ({ value, label })),
    );
    field(f, "command_topic", "Tópico de comando MQTT", data.command_topic);
    field(
      f,
      "state_topic",
      "Tópico de estado MQTT (opcional)",
      data.state_topic,
    );
    field(
      f,
      "state_path",
      "Campo do JSON do estado (ex.: temperature)",
      data.state_path,
    );
    field(
      f,
      "actions",
      "Ações e mensagens (JSON)",
      JSON.stringify(data.actions || { on: "ON", off: "OFF" }, null, 2),
      "textarea",
    );
  }
  if (kind === "routines") {
    field(
      f,
      "steps",
      "Etapas (JSON: device é o identificador cadastrado)",
      JSON.stringify(data.steps || [{ device: "", action: "off" }], null, 2),
      "textarea",
    );
    f.append(
      el(
        "p",
        "Dispositivos: " +
          catalog.devices
            .map((d) => d.id + " — " + d.name + " / " + roomName(d.room))
            .join(", "),
        "hint",
      ),
    );
  }
  if (kind === "intents") {
    field(
      f,
      "expression",
      "Expressão durante a resposta",
      data.expression || "neutral",
      "select",
      expressionChoices,
    );
    field(
      f,
      "phrases",
      "Frases que ativam a intent (uma por linha)",
      (data.phrases || []).join("\n"),
      "textarea",
    );
    field(
      f,
      "responses",
      "Respostas possíveis (uma por linha)",
      (data.responses || []).join("\n"),
      "textarea",
    );
    field(
      f,
      "device",
      "Sensor / dispositivo para {valor}",
      "" + (data.device || ""),
      "select",
      [
        { value: "", label: "Sem sensor" },
        ...options(catalog.devices.filter((d) => d.state_topic)),
      ],
    );
  }
  $("edit-form").onsubmit = (event) => {
    event.preventDefault();
    try {
      const result = { ...data };
      for (const input of f.querySelectorAll("input,textarea,select")) {
        let value = input.value;
        if (["actions", "steps"].includes(input.name))
          value = JSON.parse(value);
        if (["phrases", "responses"].includes(input.name))
          value = value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        if (input.name === "aliases")
          value = value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        result[input.name] = value;
      }
      if (kind === "intents") {
        result.room = result.room || null;
        result.device = result.device || null;
      }
      if (kind === "robots") result.token = result.token || "";
      if (!item && catalog[kind].some((i) => i.id === result.id))
        throw Error("Esse identificador já existe.");
      catalog[kind] = item
        ? catalog[kind].map((i) => (i.id === item.id ? result : i))
        : [...catalog[kind], result];
      mark();
      $("editor").close();
      show();
    } catch (e) {
      alert(e.message);
    }
  };
  $("editor").showModal();
}
function renderSettings(c) {
  const f = el("div", undefined, "grid");
  const voiceChoices = (voices?.voices || []).map((id) => ({
    value: id,
    label:
      {
        "pt_BR-faber-medium": "Faber · português brasileiro",
        "pt_BR-cadu-medium": "Cadu · português brasileiro",
        "kokoro-pf_dora": "Dora · português brasileiro",
        "supertonic-f1": "Supertonic F1 · feminina · português",
        "supertonic-m1": "Supertonic M1 · masculina · português",
      }[id] || id,
  }));
  if (!voiceChoices.some((v) => v.value === catalog.settings.tts_voice))
    voiceChoices.push({
      value: catalog.settings.tts_voice,
      label: catalog.settings.tts_voice + " · não instalada",
    });
  const groups = [
    [
      "Conversa",
      [
        [
          "provider",
          "Provedor",
          "select",
          [
            { value: "openai", label: "OpenAI" },
            { value: "deepseek", label: "DeepSeek" },
          ],
        ],
        ["model", "Modelo"],
        ["api_key", "Chave da API (vazio mantém a atual)", "password"],
        ["personality", "Personalidade", "textarea"],
        ["max_output_tokens", "Máximo de tokens por resposta", "number"],
        ["history_turns", "Turnos de memória", "number"],
      ],
    ],
    [
      "Áudio e comportamento",
      [
        [
          "stt_model",
          "Reconhecimento local",
          "select",
          ["tiny", "base", "small"].map((v) => ({ value: v, label: v })),
        ],
        ["tts_voice", "Voz local", "select", voiceChoices],
        ["listen_seconds", "Espera após responder (segundos)", "number"],
        [
          "drowsy_seconds",
          "Escuta sonolenta antes de dormir (segundos; 0 desativa)",
          "number",
        ],
        [
          "prefill_ms",
          "Reserva de áudio antes de tocar (60–1800 ms)",
          "number",
        ],
        ["volume", "Volume (0 a 100)", "number"],
      ],
    ],
    [
      "Conexão MQTT",
      [
        ["mqtt_host", "Endereço do broker"],
        ["mqtt_port", "Porta", "number"],
        ["mqtt_username", "Usuário"],
        ["mqtt_password", "Senha (vazio mantém a atual)", "password"],
        ["mqtt_tls", "Usar TLS", "checkbox"],
      ],
    ],
  ];
  for (const [title, fields] of groups) {
    const card = el("div", undefined, "card");
    card.append(el("h3", title));
    for (const [key, label, type, choices] of fields) {
      const input = field(
        card,
        key,
        label,
        catalog.settings[key],
        type,
        choices,
      );
      input.oninput = () => {
        catalog.settings[key] =
          type === "number"
            ? Number(input.value)
            : type === "checkbox"
              ? input.checked
              : input.value;
        mark();
      };
      if (key === "tts_voice") renderVoicePreview(card, input);
    }
    f.append(card);
  }
  c.append(f);
}
function renderVoicePreview(card, select) {
  const quality = field(
    card,
    "tts_quality",
    "Modo da voz Supertonic",
    catalog.settings.tts_quality || "fast",
    "select",
    [
      { value: "fast", label: "Rápido" },
      { value: "detailed", label: "Priorizar qualidade" },
    ],
  );
  quality.onchange = () => {
    catalog.settings.tts_quality = quality.value;
    mark();
  };
  const hint = el(
    "p",
    "Compare as vozes aqui e salve para usar a escolhida no robô.",
    "hint",
  );
  const phrase = el("p", voices?.sample_text || "", "hint");
  const updateHint = () => {
    quality.parentElement.hidden = !select.value.startsWith("supertonic-");
    hint.textContent =
      "Compare as vozes aqui e salve para usar a escolhida no robô." +
      (select.value === "kokoro-pf_dora"
        ? " A Dora pode aumentar o tempo de resposta."
        : select.value.startsWith("supertonic-")
          ? " Priorizar qualidade aumenta a espera; compare a naturalidade na amostra."
          : "");
  };
  select.addEventListener("change", updateHint);
  updateHint();
  const info = el("p", "", "hint");
  info.setAttribute("role", "status");
  const player = el("audio");
  player.controls = true;
  player.hidden = true;
  player.preload = "none";
  player.setAttribute("aria-label", "Amostra da voz");
  const preview = button(
    "Ouvir no navegador",
    async () => {
      preview.disabled = true;
      player.pause();
      player.hidden = true;
      const label = select.selectedOptions[0].textContent;
      const voice = select.value;
      info.textContent = "Preparando a amostra…";
      try {
        const response = await fetch(
          "/api/voice_preview?voice=" +
            encodeURIComponent(voice) +
            "&quality=" +
            quality.value,
          {
            method: "POST",
            headers: { Authorization: credential },
            signal: AbortSignal.timeout(60000),
          },
        );
        if (!response.ok) {
          const body = await response.json();
          throw Error(body.detail || "Não foi possível gerar a amostra.");
        }
        const blob = await response.blob();
        if (!card.isConnected) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        player.src = previewUrl;
        player.hidden = false;
        info.textContent = "Amostra: " + label;
        await player.play().catch(() => {
          info.textContent += ". Pressione reproduzir para ouvir.";
        });
      } catch (error) {
        info.textContent =
          error.name === "TimeoutError"
            ? "A amostra demorou demais. Tente novamente."
            : error.message;
      } finally {
        preview.disabled = false;
      }
    },
    "secondary",
  );
  card.append(hint, phrase, preview, info, player);
}
$("cancel").onclick = () => $("editor").close();
$("save").onclick = async () => {
  try {
    $("save").disabled = true;
    catalog = await api("/config", {
      method: "PUT",
      body: JSON.stringify(catalog),
    });
    dirty = false;
    $("save").hidden = true;
    message("Configuração salva.");
    show();
  } catch (e) {
    message(e.message);
  } finally {
    $("save").disabled = false;
  }
};
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  credential = "Basic " + btoa("admin:" + $("password").value);
  try {
    await load();
    sessionStorage.setItem("rosie-auth", credential);
  } catch (err) {
    message(err.message);
  }
};
async function load() {
  [catalog, status, voices] = await Promise.all([
    api("/config"),
    api("/status"),
    api("/voices"),
  ]);
  message("");
  show();
}
if (credential)
  load().catch(() => {
    sessionStorage.removeItem("rosie-auth");
  });
setInterval(async () => {
  if (!catalog) return;
  try {
    status = await api("/status");
    $("connection").textContent =
      "Servidor disponível · MQTT " +
      (status.mqtt ? "conectado" : "desconectado");
    if (page === "events") show();
  } catch {
    $("connection").textContent = "Servidor indisponível";
  }
}, 5000);
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
