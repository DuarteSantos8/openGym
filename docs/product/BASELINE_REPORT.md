# Baseline report

```json
{
  "commit_sha": "68dad18f8ffaa20e8d69d936f9acd16233098b3d",
  "branch": "feat/ep-00-baseline",
  "git_status_porcelain": "",
  "remote_urls": {
    "origin_fetch": "https://github.com/sorensadrgit-art/openGym.git",
    "origin_push": "https://github.com/sorensadrgit-art/openGym.git"
  },
  "os": "Microsoft Windows NT 10.0.26300.0",
  "node": "v26.13.0",
  "npm": "11.20.0",
  "date": "2026-11-13",
  "started_at_utc": "2026-11-13T19:45:30.615Z",
  "timezone": "America/New_York",
  "baseline_source": "origin/next/integration",
  "source_commit_unchanged": true
}
```

Captured before documentation edits at the supplied upstream commit. The worktree was clean. Live `git ls-remote origin refs/heads/main refs/heads/next/integration refs/heads/feat/ep-00-baseline` confirmed both base branches at this SHA and no pre-existing task branch. All commands below used Windows PowerShell, Node v26.13.0 and npm 11.20.0. CI uses Node 22 on Ubuntu. No Node 22 run is claimed.

## Required checks

Commands ran sequentially through `cmd.exe /d /s /c`, with a separate log per invocation. Each failure was immediately rerun once, with no other baseline suite or task smoke process running concurrently. Production source remained unchanged throughout. The imports and PR template edits were made while the checks ran; those paths are not suite inputs. Installs changed no tracked lockfile or source file, so no tracked file needed restoring.

Counts are pass / fail / skip. For a non-test command, they describe one command outcome, not assertions. Suite counts are exactly the reported tests. Durations are measured wall time around the command, including npm startup.

| Command | Working directory relative to root | Exit | Pass / fail / skip | Duration | Log excerpt and retry |
| --- | --- | ---: | --- | ---: | --- |
| `npm ci` | `.` | 0 | 1 / 0 / 0 | 1.041 s | added 2 packages; audited 3; 0 vulnerabilities |
| `npm ci` | `frontend` | 0 | 1 / 0 / 0 | 8.274 s | 7 vulnerabilities (6 moderate, 1 high) |
| `npm test` | `frontend` | 1 | 7810 / 22 / 0 | 91.930 s | 9 failed files, 642 passed; rerun: 10 failed files, 626 passed, 15 worker errors; isolated retry exit 1, 118.680 s |
| `npm run build` | `frontend` | 0 | 1 / 0 / 0 | 4.809 s | built in 2.88s; chunk size and ineffective dynamic import warnings |
| `node scripts/check-locales.mjs` | `frontend` | 0 | 1 / 0 / 0 | 0.620 s | 19 locales, 3615 keys each - in sync |
| `node scripts/check-source-strings.mjs --strict` | `frontend` | 0 | 1 / 0 / 0 | 1.525 s | 2961 translated strings in src/, all present in the locale packs |
| `npm ci` | `api` | 0 | 1 / 0 / 0 | 14.171 s | added 139 packages; audited 140; 1 moderate vulnerability |
| `npm test` | `api` | 1 | 769 / 31 / 0 | 42.280 s | 800 tests; 769 pass; 31 fail; no cancelled/skipped/todo; isolated retry exit 1, 45.989 s |
| `npm ci` | `mcp` | 0 | 1 / 0 / 0 | 2.855 s | npm ci exited 0 |
| `npm test` | `mcp` | 1 | 137 / 1 / 0 | 1.849 s | 1 failed file, 4 passed; EPERM watch errors; isolated retry exit 1, 1.919 s |
| `node scripts/catalogue/build.mjs --check` | `.` | 1 | 0 / 1 / 0 | 3.571 s | Out of date, run node scripts/catalogue/build.mjs; isolated retry exit 1, 2.259 s |
| `node scripts/build-coach-assets.mjs --check` | `.` | 1 | 0 / 1 / 0 | 1.882 s | library-data.js and prompts.js are out of date; isolated retry exit 1, 2.169 s |
| `node scripts/build-api-docs.mjs --check` | `.` | 1 | 0 / 1 / 0 | 0.085 s | website/api.html is out of date; isolated retry exit 1, 0.079 s |

| Isolated retry command | Directory | Exit | Pass / fail / skip | Duration |
| --- | --- | ---: | --- | ---: |
| `npm test` | `frontend` | 1 | 7670 / 23 / 0 (15 worker errors) | 118.680 s |
| `npm test` | `api` | 1 | 769 / 31 / 0 | 45.989 s |
| `npm test` | `mcp` | 1 | 137 / 1 / 0 | 1.919 s |
| `node scripts/catalogue/build.mjs --check` | `.` | 1 | 0 / 1 / 0 | 2.259 s |
| `node scripts/build-coach-assets.mjs --check` | `.` | 1 | 0 / 1 / 0 | 2.169 s |
| `node scripts/build-api-docs.mjs --check` | `.` | 1 | 0 / 1 / 0 | 0.079 s |

Seven of the 13 required checks exited 0; six exited 1 on both attempts. Frontend attempt 1 reported 651 files (642 passed, 9 failed); attempt 2 reported only 636 files (626 passed, 10 failed) and 15 worker errors. The second run was incomplete, not a smaller successful suite. API reported 800 tests and 9 suites on both runs. MCP reported five files on both runs and four unhandled errors per run.

Evidence: [structured results](baseline-evidence/results.json), [captured runner console](baseline-evidence/runner-console.txt), [diagnostic results](baseline-evidence/diagnostics.json), [API diagnostic stdout, gzip](baseline-evidence/api-diagnostic.txt.gz), [frontend diagnostic stdout, gzip](baseline-evidence/frontend-diagnostic.txt.gz). Original complete logs in the OS temp folder later became unavailable; captured command output preserved the original counts, exit codes, excerpts and durations. The compressed diagnostic logs are later invocations, not replacements relabeled as the original logs.

## Failure classification

| Failed check | Classification | Evidence |
| --- | --- | --- |
| Frontend suite | environment, with flaky timing failures | Nine `api-base` tests spawn `sh`, absent from PATH; mobile-bundle, CSS discovery, seasonal exclusion and Android asset-pack assertions compare POSIX paths with Windows paths. `core.autocrlf=true` adds CRLF to raw-text fixtures: settings CSS regex, CSP inline-script hashes and icon text equality fail. The first full run also timed out exporting at the archive entry limit; the second run added a store hook timeout and 15 unexpected worker exits. The focused run at two workers passes backup-media and tabs-owner but retains 21 environmental failures in eight files. |
| API suite | environment | Same 31 failures on both original attempts and the later diagnostic. Coach fixture startup uses `C:\C:\Users\...\fixture-cli.mjs`; chmod checks see decimal 438 (0666) rather than 384 (0600); unreadable/unwritable fixture tests rely on POSIX permissions; admin sockets are explicitly disabled on win32. Nudge/wrapped copy and prompt byte comparisons and the OpenAPI LF-only search fail with CRLF. See the per-test inventory below. |
| MCP suite | environment | Both attempts: `test/log-workout.e2e.test.js` fails, 137 pass, 1 fail, four `EPERM` errors from filesystem watch. The runner output identifies the same file and error on both attempts. No successful MCP end-to-end write is claimed. |
| Catalogue generated files | environment | Both worktree attempts fail. With the identical Git commit exported using `-c core.autocrlf=false`, `--check` exits 0: 5,632 exercises, generated files up to date. |
| Coach generated assets | environment | Both worktree attempts fail. The LF export exits 0 for 5,632 exercises and eight prompts. |
| API generated docs | environment | Both worktree attempts fail. The LF export exits 0: 92 endpoints, 32 schemas, 356.9 KB. |

These are failures of untouched code in this environment. No platform-independent baseline defect was established. This does not prove Node 22/Linux green. No source correction, generator write, lockfile change or workflow change was made.

### Additional classification runs

The API diagnostic reran `npm test` in `api`: exit 1, 32.527 s, 769 pass / 31 fail / 0 skip. The frontend diagnostic ran the following command in `frontend`: exit 1, 15.342 s, 136 pass / 21 fail / 0 skip, eight failed files and two passed. This isolates the failing files and reduces load; it is not the full suite.

```text
npx vitest run --maxWorkers=2 scripts/app-icons.test.mjs scripts/check-mobile-bundle.test.mjs src/color-mix-fallback.test.js src/components/Seasonal.lazy.test.jsx src/views/settings-pages.test.jsx src/lib/android-asset-packs.test.js src/lib/api-base.test.js src/lib/backup-media.test.js src/lib/csp.test.js src/store/useStore.tabs-owner.test.jsx
```

For generated checks, a disposable snapshot outside the repo was made with `git -c core.autocrlf=false archive --format=tar --output=<snapshot.tar> 68dad18f8ffaa20e8d69d936f9acd16233098b3d scripts catalogue/exercises catalogue/i18n catalogue/browse frontend/src frontend/package.json api/coach/core api/coach/prompts api/openapi.yaml website/index.html website/api.html package.json`, then `tar.exe -xf <snapshot.tar> -C <snapshot>`. Its root node_modules was a junction to the already installed root dependencies. No exercise media or runtime data was included. An initial export without the config override retained CRLF and failed the same checks; [its results](baseline-evidence/crlf-archive-checks.json) are retained. The override affects only that command, not repo configuration.

| Command in LF snapshot | Exit | Pass / fail / skip | Duration | Excerpt |
| --- | ---: | --- | ---: | --- |
| `node scripts/catalogue/build.mjs --check` | 0 | 1 / 0 / 0 | 2.142 s | catalogue: 5632 exercises, generated files up to date |
| `node scripts/build-coach-assets.mjs --check` | 0 | 1 / 0 / 0 | 1.914 s | api\coach\core\library-data.js in sync (5632 exercises).; api\coach\core\prompts.js in sync (8 prompts). |
| `node scripts/build-api-docs.mjs --check` | 0 | 1 / 0 / 0 | 0.069 s | website\api.html in sync: 92 endpoints, 32 schemas, 356.9 KB |

The [line-ending comparison](baseline-evidence/line-endings.json) shows six representative working files differ from their Git blobs only by CRLF. [LF snapshot results](baseline-evidence/lf-snapshot-checks.json) record the exact temporary directory and commands.

### API per-test failure inventory

All 31 failing tests are listed in [api-failures.md](baseline-evidence/api-failures.md), grouped by the direct environmental cause. The retained diagnostic log has the assertions and stacks. The OpenAPI failure is the literal `\n  /api/register/password:\n` search against CRLF, not evidence of a missing route contract.

## Core-path smoke

**BLOCKED. No browser journey is reported as passed.** Installed Chrome and Edge executables were found. The browser-harness executable and Docker were absent from PATH. A disposable launch was prepared for `node api/server.js` with `DATA_DIR=%TEMP%/opengym-ep00-evidence/smoke-data`, `PORT=33107`, `RP_ID=localhost`, `ORIGIN=http://localhost:5179`, plus the Vite dev server on port 5179 with `API_TARGET=http://127.0.0.1:33107` and matching `API_ORIGIN`. Chrome would use `--headless=new --remote-debugging-port=0 --user-data-dir=<task-temp>/chrome-profile`.

The Node REPL startup attempt stopped before any spawn because its runtime does not expose `process`. A subsequent PowerShell `Start-Process -WindowStyle Hidden` launch for the API, Vite and isolated Chrome was rejected before execution: `rejected: blocked by policy`. There is no OS exit code or PID for that rejected call. No alternative process-launch workaround was attempted. No task smoke servers or browser processes started, so there were none to stop. Test-suite subprocesses were managed by their test runners.

| Path | Result | Observation |
| --- | --- | --- |
| First-run registration and login | BLOCKED | Disposable server/browser launch rejected. No real or virtual authenticator ceremony attempted. |
| Start a workout | BLOCKED | Browser session unavailable. |
| Log one set | BLOCKED | Browser session unavailable. |
| Export | BLOCKED | Browser session unavailable; unit-test coverage is not an export smoke. |
| Offline save and reconnect | BLOCKED | Browser session unavailable. |
| Console errors and failed requests | UNVERIFIED | No page loaded, so no console/network capture exists. |
| Docker build and stack smoke | BLOCKED | Docker executable absent from PATH. No images built or containers started. |

No screenshots were captured, and no exercise media was supplied to an AI tool. Completing browser smoke requires a permitted process launch. A real passkey ceremony and platform-specific mobile/watch checks remain unverified.

## Workflow coverage and triggers

This is an inspection of the checked-in YAML, not a claim that GitHub Actions ran successfully.

After opening draft PR #4 against next/integration at head `f614dc918ebfc5bbff3f3ab1851bf82bd5019f41`, GitHub confirmed Actions enabled and actually triggered Tests, iOS and CLA. Tests run 43498244134 passed changes/report/tests-ok and skipped all six substantive jobs. iOS run 43498244069 passed its gate and skipped simulator/UI/archive jobs. CLA run 43498244323 failed: the fork has no `cla-signatures` branch, followed by a signature-required error. `gh pr checks 4 --watch --interval 10` exited 1, with four passed, one failed and nine skipped checks. This additional failure is classified environment (fork CLA setup). No signature or signature branch was created. [CI observation](baseline-evidence/ci-observation.json) records the commands, immutable observed head and run IDs. Repository setting verification is limited to Actions enablement, not branch protection.

| Workflow | Triggers | Work performed and gates |
| --- | --- | --- |
| `test.yml` | Every `pull_request` (no base-branch filter); pushes to main, stores, watch, ci-*; manual dispatch | Node 22, Ubuntu. Path filters choose frontend, API, MCP, catalogue, image and Android jobs. Frontend: coverage/JUnit tests, build and bundle sizes, locale check, source strings report-only (no strict flag), Garmin check, fatigue probe, test audit. API: tests/coverage, coach assets, API docs and plain-Node core load. MCP: coverage and plain-Node server load, with API deps for E2E. Catalogue: validate, generation and 180 px media-size check. Images: build default, coach and published API targets plus web, boot and probe API through nginx, verify runtime isolation and privileges. Android: mobile build/cap sync, JVM tests, debug/flavour compilation and F-Droid checks. Report combines artifacts; final tests-ok requires each relevant job to succeed or be skipped. Manual dispatch forces all six path-filter outputs true. |
| `audit.yml` | Mondays 04:23 UTC; manual; PRs touching audit workflow/deps-audit script; ci-* pushes touching those files | Dependency audit fails high/critical runtime issues, reports dev/outdated packages. Frontend/API robustness under shuffled order, UTC+14, Los Angeles and clock +42 days; shuffled case continues on error. |
| `ios.yml` | PR opened/synchronize/reopened/labeled; main/stores/watch pushes touching frontend or workflow; manual | PR gate checks iOS/native paths or ios label. Mac builds phone/watch/widgets for simulator, WatchCore and GymReminderCore tests, UI tests and screenshots. Unsigned device archive only outside PR events. |
| `cla.yml` | Created issue comments and pull_request_target opened/closed/synchronize | Contributor-assistant CLA check; only relevant PR comments invoke recheck/signature handling. No signature was submitted in this task. |
| `cla-issue.yml` | Created issue comments | Signature recording only for non-PR issue 554. |
| `docker-publish.yml` | main pushes excluding docs/config/native-only paths; published release; manual | Build/push API and web images to GHCR with metadata. Not a PR check. |
| `mirror.yml` | main pushes, v* tag pushes, manual | Fast-forward mirror; job restricted to DuarteSantos8/openGym, so gated off in this fork. |
| `pages.yml` | main pushes touching frontend, catalogue, catalogue scripts or workflow; manual | Build demo, stage media and deploy GitHub Pages. Not a PR check. |
| `release-check.yml` | v* tags; ci-* branches with workflow/release-script path filter; manual optional tag input | Check version agreement; tagged commit must be on main. |

**A pull request into next/integration does trigger Tests.** No workflow edit is needed for PR base coverage. Docs-only changes match none of the six test job filters: changes, report and tests-ok can run while substantive suite/image/mobile jobs skip. A green docs PR therefore does not establish a full platform baseline. A direct push to next/integration is outside the workflow's push branch list. If integration pushes also need validation, the smallest separate change is to add next/integration to test.yml's existing push.branches list. This task does not make that change. Fork Actions enablement, first-contributor approvals and branch protection are repository settings, not proven by YAML inspection.

## Bundle baseline

Built by the required `npm run build`, exit 0. All emitted JS/CSS files under frontend/dist, including service worker JS, are listed below. Raw bytes are file lengths; gzip uses Node zlib level 9 per file. Hashed suffixes are replaced by * in the pattern column for later comparisons. Excludes HTML, fonts, images, source maps and container/media assets. Each file's SHA-256 and byte counts are in [bundle.json](baseline-evidence/bundle.json). There are 155 files, 29262336 raw bytes and 5884077 gzip bytes summed per file. These totals are emitted assets, not the initial page transfer.

| Emitted path (name pattern) | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| `assets/Admin-Ciuc8CeD.js` (`Admin-*.js`) | 51655 | 14660 |
| `assets/api-Dv3JrEdm.js` (`api-*.js`) | 10437 | 4257 |
| `assets/app-icon-Cz1zMaNJ.js` (`app-icon-*.js`) | 1586 | 689 |
| `assets/ar-B7GMMOkS.js` (`ar-*.js`) | 336499 | 106308 |
| `assets/ar-CpDUmjvE.js` (`ar-*.js`) | 827233 | 81441 |
| `assets/ar-n3dBOUwe.js` (`ar-*.js`) | 354621 | 58103 |
| `assets/backfill-DqrdLmNZ.js` (`backfill-*.js`) | 1669 | 893 |
| `assets/backup-media-D7TuHUJy.js` (`backup-media-*.js`) | 6853 | 2943 |
| `assets/base-6FCm0523.js` (`base-*.js`) | 2855 | 1022 |
| `assets/bn-D6CP0iEe.js` (`bn-*.js`) | 494059 | 62282 |
| `assets/bn-DrCeTPid.js` (`bn-*.js`) | 454697 | 110067 |
| `assets/body-paths-D_5SR19s.js` (`body-paths-*.js`) | 93278 | 40042 |
| `assets/capacitor-fetch-bIWI-BYK.js` (`capacitor-fetch-*.js`) | 2162 | 1261 |
| `assets/categories-B2tdkgdE.js` (`categories-*.js`) | 87 | 102 |
| `assets/channel-DoHzkiWH.js` (`channel-*.js`) | 342 | 214 |
| `assets/CheckIn-DXGl5hyz.js` (`CheckIn-*.js`) | 12285 | 4817 |
| `assets/christmas-CnCNA-cB.js` (`christmas-*.js`) | 22568 | 8325 |
| `assets/christmas-Dop0I10C.css` (`christmas-*.css`) | 14712 | 3991 |
| `assets/coach-api-DFQbc7QP.js` (`coach-api-*.js`) | 9823 | 3910 |
| `assets/coach-consent-umkznCjK.js` (`coach-consent-*.js`) | 2105 | 1123 |
| `assets/coach-demo-DUjerK2J.js` (`coach-demo-*.js`) | 9183 | 4062 |
| `assets/coach-device-l8UIt3Yg.js` (`coach-device-*.js`) | 3164 | 1694 |
| `assets/coach-local-DprLZWhZ.js` (`coach-local-*.js`) | 595668 | 104421 |
| `assets/CoachChat-Dhn2gguB.js` (`CoachChat-*.js`) | 39247 | 11753 |
| `assets/CoachConsentSheet-C7SMUQih.js` (`CoachConsentSheet-*.js`) | 3555 | 1678 |
| `assets/CoachIntake-BysrNha-.js` (`CoachIntake-*.js`) | 11872 | 4134 |
| `assets/CoachSetup-q2SE37VS.js` (`CoachSetup-*.js`) | 10565 | 4179 |
| `assets/DateField-BWCydgpX.js` (`DateField-*.js`) | 27414 | 10413 |
| `assets/day-photos-93nXQdKL.js` (`day-photos-*.js`) | 1414 | 727 |
| `assets/de-B3I-S1q_.js` (`de-*.js`) | 284501 | 99708 |
| `assets/de-CKpzH790.js` (`de-*.js`) | 265382 | 58195 |
| `assets/de-CUISC6gj.js` (`de-*.js`) | 1832 | 764 |
| `assets/de-DY5LZmnD.js` (`de-*.js`) | 645575 | 85939 |
| `assets/demoSeed-DznMfJOd.js` (`demoSeed-*.js`) | 3280 | 1679 |
| `assets/DurationWheel-CIO-J-KT.js` (`DurationWheel-*.js`) | 6368 | 2366 |
| `assets/en-BJ9FHc_q.js` (`en-*.js`) | 1794898 | 307771 |
| `assets/en-CNDRxJeJ.js` (`en-*.js`) | 616048 | 150993 |
| `assets/equipment-DuJoXgOg.js` (`equipment-*.js`) | 1514 | 850 |
| `assets/es-CFQh82Kg.js` (`es-*.js`) | 273386 | 54186 |
| `assets/es-CinwZtNH.js` (`es-*.js`) | 718959 | 86340 |
| `assets/es-D3Ykguu5.js` (`es-*.js`) | 281239 | 97431 |
| `assets/esm-BmAxaDRy.js` (`esm-*.js`) | 1519 | 889 |
| `assets/esm-C9FzHnv_.js` (`esm-*.js`) | 2994 | 1553 |
| `assets/esm-CVr1xrgd.js` (`esm-*.js`) | 2541 | 1370 |
| `assets/esm-DBOqURt6.js` (`esm-*.js`) | 2694 | 1203 |
| `assets/esm-DLgi23WT.js` (`esm-*.js`) | 1764 | 1004 |
| `assets/esm-ORx6pdee.js` (`esm-*.js`) | 1513 | 890 |
| `assets/ex-unit-cay9NGUw.js` (`ex-unit-*.js`) | 2986 | 1247 |
| `assets/exercise-history-C8RS14Js.js` (`exercise-history-*.js`) | 7599 | 3441 |
| `assets/exercises-CQf54rEW.js` (`exercises-*.js`) | 1225305 | 155687 |
| `assets/fr-cFWUh51s.js` (`fr-*.js`) | 290448 | 99309 |
| `assets/fr-CWiC_6EN.js` (`fr-*.js`) | 713817 | 85607 |
| `assets/fr-dBmS1b4A.js` (`fr-*.js`) | 267710 | 54490 |
| `assets/halloween-7CwKpUf5.css` (`halloween-*.css`) | 11043 | 2758 |
| `assets/halloween-cfersamP.js` (`halloween-*.js`) | 10919 | 3795 |
| `assets/health-connect-CuGu6WTg.js` (`health-connect-*.js`) | 7684 | 3412 |
| `assets/health-sync-D1G6THsy.js` (`health-sync-*.js`) | 4717 | 2132 |
| `assets/hi-6tJcsCRU.js` (`hi-*.js`) | 453547 | 61541 |
| `assets/hi-CCj9PC99.js` (`hi-*.js`) | 447204 | 112804 |
| `assets/hi-CrhvEsuL.js` (`hi-*.js`) | 1585003 | 119528 |
| `assets/History-7uT-ZzxD.js` (`History-*.js`) | 2621 | 1243 |
| `assets/history-CuWmobaK.js` (`history-*.js`) | 54797 | 20108 |
| `assets/hu-_NLvWIXy.js` (`hu-*.js`) | 248119 | 56023 |
| `assets/hu-C1UeadDF.js` (`hu-*.js`) | 286890 | 102289 |
| `assets/hu-CsBkqtnp.js` (`hu-*.js`) | 679094 | 97148 |
| `assets/index-DG7O3Hwv.css` (`index-*.css`) | 174378 | 33403 |
| `assets/index-IvIi0JTe.js` (`index-*.js`) | 586454 | 183316 |
| `assets/it-B0tmGk2l.js` (`it-*.js`) | 281308 | 96605 |
| `assets/it-DGOnoX1O.js` (`it-*.js`) | 682773 | 87507 |
| `assets/it-X0w6XOGn.js` (`it-*.js`) | 269117 | 55050 |
| `assets/jsQR-DMfxOdIb.js` (`jsQR-*.js`) | 129986 | 46365 |
| `assets/jsx-runtime-LKYXHABd.js` (`jsx-runtime-*.js`) | 435 | 304 |
| `assets/ko-Brow1u2B.js` (`ko-*.js`) | 658191 | 98900 |
| `assets/ko-CK6tgkda.js` (`ko-*.js`) | 293290 | 102490 |
| `assets/ko-DXGCymFq.js` (`ko-*.js`) | 251584 | 55288 |
| `assets/leaflet-src-Dcu4YAMi.js` (`leaflet-src-*.js`) | 148613 | 42804 |
| `assets/leaflet-vh-t_kPv.css` (`leaflet-*.css`) | 15095 | 6363 |
| `assets/lean-qr-DWZdVoNy.js` (`lean-qr-*.js`) | 6781 | 3543 |
| `assets/Library-B0OlN1_g.js` (`Library-*.js`) | 7305 | 2656 |
| `assets/Measurements-BNfEFngC.js` (`Measurements-*.js`) | 10459 | 3532 |
| `assets/measurements-CnlVP4mt.js` (`measurements-*.js`) | 9569 | 3799 |
| `assets/media-ingest-DtEvQG5_.js` (`media-ingest-*.js`) | 6302 | 2488 |
| `assets/media-limits-O_QuQtBa.js` (`media-limits-*.js`) | 648 | 425 |
| `assets/media-prefetch-DNv9cxMH.js` (`media-prefetch-*.js`) | 2509 | 1286 |
| `assets/media-refs-CjgGBvJX.js` (`media-refs-*.js`) | 4671 | 1780 |
| `assets/media-store-BExsFtTj.js` (`media-store-*.js`) | 6441 | 2537 |
| `assets/media-store-fs-Ddv775ty.js` (`media-store-fs-*.js`) | 17809 | 7697 |
| `assets/mobile-CCSWD5jV.js` (`mobile-*.js`) | 15512 | 5079 |
| `assets/modules-copy-CtdX76Ld.js` (`modules-copy-*.js`) | 1612 | 841 |
| `assets/Muscles-pNYYKSVK.js` (`Muscles-*.js`) | 987 | 575 |
| `assets/native-CXk-vFFZ.js` (`native-*.js`) | 774 | 336 |
| `assets/nudge-check-DreO_tjR.js` (`nudge-check-*.js`) | 937 | 598 |
| `assets/pending-CG0YB1pl.js` (`pending-*.js`) | 135 | 125 |
| `assets/pl-DmWp2PTk.js` (`pl-*.js`) | 279815 | 58869 |
| `assets/pl-DyucYo8W.js` (`pl-*.js`) | 293177 | 102910 |
| `assets/pl-Vd91jsCG.js` (`pl-*.js`) | 655342 | 91474 |
| `assets/plan-share-CO-efUmP.js` (`plan-share-*.js`) | 32224 | 12094 |
| `assets/platform-now-CIGTrnA-.js` (`platform-now-*.js`) | 134 | 134 |
| `assets/preload-helper-CRzLMJPS.js` (`preload-helper-*.js`) | 1534 | 798 |
| `assets/Programmes-BLpFS6n9.js` (`Programmes-*.js`) | 11971 | 4260 |
| `assets/ProgressPhotos-CK8bnbNL.js` (`ProgressPhotos-*.js`) | 10472 | 4115 |
| `assets/providers-CC0t0Cvg.js` (`providers-*.js`) | 3420 | 1497 |
| `assets/pt-BR-BJQYc3_J.js` (`pt-BR-*.js`) | 224622 | 77687 |
| `assets/pt-BR-Do3yZIoq.js` (`pt-BR-*.js`) | 270599 | 54863 |
| `assets/pt-BR-DYGSMjF1.js` (`pt-BR-*.js`) | 696134 | 84643 |
| `assets/pt-CnKzKdMZ.js` (`pt-*.js`) | 272469 | 55038 |
| `assets/pt-DCZfbFB6.js` (`pt-*.js`) | 281897 | 97263 |
| `assets/ReportSheet-BipU1a1I.js` (`ReportSheet-*.js`) | 1916 | 984 |
| `assets/rolldown-runtime-XKyaHtl9.js` (`rolldown-runtime-*.js`) | 726 | 429 |
| `assets/rotation-T0MBC9Es.js` (`rotation-*.js`) | 37040 | 13030 |
| `assets/RoutineEdit-DhuKCUQd.js` (`RoutineEdit-*.js`) | 18487 | 6561 |
| `assets/ru-CJ33ZKaN.js` (`ru-*.js`) | 1056933 | 105222 |
| `assets/ru-CJGbBMTi.js` (`ru-*.js`) | 389949 | 115405 |
| `assets/ru-CXcRwy7n.js` (`ru-*.js`) | 427394 | 67117 |
| `assets/scan-web-_gihBo6t.js` (`scan-web-*.js`) | 63 | 80 |
| `assets/seasonal-C-Y6JYAQ.js` (`seasonal-*.js`) | 2449 | 1103 |
| `assets/session-merge-CyvedNqW.js` (`session-merge-*.js`) | 17533 | 7132 |
| `assets/set-videos-Dk2Eogrt.js` (`set-videos-*.js`) | 2610 | 1230 |
| `assets/Settings-CPf0rsta.js` (`Settings-*.js`) | 148018 | 46396 |
| `assets/ShareCard-CuMN-VU5.js` (`ShareCard-*.js`) | 14746 | 6547 |
| `assets/sheets-VRokZwzZ.js` (`sheets-*.js`) | 370846 | 118201 |
| `assets/Stats-8LN5zldC.js` (`Stats-*.js`) | 42946 | 14439 |
| `assets/StructuralBalance-A1fsotrC.js` (`StructuralBalance-*.js`) | 3793 | 1655 |
| `assets/supersetFlow-_d7fPRvw.js` (`supersetFlow-*.js`) | 2608 | 1061 |
| `assets/sv-CiwNT847.js` (`sv-*.js`) | 236342 | 54444 |
| `assets/sv-D1z3BLFn.js` (`sv-*.js`) | 271952 | 94986 |
| `assets/sync-merge-BxqXu9yo.js` (`sync-merge-*.js`) | 50204 | 17315 |
| `assets/th-CRhAMvco.js` (`th-*.js`) | 458009 | 110451 |
| `assets/th-CSXVX7GD.js` (`th-*.js`) | 458805 | 64019 |
| `assets/Tour-C96LhuIO.css` (`Tour-*.css`) | 4119 | 1378 |
| `assets/Tour-Dyzc81pf.js` (`Tour-*.js`) | 23534 | 8757 |
| `assets/tr-B5xdUX7n.js` (`tr-*.js`) | 277389 | 96875 |
| `assets/tr-DUKW85d9.js` (`tr-*.js`) | 732512 | 89520 |
| `assets/tr-sBccyaEk.js` (`tr-*.js`) | 225944 | 52885 |
| `assets/ui-BAwuUm8u.js` (`ui-*.js`) | 38047 | 11098 |
| `assets/uk-btC8ejTm.js` (`uk-*.js`) | 382481 | 114986 |
| `assets/uk-c1-draNn.js` (`uk-*.js`) | 430563 | 66412 |
| `assets/useStore-tZAohjrc.js` (`useStore-*.js`) | 49535 | 17439 |
| `assets/useUI-wOgHHPsh.js` (`useUI-*.js`) | 28524 | 10715 |
| `assets/web-BIx_nOyg.js` (`web-*.js`) | 845 | 399 |
| `assets/web-CgfmF4Rj.js` (`web-*.js`) | 3487 | 1139 |
| `assets/web-CJ1o5Z1z.js` (`web-*.js`) | 793 | 394 |
| `assets/web-D4rX6Ab7.js` (`web-*.js`) | 4439 | 1287 |
| `assets/web-Dkt1YbTs.js` (`web-*.js`) | 8478 | 2818 |
| `assets/web-DN22Gc2T.js` (`web-*.js`) | 366 | 248 |
| `assets/workout-date-CGPDmoqn.js` (`workout-date-*.js`) | 1585 | 847 |
| `assets/Wrapped-BM-Z9mql.js` (`Wrapped-*.js`) | 19468 | 7596 |
| `assets/Wrapped-DofJKFEc.css` (`Wrapped-*.css`) | 6773 | 2047 |
| `assets/zh-DOuyA1pV.js` (`zh-*.js`) | 481535 | 75692 |
| `assets/zh-I80caZHF.js` (`zh-*.js`) | 263335 | 102061 |
| `assets/zh-mnY0Y2gQ.js` (`zh-*.js`) | 185174 | 50534 |
| `assets/zh-TW-B1bVpwUU.js` (`zh-TW-*.js`) | 381048 | 80508 |
| `assets/zh-TW-C9gXV6lG.js` (`zh-TW-*.js`) | 184159 | 50223 |
| `assets/zh-TW-CMe6LMfS.js` (`zh-TW-*.js`) | 268254 | 105416 |
| `sw.js` (`sw.js`) | 21977 | 8455 |

## Documents and review guardrails

The attachment was split into 22 marker-named files plus the preamble README. Only marker lines and the final standalone separator line before each following marker were removed; all other bytes, blank lines and line endings were preserved. [Import manifest](baseline-evidence/import-manifest.json) records source SHA-256 and each file's size/hash. Imported outlines remain unchanged, including generic implementation/TDD instructions and proposed paths; the narrower EP-00 task governs this documentation-only execution. No feature behavior tests or production fixes were added.

The existing PR template keeps its checklist and platform choices, and adds the requested review sections. The ledger marks only EP-00 In Review; all other epics remain Backlog. Independent review and blocked smoke evidence remain for the orchestrator. Upstream ignores docs/superpowers/plans, so those explicit imported paths are force-added without changing .gitignore. Documentation rollback is reverting this task's commits. There is no runtime schema, feature flag or deployment change.

Import verification checks all 23 file hashes, including staged Git blobs, against the split attachment. `git diff --cached --check` exited 2 twice on the import commit because the attachment contains trailing spaces and extra blank lines at EOF. Those inherited bytes are intentionally preserved. This is an import-format exception, not a source-code baseline failure. Authored-file whitespace and final allowed-path checks are verified separately before submission.
