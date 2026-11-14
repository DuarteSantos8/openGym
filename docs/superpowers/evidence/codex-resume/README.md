# Codex resumption checks, 2026-11-14

These checks are from the resumed parent thread. They do not certify unfinished Wave 2 code.

## Repository and agents

- `room-cli files wait`: ready. `git status --short`: empty at intake, HEAD `d7f5f999`.
- Current runtime base is integration `42d75a41`; parent commits since it are documentation.
- Prior children were idle/asleep. Their retrieved transcripts show EP-03/05a still inspecting
  source at the provider limit, with no write/commit commands. EP-04 reported no implementation.
- Owner authorized the Windows prerequisite/draftbus exception; committed in `e01c50af`.
- Three isolated Codex implementers started successfully; assignments are in the progress ledger.

## Recovered test evidence

Complete earlier log endings survived under `/tmp/og-logs/`: API 854/854 (exit 0), MCP 140/140
(exit 0), frontend 7,916 passed and one timed out (exit 1; 661 files). The timeout was
`src/lib/media-sync.test.js > localMediaGc > a guest never loses a referenced file to the cap`.
Production build, locales (19 packs, 3,615 keys), source strings (2,961), catalogue (5,632),
coach assets and API docs all ended at exit 0. These are recovered results, not fresh reruns.

## CI recheck

`gh api repos/sorensadrgit-art/openGym/actions/permissions` returned `enabled: true`.
Nevertheless, `gh workflow run Tests --ref next/integration` exited 1:

```text
could not create workflow dispatch event: HTTP 422: Actions has been disabled for this repository.
```

`gh run list` showed no test run for integration `42d75a41`. Existing dynamic runs
43561645498 and 43561092178 remained queued. No Actions permissions were changed and no
queued job belonging to another thread was cancelled. Fork CLA configuration remains a separate
previously documented release gate.

## Dependency audit (existing lockfiles)

Commands: `npm audit --json` in frontend, api and mcp, using Node 22.23.5. These are findings,
not a successful security gate. The unfiltered JSON is retained in `/tmp/og-<area>-audit.json`.

| Area | High | Moderate | Details |
| --- | ---: | ---: | --- |
| frontend | 1 | 6 | happy-dom; Capacitor CLI chain through glob/minimatch/rimraf and xcode/uuid |
| api | 0 | 1 | transitive hono |
| mcp | 0 | 1 | transitive hono |

The direct `happy-dom@20.14.6` dependency is development-only and used for component tests;
it is not an app runtime dependency. Current advisories identify
[module import alias code execution](https://github.com/advisories/GHSA-834v-8h66-3h79)
(patched in 21.0.4) and
[untrusted HTML iframe/stylesheet requests](https://github.com/advisories/GHSA-c8p4-j97h-3vg8)
(patched in 21.0.0). Applicability depends on test input and evaluation configuration; this
audit is not proof of a production exploit. A major test-environment upgrade needs a separate
scoped compatibility review before release. No dependencies or lockfiles were changed here.

## Diary integration finding

An independent Node 22 probe used the checked-in synthetic nutrition contract fixture:

```js
localExtras({ nutritionEntries: [fixture] }, {})
// { workouts: 0, bodyweight: 0, customEx: 0 }
visibleOptionalEntries({ nutritionEntries: [fixture] }, 'nutritionEntries').length
// 1
```

`useStore` also omits optional records from `hasData`, and its adoption question checks the
legacy summary counts. The diary owner was asked to write RED tests for a diary-only guest
signing in, cover both adoption choices, and make the smallest necessary changes with parity.
This is an integration requirement for EP-04, not a completed fix.

## Platform limits

`command -v docker` found no executable in the parent. Docker staging/rollback is unverified.
Native Apple/Android hardware and authenticated production staging were not accessed. Browser
QA for new features will use synthetic local data and block exercise media before screenshots.
