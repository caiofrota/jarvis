# Local installation and rollback

The live installation is user-owned systemd on the miniPC VM. The Node application
uses port 8765; only the Python worker uses loopback port 8766. Neither step requires
a firmware flash. The legacy endpoint ID, token, pairing URL and WebSocket path survive.
Do not start two copies of the Node application against the same database.

## Prepare and validate

1. Install Node 22.23.2, pnpm 11.22.0 and uv 0.8.22. Run `pnpm install --frozen-lockfile`
   at the root, `uv sync --locked --project native`, and `pnpm db:generate`.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:check`, `pnpm build` and
   `pnpm test:e2e`. Browser tests use a disposable database and simulated speech/devices.
3. Back up `native/data/catalog.json`, the existing service unit and credentials to
   a directory readable only by the installation owner. Use `tools/prepare-local.py`
   only on this existing installation; it refuses to overwrite configuration.
4. Review the owning `.env.example` files for another host. Provision the admin
   credential privately; do not use the example placeholders as real passwords.
   Configure the origin to the exact panel URL, and ensure credentials are at least
   16 characters. For a fresh home, initialize the catalog through `DATABASE_URL=file:/private/application.sqlite pnpm db:init`
   after `pnpm db:deploy` instead of importing another household's credentials.
5. Set `DATABASE_URL` to the intended SQLite file, run `pnpm db:deploy`, and set
   `ROSIE_LEGACY_CATALOG` to the existing JSON before `pnpm db:import`. Import is
   explicit, backs up the JSON, refuses nonempty destinations, validates references,
   and writes atomically. It does not remove or modify the source JSON.
6. Build the Next application before starting the Node service. Apply schema changes
   explicitly before service startup; startup never runs a destructive migration.

## Switch services

Copy the reviewed units in `deploy/systemd` to the user's unit directory and run
`systemctl --user daemon-reload`. Stop `rosie-native.service`, then start
`rosie-voice.service` and `rosie-app.service`. Check worker health, login, redacted
catalog responses, endpoint connection/codec negotiation and metadata logs. Only then
enable both new units and disable the legacy unit. Keep downloaded model files in place.

The application reuses the existing owner password. A browser must log in again with
its new cookie session. Endpoint reconnection is automatic and should not require a PIN.
If voice tests fail, distinguish network/processing/playback from physical audibility.
Never conclude that a received playback acknowledgement proves audible sound.

## Return to the previous runtime

Stop `rosie-app.service` and `rosie-voice.service`; start `rosie-native.service`.
It uses the unchanged original JSON and credentials, so changes made only in the new
panel are not reflected there. Export/back up the SQLite database before rollback;
never overwrite the JSON with a lossy reverse migration. Re-enable the intended units
once acceptance is clear. Rollback does not restore Wi-Fi, amplifier power, or firmware.

## Backup

Back up the SQLite file using SQLite's backup API or while the application is stopped,
and retain owner/worker credentials with restricted permissions. Never copy a live
SQLite file without accounting for its journal. Conversations are intentionally absent.
A restored physical endpoint retains its unique credential; do not clone it into a
second box. For multiple boxes, create a new endpoint and issue its own pairing PIN.
