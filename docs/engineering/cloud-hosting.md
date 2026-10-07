# Hosting an endpoint for a household without a home server

Recommendation for this implementation: host the panel on Vercel, keep a persistent
Node device gateway and the Python speech worker on a small hosted machine, and use
private service networking plus a persistent database. The endpoint then needs Wi-Fi
and power, and connects outward over authenticated WSS. For the first separate
household, a dedicated installation is simpler than treating the current single-owner
panel as a multi-tenant product. A VPS can also host the whole application directly.

This is a proposal, not a deployed or costed cloud environment. The existing WROOM
provisioning/transport needs a verified TLS configuration before Internet use.
Household automation also needs a reachable MQTT path: a TLS broker with outbound
connections from compatible devices or a local bridge. Cloud hosting cannot directly
reach arbitrary private-LAN-only devices.

## Vercel feasibility, verified 2026-09-23

[Vercel supports WebSockets in beta](https://vercel.com/docs/functions/websockets),
including Node servers, but a connection ends at the Function duration limit and
reconnection may reach another instance. Persistent coordination belongs outside
process memory. Next.js currently uses an experimental upgrade API there. WebSocket
usage follows Function and transfer billing, so this is not a promise of free,
always-connected operation.

A Vercel-native gateway would require adapting our custom server entry point, moving
SQLite to a durable shared database, coordinating sessions/presence and acoustic
leases, routing panel actions to the owning connection, and testing reconnections
without replaying MQTT commands. Inference also needs an appropriate execution host:
[Function memory, duration and bundle limits](https://vercel.com/docs/functions/limitations)
must be checked against each downloaded model and measured cold-start cost.

Keeping speech on a hosted CPU machine preserves the local-model approach without
requiring equipment at the sister's house. It still has hosting cost. Size and price
should be selected after measuring simultaneous conversations, model memory and
acceptable first-response latency. No external provider credentials or deployment
were created for this proposal.
