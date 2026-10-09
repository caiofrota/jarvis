# Handbook adoption assessment — 2026-09-23

Scope: the entire repository, excluding dependencies, generated clients, model weights,
private data and compiled artifacts. Confidence is high for source/contracts and the
exercised browser flows; physical and provider-operated controls remain separate.
This is a gap assessment, not a certification.

## Adoption hygiene

The manifest now declares the observed web, backend, Python and monorepo profiles.
AGENTS routes through the global canonical mapping rather than a machine-local path.
Project facts and explicit local decisions are linked, not copied from standards.
Archived ESPHome/Python panel material is labeled; the React panel is the active UI.
The user approved adding `shared.communication.persistent-device-connections` to the
canonical handbook; only that standard and its index entry were changed for this task.

## Coverage

| Concern                        | Handbook IDs                                                                                                                              | Result and evidence                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application boundaries         | `repository.monorepo.application-composition`, `repository.monorepo.component-sharing`                                                    | Domain/types/database packages, one full-stack web runtime, private Python worker; decisions 001–002                                                    |
| Environment ownership          | `shared.configuration.environment-variables`, `repository.monorepo.environment-ownership`                                                 | Owning examples in web, database CLI and voice; real files ignored and restricted                                                                       |
| Authentication and permissions | `shared.security.authentication`, `shared.security.authorization`                                                                         | One installation owner, expiring/revocable cookie, Origin enforcement and route capabilities; API tests; decision 003                                   |
| Admin shell and components     | `shared.user-interface.application-navigation`, `shared.user-interface.component-structure`, `platform.web.user-interface.admin-surfaces` | Feature components, common shell, Next navigation, modal workflows and browser checks                                                                   |
| Tables                         | `platform.web.user-interface.data-tables`                                                                                                 | All catalog collections, including intents; server pagination 10/20/50/100, sort allowlist, stable IDs, URL state; labeled mobile rows and icon actions |
| Accessibility/passwords        | `platform.web.accessibility.accessible-elements`, `shared.user-interface.password-fields`                                                 | Labels, Font Awesome names, focus, dialog Escape/backdrop, password reveal; browser evidence                                                            |
| Tests and scripts              | `shared.testing.automated-tests`, `shared.delivery.package-scripts`                                                                       | Root delegation, Vitest, Playwright, Python/C++ regression tests; no placeholder mobile/distribution build                                              |
| Delivery and CI                | `shared.delivery.continuous-integration` and web/backend/Python/monorepo deltas                                                           | Locked dependencies, build/static/tests, single aggregate outcome; no PR deployment or production credentials                                           |
| Supply chain                   | `shared.security.ci-supply-chain`                                                                                                         | Pinned actions/tools, local source scanner fixture, dependency audits; remote alerts/protections not assessable                                         |
| Engineering language           | `shared.delivery.engineering-language`                                                                                                    | Maintainer artifacts/identifiers in English; product copy pt-BR                                                                                         |
| Persistent endpoints           | `shared.communication.persistent-device-connections`                                                                                      | Endpoint credentials, isolated sessions, bounded audio/queue handling, cancellation and reconnect tests                                                 |
| Publication                    | `shared.delivery.publication`                                                                                                             | Local installation authorized; no Git/cloud publication. Vercel is a researched proposal only                                                           |

## Explicit limits and follow-up

- Private-LAN HTTP compatibility, one SQLite writer and one owner are deliberate,
  bounded local decisions. Public hosting requires the changes in `cloud-hosting.md`.
- Remote branch protection, actual CI runs, vulnerability-alert settings and selective
  security-update rules are **not assessable** without a configured repository provider.
  Routine version-update PRs are disabled in the supplied Dependabot configuration.
- The architecture skill's static validator assumes a mobile app and unused shared
  packages. These are intentionally absent; decision 001 applies. Its failure does
  not authorize creating phantom applications or changing the handbook's skill.
- Acoustic arbitration is simulated with two endpoints; only one physical ESP32 is
  available. Nearest-microphone selection and biometrics are not implemented.
- A configured city provides identity context, not a live weather feed. Weather must
  use a registered sensor/intent or a separately implemented data integration.
- Python strict typing covers the new worker boundary. Retained legacy modules keep
  their regression tests; the reused speech engine has typed public PCM boundaries
  but its third-party model adapters remain dynamically typed.

Installation and physical acceptance status belong to `validation.md`. No hardware
success is inferred from builds or simulated playback.
