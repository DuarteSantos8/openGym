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

## Final-delivery review assignments (2026-11-14)

- EP-03: final `97fca350`, runtime `f28c91ea`, draft PR #9. Independent Codex reviewer
  `cr_child_a39070f7c183a2eda7b70a57`, frozen worktree `.worktrees/review-ep03`.
- EP-05a: final `c976b963`, runtime `176b1698`, draft PR #11. Independent Codex reviewer
  `cr_child_1bcb6e44c4f8aea8c9da7c59`, frozen worktree `.worktrees/review-ep05a`.
- Review packets and pending verdicts: `/tmp/opengym-review/`. Packets include every task
  commit from each plan commit's parent through final delivery; inherited orchestration docs
  are excluded. Parent will preserve final verdicts in tracked evidence.
- Reviewers are read-only, with no suite duplication, source changes or provider requests.
  EP-04 remains the only implementation writer in this sandbox and owns heavy verification.
- EP-05a review passed and task commits were integrated into the working candidate as
  `f07839b4..4ee5a409`; runtime/test/deployment paths match reviewed source byte for byte.
- EP-03 review found saved assistance overrides counted as volume. Fix round1/5 is assigned
  to the original author; source is not integrated until correction and scoped review pass.
- EP-04 source review: `cr_child_77c3d2ed9c6aed815fde2af6`, frozen runtime `4d87fc32` at
  `.worktrees/review-ep04`. Author finishes final evidence separately; source review is not
  a substitute for its full verification. Parent's invalid-day visibility probe caused
  RED `4387f0d6` / GREEN `4d87fc32`, preserving dates and separating undated rows from totals.
- EP-03's full frontend timeout remains a failed gate despite its isolated pass. One final
  combined candidate run with one worker is required; no second isolated full retry.

## External integration update

Read-only GitHub checks confirmed PR9 merged at09:52:53Z as7362eeb7 and PR11 at09:53:42Z
as470defb7, both 2026-11-14. These were external actions, not this coordinator or its children.
The parent merged updated integration into its unprotected working branch as2cecef7b. The sole
conflict was stale inherited progress text; the newer parent-owned ledger was retained.
EP-03's independently found assistance defect remains open despite the external merge. Its
correction is new draftPR12 at44b24eed and receives scoped review before acceptance. EP-05a
source is unchanged and reviewed. No protected branch write or deployment was performed here.

## Dependent UI dispatch

EP-03 correction review passed at6434f47c and was integrated asf6e9dafb..1940ebdf. EP-04
source/correction review passed ata1639383; final rebased deliveryddcd1be5 (draftPR13) was
independently compared and integrated asfaede047..7d9423bd. No source conflicts occurred.
Their final full gates remain conditional on the combined run, per the documented consolidation.

EP-05b sole owner is Codex `cr_child_9202e17e4a3ffe3598393d72`, worktree
`.worktrees/ep-05b-codex`, branch `feat/ep-05b-codex-preview`, base `7d9423bd`. The committed
brief now names exact reviewed producer interfaces and explicit snapshot/privacy rules.
The owner has the shared sandbox heavy-work window; parent performs only light coordination
until the stable runtime is ready for review/final acceptance. Reserved ports33105/5178/9325.
No live food requests remain. Independent reviewer is assigned after source delivery.
