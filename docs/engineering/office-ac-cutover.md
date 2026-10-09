# Office AC cutover — 2026-09-24

The owner authorized replacing the parallel trial after confirming a physical
22 °C command. The maintained control is now `climate.ac_escritorio`, platform
`tuya_smart_ir_ac`, named **AC Escritório**. The pinned integration version and
source remain those recorded in decision 017 and the validation log.

## Active and retained paths

| Consumer                              | Current route                                                         |
| ------------------------------------- | --------------------------------------------------------------------- |
| Rosie                                 | Existing `ac-escritorio` registration → HA climate service → Tuya IR  |
| HA cards and scenes                   | Existing `climate.ac_escritorio` entity ID                            |
| Alexa via Home Assistant Cloud        | Same entity ID, aliases and exposure; thermostat and power interfaces |
| Node-RED room-aware Alexa temperature | One office `climate.set_temperature` call with `hvac_mode: cool`      |
| Node-RED office state condition       | Reads the active climate's `cool` state                               |
| Legacy office bridge                  | Disabled tab **AC Escritório — Legado (desativado)**                  |
| Bedroom bridge                        | Original **Config AC** tab, still enabled                             |

The legacy tab retains the eight original office bridge nodes plus the former
Alexa power-before-temperature node. The generic thermostat remains defined in
HA YAML but is disabled in the entity registry as `climate.ac_escritorio_legado`.
Its helper and all Tuya scenes are retained. The old virtual target is not mirrored
into the new entity. Home Assistant's entity lifecycle removes the disabled
thermostat and its subscriptions; it must remain disabled after restart.

Alexa's installed HA implementation derives endpoint IDs from entity IDs. The
transfer preserved `climate#ac_escritorio`, the friendly name, and aliases, avoiding
an endpoint deletion during the rename. Re-pairing the skill or the S06 Pro is not
expected. Ask Alexa to adjust **ar do escritório** to a chosen temperature and
check both the HA target and the physical appliance. A successful HA service call
does not prove acoustic recognition or infrared reception.

## Scene deletion audit — 2026-09-25

Read-only checks of the live Node-RED revision, HA configuration and Rosie catalog
found the office temperature and off scenes only in the disabled legacy bridge.
HA inspection covered 15 API-readable automation/script/scene configurations,
17 YAML files (including the API-inaccessible intent script), and configured
Lovelace dashboards. Rosie had no old scene references in its 23 catalog records
or six settings records; its office temperature-scene map was empty.

The default Lovelace dashboard still references
`scene.app_ac_turbo_escritorio` in two Mushroom cards. Preserve that scene unless
those controls are deliberately replaced or removed. The bedroom temperature and
off scenes remain in active use by its original Node-RED bridge.

The new office climate route does not require the old temperature/off scenes,
but deleting them invalidates the ready-to-use legacy rollback below. A Node-RED
backup cannot recreate deleted Smart Life scene actions. Keeping the disabled
bridge and its scenes preserves the requested recovery option. This audit did
not delete scenes, modify dashboards, dispatch services, or inspect independent
Smart Life/Alexa routines outside these three systems.

Private evidence is in `native/data/office-scene-*-audit-20260925.json` and
`native/data/office-scene-dependency-audit-20260925.json`; the read-only helper is
`native/data/audit-office-scene-dependencies.mts`.

## Private recovery artifacts

- HA: `/config/.rosie-install-backups/office-ac-cutover-1790281325/`, including
  configuration, registries and exposure/cloud preferences. Directory mode 0700,
  files 0600. Never restore `.storage` over a running HA process.
- Node-RED container in LXC 200:
  `/data/rosie-office-ac-cutover-20260924/`. Contains the initial full active-flow
  backup, exact before/after touched-node subsets, deployment result and
  `migrate.cjs`. The guarded merge checks each affected node against its expected
  current value, submits the current API revision, and preserves unrelated edits.
- Rosie checkout: private `native/data/office-ac-cutover-20260924/` contains
  entity/device snapshots and the bounded service-test result.
- Local HA helper: `native/data/office-ac-ha-cutover.mts`. Run from `apps/web`
  so the normal application configuration resolves correctly. Credentials are
  read from the existing private runtime configuration, never command arguments.

## Rollback order

Do not simply enable the old Node-RED tab while the new integration owns the
main entity: that would send an additional legacy scene for each target change.
These commands are recovery instructions; rollback was not executed during the
successful cutover.

1. Confirm the legacy tab is still disabled. On Proxmox:

   ```sh
   pct exec 200 -- docker exec nodered node /data/rosie-office-ac-cutover-20260924/migrate.cjs status
   ```

2. In the Rosie checkout, from `apps/web`, restore entity ownership and save the
   new control's current mode/target for restoration:

   ```sh
   pnpm exec tsx ../../native/data/office-ac-ha-cutover.mts rollback
   ```

   The new integration returns to its original trial ID. The old entity regains
   the original ID, metadata and exposure. Keep the legacy Node-RED tab disabled.

3. Restart Home Assistant to load the re-enabled YAML thermostat. Its YAML
   default is 17 °C, so restore the saved mode/target before re-enabling the bridge:

   ```sh
   pnpm exec tsx ../../native/data/office-ac-ha-cutover.mts rollback-state
   ```

   This only restores the virtual thermostat while the scene branch is disabled.
   The helper verifies that no office scene is triggered. If a precondition fails,
   inspect current state; do not repeatedly replay the command.

4. On Proxmox, restore the original office nodes and routing with the guarded merge:

   ```sh
   pct exec 200 -- docker exec nodered node /data/rosie-office-ac-cutover-20260924/migrate.cjs rollback
   ```

5. Verify one requested temperature through Rosie or Alexa produces exactly one
   matching legacy scene, and confirm physical reception. The backup does not fix
   broken Smart Life scene references; validate them if they caused the rollback.

The rollback preserves other-room edits and rejects concurrent changes to affected
nodes. It does not restore the whole old flow file or roll back unrelated HA
configuration. No robot reflash or device pairing is part of either path.
