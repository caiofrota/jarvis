# Shared assistants and independent physical robots

Status: implemented domain design, 2026-09-23. See `../../docs/engineering/validation.md`
for deployment and acceptance status.

The user wants several physical boxes to provide access to the same named digital
robot, while keeping conversation histories and output local to the originating
box. Other boxes can use Jarvis or Astro. Household devices remain a separate
concept. The user explicitly distinguished resident profiles from behavior modes.
The Node/React application implements this model with a separate local speech worker.

## Concepts and ownership

| Concept                   | Owns                                                                                                                              | Example                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Home                      | City, time zone, optional weather coordinates, household facts and defaults                                                       | The user's home; city must be explicitly configured |
| Room                      | Location, aliases and default device/group targets                                                                                | Escritório, cozinha                                 |
| Digital robot / assistant | Name, personality, voice, expression style, provider/model selection and assistant-specific facts                                 | Rosie, Jarvis, Astro                                |
| Physical robot / endpoint | Unique identity and credential, home/room, assigned assistant, hardware capabilities, volume, mute, buffer and attention settings | Caixa do escritório                                 |
| Household device          | Room, names, type, exact MQTT topics, registered actions and state mapping                                                        | Luz da cozinha                                      |
| Resident profile          | Name, preferences, explicitly saved personal facts and routine associations                                                       | Caio, visitante                                     |
| Behavior profile          | Reusable behavior/settings preset and routine associations                                                                        | Trabalho, noturno                                   |
| Routine or intent         | Reusable definition with explicit associations and scoped variants                                                                | Boa noite, temperatura lá fora                      |

An endpoint has one assigned assistant at a time. Several endpoints may reference
the same assistant. Home location and endpoint room are authoritative structured
data, not repeated text embedded in every assistant prompt. City alone does not
provide weather: an actual weather data integration must resolve that location.
Shared facts are explicitly maintained; conversation history is not implicitly
promoted into shared or personal memory.

## Runtime context

Each turn resolves home, endpoint, assistant, room, optional resident, active
behavior profile and a fresh conversation identifier. A session is owned by the
endpoint connection. History is keyed by endpoint and conversation, with the
assistant and resident captured at session creation. Changing either identity
ends the existing conversation instead of carrying its history into the new one.

Replies and face events return only to the originating endpoint. Each endpoint
has its own credential; cloning Rosie's current endpoint ID/token into another
box is incorrect. Shared assistant identity does not imply a shared connection.

Resident selection initially uses an explicit panel/session selection, with a
guest/default fallback. Automatic speaker identification is a separate feature.
Selecting a resident or saying a person's name must not confer administrative or
device-control permissions. Grants belong to authenticated policy, enforced by
the backend, independently of LLM output.

Several boxes may hear one wake phrase. An optional configured group of endpoints
with overlapping acoustic coverage needs server arbitration before creating an
answer or sending MQTT commands. One event owns the resulting turn. Arbitration
requires real multi-device tests; microphone loudness alone cannot reliably
identify the nearest endpoint. Unrelated conversations must not be suppressed
merely because they use the same assistant. Playback on one endpoint should also
be considered when handling nearby wake detections.

## Configuration resolution

Avoid a single inheritance chain for every setting. Ownership is field-specific:

- The assistant owns identity and default voice/personality. Reassigning a box
  changes those defaults without editing other boxes.
- The endpoint owns physical volume, mute and buffering. Home defaults initialize
  unset values; explicit endpoint values remain independent.
- A behavior profile may change allowed contextual preferences such as reply
  length or a night-time volume limit. Explicit mute and hardware limits win.
- The resident contributes relevant preferences when selected, without changing
  the assistant's name or silently changing access policy.
- The room supplies local action targets. An explicitly requested room overrides
  the endpoint's current room; an unknown room never falls back silently.

The panel should show the effective value and its source, with an explicit
"use default" option distinct from zero, false or an empty value. Initial behavior
mode selection should resolve to one active preset per turn; combining several
active modes requires separately defined conflict rules.

## Shared routines and local variations

Store a routine once and associate it with homes, assistants, rooms, residents or
behavior profiles. Associations determine availability and parameters; they do
not duplicate steps. Define whether each target is a fixed registered device or
a contextual target such as the default light in the effective room.

For example, a shared "apagar a luz" command can resolve to the office light from
the office endpoint and to the kitchen light from the kitchen endpoint. Both
Rosie and Jarvis can invoke it. If there is no unique/default target, ask which
one. A shared "boa noite" routine can have a room-specific variant and an
explicitly configured whole-home variant; invoking it locally must not silently
expand its scope to the whole home.

Scope eligibility, target room and access policy are evaluated before choosing a
variant. A uniquely more specific variant may override the shared default.
Incomparable matches, such as equally applicable resident and assistant variants,
must be resolved explicitly in the panel or by clarification, not database order
or an LLM guess. Exactly one resolved definition executes per invocation. Explicit
whole-home/cross-room actions need declared targets and separate validation;
merely sharing a routine with more assistants must not broaden its action scope.

Local intents use the same associations for humorous phrases, expressions and
sensor responses. Availability of an intent is distinct from the room of the
sensor it reads. A visitor should not receive personal facts just because a
routine is available to their assistant.

Here, independent behavior means owned settings and scoped routines. Scheduled,
event-driven or spontaneous actions require explicit triggers and execution
rules; they are not automatically enabled by adding a behavior profile.

## Current implementation and migration boundaries

The current `Robot` combines endpoint identity/credential and room. Voice,
personality, volume and attention controls are global `Settings`. The socket
registry replaces a previous connection with the same robot ID. Conversation
history is also keyed by that ID. Routines currently reject cross-room steps.

A migration should preserve the existing endpoint ID/token and wire URL so the
current WROOM remains paired. Create a distinct Rosie assistant and associate the
existing endpoint with it. Move voice/personality into Rosie and copy current
physical settings into the endpoint, while preserving provider credentials,
MQTT configuration, devices, intents, room bindings and wake-model metadata.
Version the catalog and keep a recoverable backup before applying migration.

Resolve speech options per job, not through mutable process-wide selection.
TTS caches must include voice and quality; requests from Jarvis must not change
Rosie's voice. Current CPU model execution is serialized, so multi-endpoint
concurrency needs scheduling and queue feedback. Shared identity does not add
compute capacity or guarantee simultaneous low-latency replies.

The current WROOM embeds one wake model at build time. Changing assistant name or
association in the panel does not change that acoustic model. Keep the configured
activation phrase visible separately. Changing "Acorda Rosie" to a Jarvis model
currently requires a compatible model and firmware installation. Runtime model
replacement is a separate firmware capability.

Suggested delivery order: separate assistant/endpoint ownership and migrate the
existing unit; add the resident and behavior-profile catalogs and deterministic
routine bindings; then validate multiple physical endpoints and wake arbitration.
Existing APIs may retain their paths for firmware compatibility while the panel
adopts the clearer terminology.

## Acceptance cases

- Two independently authenticated endpoints share Rosie without replacing each
  other's sockets, histories, settings or output routes.
- The same local light command resolves to each endpoint's room; explicit other
  rooms work and ambiguous/unknown targets cause no action.
- Adjusting one endpoint's volume leaves the other unchanged. Shared assistant
  edits reach both; an active mute or configured volume cap is respected.
- Jarvis uses its own voice/personality while sharing a routine with Rosie.
- Resident preferences and behavior modes remain distinct and have visible
  effective configuration; guest use does not inherit personal conversation data.
- Conflicting routine variants cannot produce duplicate or expanded actions.
- A simultaneous wake in an acoustic group results in one reply and one action;
  unrelated endpoint conversations remain separate.
- Migration preserves pairing, current Acorda Rosie behavior and existing local
  intents, device actions and settings. Rollback restores the prior catalog.

The handbook currently defines no domain-modeling standard for this decomposition;
the user's product requirements and inspected runtime boundaries govern this draft.
