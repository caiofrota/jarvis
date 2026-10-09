# Conversational intents

Intents keep the existing household and association model. Recognition and response
are independent settings: `matchMode` is `exact` or `semantic`; `responseMode` is
`template` or `generated`. Existing JSON records acquire exact/template defaults at
the repository boundary, without rewriting credentials or other catalog values.

## Recognition and responses

Exact recognition compares normalized full phrases (case, accents and punctuation),
including a base intent's phrases for scoped variants. Exact/template replies remain
local and require no conversation-provider request. Semantic recognition sends only
eligible definitions for the endpoint's household, assistant, room, resident and mode
to its configured provider. More-specific variants replace their base in that list;
ambiguous applicable variants are rejected when selected. Up to 20 semantic intents
may be active in one household, limiting prompt growth; the first four phrases are
sent as examples, alongside the meaning description.

The same model response identifies the intent, extracts parameter values and creates
the reply. No additional classifier/model or classification round-trip is installed.
OpenAI's existing Chat Completions adapter uses its strict structured response;
DeepSeek retains JSON mode with identical application-side validation. See the
[official structured-output contract](https://developers.openai.com/api/docs/guides/structured-outputs).
The configured model, provider key, output-token cap and speech engines are unchanged.
Definitions/history add input tokens and selection metadata counts toward the output
cap. No embedding service, training step or extra external provider is required.

Recognition remains a model inference, not a guarantee that every paraphrase is
correct. An unmatched or ambiguous meaning can continue as ordinary conversation.
Instructions say to respect topic changes, serious requests and normal answers.

Semantic intents may additionally configure `topicTerms` (up to 30 whole-word
references) and `followUpPhrases` (up to 40 complete normalized phrases). Nonempty
topic terms require a current reference, an explicit choice/alias, or a configured
continuation of that same currently focused intent. Apply this gate after variant
resolution, before loading readings or building the prompt and response-ID enum.
An unrelated comparison is ordinary conversation, not a request to clarify a
required parameter. Validate the gate again when accepting model output, including
providers without schema enforcement; no-topic/no-candidate output cannot smuggle
in a previous intent ID. The installed other-assistant, homecoming and current-weather intents enable this gate.

The gate only admits a candidate; the model must still judge its meaning and
exclusions. With no topic terms, existing semantic recognition is unchanged.
For guarded intents, configured follow-ups match full phrases while ignoring case,
accents and punctuation; naming an assistant permits arbitrary paraphrases. Other
free-form follow-ups can continue through ordinary chat history without forcing
the intent. Scope, topic gates and extracted parameter evidence are independent.
The editor exposes these optional controls under Proteção contra assuntos diferentes.

Humor is a selectable style (normal, occasional, playful), not a guaranteed random
frequency. Generated expressions may vary with the reply; templates retain their
configured expression. Both use the existing firmware expression vocabulary.

## Parameters and continuity

Each semantic intent may define up to six named parameters: bounded text, a finite
number (absolute value at most one billion), or a configured choice. Names cannot
shadow built-in response markers or object prototype fields. Unknown/duplicate
returned names, unavailable intent IDs and invalid parameter values are rejected or
clarified. Required missing values produce a deterministic follow-up question. Valid
values remain in that endpoint's short-lived conversation context for follow-up turns;
model instructions prohibit inventing missing values.

Choice parameters optionally define `choiceAliases`, keyed by their registered
options. The editor exposes these as other ways to say each option (for example,
Amazon for Alexa). Configuring aliases grounds that parameter in a whole-word name
or alias from the current utterance, or the same intent's previous validated value on an accepted continuation.
A current name takes precedence over that previous value. A new generic mention of another assistant does not silently inherit the old name. With no evidence the
required parameter triggers clarification; the model cannot select an option merely
because it appeared in an example. A single evidenced value fills missing or stale
model metadata without interrupting a correct spoken answer. A contradictory name
or redundant confirmation triggers at most one internal regeneration, with tools
disabled and within the existing two-request turn limit. If that attempt also fails,
the user receives a neutral error, not the wrong name or another confirmation loop.
Ordinary correct replies still need one request. Without aliases,
semantic choice inference remains available, while explicit option names still win.
Aliases and bounded parameter data use the existing catalog authorization/revisions.

Conversation prompts request plain spoken text. The speech worker also removes paired
Markdown emphasis and inline backticks before pronunciation normalization, so a model
formatting slip does not read out asterisks. Literal arithmetic operators and underscores
inside words remain intact. This changes synthesized speech, not household facts.

Generated reply examples are style references, never fixed replies or evidence for
parameters. They may be left empty; use parameter markers instead of example names
when names vary. The installed homecoming and other-assistant intents now leave
examples empty and request new phrasing. Variation is model-generated, not a
guarantee that a phrase can never recur across independent sessions.

Ready replies substitute validated `{parameter_name}` values alongside `{pessoa}`,
`{robo}`, `{ambiente}`, `{cidade}`, `{nome}` and `{valor}`. A parameter referenced by a
ready reply needs a value even when its explicit Required switch is off. Values are
strings, never executable instructions, expressions, MQTT topics or payloads.
Generated replies use the configured instructions and recent history. Registered
sensor values are supplied separately; unavailable readings must not be invented.

Every completed reply, including local templates, time answers and automation results,
enters the same bounded per-endpoint history. Exact local jokes therefore support
follow-up questions. Zero history disables memory. Wake/session reset, stop and
identity/context changes clear history and intent context. Concurrent requests for
one endpoint are rejected; cancellation discards late replies instead of repopulating
cleared history. A new topic with no selected intent clears the previous intent focus.
No conversation or extracted value is persisted in diagnostic events: these contain
only endpoint/intent IDs, parameter names and clarification status.

Intents cannot execute automations. MQTT actions remain behind the existing registered
device/routine resolver and its room/scope checks. A conversational joke about Alexa
is not a command to an Alexa device.

## Local cancellation

Conversation cancellation is a built-in attention command evaluated after local STT
and before intents, MQTT or the conversation provider. It is not a generated farewell
in the intent catalog. Explicit phrases such as "pode parar", "cancele a conversa",
"chega por hoje", "não quero mais conversar" and "volte a dormir" clear the endpoint's
history and intent focus, send cancellation, and request immediate sleep. The local
wake detector remains available. No LLM request or goodbye synthesis is needed.

The matcher accepts the assistant name/aliases, polite prefixes/suffixes and accents,
but matches complete commands. Negations, questions about cancellation and requests
to cancel an alarm or stop music must not inadvertently put the robot to sleep.
The panel's text preview accepts the same commands and clears only its own history;
it does not put a physical box to sleep. Spoken cancellation requires the box to be
listening; this does not add interruption during speaker playback.

## Panel and examples

The Intents e humor table includes recognition and response modes. Its existing
responsive, sortable, paginated editing flow now includes meaning, response guidance,
humor and a bounded parameter editor. The overview's text conversation displays the
recognized intent and extracted values. This panel test has its own per-endpoint history, isolated from physical wake/reset
events, and a Nova conversa action; it does not play audio; ordinary
automation commands entered there still execute as indicated by its existing notice.

The explicit `tools/configure-conversation-examples.ts` installation tool adds two
examples to the selected endpoint's assistant using authenticated catalog mutations:
Outras assistentes (required assistant choice) and Chegamos em casa. It preserves
existing examples instead of overwriting edits. The user-confirmed fact that the family
has female dogs is added to the home's facts only when no dog fact exists; no names,
breeds or purported observed events are invented.

## Manual acceptance

1. Reload the panel and inspect the two examples under Intents e humor. Edit their
   meaning/instructions/humor there; no firmware flash is required.
2. In Experimentar uma conversa, choose the Rosie box and send a paraphrase such as
   “A assistente da Apple é melhor que você”. Expect Outras assistentes and
   `assistente: Siri`; follow with “Está com ciúme dela?” and then a new factual topic.
3. Send “Prefiro outra assistente” in a fresh conversation. If it selects the intent
   without a named assistant, expect a clarification. Answer “Alexa” and verify the
   displayed parameter. Use Nova conversa to reset the panel test without affecting the microphone.
4. Say the compiled wake phrase, wait for listening, then say “Olha quem voltou pra
   casa”. After the complete reply, continue with “E você deixou?” or refer to the
   actual joke it made. Follow-up listening uses the box's configured time window.
5. Ask “Lula ou Bolsonaro?” both in a fresh preview and after the Alexa/jealousy exchange. Expect ordinary conversation with no selected intent; the lack of an assistant name must not trigger a clarification. Then mention Siri explicitly and confirm the assistant intent is available again.
6. Say “Bom dia”, then ask about the actual reply: the local answer should now be in
   context. Say “pode parar” to end the session. Recognition/output wording can vary;
   audible quality and interpretation require listening on the real hardware.

Automated and live validation results are recorded in `validation.md`.

## Conditional response sets

An intent has up to eight ordered `responseRules`. The first rule whose conditions
all match supplies its replies and additional generation instructions. Unmatched
turns use the intent's normal replies. Conditions combine a numeric interval
(lower inclusive, upper exclusive), a daily time window (start inclusive, end
exclusive, including midnight crossings), resident IDs and mode IDs. Empty criteria
are unrestricted; an entirely unconditional rule is rejected. Time uses the home's
IANA timezone. Residents and modes are the explicitly selected endpoint context;
this does not identify speakers by voice. References remain within one home, and
existing assistant/room/variant eligibility applies before these rules.

Rules compare actual source readings in their source's unit, not numbers inferred
by the language model. Missing, expired or nonnumeric readings block numeric intents
with a neutral unavailable response instead of treating an absent value as zero or
using a misleading fallback. Each turn snapshots its reading once. Only the selected
response set enters the generation prompt; the full rule catalog does not add tokens.
Generated phrases use curated examples as style references and are never automatically
persisted or trained into a model. Templates randomly select from the chosen set.

`serious` disables the intent's playful style and generated examples. The final system
instruction gives serious requests and sensitive real concerns priority over persona,
humor and previous banter. Structured model output includes a `serious` flag. A serious
semantic turn uses the model's careful reply instead of a playful template, and uses a
neutral face. Exact/template intents remain deterministic; their owner must write
appropriate text when marking them serious. Semantic seriousness is model judgement,
not a guarantee of perfect detection or a keyword-based safety classifier.

## Reading sources and addons

`server/addons` contains built-in modules with a common configure/close lifecycle and
reading/command capabilities. MQTT owns its broker client, subscriptions, reading
cache, bounded payloads and delivery. Domain automation resolution/authorization and
no-retry behavior remain in `automation/service.ts`. Weather is a separate, read-only
addon. Both can be disabled in Voz e conexões without deleting devices or rules.
These are code modules shipped with the application, not an installer for third-party
executables. Direct Tuya and Home Assistant adapters are not implemented yet.

The reading boundary (`server/readings`) adapts observations into value/source data;
intents never choose MQTT topics or send commands. A future adapter implements this
boundary and its credential/configuration contract without changing condition
selection. Zigbee2MQTT sensors work through MQTT; Home Assistant or Tuya devices can
supply readings by publishing from Home Assistant to a registered state topic. There
is no automatic Zigbee radio pairing, Tuya login or sensor discovery here.

MQTT readings accept a scalar or a configured JSON path. The per-intent validity
(default 900 seconds, configurable 30–86400) measures time since **receipt**, including
retained messages; it cannot prove the sensor's measurement timestamp. Configure a
periodic publisher and avoid retaining outdated readings. Offline, unsubscribed,
disabled or malformed states are unavailable. Numeric conditions do not silently
convert units or parse arbitrary text as numbers.

The weather addon queries fixed Open-Meteo HTTPS endpoints with a five-second request
timeout, validated output, a ten-minute cache and shared in-flight requests. Locations
are selected explicitly from an authenticated geocoding search; ambiguous city names
are not silently resolved. Only city coordinates are sent to the weather service,
not conversation text or house facts. Upstream weather older than 90 minutes is
rejected, and failures do not fall back to stale readings. `{valor}` is Celsius and
`{condicao}` is the localized WMO condition description. This is modelled city weather,
not a measurement inside the house or a forecast for tomorrow. The panel attributes
[Open-Meteo](https://open-meteo.com/); its free endpoint is intended for noncommercial
use under its [terms](https://open-meteo.com/en/terms).

## Conditional-response acceptance

1. In Casas, search/select the weather city and save. In Intents e humor, select the
   city weather source and add ordered temperature/time rules with response sets.
2. In the panel preview, ask the current temperature using two paraphrases; verify
   the source value and matching response style. Ask a serious follow-up and confirm
   the reply drops the joke. Generation and audible interpretation require manual
   acceptance; automated provider tests use fixtures, not production billing.
3. Change a rule to restrict a selected resident/mode; unselected profiles must use
   the next matching rule or default. Compare exact thresholds with controlled test
   readings; do not alter household sensors to run tests.
4. Disable the weather addon, ask again, and verify a clear unavailable reply. MQTT
   must remain enabled/connected. Reenable weather. Disabling MQTT preserves its
   settings but stops both readings and commands.
5. Rule editing, removal and persistence are exercised in the existing desktop/mobile
   browser journey. No firmware flash is needed for these server/panel features.
