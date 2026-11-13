# EP-01 confirmed tasks

Base: cefce38b, assigned branch room/ep-01-data-contracts-and-sync-9djc. Parent owns progress.md.
No dependencies, routes, modules, UI, deployments or media changes.

## Files and interfaces

- `frontend/src/lib/sync-merge.js`, `api/sync-stamps.js`: explicit optional collection keys
  `nutritionEntries`, `activities`, `providerLinks`; generic deterministic field merge using
  `_ts`/`_f`, existing `deleted` tombstones, and stamping hooks. No fields added to old profiles.
  Equal stamp conflicts need deterministic per-field resolution. Preserve tombstoned optional
  records until explicit compaction is designed, so three-way merges cannot lose fields.
  Readers use a visible-record projection; deletion metadata remains in `deleted`.
- `frontend/src/lib/modules.js`: `optIn: true` makes only newly declared modules default off.
- `frontend/src/lib/sync-stamps-parity.test.js`, new optional-contract tests beside both sync
  files: add/add, add/edit, different-field edits, equal-time conflicts, delete/edit, re-add,
  deletion replay, idempotence, commutativity, all three-device permutations, older schemas,
  deliberate restore, collision. Tests must fail on real current behavior before source edits.
- New characterization tests for unknown top-level and collection fields through server stamping,
  client conflicts, state serialization, ZIP/JSON backups, actual store import, MCP disk reads and
  log_workout's GET/409/PUT. Runtime store/server/MCP edits only if a proven loss requires them.
- `frontend/src/lib/__fixtures__/contracts/*.json`: synthetic nutrition/activity/provider-link,
  tombstoned and older-schema examples. No credentials, media or actual user data.
- `docs/product/DATA_CONTRACTS.md`: source inventory, state diagram, extension restrictions,
  normative schemas and provider checklist, tested findings and older-binary limits.
- New provider checklist test under `api/test/`, reusing existing synthetic provider facilities.
- `docs/MODULES.md`: one paragraph on opt-in entries, without adding entries.

## Sequence and evidence

1. Commit this plan before source edits. Parent file plan sent via room-cli and approved.
2. Characterize baseline paths, then commit RED tests with exact assertion output in commit body.
3. Minimum implementation and focused GREEN; preserve existing collection semantics.
4. Contracts and fixtures with explicit links to evidence. Never claim old deployed binaries
   gain new merge support. No new module entries.
5. Node 22, max two test workers. Existing dependencies installed in root/frontend/api/mcp.
   Do not rerun full baseline before changes. CI 43498778572 provides Linux baseline counts.
6. Once at end: frontend full suite/build/locales/strict strings; API full suite; MCP full suite;
   catalogue, coach assets and API docs check-only. Compare emitted JS/CSS raw+gzip to baseline.
7. Review diff, commit everything, pull --rebase origin next/integration, push assigned branch,
   draft PR targeting next/integration. Parent owns independent review and browser baseline.
