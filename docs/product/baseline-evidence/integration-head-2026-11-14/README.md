# Integration-head verification, 2026-11-14

Independent verification of `next/integration` head `10fe87b1f` ("Merge pull request #15 from
sorensadrgit-art/room/autonomous-project-resumption-orchestrat-djus"), run on Windows 11 because
GitHub Actions could not run on this repository (see "CI remains unverified"). No production
source file was modified. Every command below was actually executed; raw output is retained beside
this file.

Environment: Windows 11 10.0.26300.9974, Node v26.13.1, npm 12.2.2, git 2.53.0 with the global
`core.autocrlf=true`. The CI images use Node 22 on Ubuntu. No Node 22 run is claimed here.

Baseline reference: [BASELINE_REPORT.md](../../BASELINE_REPORT.md) and its
[api-failures.md](../api-failures.md), captured at commit `68dad18f8` on the same platform. That
report classified 31 API failures as environmental and recorded the CRLF cause for the generated
file checks. This run re-checks the same surfaces on the current integration head.

## CI remains unverified

`gh workflow run Tests --ref next/integration` and `--ref main` both fail with
`HTTP 422: Actions has been disabled for this repository`.
`GET /repos/sorensadrgit-art/openGym/actions/permissions` still reports
`{"enabled":true,"allowed_actions":"all"}`, so the repository setting and the API answer disagree.
`workflow_dispatch` is present in `.github/workflows/test.yml` on both `main` and
`next/integration`, so the trigger is not the cause. Pull requests #13, #14 and #15 have no
workflow check runs at all; only a CodeRabbit check is reported. Three Copilot `dynamic` runs
(43580595089, 43561645498, 43561092178) have sat in `queued` for 4-8 hours without starting.

The last successful full run on this branch is
[run 43498778572](https://github.com/sorensadrgit-art/openGym/actions/runs/43498778572), a
`workflow_dispatch` on `next/integration` at `cefce38b` (EP-00 merged, before EP-01 through EP-05b).
**The current integration head has never passed CI.** Every number below is local Windows
evidence, not a Linux CI result.

The fork CLA workflow also still fails: `refs/heads/cla-signatures` does not exist on the fork, so
`contributor-assistant/github-action` cannot store signatures. No signature branch was created
and no signature was submitted. This is fork configuration, not a source defect.

## Test suites

| Suite | Command | Result |
| --- | --- | --- |
| API | `npm test` in `api` | exit 1; 891 tests, 830 pass, 61 fail, 0 skip |
| API (reduced concurrency) | `node --test --test-concurrency=2 test/*.test.js` in `api` | exit 0; the same 891 tests pass |
| Frontend | `npx vitest run --maxWorkers=2` in `frontend` | exit 1; 8,128 tests, 8,116 pass, 12 fail, 674 files |
| MCP | `npm test` in `mcp` | exit 1; 140 tests, 139 pass, 1 fail, 6 files |
| Frontend build | `npm run build` in `frontend` | exit 0; built in 8.23s |
| Locales | `node scripts/check-locales.mjs` in `frontend` | exit 0; 19 locales, 3,684 keys each, in sync |
| Source strings | `node scripts/check-source-strings.mjs --strict` in `frontend` | exit 0; 3,030 strings, all present |
| Catalogue generator | `node scripts/catalogue/build.mjs --check` | exit 1 in the worktree, exit 0 in an LF export |
| Coach assets | `node scripts/build-coach-assets.mjs --check` | exit 1 in the worktree, exit 0 in an LF export |
| API docs | `node scripts/build-api-docs.mjs --check` | exit 1 in the worktree, exit 0 in an LF export |

Raw output: [api-suite-full.txt.gz](api-suite-full.txt.gz),
[frontend-suite.txt.gz](frontend-suite.txt.gz), [mcp-suite.txt.gz](mcp-suite.txt.gz), each
gzipped console output of the run named.

### API: the 30 new failures are load-induced timeouts, not defects

The baseline recorded 31 API failures on this platform. This run records 61, and all 31 baseline
failures are still present, so 30 failures are new by name. The complete new list is in
[api-failures-new-vs-baseline.json](api-failures-new-vs-baseline.json); every observed failure is
in [api-failures-observed.json](api-failures-observed.json).

Every new failure was re-run in its own file and passes. Results, each isolated:

| Test file | Isolated result |
| --- | --- |
| `server-data-rev-endpoint.test.js` | 1 test, 1 pass |
| `server-data-rev.test.js` | 2 tests, 2 pass |
| `server-data-reset.test.js` | 2 tests, 2 pass |
| `server-data-wid.test.js` | 1 test, 1 pass |
| `contracts-http.test.js` | 22 tests, 22 pass |
| `server-anon-flood.test.js` | 3 tests, 3 pass |
| `server-bad-input.test.js` | 5 tests, 5 pass |
| `server-body-errors.test.js` | 1 test, 1 pass |
| `server-config-session.test.js` | 4 tests, 4 pass |
| `server-csrf-bearer.test.js` | 3 tests, 3 pass |
| `server-login-csrf.test.js` | 6 tests, 6 pass |
| `server-origin-hint.test.js` | 3 tests, 3 pass |
| `server-passkeys.test.js` | 30 tests, 30 pass |
| `server-password.test.js` | 26 tests, 26 pass |
| `server-nudge.test.js` | 3 tests, 3 pass |
| `server-nudge-check.test.js` | 4 tests, 4 pass |
| `server-email.test.js` | 14 tests, 14 pass |
| `server-first-user-admin.test.js` | 5 tests, 5 pass |
| `server-integrations.test.js` | 3 tests, 3 pass |
| `server-presence.test.js` | 7 tests, 7 pass |
| `server-account-delete.test.js` | 13 tests, 13 pass |
| `server-admin-delete.test.js` | 8 tests, 8 pass |
| `server-admin-state.test.js` | 4 tests, 4 pass |
| `food-lookup-http.test.js` | 12 tests, 12 pass |

Each new failure in the full run took about 20,000 ms, the node test runner default timeout,
while the same test alone takes 8-13 s. The machine was running 38 concurrent Node processes from
other agents at the time. The upstream validation command, `node --test --test-concurrency=2
test/*.test.js`, passes all 891 tests at exit 0 on the same machine. This is a scheduling
artifact of the shared host, not a regression in the integration head.

### Frontend: 12 failures, all CRLF or POSIX-path assumptions on Windows

The 12 failures are in 7 files: `scripts/app-icons.test.mjs`,
`scripts/check-mobile-bundle.test.mjs`, `src/color-mix-fallback.test.js`,
`src/components/Seasonal.lazy.test.jsx`, `src/lib/android-asset-packs.test.js`,
`src/lib/csp.test.js`, `src/views/settings-pages.test.jsx`. Three cause groups:

- **CRLF.** `src/lib/csp.test.js`, `src/views/settings-pages.test.jsx` and
  `scripts/app-icons.test.mjs` compare text against Git blobs that carry LF. Re-running these
  three files against an LF export of the same commit (`git -c core.autocrlf=false archive`)
  passes 54 of 54 tests. The cause is the host global `core.autocrlf=true`, unchanged from the
  baseline report.
- **POSIX path separators.** `src/lib/android-asset-packs.test.js` expects
  `/media/480/0001.webp` and receives a backslash-separated path;
  `src/components/Seasonal.lazy.test.jsx` expects a forward-slash component path and receives a
  backslash-separated one; `src/color-mix-fallback.test.js` and
  `scripts/check-mobile-bundle.test.mjs` assert on forward-slash paths. These fail on Windows
  regardless of line endings.
- **Windows build layout.** The remaining `check-mobile-bundle` cases depend on POSIX `dist/`
  path handling.

The upstream Linux CI result on this commit ancestor is green (run 43498778572, frontend job),
and the baseline report classified the same class of failures as environmental on this host.

### MCP: 1 failure, POSIX permissions

`test/state.test.js > a permission failure names the file, not the server path` fails because
`fs.chmodSync(path, 0o600)` does not deny reads on Windows, so no `EACCES` is raised. Four
unhandled `EPERM: operation not permitted, watch` errors come from the filesystem watcher. Both
are the same environmental class the baseline recorded.

### Generated files: CRLF only

In the worktree all three generator checks fail. Exported from the identical commit with
`git -c core.autocrlf=false archive --format=tar`, with root `node_modules` present for
`js-yaml`, all three pass:

| Check | LF export result |
| --- | --- |
| `node scripts/catalogue/build.mjs --check` | exit 0; 5,632 exercises, generated files up to date |
| `node scripts/build-coach-assets.mjs --check` | exit 0; `library-data.js` in sync (5,632 exercises), `prompts.js` in sync (8 prompts) |
| `node scripts/build-api-docs.mjs --check` | exit 0; 93 endpoints, 34 schemas, 366.9 KB |

The override applies to that one command only and does not change repository configuration.

## Browser smoke, guest path

This closes the core-path smoke that the baseline report had to record as BLOCKED: the browser
harness was unavailable then. It now runs on this host.

Environment: the Vite dev server on `http://127.0.0.1:5179` proxying to the API on
`http://127.0.0.1:33107`, both started from this worktree with a disposable `DATA_DIR` under the
agent scratch directory. Chromium was driven over CDP. The profile is guest mode, all data is
synthetic, and no external service was contacted.

| Step | Result | Observation |
| --- | --- | --- |
| Open app, continue without account, skip tour | PASS | Guest mode banner shown |
| Load the Full Body starter plan | PASS | "3 of 3 left this week"; next session Full Body A |
| Start the Full Body A workout | PASS | Workout screen, 6 exercises, 16 sets, "0/16 sets" |
| Log a set, 40 kg x 10, mark done | PASS | Header becomes "1/16 sets" and "400 kg"; stored set `w:40, r:10, done:true` |
| Go offline via CDP, log a second 40 kg x 10 set | PASS | Header becomes "2/16 sets" and "800 kg"; second set persisted to `localStorage` |
| Restore network, finish and save | PASS | "Workout complete!", 1 min, 800 kg, 2 sets, 1 new PR (Barbell Full Squat) |
| Saved state | PASS | `active` is null; one workout in `workouts`; two done sets of 40 kg x 10; total 800 kg |
| Export backup (JSON) | PASS | Real download `opengym-backup-2026-11-14.json`, 6,228 bytes; one workout, two 40 kg x 10 done sets, 800 kg total, `active` null. Retained as [browser-export-backup.json](browser-export-backup.json) |
| Reload the page | PASS | `active` still null; the workout, both sets and the 800 kg total survive the reload |

Server-side state is not part of this smoke: the guest profile never synced, and `GET /api/health`
returned `{"ok":true,"users":0,"writable":true}` for the disposable instance throughout. Both
servers and the browser tab were stopped afterward.

Not covered: authenticated passkey sign-in, backup re-import, a real account, multi-device sync,
mobile or watch behaviour, deployment to a staging host, and Docker build and stack smoke, because
no Docker executable exists on this host (`docker`, `podman` and WSL are all absent).

## What this does and does not establish

Established on this host, at `10fe87b1f`:

- The API, frontend and MCP suites pass when the machine is not oversubscribed: 891 API tests at
  `--test-concurrency=2` exit 0, 8,116 of 8,128 frontend tests pass with 12 Windows-only failures,
  139 of 140 MCP tests pass with one Windows-only failure.
- The production build succeeds, and locales, strict source strings and all three generated-file
  checks are in sync.
- The guest core path works end to end in a real browser: plan, workout, set logging, offline
  logging, save, export and reload persistence.

Not established:

- **Linux Node 22 CI for this commit.** Actions will not start. This is the one gap that matters
  for release confidence, and it needs an owner action on the repository Actions setting.
- A staging deployment, a real passkey account, cross-device sync and backup re-import.
- Any platform-independent defect. No source defect was found in this run.

## Suggested next step

Restore Actions for `sorensadrgit-art/openGym` and dispatch `Tests` on `next/integration`. The
repository setting and the API disagree about whether Actions is enabled, so the fix is on the
account side. Until a green Linux run exists for `10fe87b1f`, treat the integration head as
locally verified but not CI verified.
