# Codex continuation: MVP execution and review

Owner instructions: resume the existing project, delegate implementation, independently review,
preserve verified work, and do not merge protected branches or deploy. On 2026-11-14 the owner
said **Resume without claude**, then explicitly approved the cloud prerequisite exception in
`../briefs/WAVE-2-common.md`. This is not permission to add dependencies or launch experimental
product tracks without their required decisions.

## Recovered baseline

Runtime integration commit: `42d75a41` (EP-00/01/02 merged). The parent checkout at `d7f5f999`
was clean and included the saved Wave 2 briefs and progress ledger. Saved full logs under
`/tmp/og-logs/` ended before shutdown: API 854 pass, MCP 140 pass, frontend 7,916 pass and one
5-second timeout in `media-sync.test.js`. Build, locales, source strings and generators exited
0. These are recovered earlier results, not fresh runs. The ledger records three successful
isolated reruns of the timed-out file; the parent has not rerun them in this continuation.

The prior Claude attempts for EP-03/05a stopped during inspection. Their Cloudroom transcripts
show no implementation writes. EP-04 reported a clean branch and no changes. All three were
idle/asleep when checked. New Codex assignments supersede those tasks; Claude is not resumed.

## Execution waves

| Wave | Deliverable and owner | Depends on | Verification and reviewer | Risk / approval |
| --- | --- | --- | --- | --- |
| 2A | EP-03 volume trend: Codex `thr_pbxv6g7svw` | merged EP-01/02 | brief tests, real browser, locales/build; parent spec review and independent Codex code review | Medium: historical date/unit correctness; no new dependency |
| 2A | EP-04 diary: Codex `cr_child_6adc1136d3d29d50bd726c63` | merged EP-01/02 | real store/merge/backup matrix, browser/offline, locales/build; parent plus independent reviewer | High: sync/deletion integrity; preserve EP-01 hooks |
| 2A | EP-05a lookup API: Codex `thr_96ja8kwfhg` | merged EP-01 contracts | transport tests, real HTTP auth/status tests, source terms, API/docs; parent plus independent reviewer | High: outbound requests and untrusted provider data; bounded live probes already authorized by brief |
| 2B | Review and combine accepted branches on parent working branch | 2A deliveries | inspect full changes from baseline, independently rerun meaningful tests and final combined regressions | No merge into `main` or `next/integration` |
| 3 | EP-05b lookup preview and confirmed diary snapshot | reviewed EP-04 and EP-05a interfaces | no request on view/load, explicit lookup and save, missing values/provenance, offline reopen and browser flow | Medium; finalize bounded brief against actual delivered interfaces first |
| 4 | MVP EP-16 evidence and release readiness | reviewed MVP implementation | final FE/API/MCP, build/generators/locales, browser and security/backup checks; final independent review | Release remains blocked until outstanding platform/staging/owner gates are met |

Tools: Cloudroom isolated Codex child threads, Git/GitHub CLI, Node 22, existing npm lockfiles,
repository tests, browser-harness for rendered QA. No project dependencies are approved in Wave 2.
Workers must be capped and heavy suites run serially within each sandbox. Child threads have
separate checkouts and branches; no shared source writers.

EP-04 exception: its first Codex child's project copy timed out with no files available. Parent
stopped that child (`thr_f6kmim4v34`, no edits) and created `.worktrees/ep-04-codex` on
`feat/ep-04-codex-diary` from `be8fc9bf`. The replacement shares the parent sandbox but works
only in that distinct worktree. Parent must not run heavy jobs concurrently with it. This
avoids another full remote clone while retaining branch and file isolation.

## Interface review before dependent work

| Producer → consumer | Required agreement | Ruling |
| --- | --- | --- |
| EP-01 → EP-04 | visibleOptionalEntries, field clocks, retained tombstones, negative add-back | Use existing hooks; any insufficiency needs a RED case and client/API parity |
| EP-04 → EP-05a | modules.nutrition explicitly true | Both scopes already specify strict opt-in; missing/nonboolean is off |
| EP-04 + EP-05a → EP-05b | create entry seam, nutrient basis/serving, provenance | Freeze only after reviewing actual interfaces; no assumed density conversion between mL and g |
| EP-03 + EP-04 locales | different key blocks in shared locale packs | Combine both additions; never replace one agent's pack with the other's |
| EP-03 → existing Stats | shared range selector and historical records | Preserve all existing modes; separate 1W control if narrow layout fails |

## Explicitly outstanding

- GitHub Actions: existing ledger records HTTP 422 on dispatch despite enabled setting.
  Read-only recheck shows no integration-head run and old queued dynamic runs. Do not call this CI green.
- Fork CLA configuration remains unresolved; do not sign on the owner's behalf.
- Authenticated staging, Docker rollback, native iOS/Android and physical-device checks must be
  demonstrated or explicitly marked blocked; a browser screenshot cannot certify them.
- EP-06–15 are the product plan's optional post-MVP tracks. Each needs a bounded design and
  its documented provider/hardware/asset/dependency decisions before implementation. They are
  backlog, not implemented or silently included in the MVP completion claim.
- Existing draft PRs #7 (reviewer documentation) and #8 (Extension Lab against main) are outside
  these deliveries and remain untouched.

Progress and final evidence live in `../progress.md` and each task's evidence directory.
