# Personal assistants and integrations

## Using the web companion

**Assistentes → Padrão da instalação** configures the fallback (administrators only).
**Assistentes → Seus assistentes** belongs to the signed-in account: create assistants, choose
their names, voices, personality and conversation provider/model, and select a
personal default. The companion uses that selection without an endpoint, home or
room. Physical endpoints retain their existing household catalog profiles. Those profiles
are labeled shared assistants and can also be selected for the authenticated web
companion. Selecting a shared profile does not share the account integrations or
conversation history. Personal default selection accepts either an owned private
profile or an enabled shared catalog profile; the server validates the reference.

Create a separate account for each person in **Usuários**, using **Usuário
pessoal** for companion access without installation administration. Personal users
can converse and use the installation's Home Assistant controls, but cannot inspect
the catalog/status, pair endpoints, change installation settings or manage users.
The installation owner is therefore granting household companion access when
creating this role. Viewers retain read-only household access and can configure
their personal profiles/integrations, but cannot converse or execute home commands.

Profiles are stored under authenticated user IDs, with optimistic revisions.
Private default selection must reference an assistant in the same profile.
Shared defaults must reference an enabled installation assistant. The server
assigns new assistant IDs and rejects foreign companion selections. The fallback
editor changes only its profile and preserves all other installation settings.

## Connecting Google and Microsoft

Each person opens **Configurações → Minhas contas** while signed in and authorizes their own
Google and/or Microsoft accounts. Up to ten accounts per user are supported,
including multiple accounts from the same provider. Provider authorization is an
integration link, never an application login or an administrator grant. A provider
identity cannot be silently merged into another Jarvis user by email address.

An administrator first opens **Configurações → Aplicativos Google e Microsoft**
and configures each provider application. This is separate from personal account
authorization, and never connects a mailbox by itself.
Client secrets never return to the browser; an empty secret preserves the existing
secret only when the client ID remains the same. Changing the client ID requires
reconnecting existing accounts. The exact callback is derived from `ROSIE_ORIGIN`:

```text
https://your-jarvis-domain/api/v1/personal-integrations/callback
```

The present LAN IP and its self-signed certificate are not a production OAuth
configuration. Register a provider-compatible HTTPS domain, or use localhost for
development. The server must be reachable through the configured origin, and the
browser must trust its certificate.

For Google, create a **Web application** OAuth client, enable Gmail and Google
Calendar APIs, configure the consent screen, and register that exact callback.
During testing, add both people's addresses as test users. Gmail scopes may
require verification before public distribution. See the official
[web server authorization guide](https://developers.google.com/identity/protocols/oauth2/web-server)
and [Gmail authorization guidance](https://developers.google.com/workspace/gmail/api/auth/about-auth).

For Microsoft, register a server application supporting the account types you
intend to connect (including personal Microsoft accounts when applicable), add
the callback as a **Web** redirect, and create a client secret. Delegated
permissions are `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite` and
`offline_access`; organizational policy may require administrator consent. See
the official [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
and [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).

Google authorization requests verified email identity, Gmail read/send, calendar
events and calendar-list read scopes. PKCE S256, random state and authorization
code/refresh processing use `oauth4webapi`. The callback exchanges the code once,
then redirects with an expiring continuation. Only an authenticated request from
the user who started the flow can persist the link. OAuth state expires after ten
minutes; continuations expire after five. A restart discards incomplete flows.

## Reading and confirming actions

The personal accounts page lists the first ten inbox messages, opens text-only message bodies, lists
up to fifty calendars and shows up to thirty events over the next seven days.
HTML, attachments and remote resources are not displayed. Lists are bounded and
may be incomplete. All provider calls use official HTTPS endpoints and timeouts.

For conversational planning, `personal_agenda` reads an explicit interval of at most 31 days across the authenticated user's connected accounts. Daily summaries include the entire reference-timezone day, including all-day and earlier events. The server supplies up to three focus candidates using provider attendance, calendar ownership/default selection, availability and timing, without classifying event titles. Subscribed calendar owners are not mistaken for the connected account. Unnamed blocks remain availability data and may explain a conflict, but are excluded from spoken highlights. Cancelled/declined events are excluded. Public or secondary calendars do not prove personal attendance. Conflicts concern busy personal events, excluding transparent background events. Summary tool results omit the full event list; `view: full` retains it for explicit detailed requests. The model delivers two to four conversational sentences, converting times to the reference timezone and avoiding numbered inventories and generic closing questions. Queries inspect at most 30 calendars, three at a time, return at most 100 events, and report unavailable calendars and potentially truncated provider responses. General summaries do not require choosing one calendar; explicit account restrictions remain owner-validated. No background agenda retrieval or calendar writes are introduced.

Mail sending and event creation have a review step showing the account and draft.
Only the explicit confirmation dispatches the operation. Proposals expire after
five minutes, belong to one user and connection revision, and can be consumed only
once. Calendar write permission is checked before both review and execution.
Delivery uncertainty never causes an automatic retry: inspect Sent/the calendar
before preparing another action. Provider acceptance does not prove delivery to a
recipient. Event editing, deletion and attachments are outside this feature.

The companion can perform bounded **read-only** personal tool queries when the
user requests them. It receives only its user's connection identities; tool calls
recheck ownership at the service boundary. Email/calendar contents are treated as
untrusted data, never instructions. No sending or event-creation tool is exposed
to the conversation model; those actions require confirmation on the page. Personal
content is sent to the configured conversation provider only as part of requested
queries. Conversation replies stay in the existing private in-memory session.

## Storage and operation

Tokens and application secrets are encrypted with AES-256-GCM using a key derived
from the private installation credential; authentication binds ciphertext to its
application or user/connection identity. Keep the database and installation
credential together in private backups. Rotating that credential invalidates
existing sessions and encrypted integrations, requiring reconnection. The database
contains private account metadata and must never be committed or published.

Disconnecting removes stored tokens and the identity reservation from Jarvis and
invalidates pending actions. It does not revoke provider-wide consent; users can
remove that in their Google/Microsoft application settings. Refresh calls are
coalesced, and a transaction prevents a late refresh from restoring an unlinked or
reconnected account. Disabled users cannot begin, finish or dispatch personal work.

The member-role migration rebuilds the SQLite user table while preserving account
IDs, hashes, revisions and sessions. Before activation, take an online SQLite
backup; apply `pnpm db:deploy` using the installation's `DATABASE_URL`. No
household entry or endpoint credential is changed. Rollback uses the matching
application/database backup; older code does not recognize member accounts.

Validation uses isolated databases and mocked provider responses, including both
providers, foreign ownership, replay, encryption/redaction, stale profile changes,
permissions, confirmation and uncertain delivery. Browser checks cover desktop and
mobile layouts. Real provider consent and real microphone quality require the
owner's accounts/hardware and are not inferred from those tests. Native mobile and
desktop clients do not yet consume these personal integration screens.

## Personal calendar selection

In Settings → My accounts, open an account's calendars and save a mode for each:
priority, normal, or excluded. The selection is persisted per installation user and
connection, applies to aggregate summaries and direct event reads, and never changes
the upstream calendars. Existing connections remain enabled until configured; once
a selection is saved, newly discovered calendars default to excluded. An empty
selection disables calendar consultation for that connection. Disconnecting removes
its preferences. Calendar discovery remains available to edit the selection.

Priority is an explicit user preference, not a title classifier. Reminder calendars
can be excluded or left normal while important calendars are marked priority.
Provider organizer metadata identifies the calendar record's organizer; it must not
be presented as evidence that the user hosts the real-world event. Only a verified
attendee response establishes accepted/tentative participation.
