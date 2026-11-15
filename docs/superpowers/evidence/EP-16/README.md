# MVP combined acceptance record

Status: **final review findings closed; corrected acceptance passed; ready for draft integration review, not release approval**. Parent working branch:
`room/autonomous-project-resumption-orchestrat-djus`. The full acceptance commands below
ran after the final EP-05b source review. The [whole-branch review](independent-review-round1.md)
found a missing UUID fallback on supported plain-HTTP LAN origins plus a stale Modules-guide
statement. Both were resolved in one bounded wave and the [scoped final review passed](independent-fix-review.md),
with zero open/new findings. The original passes below predate that correction. Corrected
frontend acceptance is recorded separately below.
The bounded scope and staging checklist are in [EP-16-mvp-gates](../../plans/EP-16-mvp-gates.md).

## Source lineage and reviews

| Delivery | Reviewed source | Parent integration | Review and evidence |
| --- | --- | --- | --- |
| EP-03 volume plus assistance corrections | final6434f47c, runtime7a0d9f4c | Original PR9 merged externally; correctionf6e9dafb..1940ebdf | [Final scoped PASS](../EP-03-parent-review/independent-fix2-review.md);414 focused tests; browser; earlier failure preserved |
| EP-04 diary and adoption/validation corrections | finalddcd1be5, runtime0ac5cbc8 (identical to reviewedfe22da11) | faede047..7d9423bd,50 source/test/contract paths identical | [Scoped PASS](../EP-04-parent-review/independent-fix1-review.md);218 focused frontend/47API; browser/backup evidence |
| EP-05a server lookup | finalc976b963, runtime176b1698 | Original task cherry-picks then external PR11 merge470defb7 | [Independent PASS](../EP-05-parent-review/independent-review.md); FE7917/API911/MCP140; three live requests exhausted |
| EP-05b preview and saved source snapshot | final1ee7d922, reviewed runtime762f48a5; [PR14 merged externally](https://github.com/sorensadrgit-art/openGym/pull/14) | d9b54358..ef571176 plus evidence; source/tests/operator docs identical | [Scoped PASS](../EP-05b-parent-review/independent-fix1-review.md);172 focused tests, browser/build; EOF evidence cleanup verified |
| Final whole-branch UUID/guide correction | final766a99a2, runtime0a56181b | dd3eabdd..88927683; source/tests/guide identical | [Scoped PASS](independent-fix-review.md);37 focused/171 covering tests, natural insecure-HTTP browser proof |

Original task/review failures are retained, not turned into passes by later focused checks.
EP-03 full frontend had7,952 pass/1 timeout, with isolated31/31. EP-04 pre-correction full
frontend had7,962 pass/1 obsolete default-preset assertion, subsequently corrected. Both
tasks' final full acceptance is consolidated into the exact combined runtime gate.

## Combined checks to record

Environment: Linux; Node22.23.5; existing lockfiles; one heavy job at a time. Combined runtime
candidate: `4cf4bad31575d1f94cf208a8482de5f372488b69`. Start/end/exit and counts are recorded
with each command. Long jobs use retained TTY sessions; interrupted output cannot be labelled
passing. Later evidence-only commits do not change this tested runtime.

| Check | Result | Evidence |
| --- | --- | --- |
| frontend `npm test -- --maxWorkers=1` | PASS:8,124 tests /673 files; exit0 | [Command/timestamps](frontend-full.json), [output](frontend-full.log);667.58s |
| API `node --test --test-concurrency=2 test/*.test.js` | PASS:912 tests /9 suites; exit0 | [Command/timestamps](api-full.json), [output](api-full.log);133.23s |
| MCP `npm test -- --maxWorkers=2` | PASS:140 tests /6 files; exit0 | [Command/timestamps](mcp-full.json), [output](mcp-full.log) |
| Production build, entry/lazy bundle sizes | PASS; exit0 | [Build](build.log), [sizes](bundle.json); entry183,580 gzip bytes, Nutrition7,657, Stats15,459 |
| Locale and strict source-string checks | PASS; both exit0 | [19 packs ×3,684 keys](locales.log), [3,030 strings](source-strings.log) |
| Catalogue, coach-assets and API-docs generators | PASS; all exit0 | [Catalogue](catalogue.log), [coach](coach-assets.log), [API docs](api-docs.log):93 endpoints/34 schemas |
| Combined browser paths | PASS for bounded smoke below | [Observed results](browser-results.json); synthetic account, media blocked, no live provider calls |
| Final whole-branch independent review | Initial I1/M1 closed; scoped PASS, zero findings open | [Full verdict](independent-review-round1.md), [final scoped verdict](independent-fix-review.md) |

The UI author ran focused tests/browser/build during implementation. Parent ran the full
combined gate once; no duplicate task full run is requested. If a real failure requires a code
correction, retain the failed run and rerun the affected gate on corrected source.

The complete serial runner is [combined-verify.py](combined-verify.py); each stage JSON records
the expanded command, exact Node/source SHA, working directory, UTC start/end and exit. All
nine stages exited0. Frontend logs retain happy-dom's disabled YouTube iframe warnings; build
logs retain existing large-chunk/ineffective-dynamic-import warnings. Neither is hidden or
described as a failed assertion. Logs were trimmed only for trailing whitespace.

## Corrected candidate gate

Corrected runtime candidate: `bb123447699e5f1eb96d4ced815856eb21942d2c`. It integrates reviewed
`0a56181b` byte for byte. The only runtime correction is the private food-event UUID helper:
native randomUUID is preferred; insecure HTTP LAN origins use getRandomValues with RFC4122-v4
version/variant bits. [Complete correction evidence](../EP-16-final-fix/README.md) preserves
the actual failing manual/lookup Saves and successful natural insecure-origin browser rerun.

| Corrected check | Result | Evidence |
| --- | --- | --- |
| Full frontend, one worker | PASS:8,128 tests /674 files;exit0 | [Command/timestamps](final-frontend-full.json), [output](final-frontend-full.log);681.83s |
| Production build | PASS;exit0 | [Build](final-build.log), [final bundle](bundle-final.json), deterministic gzip level9 |
| Locales / strict source strings | PASS;both exit0 | [19×3,684 keys](final-locales.log), [3,030 strings](final-source-strings.log) |
| API912 /MCP140 /three generators | Carried forward unchanged, not rerun | [Git object identity](carried-forward.json) for API/MCP/scripts/catalogue/lockfiles |

The final correction is a concrete new source change, so one affected full frontend rerun is
warranted. API/MCP and generated inputs are unchanged; their original exact full passes remain
applicable. No additional provider request or duplicate API/MCP run is claimed.

## Combined browser smoke

Production build from the tested runtime, Chromium at390px/reduced motion, real local API
on33106 and Vite preview5179. The [UI author's synthetic HTTPS preload](../EP-05b/synthetic-transport.mjs)
replaces provider transport only; real authentication, consent, normalization and profile sync
execute. Local test session was seeded with a generated secret in a restricted throwaway
directory. No credential or raw session is retained here. Exercise-media requests were blocked
before navigation or screenshots. [Preview capture](combined-preview-390.png) was visually read.

- Opening/typing caused zero provider calls. Explicit lookup of synthetic200kcal/100g oats
  followed by25g Save created50kcal, known fat0, carbohydrate absent. Server state received
  the identical original snapshot through ordinary profile sync.
- Offline reopening/editing changed entry energy to123 while original source200 and the hash
  stayed unchanged; no new provider call. Unknown product showed an error, then manual logging
  saved protein0.024. Only two synthetic transport calls occurred in the entire smoke.
- Turning Nutrition off hid lookup and retained both entries. With it off, Stats one-week
  Volume showed150/200/400 for saved non-assisted overrides with bodyweight volume on, plus
  a chart and no horizontal overflow. Freestyle workout startup created an active session.
- Explicitly discarded that empty test workout, restored Nutrition, and verified both records
  and original snapshot remained. Final browser session had zero uncaught exceptions and zero
  HTTP errors. Earlier offline emulation and the deliberate404 are separate expected cases.

Harness corrections are recorded in browser-results: the initial amount selector needed the
actual `lookupAmount` name. Parent then prematurely stopped its services while the final step
was waiting for a second Discard confirmation. Earlier saved assertions were retained; the
services were restarted and final confirmation/module restoration passed. Earlier-session
diagnostics were lost, so only the clean final session has a no-errors claim. This is not a
claim that every original browser event was error-free. [Initial flow](combined-browser.py)
and [module/Stats flow](combined-browser-rest.py) retain the helper-based checks; the final
confirmation was performed interactively. The wider task-owned browser matrices remain the
evidence for320/1280, light/RTL and additional arithmetic cases.

Owned API/Vite/Chromium PIDs52659/52689/52731, then53409/53439/53481 were stopped. Ports
33106/5179/9326 were confirmed closed. Throwaway data/secret/cookie/profile were removed.

## Coordination rulings retained

- Missing legacy provenance remains unknown; present metadata is validated. Inventing source
  history would corrupt older records. If this compatibility choice is too permissive, missing
  metadata can remain unverifiable rather than causing rejection.
- Full EP-04 correction and EP-05b suites were consolidated into this exact combined gate.
  Both now have a full passing run; the cost is that their original isolated delivery heads
  are not claimed to have separately passed the final full suite.

## Release limits retained

- **CI unavailable:** last dispatch returned422, and the new draft correction PR had no check
  runs. Queued unrelated dynamic jobs are not test passes. No Actions permissions were changed.
- **Docker/staging unverified:** no Docker executable, no image build/boot, isolated HTTPS
  passkey deployment or rollback rehearsal. Source-server HTTP and COPY-manifest tests are
  separate evidence. Existing compose upstream-latest images are not this fork candidate.
- **Device/accessibility limits:** desktop Chromium coverage does not certify physical
  Android/iOS/Safari, all locales, screen readers or cold-start offline behavior. Existing shared
  picker focus limitations and earlier EP-02 motion-measurement limits remain documented.
- **Security baseline:** existing development/optional dependency advisories remain in
  [the resumption audit](../codex-resume/README.md). Frontend production and defaultAPI
  nonoptional audit subsets had zero advisories; this is not an all-target security approval.
  The server author's install log also reports existing watch-zepp high/critical findings;
  that optional watch dependency tree has not been remediated or certified by this MVP work.
- **Owner/operator gates:** fork CLA configuration unresolved; OFF operator usage setup is
  documented, not completed on the owner's behalf. No provider request beyond the authorized
  three was made. No protected-branch merge, public deployment or native release was performed
  by this coordinator or its children. PR9/11 were externally merged while work continued.
- **Scope:** EP-00–05 and this bounded evidence task comprise MVP work. EP-06–15 remain
  deferred optional designs, not silently implemented or declared complete.

No production data, credentials, licensed exercise media or raw browser session cookies belong
in these artifacts. All browser records are synthetic; the final lookup UI uses a local
synthetic HTTPS boundary for provider responses while retaining real route/auth/normalization.

## Updated integration and final disposition

Draft [PR #15](https://github.com/sorensadrgit-art/openGym/pull/15) targets `next/integration`.
It restores clean nutrition syntax after the external task merges and includes the verified
HTTP-LAN UUID fallback. The source is identical to the final tested runtime; later commits
only record evidence and the PR handoff. No protected-branch merge or deployment was performed.

External PR12/13/14 merges advanced integration to ccf8188a and introduced duplicate syntax
blocks. [Reconciliation evidence](upstream-merge-reconciliation.md) records the failing upstream
parse and the ancestry merge preserving our exact passing tree. Final source remains identical
to tested bb123447; all review findings are closed. The candidate is ready for draft integration
review; release/platform gates above remain blocked or unverified. No production approval is
implied. The final reviewer's Declined-to-judge items are accepted as the documented environment,
optional-track and historical-client limits, not silently cleared or newly implemented scope.
