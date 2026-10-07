# Installation accounts

Panel users are distinct from residents, voiceprints and device credentials.
Each account has a unique case-insensitive ASCII username (3–40 characters), a
display name, an administrator/member/viewer role and an enabled flag. Usernames permit
letters, digits, dots, hyphens and underscores. Passwords are 8–128 characters,
are never trimmed and are stored only as salted hashes.

## First administrator

After deploying the database migrations, run on the application host as its normal
service user:

```sh
cd /home/caiofrota/workspace/desk-robot
pnpm user:create-first
```

The terminal asks for name, username, password and password confirmation. Password
input is hidden; command-line arguments, redirected input and non-interactive
execution are refused. No fixed account or default password is created. The
database transaction checks both account count and a durable bootstrap marker.
A second run refuses to create another user. After signing in, use **Usuários**
to create the remaining accounts. There is no public account-creation endpoint.

## Access and lifecycle

- Administrators manage the existing catalog, integrations, robot actions and user
  accounts across this installation. Editing an account requires its current
  revision; stale updates fail instead of overwriting another administrator.
- Viewers can read the catalog, effective endpoint configuration and status. They
  cannot use conversation previews, run robot tests, pair devices, configure
  integrations, enroll voices, edit calendars or manage users. The API enforces
  this independently of hidden UI actions. Integration settings and credentials
  are not part of viewer access.
- Personal members can converse and manage their own assistants and integrations,
  without access to household catalog/status or installation administration. See
  [personal assistants](personal-assistants.md) for the household access grant.
- All roles can manage their own personal profiles/integrations and change their
  own password through **Minha conta**, verifying
  the current password first. All their sessions end afterward. Administrators
  can reset another account's password through **Usuários**.
- Disabling an account or editing its identity/role/password revokes its sessions.
  An enabled administrator must always remain. Accounts are not deleted, so the
  bootstrap command cannot become a way to recreate access after disabling users.
- User listing follows the existing responsive table layout, URL filters/sorting,
  page sizes 10/20/50/100, labeled mobile fields and accessible icon row actions.

## Credentials and sessions

Use Node's asynchronous scrypt with a random 16-byte salt, 32-byte result,
N=32768, r=8, p=3 and a bounded two-operation concurrency limit. This is the
32 MiB profile in [OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
Unknown users perform the same hash work as invalid passwords; login errors are
generic. Existing per-address rate limits apply before hashing. Hashes and raw
passwords are excluded from administration responses and metadata audit events.

Iron Session seals an opaque random session credential; SQLite stores its SHA-256
digest with the user relation and eight-hour expiry. Every authenticated request
checks expiry and current account status/role. Logout, role changes and password
changes revoke database sessions. Mutations require the configured Origin.
The existing LAN HTTP exception remains; HTTPS deployments set Secure cookies.

`ROSIE_ADMIN_TOKEN_FILE` is retained as a private installation signing key, never
as a login credential. Do not delete or rotate it as part of creating users.
Worker and ESP32 authentication remain separate and unchanged.

## Migration and recovery

The `202609300001_user_accounts` migration adds tables and clears legacy shared
admin sessions. It does not alter household entries, settings, device pairing or
resident voiceprints. No password is automatically copied into a user record.
Until the owner runs the bootstrap command, the panel rejects all logins while
the robot and background integrations continue normally.

Before applying it, preserve an online SQLite backup and the previous build.
Build into a separate `ROSIE_NEXT_DIST_DIR` when an existing server is active;
the default remains `.next`. Stop/restart only the Node app during activation,
preserving the speech worker. Rollback requires the matching old application and
database backup, because returning to shared-password code changes the access
model. Never use the migration clone's database for this installation.

If every administrator forgets their password, an operator must recover through
a verified private backup or a separately reviewed local recovery procedure;
the first-user command deliberately does not bypass existing accounts.

## Validation

Isolated SQLite/API tests cover bootstrap uniqueness, hashing, old-password
rejection, session rotation/revocation, username collisions, last-administrator
protection, optimistic revisions and viewer action denial. Browser tests exercise
creation, sorting, pagination, password visibility and viewer navigation at desktop
and mobile sizes. Household services are mocked for browser tests.

## Local installation — September 30, 2026

Activated the staged `.next-users` build and migrated the original standalone
database. The private recovery directory is
`native/data/user-accounts-backup-20260930`, containing an online SQLite backup,
the previous environment, the preserved pre-migration source archive and a catalog
digest. Post-installation integrity checking passed; all 25 catalog records match
that digest. Legacy panel sessions were cleared. No installation user was created
by the installer: the owner must run the interactive first-user command.

Only `rosie-app.service` was restarted. `rosie-voice.service` retained its existing
process and start time. No firmware, pairing, household integration or assistant
identity change was part of this update.

Validation passed for the 14 account/API/terminal checks, 10 shared-contract tests,
171 Python regression tests, and the desktop/mobile administration and robot
connection checks. The final users screen also passed both browser viewports after
the self-password flow was restricted to **Minha conta**. Password hashing tests
use a 15-second per-case limit because they perform several real scrypt operations
on the CPU-only host. Production build, type checks, source lint, document links
and secret scanning passed. The existing optional template-string lint suggestion
in the HA adapter was left unchanged.
