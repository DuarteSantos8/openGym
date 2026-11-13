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

## Final verification (Linux, Node v22.23.5)

Implementation/fixtures tested at `ffcf68ea`; subsequent changes are evidence documentation only.
Existing dependencies installed successfully with `npm ci` in root, frontend, api and mcp.
One full run of each suite, sequentially, max two workers. No skipped tests or exclusions.

| Command (directory) | Exit | Actual result |
|---|---:|---|
| `npm test -- --maxWorkers=2` (frontend) | 0 | 657 files, 7,876 tests passed; 364.83 s |
| `node --test --test-concurrency=2 test/*.test.js` (api; npm test's runner with explicit worker cap) | 0 | 833 passed, 0 failed/cancelled/skipped, 9 suites; 132.08 s |
| `npm test -- --maxWorkers=2` (mcp) | 0 | 6 files, 140 tests passed; 3.51 s |
| `RAYON_NUM_THREADS=2 npm run build` (frontend) | 0 | Built in 2.43 s; existing chunk-size/ineffective dynamic-import warnings |
| `node scripts/check-locales.mjs` (frontend) | 0 | 19 locales, 3,615 keys in sync |
| `node scripts/check-source-strings.mjs --strict` (frontend) | 0 | 2,961 translated strings present |
| `node scripts/catalogue/build.mjs --check` (root) | 0 | 5,632 exercises, generated files current |
| `node scripts/build-coach-assets.mjs --check` (root) | 0 | 5,632 exercises / 8 prompts in sync |
| `node scripts/build-api-docs.mjs --check` (root) | 0 | 92 endpoints / 32 schemas / 356.9 KB in sync |
| `git diff --check origin/next/integration` | 0 | No whitespace errors |

Linux baseline CI 43498778572: frontend 7,832 tests/651 files, API 800, MCP 138/5 files.
Deltas: frontend +44 tests/+6 files; API +33 tests; MCP +2 tests/+1 file. Existing tests unchanged.
Logs are retained in this checkout's `/tmp/ep01-full-{frontend,api,mcp}.log` and
`/tmp/ep01-build.log`; other check logs use `/tmp/ep01-*.log`. These are local evidence paths,
not files available to new cloud threads. Parent independently reran focused cases.

Bundle comparison uses all emitted `.js`/`.css`, including service worker, with Node gzip level 9,
matching `docs/product/baseline-evidence/bundle.json`: 155 files unchanged; raw
29,262,336 → 29,265,815 bytes (**+3,479**); gzip 5,884,077 → 5,885,365 (**+1,288**).
The sync chunk is 53,971 raw / 18,480 gzip bytes (baseline 50,204 / 17,315).
This is the total emitted bundle, not initial page transfer.

### RED/GREEN and independent evidence

- `259e55a3`: real optional-list add/add loss, missing opt-in behavior, and unknown-field loss;
  frontend optional/default-off RED 13 failed/2 passed; API RED 10 failed/2 passed;
  preservation/backup RED 2 failed/7 passed.
- `3f321f0b`: reset/prefer/restore/malformed/replay boundary proofs, frontend RED 21 failed/3 passed.
- `77c85ff0`: real HTTP missing optional entry field RED (`undefined !== 42`).
- `411aed42`: initial GREEN hooks. Its commit message has one count typo: expanded parity run
  was **32**, not 33. Other selected runs were frontend 143, API 45, MCP 2 passed.
- `775ade9c` → `f7c5603e`: parent found preferred-account reset loss and zero-clock field loss;
  both reproduced RED (2 failed/22 passed), then corrected on both sides, including initial HTTP PUT.
- `dbcc987a` → `f7c5603e`: 150,000-field `_f` map under MAX_BODY overflowed Math.max arguments;
  RED 1 failed/24 skipped, then iterative maximum; real HTTP large-map path now passes.
- `58c84cfd` → `142b3e7f`: optional reset id 20,001 was evicted; RED expected 20,001/got 20,000,
  then uncapped optional inventory; optional suite 26 passed.
- Parent independently rechecked `ffcf68ea`: 43 focused frontend, 33 API, direct assertions for
  its three findings, all passed. This is parent evidence, not an extra full-suite run here.
- Parent browser smoke at `ffcf68ea` on Node 22 passed: loaded baseline guest profile, started
  another workout, logged 40×10 offline, reconnected/saved/reloaded; old 800 kg and new 400 kg
  workouts persisted with `active=null`. Parent stopped its test tab/servers and owns the
  browser-smoke JSON/report to be committed separately to integration after this branch's final push.

Draft PR: https://github.com/sorensadrgit-art/openGym/pull/5, targeting `next/integration`.
No merge/deploy/public preview. No runtime store/server/MCP edits, dependencies, media or secrets.
All edits stay in authorized source/documentation paths or new tests/fixtures.

### Remaining gates and integration notes

Cross-vendor review is **BLOCKED**, not passed: the Claude provider limit lasts until 23:20 UTC;
the assigned Pi reviewer has no OpenAI credentials and produced no review. Parent focused review
and browser smoke are separate evidence. Native devices and live provider services are UNVERIFIED.
No UI surface was changed, so this task produced no screenshot/media artifacts.

Later EP-04/EP-07 consumers must use `visibleOptionalEntries`, explicitly validate domain inputs,
and implement stable import identity before enabling modules. Logical deletion/reset retain payloads;
no automatic compaction or hard erasure is promised. Upgrade participating clients/server before
concurrent optional edits; old binaries do not gain hooks. Existing webhook status and error-text
limitations are documented without out-of-scope runtime changes. Parent owns progress.md and merge.
