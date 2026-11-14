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

## Initial verification (2026-11-13; Linux, Node v22.23.5)

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

### Gates recorded at the initial checkpoint (superseded below)

Cross-vendor review is **BLOCKED**, not passed: the Claude provider limit lasts until 23:20 UTC;
the assigned Pi reviewer has no OpenAI credentials and produced no review. Parent focused review
and browser smoke are separate evidence. Native devices and live provider services are UNVERIFIED.
No UI surface was changed, so this task produced no screenshot/media artifacts.

Later EP-04/EP-07 consumers must use `visibleOptionalEntries`, explicitly validate domain inputs,
and implement stable import identity before enabling modules. Logical deletion/reset retain payloads;
no automatic compaction or hard erasure is promised. Upgrade participating clients/server before
concurrent optional edits; old binaries do not gain hooks. Existing webhook status and error-text
limitations are documented without out-of-scope runtime changes. Parent owns progress.md and merge.

## Resumed review closure (2026-11-14)

Runtime SHA **ffac4559** is unchanged after independent acceptance. Final follow-up edits are
only this evidence and the requested revisionless-replacement caveat in DATA_CONTRACTS.md.
Existing branch/PR #5 retained; no force push or published-history rebase. Fetched integration
at `02697e81`; its parent-owned documentation did not require a runtime integration merge.
No edits to progress.md, no dependencies, no deployment or merge.

### Assigned findings and RED/GREEN

- RED **f9aa688c**: frontend optional/store 12 failed / 36 passed; API optional/HTTP
  17 failed / 27 passed. One HTTP failure was incidental fixture indexing after new records
  were added; lookup by record id corrected that fixture, not a product defect.
- F2: a reset learned server-only ids at the same resetAt. Before the fix, deleted.b was
  undefined instead of 200 and the actual store resetEverything follow-up left b visible.
  The helper now processes explicit inventories at an equal epoch, without timestamp-only
  legacy inference, without overriding later add-backs, and with existing prefer protection.
  Tests cover all three keys, both merge orders, stale replay, post-reset new ids, actual
  store follow-up, and actual HTTP unstamped PUTs.
- F4 replay (F3 in review final labels): identical partial-stamp PUT replay changed an
  unchanged distance clock from 286 to 495 and suppressed a third device's distance 9.
  Unchanged rows now retain known per-field clocks. Tests use consistent document clocks,
  all three keys, client/API parity and real HTTP writes both with and without baseRev.
- Revisionless edits: before the fix, Apple → An apple was discarded by a lexical tie.
  Every unstamped non-new-reset optional write now stamps explicit changes after keepUnknown;
  legacy stampUnstamped remains gated by overRead. HTTP tests cover both lexical directions,
  omitted collections/unknown fields, repeated partial payloads, positive deletion retention
  and malformed input. No legacy runtime rule was broadened.
- F1 add-back ownership: documentation plus all-three-key tests, no resurrection heuristic.
  Callers write a negative clock newer than all known field/deletion stamps. Tests exercise
  stampChange, stamped/unstamped PUT, both merge orders, unchanged field clocks and hidden
  ordinary stale edits. stampRestore remains the dedicated bulk restore operation.
- Nonblocking reviewer observation is documented, not changed: a revisionless unstamped
  replacement's omitted rows in a present collection are new deletions, can override an earlier
  add-back, and may advance deletion evidence on repetition. Omitted whole collections stay
  preserved. Concurrent writers must send baseRev and handle 409; this is distinct from stamped
  normal app replay.
- GREEN **ffac4559**: focused frontend 58 passed; API optional/HTTP/legacy stamping 65 passed;
  final expanded real HTTP 22 passed. No runtime edits followed this commit.

### Fresh full verification at ffac4559

Node v22.23.5/Linux. Full suites ran sequentially, at most two workers, once each at this
runtime. MCP was rerun because its unstamped API write contract is affected, rather than merely
carrying forward its earlier result. No skipped tests, baseline exclusions or removed assertions.

| Command (directory) | Exit | Actual result |
|---|---:|---|
| `npm test -- --maxWorkers=2` (frontend) | 0 | 7,894 passed / 657 files; 371.57 s |
| `node --test --test-concurrency=2 test/*.test.js` (api) | 0 | 854 passed / 9 suites; 0 fail/cancel/skip; 128.72 s |
| `npm test -- --maxWorkers=2` (mcp) | 0 | 140 passed / 6 files; 3.14 s |
| `RAYON_NUM_THREADS=2 npm run build` (frontend) | 0 | Built in 2.06 s; existing size/dynamic-import warnings |
| `node scripts/check-locales.mjs` (frontend) | 0 | 19 locales / 3,615 keys |
| `node scripts/check-source-strings.mjs --strict` (frontend) | 0 | 2,961 strings |
| `node scripts/catalogue/build.mjs --check` (root) | 0 | 5,632 exercises current |
| `node scripts/build-coach-assets.mjs --check` (root) | 0 | 5,632 exercises / 8 prompts current |
| `node scripts/build-api-docs.mjs --check` (root) | 0 | 92 endpoints / 32 schemas current |
| `git diff --check` | 0 | Clean |

Relative to the original green Linux CI baseline: frontend +62 tests, API +54, MCP +2.
Relative to the previous local full run: frontend +18 tests, API +21, MCP unchanged.
Logs: `/tmp/ep01-review-full-{frontend,api,mcp}.log`, `/tmp/ep01-review-build.log` in this
checkout only. The fixture regression RED/GREEN logs use `/tmp/ep01-review-*.log`.

Bundle, same 155 emitted JS/CSS files, gzip level 9: **29,265,867 raw / 5,885,360 gzip bytes**.
Delta from BASELINE_REPORT: **+3,531 raw / +1,283 gzip bytes**. Delta from the prior EP-01 build:
+52 raw / -5 gzip bytes. These are total emitted assets, not initial transfer sizes.

### Independent acceptance and remaining gates

Parent reports independent Pi/MiniMax **ACCEPT at ffac4559** after its own reset, replay,
revisionless-write and add-back probes: 0/300 clock drift and 0/800 unexplained loss. Parent's
four blocking assertions pass too. This supersedes the earlier blocked review status and
CHANGES REQUESTED. These are independently supplied results, not additional full runs here.

PR #5 remains draft. Parent will trigger the existing GitHub Tests workflow on the final pushed
branch after this documentation commit; no GitHub check pass for that head is claimed here.
Native devices/live providers remain unverified. Earlier parent browser evidence is still
at ffcf68ea and is not relabeled as a browser run on ffac4559. Parent owns merge and evidence.
