# Rosie application context

The active product is a native ESP32-WROOM audio endpoint with an SSD1306 face,
local compiled wake word, browser provisioning, and a local server. The user asked
for Node/React application ownership, local Python speech, distinct shared digital
assistants and independent physical endpoints. Resident profiles and behavior modes
are separate concepts. See `native/docs/assistant-model-proposal.md` for the product
specification and `decisions.md` for implementation choices.

## Boundaries

- `apps/web`: Next.js/React panel, versioned administrative REST API, authenticated
  robot WebSockets, application sessions, LLM adapters, registered MQTT and Home Assistant actions,
  and optional Home Assistant Cloud speech synthesis.
- `packages/types`: Zod contracts, references, context and scope resolution.
- `packages/db`: Prisma with SQLite, migrations and repository access. Browser code
  imports contracts only; it never imports the database or server modules.
- `native/voice`: private FastAPI speech worker. STT, VAD and TTS use downloaded
  models through `native/server/speech.py`; no household catalog or LLM key is sent.
- `native/firmware`: compatible audio protocol, IMA ADPCM batches, local wake word,
  face animation, microphone, speaker, optional PWM light, display control and provisioning. Current hardware acceptance
  and exact flashed artifacts are recorded in `native/docs/validation.md`.
- `native/server` apart from the shared speech engine: retained rollback server,
  frozen panel and legacy tests. Not a second active application service.
- Root ESPHome YAML and related tooling: retained legacy implementation. No automatic
  flash, Home Assistant mutation or UniFi changes belong to application validation.

The product UI is Portuguese (Brazil). Maintainer documentation and identifiers
are English. Panel accounts use individual usernames and passwords. Administrators
manage the installation; viewers only consult catalogs and endpoint status.
Accounts cover all configured homes and are separate from resident personalization.
Resident selection is a preference, never an admin grant. See
[account setup and access rules](user-accounts.md).
There is no public registration, billing, mobile app, or independent tenant account.

Panel pages use the root and validated single-segment routes. Do not introduce a
Next catch-all that also matches `/ws/robot/:id`: Next's upgrade handler would close
device handshakes after the first panel request. Device routes belong to the
authenticated gateway; a production-server regression verifies panel access followed
by repeated endpoint connections.

Voice and connection settings use accessible tabs for voice, conversation,
web search, Home Assistant, external speech, MQTT and weather. Switching tabs preserves drafts; one save action
applies the form, and validation reveals an invalid field in another tab.

Runtime state is private: sessions/conversation text/audio remain in memory; catalog,
credentials and bounded metadata events live in a permission-restricted SQLite file.
No chat text or microphone recording is persisted by the application. A provider may
apply its own retention policy to requests sent for an LLM response.

A change of room, assistant, resident or mode ends the endpoint's conversation.
Enrolled residents can be identified locally from post-wake speech when no fixed
resident is selected on the endpoint. Enrollment, ephemeral session identity,
private references and acoustic acceptance are defined in
[the speaker identification contract](speaker-identification.md).
Residents can also have one explicitly bound Google calendar through the existing
Home Assistant connection. Voice queries use that resident's binding; creation
requires a separate, expiring confirmation. OAuth setup, identity limitations and
validation are defined in [the resident calendar contract](resident-calendar.md).
Home defaults apply only to unset endpoint values; mode volume caps and mute win.
A wake-model label is descriptive: changing assistant name never retrains firmware.
The current local installation keeps its physical ID and credential during import.

The offline experiment for additional Rosie greetings and addressed stop phrases
is separate from the installed detector. The pending
[voice-interruption contract](voice-interruption.md) defines context-preserving
interruption, immediate sleep, stale-output rejection and physical echo/timing
acceptance. Training a candidate does not enable simultaneous listening in the
currently half-duplex firmware.

Conversational intents support exact or semantic recognition, ready or generated
replies and bounded parameters. See [the feature contract](conversational-intents.md).
Panel text previews keep separate per-endpoint history from physical microphone
sessions; they use the same context and registered automation authorization.

Conditional intent response sets use actual city-weather or registered MQTT readings,
ordered thresholds/time windows and selected resident/mode context. MQTT transport and
Open-Meteo weather are built-in addons under `server/addons`, independently enabled in
Voz e conexões. Detailed boundaries and limitations are in `conversational-intents.md`.

Each digital assistant may have an explicit `worldview`, editable with its identity.
It is shared by that assistant's endpoints, applied when relevant to the question,
and distinguished from household observations and factual evidence. It does not
change local automation authorization or deterministic exact replies.

Speech generation is selected per digital assistant. Existing local voices remain unchanged;
the optional Home Assistant Cloud voices use only that home's configured HA connection.
STT, VAD and wake detection stay local. Previewing a voice never saves it, and provider
failure never silently switches to another engine. See decision 013 and
[the integration contract](home-assistant.md#optional-home-assistant-cloud-voice).

Current external information uses an optional web-search addon with a durable,
installation-wide monthly dollar budget, bounded in-memory cache and one hosted search per turn. See
[web-search boundaries](web-search.md) for cost, source display and flight limitations.
Search answers obey a bounded spoken-text contract before caching. Current home
weather prefers an eligible intent's valid reading; other periods and unavailable
readings preserve the search path. Node normalizes visual formatting and spoken
units at the shared voice-worker boundary, including browser voice previews.
Flight searches default omitted origin to the home's city and omitted passenger
count to one adult, quoting per-person prices. Omitted trip type means round trip;
omitted dates mean departures in the next 30 local-calendar days. Default stays are
2–7 days domestically (short trips prefer weekends), 4–7 days for international
routes within South America, and 7–20 days for other international routes. Explicit
dates, periods and stays win; unknown destinations/geography require clarification,
and a flexible period is not replaced with an invented exact date. Python's shared speech
engine applies word pronunciation overrides only during synthesis, preserving the
displayed text (including Celsius with first-syllable stress and LATAM with final-syllable stress).
Flight responses use structured published offers and server-side date/duration
validation; unsupported offers are not read as matching fares. Shared speech
normalization expands currency amounts and clock notation before synthesis.

Home Assistant supplies devices through the optional automatic Assist-exposed catalog
with room-to-area bindings, or retained manual imports (decision 021). External MQTT
announcements and questions use local speech and explicit answer choices, isolated per
endpoint; see [the integration contract](home-assistant.md). Direct TinyTuya remains future work.
Explicit multi-device commands and short relative timers use one validated plan, with
pinned targets and bounded durable pending steps; see decision 012 and the same contract.
Registered HA climate devices can receive a validated Celsius setpoint, including direct
local temperature phrases and aliases. See the integration contract for capability,
range/step checks, room scope and retained timer parameters.
Room comfort complaints use local, state-based proposals with explicit, single-use
confirmation. Proposals never enter LLM history and are invalidated across sessions;
see the same contract for scope, deadlines and state revalidation.
Explicit HA scene mappings support infrared temperature commands independently of a
virtual thermostat. Comfort speech distinguishes last-sent infrared settings from readings.
The installed office AC now uses Tuya Smart IR AC through the preserved
`climate.ac_escritorio` identity. Rosie's scene map remains empty. The old generic
thermostat and office Node-RED scene bridge are disabled and retained for rollback;
the bedroom bridge remains active. Alexa keeps the existing entity identity and
aliases, with the office temperature route issuing one combined command (decision 018).
Model-initiated internet searches require a single-use confirmation unless the user's
current request explicitly asks for the search; see the web-search contract.

## Moving an existing Rosie catalog into Jarvis

`apps/web/tools/import-rosie.ts` merges a maintained SQLite catalog into an already
initialized Jarvis database. Set distinct `ROSIE_SOURCE_DATABASE_URL` and
`DATABASE_URL`, then run `pnpm --filter @rosie/web exec tsx tools/import-rosie.ts`.
The default is a read-only plan; `--apply` commits the plan in one transaction.
Take private online SQLite backups before applying and rehearse against a copy.

The importer preserves assistant/endpoint IDs, endpoint tokens, voice/personality,
physical controls, inherited audio values and household behavior references. It
reuses matching homes and rooms, fills empty household facts, maps room references, and fills missing room
bindings/default devices without replacing existing choices. Conflicting IDs fail
without overwriting records. Accounts, sessions, OAuth connections, voiceprints,
installation credentials and provider settings are not imported. Existing resident voiceprints
can be transferred separately with `apps/web/tools/import-residents.ts`, as documented
in [speaker identification](speaker-identification.md#importing-existing-residents-and-enrolled-voices). Imported resident
entries remain household preferences rather than account identities. No firmware
or stored device server address changes: an existing physical endpoint must later
be pointed at the Jarvis gateway using its preserved identity.

## Removing houses and rooms

House/room deletion first presents the exact dependent registrations. Confirmation
removes those local records atomically; it never deletes entities in Home Assistant
or flashes a physical endpoint. Dependency closure includes fixed endpoints,
registered devices, scoped rules and inherited variants, preventing an unlinked
scope from becoming installation-wide. An intervening catalog/settings edit
invalidates the review. Projected HA entities are not persisted dependencies.
Removing the connected house disables its HA connection while retaining its URL
and secret, and clears affected shared assistant defaults. Users, private assistant
profiles and personal integrations remain intact.
