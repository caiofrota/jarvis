# Scoped handbook decisions

This file points to project decisions; it does not restate handbook standards.

- `shared.security.authentication`: invitation-only local username accounts, with
  no email addresses, public registration or social login. A terminal-only command
  bootstraps the first administrator; subsequent accounts are managed in the panel.
  See decision 020 and `user-accounts.md`. Decision 003's LAN transport exception
  and separate machine credentials remain in force.
- `shared.configuration.environment-variables`: the local worker credential derives
  from the existing private installation credential; it is never a committed default.
- The non-normative cross-platform architecture reference: SQLite instead of
  PostgreSQL, no mobile application, and a persistent custom Node server. Decisions
  001–002 define the deployment constraints and removal conditions.
- Secure-cookie default in that architecture reference: HTTP compatibility is limited
  to the existing private LAN deployment. Decision 003 requires TLS before exposure.
- `shared.user-interface.application-navigation` and
  `platform.web.user-interface.admin-surfaces`: the legacy Python static panel and
  ESPHome dashboard are retained rollback/history artifacts, not parallel active UI.
  The new React panel is the maintained administration surface (decision 005).
