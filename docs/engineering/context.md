# Engineering context

## Product and runtime

- Product locale: Brazilian Portuguese (`pt-BR`). User-facing copy and product data may remain in Portuguese.
- Maintained surfaces: a Next.js browser application, a Node.js local server, an Electron desktop application, and a Python voice runtime.
- The browser and local server listen on loopback by default. `PORT` is read from the process environment and defaults to `4318`; no dotenv loader is used.
- The Python voice runtime targets Python 3.11 and is installed into `.voice-env` from the locked project in `voice/`.
- There is no user account, multi-tenant organization, database, or public deployment in this repository.

## Repository boundaries

- `app/`, `components/`, and `features/` contain the browser UI.
- `server.ts` and `lib/` contain the local Node.js services.
- `desktop/` contains the Electron main and preload boundaries.
- `voice/` is the independently locked Python runtime for local speech features.
- `tests/` contains the deterministic Node test suite; hardware and real-provider acceptance remain separate.

## Supported commands

- `pnpm dev` runs the local development server.
- `pnpm start` runs the built local web/server artifact.
- `pnpm desktop` runs the packaged Electron application.
- `pnpm preview` is an alias for the built local web/server artifact.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` are required validation commands.
- `uv sync --project voice --locked` provisions the locked Python voice environment.

## Environment ownership

Provider-specific security controls and their temporary limitation are recorded in
[ADR 001](decisions/001-selective-security-updates.md).

- `PORT` belongs to the local web/server runtime.
- `JARVIS_TEST_DATA` and `JARVIS_TEST_HIDE` belong to non-packaged Electron tests.
- `JARVIS_TEST_LOCAL_MODEL` enables optional tests that require a locally installed model.
- Host variables such as `PATH`, `SystemRoot`, and `APPDATA` are supplied by the operating system and are not application configuration.
- Process variables take precedence because the application reads them directly; local dotenv files are not loaded automatically.
