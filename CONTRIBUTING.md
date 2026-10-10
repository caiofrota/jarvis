# Contributing to Jarvis

Thank you for helping improve Jarvis. Start with the [README](README.md) to run
it, and read our [community contribution guide and code of conduct](https://gist.github.com/caiofrota/6e65a17fd3bf100d058cb48dcc780b21).
For private conduct reports, contact [contato@caiofrota.com](mailto:contato@caiofrota.com).

## Before you change something

Small fixes and documentation improvements can go directly to a pull request.
Discuss new features, architectural changes, removed functionality and breaking
changes in an issue first. Explain the problem, expected behavior and tradeoffs.

Read the root and relevant scoped `AGENTS.md` instructions, project context and
applicable decisions. Keep server/database code outside browser and native shells.
Respect account ownership, action confirmation and the existing license boundaries.
Use English for documentation, identifiers, commits and pull request descriptions;
product UI copy follows the project's Brazilian Portuguese locale.

## Development and validation

Use the pinned prerequisites in the README and install with
`pnpm install --frozen-lockfile`. Relevant checks include:

```sh
pnpm db:generate
pnpm format:check:brain
pnpm lint:brain
pnpm typecheck:brain
pnpm test:brain
pnpm build:brain
pnpm project:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

For UI journeys, run `pnpm test:e2e:brain` with Playwright Chromium installed.
For native clients, use `pnpm mobile:check`; for Python changes, use
`pnpm python:check` and the checks for the affected worker. Follow
[the CI workflow](.github/workflows/ci.yml) for the full required validation.
Use isolated data and simulated external providers/devices for automated tests.
Build/test success does not prove microphone quality, physical playback or device
execution; report actual platform and hardware validation separately.

## Pull requests

- Keep the change focused and explain the user-visible problem and resulting behavior.
- Add meaningful regression coverage when behavior changes; do not add tests for prose edits.
- Update setup instructions, contracts and safe configuration examples when needed.
- Include validation results and any limitations or required follow-up.
- Use English [Conventional Commits](https://www.conventionalcommits.org/).
  Maintainers manage release versions; routine changes do not require a version bump.
- Wait for the required CI checks and resolve review feedback before merging.

Never commit private credentials, OAuth tokens, recordings, calendar/mail contents,
databases, downloaded model weights or generated binaries. Keep the MIT and native
GPL notices intact; new code must be compatible with its destination's license.

## AI-assisted contributions

AI tools are welcome. Disclose substantial use in the pull request and remain
responsible for every submitted change. Understand the code, verify references and
APIs, review the complete diff and run the appropriate checks. Do not claim tests
or hardware acceptance that you did not perform.

Do not upload private runtime data or credentials to a model, and do not let an
agent publish, deploy, contact people or control real devices beyond the authorized
scope. Avoid phrase-specific patches or invented capabilities: use authoritative
runtime catalogs and validate effects through the owning executor. See the
[general AI contribution guidance](https://gist.github.com/caiofrota/6e65a17fd3bf100d058cb48dcc780b21#ai-assisted-contributions).
