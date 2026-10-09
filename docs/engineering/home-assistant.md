# Home Assistant and external speech

Home Assistant is a built-in addon beside MQTT and city weather. Configure its URL,
owning home under **Voz e conexões → Home Assistant**, then choose **Conectar com
Home Assistant**. Login and authorization happen on HA itself. Save any other settings drafts before
leaving the panel. Reconnecting creates another named token; revoke unused Rosie
tokens from the HA profile after confirming the new connection. The application
exchanges the one-use code, creates a named 10-year integration token, stores it
privately and revokes the temporary login grant. Authorization states expire after
five minutes, are limited to five pending entries and do not survive a restart.
Only the authenticated installation owner can initiate or finish the connection.
The callback immediately removes its code/state from the address bar. A manual
long-lived token field remains available as an alternative.
The token stays in the private database and is never returned by settings GET or
sent to speech/conversation providers. Blank token submissions preserve it.
The existing private-LAN HTTP exception applies; revoke the HA token to remove access.

## Automatic device catalog

Enable **Voz e conexões → Home Assistant → Usar catálogo automático do Home Assistant**
and save. In HA, expose the intended entities to Assist and assign their areas.
In **Ambientes**, select the matching **Área no Home Assistant**. When no explicit
binding exists, a unique match to the Rosie's room name or alias is accepted.
Entities without a matching area are omitted; existing imports without an HA area
retain their prior room binding. Ambiguous room matches are never guessed.

Supported exposed entities appear in **Dispositivos** and routine/default selectors
without individual import or new device database records. Edit their names, aliases,
areas and exposure in HA. A switch defaults to the switch role; previously imported
logical light/fan roles remain unchanged. Unsupported HA domains are not offered.
Existing imported IDs, local aliases and explicit action permissions are preserved,
so this mode does not silently grant new actions to an imported device.

Discovery is cached/coalesced for five seconds. A disconnection or failed refresh
makes projected devices unavailable. Exposure is checked again before any action;
a removed Assist exposure prevents dispatch. HA acknowledgement still means command
acceptance, not a physical observation. The HA credential needs permission to read
its registries and exposure list (the latter requires an administrator).

The implementation uses the structured HA WebSocket APIs. Installing an MCP server
is not required for this catalog; an MCP conversational client remains separate work.
The mode is disabled by default for existing installations. Turning it off restores
the preserved manual imports; no HA configuration is changed. References to newly
projected devices require automatic mode and the corresponding entity/room mapping
to remain available. Test using the panel text preview before physical voice testing.

## Manual device catalog

The authenticated WebSocket tracks states and reconnects without replaying actions.
Import only selected entities, assign their Rosie rooms, and use aliases/default
lights and routine scopes as for MQTT devices. Lights, switches, fans and climate
support registered on/off actions; climate also supports an explicitly enabled single
target temperature. Scenes and scripts activate by `turn_on`.
Sensors are read-only. Choose the household role when importing: a HA `switch`
can represent a switch, light, fan or other appliance. A relay-backed light uses
Rosie's `light` kind for room resolution but still sends `switch.turn_on/turn_off`.
Other domains retain their matching roles; changing the role cannot make a sensor
writable or add service permissions. An entity cannot be registered twice in one home.
Acknowledgement means HA accepted the service call,
not physical confirmation. Unknown/uncertain delivery is never automatically retried.
Numeric sensor conditions require a recent `last_updated`; unchanged readings older
than the configured age are deliberately unavailable. This is a conservative changed-
state timestamp, not a claim about the physical sensor's measurement time.

Devices already supplied by Tuya or Zigbee through HA use this addon. A direct
TinyTuya adapter is not installed and must remain a separate future connection.
A single HA installation is currently mapped to one Rosie home.

## Air conditioner temperature

HA climate imports include `set_temperature` when the entity advertises single-target
temperature support. For an existing import, enable **Dispositivos → Editar → Permitir
ajuste de temperatura**. Disabling it revokes that action without deleting aliases or
on/off control. Simple requests such as **“coloca o ar no 20”**, **“coloque o ar condicionado
em vinte graus”**, or **“ajusta a temperatura do ar para 22”** resolve locally, using the
endpoint room unless another room is explicit. Spoken hyphens/spaces are equivalent
for names and aliases. Ambiguous devices still require a default or clarification.

Conversational requests receive the enabled devices' IDs, names, aliases and registered
actions. The bounded automation plan carries a numeric `temperature` only with
`set_temperature`; temperature and delay are independent fields. Recognized explicit
temperature requests cannot be silently dropped or replaced by a different number.
Pending plans preserve the value over restart and revalidate it before dispatch.
Existing routine steps do not support numeric parameters, so this action is not offered
in the routine action picker. MQTT temperature payload templates remain separate future work.

The HA adapter verifies house, logical and transport types, enabled action, availability,
single-target capability, Celsius configuration, reported min/max and advertised step
before sending exactly `climate.set_temperature` with `service_data.temperature`. Every
plan is preflighted before sending its first action. Out-of-range values are rejected,
never clamped. Adjusting temperature does not also send on/off or an HVAC mode change.
The acknowledgement confirms HA accepted the adjustment, not that the room has reached
the requested temperature. See [HA climate actions](https://www.home-assistant.io/integrations/climate/).

## Multiple commands and relative timers

A compound request uses one `control_home` plan with up to eight requested steps
(up to 32 expanded routine actions). Each step specifies the target, room, action,
routine flag and `delaySeconds`. Zero means immediate; a positive wait starts after
the preceding action's transport acknowledgement, or plan acceptance for the first
step. This does not measure when a physical lamp actually changes. Waits must total
at most one hour. The server verifies explicit durations against the original request;
missing units, unsupported times or omitted/invented delays produce clarification
without executing part of the request. Simple single-device commands remain local.

Every target and registered action is resolved before the first dispatch. A missing
TV or an ambiguous room prevents the entire new plan from starting. A later transport
failure stops the remaining steps; earlier physical actions are not rolled back.
The model's result is treated as one plan, rather than independently executing a list
of tool calls. Server acknowledgements are returned directly, without another LLM pass.

Up to 32 pending plans share a serialized dispatcher. Waiting steps release the dispatcher,
so another endpoint is not blocked. The single Node writer persists bounded plans in
the private `automation:pending-plans:v1` Setting row, before sending an action. Only
registered target IDs, actions, waits and authorization fingerprints are retained;
no transcript, audio or credentials are added. Accepted timers outlive sleep and
endpoint reconnection. After server restart, future waiting steps resume; expired or
in-flight steps are cancelled instead of replayed. A running timer over five seconds
late is also cancelled. The server must remain available for timely execution.

Targets are pinned. At execution, the server rechecks the endpoint context, enabled
home/rooms/devices, transport configuration and original routine definition. A changed
default never redirects an existing timer to another device. New explicit commands
supersede pending plans that affect the same device. Say **“cancele os temporizadores”**
to cancel this endpoint's pending plans; ending the conversation alone leaves accepted
timers intact. Failure/cancellation/scheduling metadata uses the existing bounded event log.

Examples: **“Acenda a luz e apague depois de cinco segundos”** and
**“Apague a luz do escritório e da cozinha e ligue a TV”**. All devices and actions,
including the TV's actual control integration, must already be registered.

## Speech and questions

Enable MQTT and **Falas e perguntas** on the same broker used by HA. Endpoint edit
forms configure whether to accept announcements, their optional volume and quiet
hours in the home's timezone. Mute and mode volume limits remain authoritative.

Select a box in **Falas e perguntas** to see its exact topics, test speech/questions,
and download a credential-free Home Assistant package. The panel test itself uses
the owner-authenticated API, so it also works when external MQTT requests are disabled.
The question test returns a choice on screen; it never controls a device.

Requests publish with QoS 1 and **retain: false** to
`<prefix>/<homeId>/<endpointId>/request`; replies use the corresponding `/result`.
The server subscribes only to enabled endpoint topics, ignores retained deliveries,
and bounds message size, admission, queues and deadlines. Broker ACLs must restrict
request publication and result consumption to the household's trusted automation
clients; MQTT payloads are not a substitute for broker authentication.

```json
{
  "id": "unique-request-id",
  "type": "ask",
  "text": "Posso apagar a luz do escritório?",
  "expression": "curious",
  "expiresAt": "2026-09-24T16:00:00-03:00",
  "timeoutSeconds": 30,
  "busyPolicy": "reject"
}
```

Generate a new ID and an absolute future expiration (at most 120 seconds) for each
request. The expiration controls admission/queueing. Processing is capped at 90
seconds; the answer window starts after playback and is limited to 5–120 seconds.
A queue holds at most three waiting items per endpoint and 64 globally. A disconnected
box receives no offline queue. Durable IDs are kept for five minutes (64 per endpoint);
restarts discard pending work and never replay it. A duplicate cannot speak twice.

`announce` speaks and sleeps; `ask` listens after completed playback. Answers map
locally to explicit choices, without an LLM call or automation tool execution.
Defaults are yes/no, with common Portuguese aliases. Custom `choices` accept 2–6
`{value,label,aliases}` entries; aliases cannot ambiguously match different choices.
Two unrecognized answers, explicit cancellation, disconnection or expiry finish the
request without approval. Only `{status:"answered",choice:"yes"}` authorizes a caller's
separate affirmative branch. Silence, `duplicate`, error and timeout never mean yes.
External text is synthesized as text, not sent to the tool-enabled conversation agent.

## Install the downloaded HA package

1. Ensure HA MQTT uses the same broker as Rosie.
2. Save the downloaded YAML in HA's `config/packages/` directory. Under the existing
   `homeassistant:` mapping in `configuration.yaml`, add
   `packages: !include_dir_named packages` if package loading is not already enabled.
   Do not create a duplicate `homeassistant:` key or overwrite other packages.
3. Check HA configuration before restarting/reloading as appropriate for MQTT YAML.
4. Verify the generated `sensor.rosie_<endpoint>_resposta` entity ID. If HA adds a
   suffix because another entity already uses it, update both script references.
5. Use `script.rosie_<endpoint>_avisar` with `mensagem` to announce. Use the matching
   `_perguntar` script with a `response_variable` to branch on its result.

The response sensor subscribes before the request, avoiding a publish-then-subscribe
race for immediate rejection. It stores the bounded correlation ID/status/choice;
HA's recorder may retain this metadata, while Rosie stores no speech transcript.
Each generated question script runs in single mode per box. Calls must use a fresh
ID and check its result, never react to an old sensor value or a bare yes/no event.
Do not run parallel questions on the same box from several independent HA scripts.
The package only supplies helpers; it installs no appliance-changing automation.

Example action sequence **after replacing IDs with the actual selected light**:

```yaml
- action: script.rosie_rosie_perguntar
  data:
    mensagem: Posso apagar a luz do escritório?
  response_variable: resposta
- if:
    - condition: template
      value_template: "{{ resposta.status == 'answered' and resposta.choice == 'yes' }}"
  then:
    - action: light.turn_off
      target:
        entity_id: light.REPLACE_WITH_REGISTERED_OFFICE_LIGHT
```

Fixed messages and choices use local STT, the assistant's selected TTS and no ChatGPT tokens. Templates may
include HA state values. Generating unsolicited text from arbitrary instructions is
not exposed through this addon. Native HA custom integration/discovery can follow
later; these are `script.*` helpers, not a nonexistent `rosie.*` service.

References: [HA WebSocket API](https://developers.home-assistant.io/docs/api/websocket/),
[MQTT sensor](https://www.home-assistant.io/integrations/sensor.mqtt/), and
[script response variables](https://www.home-assistant.io/docs/scripts/).

## Room comfort suggestions

Infrared devices may configure an explicit `haTemperatureScenes` map in the device
form (for example `20=scene.office_20`). For mapped temperatures, the adapter sends
only that registered scene through `scene.turn_on`; it does not update a virtual
thermostat or chain an implicit fallback. Missing scenes/values, unavailable entities
and non-cooling mode reject the command. The existing on/off registration is independent.
Changing the map invalidates pending commands and comfort confirmations.

Use the scene map only when the configured climate entity has no existing route to
the infrared temperature commands. Inspect external automation services such as
Node-RED as well as HA YAML before making that determination. The installed office
AC now uses Tuya Smart IR AC directly through `climate.ac_escritorio`. Its Rosie
scene map remains empty: Rosie calls the registered climate service and the new
integration sends the infrared request. The old generic thermostat is disabled as
`climate.ac_escritorio_legado`, and its office Node-RED scene branch is retained in
a disabled tab. The bedroom bridge is unchanged. Do not enable both office paths.

Rosie, HA scenes, and Alexa retain the office entity ID and aliases. The former
trial ID is no longer active. See decision 018 and the
[cutover and rollback runbook](office-ac-cutover.md). No ESP32 firmware or Smart Life
device pairing changes are involved. Local sensor readings remain distinct from
the Tuya cloud's recorded target; IR does not confirm physical appliance state.

For installations that actually need a direct scene map, that virtual thermostat's
setpoint is not evidence that the infrared appliance received the same temperature.
The latest timestamp among mapped scene activations supplies the **last sent setting**
for comfort proposals, identified as such in speech; it is not a physical sensor value.
No known scene activation means no invented setpoint. Using another remote can make
that last-command value stale. The virtual HA thermostat card is not synchronized by
this adapter. Temperature scenes can themselves encode power/mode; configure the
scene to match the intended cooling command. No Tuya credentials are added to Rosie.

Clear complaints such as “tô com frio”, “estou com calor” and “tá quente aqui” run
locally, without an LLM call. They inspect enabled climate/fan devices in the endpoint's
current room only. A room default resolves multiple appliances of the same kind;
otherwise Rosie asks which device instead of guessing. Climate adjustments take
priority; a usable room fan is considered when no climate adjustment is available.
The recognizer also accepts the assistant's configured name/aliases at phrase edges,
politeness, “estou sentindo/passando frio” and the current room's name. Negation,
conditional/third-person phrases, a different named room and unrelated clauses are
not removed to force a match. Diagnostic events identify the comfort route and feeling,
without retaining the user's spoken text.

For an active cooling/heating thermostat, offer an absolute target approximately two
degrees higher for cold or lower for heat discomfort, aligned to its reported step
and clamped to its limits. State the configured setpoint, never claim it is a measured
room temperature. At the relevant limit, offer switching off opposing cooling/heating
if registered. Offer to turn on a stopped cooling-only AC for heat; avoid starting an
AC that might restore an unknown heating mode. Fans offer on for heat/off for cold.
Unavailable states, unsupported modes and missing controls yield no invented action.

Every suggestion asks permission. A short affirmative consumes one concrete proposal
within 60 seconds; negative replies discard it. Changed room/assistant/resident/mode,
sleep/reset, another request, cancellation and restart invalidate it. Proposals live
only in a bounded 128-endpoint memory map, separate between voice and panel preview;
they are never included in LLM history. An affirmative naming a different action
cannot authorize the proposal. Confirmations never automatically replay after delivery
failure or uncertainty.

Read HA state from its synchronized WebSocket snapshot and MQTT fan `on`/`off` state
from an available reading at most 120 seconds old. Recheck scope, device configuration,
deadline and relevant state before accepting the confirmation and immediately before
dispatch. If state changed before confirmation, issue a new proposal requiring a new
affirmative. This prevents acting on a known stale proposal; it is not an atomic
compare-and-set against a physical appliance, which can still change after dispatch.
MQTT climate setpoints and arbitrary HVAC mode changes are not implemented.

## Optional Home Assistant Cloud voice

In **Robôs digitais → Editar → Voz e conversa**, choose a discovered standard pt-BR
voice ending in **Home Assistant Cloud**. **Ouvir no navegador** generates a fixed
sample without changing the saved voice. **Salvar** applies it to this assistant's
endpoints. Local voices remain available, and adding this feature does not change
any existing selection. Changing or closing the preview cancels its pending request.

Cloud TTS needs the enabled Home Assistant addon, its existing private credential,
a matching home, an active Cloud subscription and internet. The text of the response
is sent for cloud synthesis; microphone STT/VAD and ESP wake detection remain local.
Voice generation is included in the Cloud subscription; the conversational LLM and
optional web-search charges remain separate. The voice choice is shared by the digital
assistant; volume and audio prefill remain endpoint settings. This also applies to
external announcement/question playback. There is no automatic provider fallback:
an unavailable chosen voice reports failure, and the owner can choose a local voice.

Node discovers only `tts.home_assistant_cloud` standard pt-BR voices using the existing
authenticated HA WebSocket. It caches/coalesces metadata for up to 60 seconds, and
failed discovery for five seconds. TTS calls use HA's authenticated `/api/tts_get_url`
with `cache: false` (no new HA disk audio cache), then download only a strictly validated
`/api/tts_proxy/` path from the configured origin. Advertised external URLs and redirects
are rejected; the bearer credential never accompanies the audio download. HA can still
reuse its own short-lived RAM cache. Rosie persists no speech text or audio for this path.

Requests are limited to 2,500 characters, four concurrent syntheses, 45 seconds and
180 seconds of audio. Bounded downloads are decoded only if they match PCM16 mono
16 kHz; ffmpeg pipe WAV headers with unknown lengths are accepted only after the
bounded response completes. A home/credential/address change discards the previous
response. Cancellation propagates to HTTP and stale audio is never played. The full
reply is ready before the existing robot playback starts; no firmware change is needed.

References: [Cloud voice setup and subscription](https://www.home-assistant.io/voice_control/voice_remote_cloud_assistant/),
[Nabu Casa text-to-speech](https://support.nabucasa.com/hc/en-us/articles/25619386304541-Text-to-speech-TTS),
and [Nabu Casa privacy](https://www.nabucasa.com/privacy/).
