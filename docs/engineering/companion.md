# Companion and fixed endpoints

The central `/studio` conversation does not require a digital robot, physical
endpoint, local home or room record. Its default profile lives in installation
settings; each authenticated account can create personal assistant profiles and
choose its own default voice and personality in **Meus assistentes**. See
[personal assistants and integrations](personal-assistants.md).
Fixed endpoints retain their scoped catalog and firmware contract.

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
entity/action, asks for confirmation and consumes the proposal on the next reply.
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
on **Minhas integrações**. Scheduled/composite home actions, temperatures, search and desktop executors remain
outside the companion action boundary in this iteration; never confirm their execution.

iPhone and Android are planned native clients of the central services. No mobile app
or remote desktop pairing is shipped by this change. The Electron executor remains local.
Native client authentication, pairing and OS permissions must be implemented explicitly.

The existing workspace uses SQLite, Next and Electron. It intentionally does not add the
handbook scaffold's Expo mobile app, PostgreSQL, Turbo, API client package or i18n package
until those boundaries have implementations. The scaffold validation script reports these
missing components; this is a local integration decision, not evidence of a shipped mobile app.

For local web development, `pnpm setup:brain:https` requires an existing `.env` and OpenSSL.
It creates a 90-day self-signed certificate in ignored `apps/web/.local/tls`, changes the
configured origin and port, and enables a fixed-origin HTTP redirect. Trust the certificate
on the review computer. Keep keys private; use trusted certificates for deployed clients.
