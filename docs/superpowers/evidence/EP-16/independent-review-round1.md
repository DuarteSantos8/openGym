# Final whole-branch MVP review

Reviewed on 2026-11-14. Frozen checkout: `/code/openGym-fork/.worktrees/review-mvp`; verified HEAD **3864f39e3a33eaf491d9094300a3b93f15e89351**. Review range: `42d75a41..3864f39e`. All source references below are relative to that checkout unless linked otherwise.

Read the actual PRODUCT_SPEC, bounded EP-03/04/05a/05b briefs and common instructions, DATA_CONTRACTS, EP-16 gate plan, progress ledger and final evidence manifest. The bounded briefs control over the broader epic outlines. Inspected the supplied source diff, changed implementations with surrounding shared code, relevant tests, operator guidance, earlier independent reviews and selected exact evidence. No source, index or Git-state mutation, installs, subagents, provider calls, browsers, servers or suite reruns. This verdict is the only file written.

## Strengths

- **Analytics preserves historical meaning and existing consumers.** `exercise-volume.js` uses the existing date/unit/set helpers, explicit exclusions and one point per session. Saved assistance overrides govern this series. The optional resolver in `history.js:763` retains the exact prior ID-based default for other consumers. The reviewed regressions preserve new-series **150/200/400** versus default-consumer **250/200/0**, warm-ups/bodyweight settings, pinned kg/lb, sides, drops and repeated exercise occurrences. Stats supplies a semantic table and inclusion explanation without persisting derived values.
- **Diary integration uses the existing state contracts.** The module defaults off; reads, totals and suggestions use the visible optional-entry projection. Missing nutrients remain omitted, zero remains known, serving units stay explicit and formatting preserves three decimals. Delete/undo retains field ownership and deletion evidence. Undated/unsupported identified records remain accessible without rewriting them. Client/API stamping changes are narrow and mirrored. Guest adoption distinguishes guest inventory from account foods created during a pending decision, including an initially null server document.
- **Lookup has a clear consent and persistence boundary.** The server verifies authenticated identity, its operator switch and the stored boolean module choice before cache/transport. Fixed HTTPS origin, connection-time DNS guards, no redirects, streamed byte/time bounds, rate limits and bounded memory caching are implemented. UI lookup is explicit; Save is separate. Source basis/nutrients/attribution are bounded, deep-copied and fingerprinted independently of meal UUIDs and editable totals. Generation checks prevent stale response/save use across transient access changes. Reopening/editing/reusing saved food does not refresh the catalogue.
- **Verification is substantial and candid.** Outcome-based RED/GREEN history is preserved. Real-store tests cover conflict retries, guest/account adoption, reset/prefer, JSON/ZIP readers, source metadata, older-writer shapes and deletion/undo. Task browser evidence covers wider layouts and real local sync; parent smoke covers the combined feature interactions. Failed earlier attempts and lost diagnostics are disclosed rather than relabelled as passes. No dependency manifests, lockfiles, workflows or catalogue/media/data paths changed in the supplied net package.

## Findings

### Critical

None confirmed.

### Important I1 — New diary events cannot be saved on supported plain-HTTP LAN deployments

**Primary location:** [frontend/src/lib/nutrition/entry.js:47](/code/openGym-fork/.worktrees/review-mvp/frontend/src/lib/nutrition/entry.js:47).

**Trigger:** Open the app at an ordinary insecure LAN origin such as `http://192.168.1.10:8080`, enable Nutrition, and save a manual food or confirm a lookup preview. This is a supported deployment context: [docs/SELF_HOSTING.md:341](/code/openGym-fork/.worktrees/review-mvp/docs/SELF_HOSTING.md:341) explicitly provides password sign-in for plain-HTTP LAN users. In that context `crypto.getRandomValues` is available, but secure-context-only `crypto.randomUUID` is absent.

**Observed defect and impact:** `createEntry()` calls `crypto.randomUUID()` unconditionally. Both manual creation/recent-food reuse (`components/nutrition/EntrySheet.jsx:47`) and confirmed lookup Save (`components/nutrition/FoodLookup.jsx:86`) go through this function. They fail before persistence; their catch handlers show a generic save error. Valid food inputs cannot be added. Existing records are not erased. The source-hash helper already supports this deployment context, so successful lookup/preview does not solve the Save failure.

**Independent offline reproduction:** Using the frozen real entry and source helpers under **Node v22.23.5**, supplied a crypto capability object with genuine bound `getRandomValues` and no `randomUUID`. A valid manual input and a valid lookup input derived from the committed source fixture both produced:

```text
manual: TypeError: crypto.randomUUID is not a function
confirmed lookup: TypeError: crypto.randomUUID is not a function
```

The probe asserted both failures and exited 0; no network or files were used. Its first attempt incorrectly selected grams for the fixture's ml basis and exited on `Error: unit`; the corrected probe selects the fixture's actual basis. This is a capability-level reproduction, not a claim that this reviewer launched an insecure-origin browser. The existing `lib/push.js:30` also recognizes that `randomUUID` may be absent and uses `getRandomValues`, although its hyphenless device-ID fallback is not directly a conforming diary UUID.

**Required correction:** Use native `randomUUID` when available and a cryptographically random RFC 4122 UUID-v4 fallback using `crypto.getRandomValues` otherwise. Reuse an existing suitable UUID helper if one exists; the fallback must set the version/variant bits and emit the UUID format accepted by `normalizeEntry`. No `Math.random`, new dependency, timestamp identity or fingerprint-as-event-ID substitution. Cover the real `createEntry` manual and lookup paths with `randomUUID` absent; verify valid/distinct UUIDs and unchanged source provenance. Add focused manual/lookup Save coverage and an actual insecure-context browser proof using synthetic provider transport. The parent accepted I1 as Important and authorized this bounded correction; the reviewed source remains unchanged.

### Minor M1 — Modules guide still describes the diary before lookup integration

**Primary location:** [docs/MODULES.md:27](/code/openGym-fork/.worktrees/review-mvp/docs/MODULES.md:27).

**Trigger:** A user/operator reads the Nutrition module description in the complete candidate. It says **“No lookup service, Coach or MCP access is added.”** The branch now includes the lookup route and the explicit diary preview/save flow. The same guide's server-module inventory at [docs/MODULES.md:91](/code/openGym-fork/.worktrees/review-mvp/docs/MODULES.md:91) still enumerates only the three older readers and omits the food-lookup authorization path.

**Impact:** The consolidated guide contradicts shipped functionality and the accurate SELF_HOSTING/INTEGRATIONS instructions. This is documentation drift, not a consent bypass or runtime failure.

**Intended correction:** Replace the stale lookup sentence with wording equivalent to: “Optional Open Food Facts barcode lookup is available to signed-in users when the operator enables FOOD_LOOKUP and the Nutrition choice has synced. Lookup previews; Save creates an entry with its original source snapshot. Manual logging remains available offline. No new Coach or MCP diary access is added.” Link the existing `INTEGRATIONS.md#open-food-facts-barcode-previews-food_lookup` section. Update the developer inventory at line91 to include `api/server.js` / `api/food-lookup.js` and the strict stored `modules.nutrition === true` gate. While editing that paragraph, qualify line84's general “a missing key is on” statement with the opt-in exception already correctly described at lines96–99. No runtime change or suite rerun is warranted for this documentation correction.

## Evidence assessment and earlier finding triage

The exact stage JSON records and selected log tails under `docs/superpowers/evidence/EP-16/` agree on the following **parent-run**, Linux **Node v22.23.5** acceptance at `4cf4bad31575d1f94cf208a8482de5f372488b69`:

| Gate | Inspected result |
| --- | --- |
| Frontend, maxWorkers1 | 8,124/8,124 tests; 673 files; 667.58 seconds; exit0 |
| API, concurrency2 | 912/912 tests; 9 suites; 133.23 seconds; exit0 |
| MCP, maxWorkers2 | 140/140 tests; 6 files; exit0 |
| Production build | exit0; existing chunk/import warnings retained |
| Locales / strict source strings | 19 packs × 3,684 keys; 3,030 source strings; both exit0 |
| Catalogue / coach assets / API docs | all exit0; API docs 93 endpoints / 34 schemas |

All nine stage manifests include the command, SHA, Node version, directory and UTC start/end. Independently checked the paths changed from that tested SHA to frozen HEAD: documentation/evidence only, with no source/test delta. These passing suites do not cover the missing-browser-capability defect I1.

Final entry JS is 587,715 raw / 183,580 gzip bytes: +1,261 / +264 versus the historical EP-00 baseline. Lazy Nutrition is 23,458 / 7,657 and Stats 46,109 / 15,459. The historical comparison spans toolchains and earlier integrated work; it is not an isolated Wave2 performance attribution.

Parent browser records and scripts support explicit lookup/save with real local profile sync, offline edit retaining source/hash, synthetic404/manual fallback, module-off data retention, Stats150/200/400 and workout startup/restoration. The two transport calls were synthetic. The final clean-session diagnostics do not establish the lost earlier session's diagnostics; the reported selector correction and premature cleanup remain disclosed. Wider task evidence covers layouts, real two-profile409, JSON browser restore and completed workouts; ZIP coverage comes from the real-reader tests. This reviewer inspected those artifacts, not a new live browser run.

- **EP-03 I1/I2:** prior corrections remain addressed; the default resolver and opt-in series behavior are preserved in this complete candidate.
- **EP-04 I1/I2/I3 and precision M1:** remain addressed. Present provenance is validated; absent legacy provenance remains unknown under the approved ruling. No invented migration is required.
- **Malformed raw elements:** the approved correction preserves unidentifiable elements during unrelated local/stamping edits; it does not redesign generic ID reconciliation. Identified unsupported/undated rows use the established retained-record path. This distinction is explicit in the earlier review and contract, not silently discarded here.
- **EP-05b stale-Save I1:** remains addressed by the synchronous preview-generation check.
- **EP-04 E1 / EP-05b M1 evidence EOF whitespace:** closed for this candidate. Independently ran `git diff --check 42d75a41 3864f39e`; exit0, no output.
- **Consolidated full-suite ruling:** satisfied by the exact combined runtime gate. Original EP-03 timeout and EP-04 obsolete Tour assertion remain historical failures; no claim that their isolated original heads passed final acceptance.

A separate tiny offline barcode-boundary probe on the shell's Node v24.22.1 rejected trailing line terminators and accepted the valid control barcode. It resolved that concrete reading doubt without a finding; it is not Node22 acceptance evidence. Git reads used the frozen checkout; final status was clean with optional locks disabled. No additional suite/build was run.

## Recommendations

Use the **one final bounded fix wave** for I1 and M1. Preserve a failing capability regression before the UUID correction, then run the focused affected tests and requested insecure-origin synthetic browser proof. Review the corrected helper and source identity before changing this verdict. The existing combined full run remains evidence for its exact runtime; any subsequent acceptance command must name the corrected SHA. Do not broaden or repeat suites merely for the guide edit.

Carry the release gates into the draft PR explicitly. Do not turn local tests, seeded-session browser checks, static Docker COPY inspection or historical live-provider samples into claims of CI, passkey staging, image boot or production release verification.

## Declined to judge

- **Production platform/release readiness beyond the supplied evidence:** Actions dispatch remains422, fork CLA is unresolved, Docker image build/boot and isolated HTTPS/passkey staging/backup rollback are unverified. No environment or authorization was provided to complete them in this review.
- **Physical Android/iOS, Safari, complete assistive-technology coverage, cold-start offline and all19 human translation reviews:** desktop/synthetic artifacts cannot certify these. Existing picker-focus and EP-02 motion-measurement limitations remain visible release follow-ups.
- **New live OFF compatibility/licence/service reliability:** the three-request budget is exhausted and new provider calls are prohibited. Assessed normalization/security against committed fixtures, dated producer research and synthetic tests; did not independently re-fetch external terms or products. Per-process rate/cache limits and shared-IP coordination remain documented operator constraints.
- **Arbitrary historical binaries and unidentified raw-element merge guarantees:** tests exercise old-writer shapes against the current contracts, not every historical app/server. The specifically approved narrow malformed-element retention scope is retained above.
- **Deferred EP-06–15 designs, external Hermes workstation automation and existing dependency advisories:** optional designs were not MVP requirements; the inherited Hermes document is not implemented by this candidate. Unchanged development/optional dependency findings remain in the release ledger, not new-source defects or silently cleared security findings.

## Explicit verdict

**Spec compliance: CHANGES REQUIRED.** The bounded MVP is substantially implemented, but I1 breaks food creation in a documented supported deployment context. M1 should be corrected in the same bounded wave.

**Code quality/correctness: CHANGES REQUIRED — 0 Critical, 1 Important, 1 Minor.** No other actionable defect was confirmed in this whole-branch pass. Passing combined suites are valuable but do not override I1's direct reproduction.

**Draft integration review:** the branch is reviewable and may be presented as a **DRAFT with I1/M1 explicitly open**. It is not yet an accepted integration candidate. After the bounded correction, focused verification and scoped re-review, it can be reconsidered for draft integration acceptance without implying release approval.

**Production release:** **NOT READY / NOT APPROVED.** I1 must be resolved and the listed external release gates remain outstanding. No protected merge, deployment, native publication or GitHub review submission is authorized by this verdict.
