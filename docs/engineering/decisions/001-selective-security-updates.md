# Selective security updates on a private personal repository

Status: accepted temporary provider limitation (2026-10-05).

## Context

`caiofrota/jarvis` is a private repository owned by a personal account. GitHub's
custom Dependabot auto-triage rules are available for public repositories or
eligible organization-owned repositories with GitHub Code Security. They are not
available for this repository's current ownership and visibility.

Reference: [GitHub auto-triage availability](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-auto-triage-rules).

## Decision and temporary controls

Keep vulnerability alerts enabled for every severity. Disable the general
security-update switch because it opens pull requests for every fixable severity.
Do not configure scheduled version-update pull requests. The repository owner
reviews dependency alerts when changing dependencies and before releases, and
opens reviewed fixes for high or critical alerts with a compatible patch. Node
and uv lock changes pass the ordinary required `ci` check.

## Risk and restoration condition

Remediation depends on maintainer review rather than automatic selective pull
requests. Restore automated high/critical patched-alert rules when the repository
becomes public or moves to an organization with the required security license.
Reassess this decision whenever ownership, visibility, or GitHub feature
availability changes; remove this exception after configuring and verifying those rules.

## Open advisory without a patch

On 2026-10-05, Dependabot alert 1 reports high-severity cross-user cache disclosure
in `http-cache-semantics <=4.2.0`, with no patched version available. The lock
contains 4.2.0 as a transitive development dependency. Electron packaging excludes
`node_modules`; this package is not shipped in the application. Keep the alert
open and visible, avoid authenticated shared caching in build tooling, and update
the owning dependency and lock as soon as a compatible fix is available. The
repository owner reviews this alert before releases.
