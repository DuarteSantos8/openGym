# EP-05b implementation handoff

**Final source runtime: `762f48a59fa4d03fc4f4e177c0b7d89f8dc11727`.**
Assigned branch: `feat/ep-05b-codex-preview`; base: `7d9423bd` with inherited merge history.
Draft PR: [#14](https://github.com/sorensadrgit-art/openGym/pull/14), targeting `next/integration`.
Evidence delivery commit: `bc7fc907`; subsequent PR-link documentation does not alter source.
First `git pull --no-rebase origin next/integration` was already up to date, with no conflict
or source delta; push was only to the assigned branch. No published ancestry was rewritten.
Work stayed in `/code/openGym-fork/.worktrees/ep-05b-codex`. No agents, Claude, parent worktree
edits, progress.md edits, new dependencies/lockfiles, live food calls, deployment or protected
branch push/merge. Later delivery commits contain evidence only. Source identity is recorded
in [runtime-files.json](runtime-files.json).

Independent scoped spec/quality review **PASS**, I1 resolved, no new findings:
[verbatim correction verdict](independent-review-round1.md). The reviewer inspected source,
history and author-run logs; it did not rerun the suites/browser. EOF evidence cleanup was
the remaining M1 item. Final combined frontend/API/MCP acceptance belongs to the parent and
remains **conditional on its exact integrated runtime passing**. This is not a full-gate pass.

## Work completed and changed files

- Pure `lib/nutrition/food-source.js`: strict GTIN, bounded snapshot copy/validation, stable
  SHA256 provenance and explicit g/mL/serving conversion. `entry.js` minimally extends its
  existing creation context, validates matching provenance and copies the snapshot.
- `components/nutrition/FoodLookup.jsx`: explicit authenticated `api()` call only; honest
  configuration/unavailable/error states; bounded preview and unknown nutrients; explicit
  amount/meal/Save; current owner/module/config and request-generation checks; one submit.
- `SourceSnapshot.jsx`: validated original metadata and attribution on preview and offline
  reopen, constructed HTTPS links only. `EntrySheet.jsx` forwards snapshots on recent-food
  reuse, retains original guards/provenance and prevents duplicate synchronous submissions.
- `views/Nutrition.jsx`: import and day-keyed lookup panel only. Scoped nutrition CSS.
  Existing invalid/undated reads, three-decimal formatter and update/addEntry seam retained.
- Domain/component/store/contract tests and `nutrition-source-entry.json`: real persistence,
  atomic field clocks, JSON/ZIP export/read/import, older-writer retention, delete/undo.
  No shared sync algorithm, API runtime or store runtime change.
- 25 new translated strings in each of 19 locale packs, including explicit pt-BR overrides.
- DATA_CONTRACTS, plan, evidence; parent-authorized food-section/comment updates in
  SELF_HOSTING, INTEGRATIONS and .env.example explain explicit save, manual offline use,
  retained attribution and `docker compose up -d api` recreation after env changes.

## Commits and RED/GREEN evidence

| Behavior | RED | GREEN | Evidence |
| --- | --- | --- | --- |
| Confirmed bounded source/conversion | `25dd8246`: missing helper suite + invalid-source creation assertion fails | `eb466d7d`: 77 tests/5 files | `domain-red.log`, `domain-green.log` |
| Explicit lookup/UI and one confirmation | `099dfe31`: missing UI suite; real EntrySheet double submit produces2 rows instead of1 | `385449e2`: 159 tests/11 files | `ui-red.log`, `submit-red.log`, `ui-green.log` |
| Additional mobile/mL/imported-source coverage | Coverage-only `96274f47` | 169 tests/13 files, no runtime delta | `covering.log` |
| Reviewer I1: transient access changes permit stale Save | `6e02af93`: 3 failed/30 passed, each stale Save produces1 row instead of0 | `762f48a5`: 172 tests/13 files | `review-round1-red.log`, `review-round1-green.log` |

Plan `e0e28aee` precedes source changes. `ui-green-attempt.log` is an earlier successful
113-test/8-file subset, not a failed run relabelled green. The round1 report contains the
exact commands, expanded 13-file selection, finding, fix and browser proof:
[review-round1.md](review-round1.md). Six original logs and final logs have terminal escapes,
trailing line whitespace and blank EOF lines removed; substantive failure/output is unchanged.

## Environment and exact commands

Linux, **Node v22.23.5**, npm10.9.9. PATH prefix:
`/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin`.
All four root/frontend/api/mcp lockfiles matched parent byte-for-byte. Reused authorized
node_modules symlinks, no install: React19.3.1, Vitest4.1.12, installed Vite8.3.5.
Disk/load checked before work/build (281GB free, load below1, host available memory25GB).
Tests capped at2 workers and builds at `RAYON_NUM_THREADS=2`, using retained TTY sessions.
The brief's final full-suite run is parent-owned and was not duplicated.

All Vitest/build commands below ran from `frontend`; generator commands from repository root.

| Command | Exit / observed result | Log |
| --- | --- | --- |
| `npx vitest run src/lib/nutrition/food-source.test.js src/lib/nutrition/source-creation.test.js --maxWorkers=2` | 1; one failed assertion + one missing-module suite | `domain-red.log` |
| `npx vitest run src/lib/nutrition --maxWorkers=2` | 0; 77 tests/5 files | `domain-green.log` |
| `npx vitest run src/components/nutrition/FoodLookup.test.jsx --maxWorkers=2` before UI | 1; missing UI module, zero tests collected | `ui-red.log` |
| `npx vitest run src/components/nutrition/EntrySheet.source.test.jsx --maxWorkers=2` | 1; duplicate-submit test fails | `submit-red.log` |
| `npx vitest run src/components/nutrition src/views/Nutrition.test.jsx src/lib/nutrition --maxWorkers=2` | 0; 113 tests/8 files | `ui-green-attempt.log` |
| `npx vitest run src/components/nutrition src/views/Nutrition.test.jsx src/lib/nutrition src/store/useStore.nutrition.test.jsx src/lib/contracts-fixtures.test.js src/lib/sync-stamps-parity.test.js --maxWorkers=2` | 0; 159 tests/11 files | `ui-green.log` |
| Same command plus `src/lib/pt-br-locale.test.js` | 0; 169 tests/13 files before review correction, 172/13 after | `covering.log`, `review-round1-green.log` |
| `RAYON_NUM_THREADS=2 npm run build` | 0; 2.16s at385449e2, 2.09s at762f48a5 | `build.log`, `review-round1-build.log` |
| Same build on exported base7d9423bd inside assigned worktree | 0; 2.04s; temporary export removed | `base-build.log` |
| `node scripts/check-locales.mjs` | 0; 19 locales/3684 keys | `static-checks.log` |
| `node scripts/check-source-strings.mjs --strict` | 0; 3030 strings, all present | `static-checks.log` |
| `node scripts/pt-br-inheritance-fingerprint.mjs` | 0;2386 overrides/1298 inherited, unchanged inherited hash | `static-checks.log` |
| `node scripts/catalogue/build.mjs --check` | 0;5632 exercises up to date | `static-checks.log` |
| `node scripts/build-coach-assets.mjs --check` | 0;5632 exercises/8 prompts in sync | `static-checks.log` |
| `node scripts/build-api-docs.mjs --check` | 0;93 endpoints/34 schemas/366.9KB | `static-checks.log` |

Static checks ran before the two-line generation correction, which adds no strings or generated
inputs; the correction was covered by the 172-test run and rebuild. No full frontend, API or
MCP suite ran in this task. No typecheck script exists in this JavaScript project.

Other observed failures: initial baseline export used Python's unsupported `extractall(filter=)`
argument (exit1), then succeeded with explicit path/link checks and ordinary extraction.
One static-check output display used a relative path after `cd frontend` and printed file-not-found;
all checks exited0 and the complete root log was read successfully. Build warnings are existing
large chunks and ineffective dynamic imports. Chromium emitted environment DBus/OOM-score
warnings; no browser process was killed by OOM. No runtime changes were made for these issues.

## Browser evidence and boundaries

Real Chromium, production `vite preview` on localhost5178, real API33105, isolated CDP9325/profile,
throwaway DATA_DIR and synthetic signed account. Auth used the real server's cookie verifier,
but no interactive passkey/password ceremony is claimed. The test-only
[synthetic-transport.mjs](synthetic-transport.mjs) replaces Node HTTPS requests before DNS or
network; actual route, authorization, module, cache/rate, timeout/stream and normalization code
remain in the path. **0 live provider calls**. Existing exhausted producer budget remains3/3.
The browser also blocks `/exercise-media/` and provider/licence origins before navigation.
No exercise images, raw provider payloads, images, private credentials or external secrets in captures.

Launch commands (temporary values supplied only to these processes):

```sh
DATA_DIR=/tmp/ep05b-qa-data PORT=33105 RP_ID=localhost ORIGIN=http://localhost:5178 FOOD_LOOKUP=1 FOOD_LOOKUP_CONTACT= INTEGRATIONS= COACH= AUDIT_LOG=0 node --import ./docs/superpowers/evidence/EP-05b/synthetic-transport.mjs api/server.js
# from frontend
API_TARGET=http://127.0.0.1:33105 API_ORIGIN=http://localhost:5178 npx vite preview --host 127.0.0.1 --port 5178 --strictPort
chromium --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --remote-debugging-port=9325 --user-data-dir=/tmp/ep05b-browser-profile --no-first-run --no-default-browser-check about:blank
BU_NAME=ep05b BU_CDP_URL=http://127.0.0.1:9325 BH_TAB_MARKER=0 browser-harness
```

Executed helper functions are retained in [browser-helpers.py](browser-helpers.py); assertions,
original snapshot/hash, exact synthetic outbound fields and observed statuses are in
[browser-results.json](browser-results.json). All recorded browser scripts exited0.

- Open and type: zero provider requests. Keyboard Tab reached Lookup with a visible outline;
  Enter made one request. Preview and amount edits persisted zero rows. Source said100g despite
  package330ml; known zero and unknown carbohydrate were distinct.
- Explicit Save:25g produced50kcal/2g protein/0g fat and omitted carbohydrate. Offline reopen
  showed original attribution; editing label/kcal to123 retained source200kcal and fingerprint.
  Online reload, delete and undo retained the snapshot with no provider refresh.
- Synthetic unknown product404 and provider502 showed local messages. Manual fallback saved
  protein0.024. Explicit ml serving2x125 produced250mL/100kcal/protein0, never amountG.
- Dark/light at320/390/1280, reduced motion and Arabic RTL/200% text at320: no horizontal
  overflow. All captures inspected. Theme QA set the real `data-theme` CSS mode; Arabic was
  selected through Settings. Full-page captures include the ordinary fixed bottom navigation
  at the capture scroll position; controls were scrolled into view for interaction.
- No uncaught errors observed. Expected failed requests: offline sync attempts, synthetic404
  and502 lookup responses. Resource status evidence is scoped to the post-reload period,
  not a claim of a complete HAR. No direct provider request from the browser.
- Corrected762f48a5 production browser: actual built store + old rendered Save, same-task
  module/account/config away/back all kept3 rows; a fresh preview saved one distinct row.
  The earlier UI captures are source-identical visually; the correction changes only guards.

Captures: `preview-{dark,light}-{320,390,1280}.png`, `offline-edit-390.png`,
`not-found-manual-fallback-390.png`, `preview-rtl-200percent-320.png`.
No offline cold-start claim: the localhost preview had no active service-worker controller.
Offline reopen/edit used the loaded production app; JSON/ZIP re-import used the real reader/store
in focused tests, not browser file-picker automation.

Owned API/Vite/Chromium stopped via their retained sessions, owned tab closed, named harness
daemon stopped. Ports33105/5178/9325 verified closed; synthetic DATA_DIR/cookie/profile removed.
Heavy window returned to parent before its combined gate.

## Snapshot, fingerprint and bundle

One creation-only atomic `sourceSnapshot`: `source`, validated `externalId`, `label`, optional
`brand`/`quantityText`, original `per100` basis/nutrients/conversion, optional explicit `serving`,
`fetchedAt`, and `attribution` text/product URL/licence/licence URL. See DATA_CONTRACTS for exact
bounds. Creation deep-copies only named fields and verifies matching source/ID/fingerprint.
`_f.sourceSnapshot` is one field stamp; edit/delete/undo/reuse do not change original source data.
Canonical UTF-8 JSON SHA256 includes original bounded source fields except fetch time, never
user amount/day/meal/corrections. New meal UUIDs remain distinct from the source fingerprint.

[bundle.json](bundle.json) contains per-file raw/gzip9/hash measurements and both built baselines.

| Final762f48a5 output | Raw bytes | gzip9 bytes | Delta from actual base7d9423bd |
| --- | ---: | ---: | --- |
| Entry JS | 587715 | 183580 | 0 raw / -8 gzip |
| Lazy Nutrition JS | 23458 | 7657 | +9514 raw / +2781 gzip |
| Lazy Nutrition CSS | 2622 | 811 | +705 raw / +164 gzip |
| All JS/CSS emitted assets | See bundle.json | See bundle.json | +58420 raw / +18691 gzip |

Entry delta versus historical EP-00: +1261 raw/+264 gzip. Hashed import names affect gzip;
entry raw is unchanged against the same-base build. Locale packs account for most total growth.

## Licence, privacy and remaining acceptance

Existing AGPL code, no new library/media/model. Original OFF attribution/ODbL1.0 links are
retained even offline. Imported links are constructed from fixed supported source plus GTIN;
no raw URL/HTML/image rendering. Only explicit barcode requests reach the provider transport;
never diary/profile/account identity. No catalogue refresh on reopen/edit/reuse.

Native devices, Docker deployment, interactive login ceremonies, live OFF and offline cold
start remain unverified here. Full final frontend/API/MCP gate is parent-owned and pending at
this evidence handoff. Parent integrates only task-owned commits after7d9423bd, preserving
the already published merge ancestry. No integration or production acceptance is implied by
the draft PR or these covering checks.
