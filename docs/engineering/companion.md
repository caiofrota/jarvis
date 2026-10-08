# Companion and fixed endpoints

The main `/` and `/studio` workspace does not require a digital robot, physical
endpoint, local home or room record. Its default profile lives in installation
settings; each authenticated account can create personal assistant profiles and
choose its own default voice and personality in **Assistentes → Seus assistentes**. See
[personal assistants and integrations](personal-assistants.md).
Fixed endpoints retain their scoped catalog and firmware contract.

All profile editors share personality, optional facts and optional worldview fields.
The web companion and fixed endpoint model prompts use the same identity builder.
Selecting a shared profile includes its enabled household facts/timezone as reference
data, without inferring the mobile user’s room or resident identity. Private profiles
have no household binding. Profile/context edits reset the in-memory conversation
history. Personal defaults override the installation fallback; only administrators
can edit shared profiles or that fallback.

Companion API routes are authenticated under `/api/v1/companion`. The server creates
random session IDs, binds them to the authenticated account and expires idle sessions
after 30 minutes. History is bounded and kept in memory. Audio and conversation text
are not persisted. Sessions and voice requests are bounded and write routes enforce
the existing capability and origin checks. Requests abort when the browser disconnects.

The web client reuses desktop microphone capture, the PCM worklet, `AudioOutput`,
`SpeechPipeline` and the energy ring. Recognition uses the existing speech worker;
responses use its configured voice. Capture pauses during response generation and
playback. Interruption stops speech; ending voice or leaving the page releases microphone
tracks. Synthetic browser tests exercise capture and playback, not acoustic quality.
Real microphones, echo handling and audible speech still require user acceptance.

Immediate on/off requests use the shared generic command parser. Natural-language
action offers must use `propose_home_action`: the server registers one exact
entity/action and asks for confirmation. Clear short approvals retain the fast local path;
other replies are classified by the selected model as confirmation, refusal, uncertainty
or a new request. The classifier cannot change the target or action. Unclear replies
retain the original proposal until its deadline instead of creating repeated offers.
A positive confirmation dispatches once after rechecking exposure, availability,
entity identity and connection. Offers expire after two minutes; refusal, topic or
assistant/location changes discard them. Uncertain dispatch is never retried. HA owns the authoritative
entity names, aliases, availability and areas. Switches whose authoritative names identify
a light or fan can match that role; arbitrary switches are not presumed to be lights.
Only Assist-exposed entities are eligible, and exposure is rechecked before dispatch.
No duplicate room/device rows are created. The existing HA connection still belongs to
an installation home; a companion itself has no home binding. Explicit room names override
optional current area; absent or ambiguous location requires clarification. A successful
HA service request is acknowledged as a sent command, not verified physical state.
Personal email/calendar reads use owner-scoped tools; writes require confirmation
on **Configurações → Minhas contas**. Scheduled/composite home actions, temperatures, search and desktop executors remain
outside the companion action boundary in this iteration; never confirm their execution.

Windows/Linux connect through `pnpm companion --server https://your-server`. The
remote Electron renderer has no Node access. A narrow preload exposes origin-checked
window management and catalog actions, with native consent before launching a local
program. It exposes no credentials, arbitrary file paths or shell commands. Android/iPhone
source uses a native WebView of the same interface, secure server selection and OS
permissions. See [native client setup](remote-clients.md) for certificates and builds.
Voice-driven remote executor pairing is not implemented by the native shell.
The computer card can explicitly open locally registered programs through the desktop
executor; the central model cannot dispatch computer actions.

The main interface reuses the original Jarvis shell, particle ring, focus mode, fitted
card grid, drag/order/size controls and per-window preferences. Desktop window geometry
and detached cards use the existing WindowSession lifecycle. Administration stays on
web routes such as `/overview`, `/personal` and `/integrations`, opened in the system
browser from native clients. Next development indicators are disabled. Tasks and notes
retain the original client-side persistence, now namespaced by account; they are shared
between this account's windows on this device, not synchronized across devices or used
as authoritative central conversation tasks. That integration remains separate work.
The calendar card reads the signed-in user's connected provider calendars; it contains
no example events.

The workspace keeps SQLite, Next and Electron. The mobile companion's one connection
flow uses `registerRootComponent` instead of unused Expo Router routes. It consumes
the central interface and shared connection policy without importing server/web
source or duplicating domain services. PostgreSQL, Turbo orchestration and shared
UI/i18n packages are not added without a consuming implementation. Native pt-BR copy
stays in its messages module. These are documented scaffold exceptions.

For local web development, `pnpm setup:brain:https` requires an existing `.env` and OpenSSL.
It creates a 90-day self-signed certificate in ignored `apps/web/.local/tls`, changes the
configured origin and port, and enables a fixed-origin HTTP redirect. Trust the certificate
on the review computer. Keep keys private; use trusted certificates for deployed clients.

Companion transcription supplies a bounded vocabulary from the selected assistant and
Assist-exposed entity names, aliases and areas to the private worker. It contains no
personality, credentials or transcript replacements. The worker validates its length
and uses it as Whisper's initial prompt with a five-candidate beam. This may increase
CPU inference time; real microphone recognition quality remains an acceptance check.
The vocabulary supplements acoustic decoding and never authorizes an action.
