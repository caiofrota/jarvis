# Resident Google calendars

## Provider and account setup

The built-in calendar addon uses the existing authenticated Home Assistant
connection. Google's official HA integration owns OAuth and refresh credentials;
Rosie stores only the resident's calendar entity, permissions, home and revision.
No public Rosie callback, HTTPS domain, Google client secret or additional service
is required. This installation remains on its trusted private LAN.

The account holder must first connect Google Calendar in HA. Follow the
[official setup guide](https://www.home-assistant.io/integrations/google/): create
a Google Cloud project, enable Calendar API, configure the OAuth application and
create a Web application client with the exact redirect
`https://my.home-assistant.io/redirect/oauth`. Enter the client credentials directly
in HA, authorize the account and verify the returned HA instance address. Testing
mode requires test users and its authorization expires after seven days; the
official guide describes publishing the personal application for ongoing use.
Account consent and Google project configuration are not automated by Rosie.

Each account is connected through HA; the owner then opens **Moradores → Editar →
Agenda**, refreshes discovery, selects the resident's Google calendar and saves
the explicit read/create permissions. Saving the calendar is separate from saving
the profile. Removing the binding or resident never deletes Google events.

Discovery accepts only enabled `calendar.*` entities registered by the Google
integration in the configured home. Writable calendars must advertise HA's
create-event capability. Calendar state attributes are not used as an event list;
queries call `calendar.get_events` with a bounded interval. Confirmed creation calls
`calendar.create_event` once, with one pinned target.

## Identity and consent

- Calendar access requires the session's recognized resident or the endpoint's
  explicitly fixed resident, in the same home as the binding and HA connection.
  A name spoken in a prompt cannot select someone else's binding.
- Voice identification is personalization, not a password or strong biometric
  authentication. A shared physical endpoint speaks events aloud; do not use this
  convenience feature as a confidentiality boundary between people in the room.
- Creation produces a proposal naming the resident, title, date and full time
  range. A separate affirmative utterance within 60 seconds consumes the proposal
  before dispatch. Refusal, another request, reset, sleep, abort or a change of
  resident/home/room/assistant/mode invalidates it.
- The binding revision, resident, home time zone and HA credentials are checked
  again immediately before dispatch. Disabling or changing the binding invalidates
  outstanding proposals. No automatic retry follows timeout or uncertain delivery;
  the event may already exist and the user must check the agenda before retrying.
- Concurrent panel editors use revision comparison. Binding routes require the
  existing owner session and mutation Origin checks. Device identity cannot call
  the administrative API.

## Conversation behavior and limits

Common queries such as “Qual é minha agenda hoje?” and “Quais compromissos tenho
amanhã?” are local. Other phrasing and new event details use a function tool in the
existing conversation request, without adding another classifier or LLM service.
The tool cannot choose arbitrary residents, entities or HA services. Mixed calendar
and automation tool calls are rejected for clarification instead of partial execution.

Queries span at most 31 local calendar days. “Esta semana” means today through
Sunday. Spoken summaries include at most four events and indicate additional
results. Responses and pending proposals stay out of LLM conversation history;
event titles are treated as plain text, never tool instructions. User requests
still follow the configured conversation provider, and spoken answers follow the
selected local or cloud TTS provider.

Creation requires a title and date; timed events require a start time. A missing
end time proposes one hour and announces both times before confirmation. All-day
events require an explicit request and use Google's exclusive end date. Dates use
the home's IANA time zone; ambiguous or nonexistent daylight-saving times are
rejected. New events are limited to seven days and a start within one year. Editing,
deleting, recurrence, guests, reminders and autonomous calendar announcements are
not supported in this version.

Event contents, transcripts and Google credentials are not persisted in Rosie's
metadata log. Logs record only resident/endpoint IDs and lifecycle outcomes. HA and
external providers have their own storage policies. No shared query cache is used.

## Validation and operation

`resident-calendar.test.ts` covers resident/home isolation, read-only access,
single-use confirmation, expiry and changed context, cancellation, revalidation,
uncertain delivery, revisions, dates and LLM history exclusion. The provider tests
use an isolated HA WebSocket fixture to verify Google discovery, actual service
payloads and one dispatch. HTTP tests cover owner authentication and Origin checks.
The calendar and voice browser tests exercise resident tabs at desktop and mobile
widths, preserving drafts and errors without a real Google account.

After authorizing an account, bind its calendar and ask “Qual é minha agenda hoje?”.
For creation, ask for a deliberately chosen test appointment, check the complete
proposal and explicitly confirm only if it should be saved. Verify it in Google
Calendar. Do not create real test events without the user's approval. No firmware
reflash is needed for this feature. Automated fixture results do not establish that
the user's Google account is connected.

### Local rollout — 2026-09-25

The application build, TypeScript checks, 323 web tests, ten shared-contract tests,
and calendar/voice browser scenarios at both desktop and mobile widths passed.
The calendar's sixteen focused tests were repeated after correcting the response
to a refusal following an already-consumed confirmation. Source secret scanning,
documentation and browser import-boundary checks passed. The handbook skill's
workspace validator reports the intentionally absent mobile app; decision 001
documents that exception. No remote CI or Git publication is claimed.

A consistent private SQLite backup passed `quick_check` before restarting only
`rosie-app.service`. Authenticated live verification found the Rosie endpoint idle,
speech and speaker identification ready, and HA discovery connected for both Caio
and Luana. No Google calendar entities or resident bindings existed yet. The owner
is creating the Google project/application credentials; account consent, an actual
calendar query and confirmed creation remain pending. No real event was created
and no firmware was flashed during this rollout.
