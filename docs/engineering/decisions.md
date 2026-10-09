# Application decisions — 2026-09-23

## 001: Two runtime services and a cohesive web application

Node/TypeScript owns the domain and React panel. One persistent Node process serves
Next.js, REST and the robot WebSocket protocol; Python owns local speech inference.
The speech engine retains its exclusive inference lock through cancellation, and
complete replies are synthesized before continuous buffered playback. This preserves
existing model compatibility without splitting every feature into a microservice.
Node does not make CPU inference inherently faster. Speech timings remain observable.

The custom Node server is the local delivery target. Next route entry points compose
screens; API handlers delegate domain work to services. No phantom mobile app or
unused shared packages are scaffolded. A future mobile client consumes the same API.
The handbook architecture skill's mobile-directory check is inapplicable here.

## 002: Prisma/SQLite and bounded catalogs

Use Prisma with a file-backed SQLite database on the existing miniPC. The deployment
has a single application writer and at most 500 records per catalog collection.
Relationships in versioned JSON entries are validated in the domain on every catalog
mutation; mutation serialization and optimistic revisions prevent lost updates within
this single writer. List filtering, sorting and pagination happen on the server,
with an allowlist and stable identifier tie-break. This consciously avoids a third
service and a complex table migration for every new setting.

This store is not a multi-instance cloud database. Before horizontal scaling, replace
it with a shared database, transactional cross-process reference enforcement and
shared operation/session coordination. Copies of the same SQLite file must not be
used as independent writers. Back up both the database and private credentials.

## 003: Existing owner authentication and local transport

The shared-password login in this decision is superseded by decision 020. Its
private LAN transport and separate machine-credential boundaries remain applicable.

Preserve the existing administration credential as the installation owner's password.
Store revocable, eight-hour sessions in the database; the browser holds only a sealed
HttpOnly, SameSite=Strict cookie. Mutations require the exact configured Origin.
All administrative routes require the owner session. Endpoint authentication is
separate and PIN pairing is single-use, short-lived and rate-limited.

The current private LAN URL remains HTTP to avoid breaking existing firmware and
bookmarks. Consequently cookies cannot use Secure locally and device traffic is not
TLS protected on that LAN. This is a scoped compatibility exception, not permission
to expose the service publicly. Internet delivery requires TLS/WSS, trusted certificate
verification in firmware and a new threat assessment. HTTPS mode enables Secure cookies.
The internal worker binds to loopback and uses a distinct bearer credential derived
from the existing private installation credential with a domain-separated HMAC.

## 004: Scope and autonomy

A shared routine is stored once in one home and associated with assistants, rooms,
residents and modes. Empty associations mean all values of that dimension. A variant
must be more specific than its base; incomparable applicable definitions are rejected.
Targets resolve to either registered devices or a kind/default in the effective room.
Explicit room requests win; unknown rooms never silently fall back. A routine must
opt in to affecting rooms other than its chosen room. MQTT PUBACK confirms delivery
to a broker, not physical execution. No application retry follows uncertain delivery.

Optional acoustic groups accept the first active endpoint until that conversation
ends; this is arbitration, not measured nearest-device selection. Multiple physical
units require unique IDs/credentials. Shared settings do not share conversation text.
Residents can be selected explicitly or identified from enrolled speech under the
speaker-identification contract. This is personalization, not an administrative
authorization or strong biometric guarantee. There are no unsolicited scheduled
actions or automatic promotion of chats into shared memory.

## 005: Delivery and archived implementations

Direct local installation is authorized by the ongoing project request. No cloud
publication, Git commit/push, firmware reflash or home-wide network change is included.
The previous Python server and ESPHome source remain available for rollback/history.
Their existing deterministic checks stay in CI. New application code uses the root
pnpm lock; Python uses its uv lock. The stable required outcome remains
`Firmware validation`, aggregating all applicable jobs. Remote branch protection and
actual CI execution cannot be claimed until the user supplies/publishes a repository.

## 006: Reviewed dependency patches

Prisma 7.10.0 remains the stable major selected for this application. Its CLI
transitives `deepmerge-ts` and `mysql2` are overridden to 8.0.0 and 3.23.1 to
resolve advisories found during validation. Remove each override when the parent
provides a patched compatible resolution. These changes are verified by schema
validation, generation, migration and integration tests. Python test tooling uses
pytest 9.0.3 or later because the previously installed 8.4.2 had a known advisory.
Routine Dependabot version PRs are disabled; selective high/critical security
updates and all-severity alerts require repository-provider configuration, currently
not assessable because no Git remote is configured.

## 007: Semantic intents share the existing conversation request

Use the configured conversation provider to select an eligible intent, extract bounded
parameters and generate its reply in one structured response. Keep exact/template
intents local; do not introduce another classifier or inference service. Preserve local
replies in the bounded per-endpoint history for natural follow-ups. See
[conversational intents](conversational-intents.md) for parameter validation, scope,
limits and acceptance. This is a project decision; no new handbook standard is needed.

## 008: Conditional replies and built-in integration modules

Choose response sets deterministically from bounded real readings and endpoint context
before sending a single generation request. Numeric rules use lower-inclusive,
upper-exclusive intervals and priority order. The selected examples guide phrasing;
there is no self-training or automatic growth of shared household memory.

Keep MQTT transport and weather acquisition in independently configurable built-in
addons. Device authorization and routine scope remain application domain concerns.
Use Open-Meteo for the initially requested city weather; keep MQTT readings available
for existing Home Assistant/Zigbee2MQTT publishers. Direct Tuya remains a future module. Decision 011 subsequently adds the Home Assistant
adapter. Unimplemented connections are not exposed as working placeholders. No plugin package
manager or dynamic remote code loader is included in this iteration.

## 009: One bounded hosted web search per turn

Use OpenAI Responses with GPT-4.1-mini for the built-in search addon, reusing the
installed credential while preserving the primary conversation model. The owner
approved ten search calls per day and no repeated search within one interaction.
Enforce the budget before dispatch in a durable Setting row, shared by physical
voice and panel previews; also cap the hosted tool at one invocation. Return the
annotated search answer directly rather than running another generation pass.
No additional microservice, firmware update or third-party search account is needed.
The [feature contract](web-search.md) defines failures, cancellation and evidence.

## 010: Monthly search budget and conservative shared cache

The owner replaced decision 009's ten-per-day allowance with US$5 per calendar
month. Include the hosted tool fee and the search request's model tokens in that
allowance; ordinary conversation generation remains separate. Persist integer USD
micros, reserve a conservative request maximum before dispatch, then settle only
known usage. Carry uncertain reservations across restarts and import the earlier
usage evidence once. Reset only at the next Fortaleza calendar month; retain earlier
months so late responses settle their own reservation. This is a local estimate
using documented rates, not an account-wide provider billing limit.

Keep sourced answers in a bounded RAM cache, isolated by home, city, timezone, local
date, requested period and normalized query. Use shorter lifetimes for volatile
subjects, share concurrent identical work with independently cancellable waiters,
and support explicit refresh. Do not use fuzzy similarity that could erase dates,
negation or route differences. No persisted search text, background refresh, new
classifier service or extra model request is introduced. The one-search-per-message
rule from decision 009 continues to apply.

## 011: HA command adapter and bounded external interactions

Connect one Home Assistant installation to one configured home through its authenticated
WebSocket. Import selected entities into existing room/device authorization; retain MQTT
as an independent transport. Scenes/scripts are registered activation targets, not arbitrary
LLM-selected services. Credentials remain private. Acknowledged service calls do not prove
physical execution, and uncertain commands are never automatically replayed.

External announcements/questions enter through authenticated owner API or exact endpoint
MQTT topics. They use local speech and fixed answer choices, with endpoint policies, bounded
queues, absolute admission expiry, answer deadlines and durable duplicate suppression.
Cancellation/disconnection never authorizes an affirmative action. Caller-side HA scripts
branch on the correlated result; incoming speech text cannot invoke conversation tools.
The downloadable HA package supplies per-endpoint scripts and a result sensor; it contains
no credentials and changes no appliance without a separately configured caller action.
See [the integration contract](home-assistant.md). No firmware change is required.

## 012: Explicit automation plans and relative timers

Replace independent immediate model tool calls with one preflighted automation plan.
Preserve explicit user intervals server-side, pin resolved targets and return the
server's acceptance without a second LLM response. Keep short accepted timers independent
of voice attention sessions, with bounded durable state in the existing single-writer
SQLite Setting store. Future work can survive a Node restart; uncertain, expired or
invalidated work is cancelled and never replayed. There is no new queue service, calendar
scheduler or autonomous task generation. Limits, cancellation and recovery are specified
in [the integration contract](home-assistant.md#multiple-commands-and-relative-timers).

## 013: Optional cloud speech through the existing Home Assistant connection

The owner requested Home Assistant Cloud TTS as an option after observing CPU-bound local
synthesis latency. Keep the assistant's existing voice field and default local choice;
use `ha-cloud-` IDs for discovered standard pt-BR cloud voices. The Node application
calls the configured HA instance, which uses its existing Cloud subscription. Do not
add a cloud STT path, another credential, a Python cloud adapter or a new service.

Require the assistant's home to match the HA connection. Convert to the existing
16 kHz mono PCM contract before playback, with bounded requests and response sizes,
cancellation and no implicit engine fallback. Browser previews are explicitly initiated,
do not save voice selection, and cancel on dismissal/voice changes. See
[the integration contract](home-assistant.md#optional-home-assistant-cloud-voice).

## 014: Parameterized climate control and confirmed comfort suggestions

Climate setpoints are typed Celsius parameters, separately authorized from on/off.
Resolve registered aliases locally for common commands; retain parameters through
validated multi-step plans and verify HA capability, unit, range and step. A simple
temperature adjustment never implicitly changes HVAC mode or power state.

The owner also requested suggestions in response to feeling cold/hot. Deterministic
local proposals inspect the endpoint's room and ask before acting. Confirmation is a
bounded, expiring, single-use capability, bound to context/configuration/state and
rechecked immediately before dispatch. Do not let an LLM reconstruct old offers from
conversation history. See [the integration contract](home-assistant.md#room-comfort-suggestions).

## 015: Registered infrared temperature scenes and internet-search consent

The office HA climate entity is a generic thermostat: its target is a virtual threshold,
not an infrared temperature payload. Extend the registered device with an optional,
bounded temperature-to-HA-scene map. Preserve native climate setters for other devices.
The owner authorizes each mapped scene through device configuration; dispatch one scene,
without a second virtual setter, implicit fallback or automatic replay. A scene carries
its configured payload, potentially including mode and power. Its activation timestamp
means last command sent, never physical temperature feedback. Keep existing on/off mappings.

An internet search proposed by the model now requires the user's confirmation unless
the current utterance explicitly requests a search. Keep the resolved search criteria
in a bounded, expiring, per-session proposal; consume confirmation once before the existing
budget/cache/search path. Do not spend search quota or run another classification request
while awaiting a reply. Reset, unrelated requests and context changes invalidate the offer.
This supplements decisions 009–010 without changing their monthly allowance or call cap.

## 016: Reuse the existing office climate bridge

The initial installation analysis for decision 015 did not inspect the separate
Node-RED service. Its existing `Config AC` flow already observes
`climate.ac_escritorio` target/mode changes and executes the corresponding Tuya scene.
Direct scene mapping in Rosie bypassed that bridge and left the HA card's target stale.

Remove only the installed office device's direct temperature-scene map. Rosie again
calls the registered HA climate service; HA owns the target and Node-RED owns the
scene dispatch. Preserve existing on/off registrations, aliases, HA YAML and Node-RED
flows. The optional direct-scene feature remains available for installations without
such a bridge; do not infer the absence of one from generic-thermostat type alone.

This supersedes the office installation choice in decision 015, not its generic
optional capability. The shared target is a commanded setting, not physical feedback.
Neither this change nor HA scene timestamps establish synchronization with commands
from a physical remote or direct Smart Life controls that HA does not observe.

## 017: Parallel Tuya IR integration trial

The owner explicitly requested installing Tuya Smart IR AC alongside the existing
office control, deferring replacement until separately requested. Install upstream
`EnzoD86/tuya-smart-ir-ac` version `2026.9.0`, revision
`c04b3e1f8c96c2ce2c0fc712a03b7d0b6aca3d64`, on the existing Home Assistant.
Use its supported config flows and the existing private Tuya project credentials.

The trial owns `climate.ac_escritorio_teste_tuya_ir`, named
`AC Escritório — Teste Tuya IR`, and has no Rosie registration or automation
bindings. Keep `climate.ac_escritorio`, its Node-RED scene bridge, household
automations, and Rosie's existing device registration unchanged. Both entities
address the same physical appliance; separate names isolate automation routing,
not the physical effects of manual commands. Do not synchronize the trial back to
the old virtual thermostat, which could cause a second infrared transmission.

Start with the existing 17–27 °C operating range, whole-degree steps, cooling,
the existing room-temperature sensor, and no extra presets. Keep upstream polling
defaults of 300 seconds and leave optional Pulsar disabled during this trial.
Cloud state is the last recorded setting, not confirmation from the appliance.
The owner's IR service authorization now permits the API; IoT Core remains a
separate dependency. No paid service was purchased by the agent.

## 018: Replace the office scene bridge while preserving consumers

After confirming that the trial delivered a physical temperature command, the
owner explicitly authorized replacement with the old flow disabled and rollback
ready. Transfer `climate.ac_escritorio` to the installed Tuya Smart IR AC entity
using Home Assistant's registry APIs. Preserve the friendly name, aliases, Alexa
exposure and Rosie's catalog registration. Disable the former YAML thermostat as
`climate.ac_escritorio_legado`; keep its YAML and all Smart Life scenes intact.

Move only the office bridge to a disabled Node-RED tab. The shared `Config AC` tab
continues to run the bedroom bridge. Change the office state consumer to read the
active climate rather than the old thermostat's helper. The Alexa office
temperature path formerly sent power-on followed by temperature; collapse this to
one `climate.set_temperature` request including cooling mode. Preserve the former
power node in the disabled legacy tab. Other rooms and routes remain unchanged.

Preserve Alexa's entity-based endpoint identity during the registry transfer,
without sending a delete for that endpoint. Re-pairing is not expected; actual
voice recognition and any Amazon-side routine behavior still require user testing.
The new climate's cloud state remains a recorded command, not appliance feedback.
Tuya cloud and its project/API entitlements remain runtime dependencies.

This supersedes the installed office route in decision 016 and the temporary
parallel-only restriction in decision 017. It does not remove the reusable scene
mapping capability. See [the migration and rollback runbook](office-ac-cutover.md).

## 019: Resident calendars through the existing HA connection

The owner requested one Google calendar per resident, with consultation and event
creation only after confirmation. No calendar account or HTTPS domain is currently
configured. Reuse HA's official Google integration for OAuth instead of adding a
public callback or storing another provider secret in Rosie. Account holders finish
Google authorization in their browser. The resident calendar addon exposes only
discovery, bounded reads and single-target creation; domain authorization remains
in Rosie and does not depend on LLM-selected identities or entities.

Bind a discovered Google calendar explicitly to an enabled resident and home, with
separate read/create permissions. The current session's recognized or fixed resident
selects the binding. Single-use creation proposals expire and are revalidated before
dispatch; uncertain delivery never triggers a retry. Calendar contents and pending
proposals stay out of LLM history and persisted event metadata. Account holders
should treat voice recognition and spoken replies as household convenience, not a
private authentication channel. The complete setup, limits and validation contract
is in [resident calendars](resident-calendar.md).

## 020: Local installation accounts with a terminal-only bootstrap

The owner requested individual usernames and passwords, with administrator and
read-only roles. Retain the existing maintained cookie library and server-side
revocation model. Add distinct user and hashed-session records; never reinterpret
resident voice identity as panel authorization. The old installation credential
continues sealing sessions and is never accepted as a user password.

`pnpm user:create-first` reads hidden passwords from an interactive terminal and
creates exactly one initial administrator, guarded by a database transaction and
permanent bootstrap marker. There is no public bootstrap or registration route.
Administrators create and edit further accounts in the panel. Passwords use salted
scrypt; disabled accounts and stale sessions cannot access the API. Role/password
changes revoke the affected user's sessions, and the last active administrator
cannot be removed. Accounts are disabled rather than deleted. See the
[operational contract](user-accounts.md) for access scope, migration and recovery.

## 021: Home Assistant owns the automatic device catalog

The owner requested removing duplicate device registration in Rosie. Add an optional
`homeAssistantAutomaticCatalog` mode, with the existing manual mode retained for
rollback. Project exposed Assist entities into the effective catalog at read time;
do not create a database entry per new device. HA owns names, aliases, areas and
advertised capabilities. Rosie owns endpoint room context, room-to-HA-area bindings,
room defaults and routine references. Preserve imported IDs and explicit action
permissions, including logical switch roles and infrared mappings.

Use the existing authenticated WebSocket registry/state APIs and the Assist exposure
list for structured discovery. The MCP conversational context is not used as a
machine-readable device registry. This change implements catalog ownership, not an
MCP tool execution client. Cache discovery for five seconds, coalesce concurrent
reads, fail closed on discovery errors, and recheck Assist exposure before dispatch.
Only currently supported domains are projected. No entity is exposed or modified
in HA by this feature, and no firmware change is required.

## 022: Authenticated personal companions and direct account integrations

The owner requested separate companions and both Google/Microsoft mail and calendar
accounts for each person. Companion profiles therefore belong to installation
users rather than physical endpoints/residents. An explicit personal member role
grants companion and personal integration access without installation management.
Administrators configure the global fallback and provider applications; each user
authorizes their own accounts. Existing physical resident calendars through HA
remain separate, with their household authentication limitations.

Use maintained OAuth protocol primitives, PKCE/state, encrypted server-only tokens
and authenticated owner-bound completion. Provider identities are integration links,
not additional login mechanisms. Read-only tools may query personal accounts for
the companion; sending and event creation require explicit page confirmation.
This implements separate authenticated personal access, not private voice identity
or native mobile integration. See [the feature and setup contract](personal-assistants.md).

## 023: Native companions reuse the central interface

The owner requested Windows/Linux and iPhone/Android clients of the central server.
Use a separate sandboxed Electron remote entry and a thin Expo React Native WebView
app. Both reuse `/studio` with shared public connection policy in `packages/api-client`.
Neither shell imports server/database code. The initial desktop boundary is refined
by decision 024 for window management and explicitly confirmed local catalog actions.

The one native connection flow uses `registerRootComponent`, not unused Expo Router
routes. Localized native strings live in a focused messages module, without an
unused shared UI/i18n package. These scaffold exceptions last until more native
screens/consumers justify routing or shared copy. Remote program execution requires
a separate executor-pairing feature, not privileged website loading.

Desktop local HTTPS supports exact certificate trust with SAN/date checks. Android
local CA trust is an optional build-time setting limited to one host; iOS uses
explicit system trust. System-trusted HTTPS remains the default. Generated native
projects/binaries are private; signing/device acceptance is separate from bundling.
No app-store publication is configured.

## 024: Restore the original assistant workspace and keep administration separate

The owner rejected using the operations panel as the native companion. The main
`/` and `/studio` surface therefore reuses the original Jarvis shell, sphere, focus
mode, fitted card grid and movable/detachable panel components. The administrator
interface remains on web configuration routes, accessed through the system browser
from native clients. Next development indicators are disabled on both applications.

Scope the original stylesheet to the companion body using a generated asset; the
source remains the original root CSS. Account-prefixed browser storage separates
personal tasks/notes and window preferences. This preserves client-side behavior;
central task tools and cross-device task/note synchronization are still pending.
The calendar card queries only the signed-in person's actual connected calendars.

A dedicated sandbox-compatible preload exposes window creation and the existing
local catalog executor only. Every invocation checks ownership, the exact central
origin, `/studio`, and the main frame. No generic IPC, shell, credential or filesystem
API is exposed. WindowSession persists each window's identity, panel, reachable
bounds, maximized/fullscreen state and closing lifecycle. Native mobile does not
advertise detached windows. Local execution requires an owner-bound expiring token
and a native confirmation defaulting to cancellation; central voice cannot dispatch
computer actions. Deterministic acceptance uses a simulated executor, never real
program launches or home commands.
