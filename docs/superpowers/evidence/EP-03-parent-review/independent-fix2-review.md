# EP-03 round 2 scoped re-review

Frozen HEAD verified: `6434f47ca71fdce9297a93f92b2953d146c58d65`. Runtime: `7a0d9f4c755a8fc970c9a1945fbe1c7f9934b0af`. Scope: only round 2 (`44b24eed..6434f47c`), original I2 and potential breakage introduced by this correction. Read the supplied fix packet, previous verdict, changed implementation/tests, and appended author evidence. Unrelated surfaces were not reopened.

**I2: ADDRESSED.**

**Spec compliance: PASS for this scoped correction.** Overall EP-03 acceptance remains conditional on the parent's combined frontend gate.

**Task quality: PASS for this scoped correction.** No Critical, Important or Minor defects confirmed. No additional correction required by this review.

## Why I2 is resolved

- `frontend/src/lib/history.js:763` adds the expressly authorized optional `bodyLoadFor(entry)` resolver. Its default is exactly the previous `bodyLoadOf(entry?.id)` lookup. At `history.js:783`, resolution remains conditional on positive bodyweight; the volume arithmetic, warm-up filtering, sides, drops and dumbbell factors are unchanged.
- `frontend/src/lib/exercise-volume.js:13` resolves catalogue/custom metadata with the saved `isAssisted(entry)` flag through the existing `bodyLoadOf` equipment/share rules. Only this production caller opts in, at `exercise-volume.js:46`. No stored entries or exercise metadata are rewritten, and bodyweight arithmetic is not duplicated.
- For ID 0017 explicitly overridden non-assisted, existing equipment rules give no bodyweight contribution: loads 30/40/80 kg at five reps produce **150/200/400 kg**, including the formerly lost endpoint. The tests also preserve the genuine pull-up contribution of **550/600/800 kg** for an 80 kg bodyweight.
- New helper and Stats tests cover both target-level and entry-level false overrides, rising loads, the equal-bodyweight endpoint, chart/table values, inclusion counts and nonmutation. Tests explicitly retain the ID-based default consumer results. Existing assertions and Stats runtime are unchanged.

## Independent checks and inspected evidence

1. A tiny inline offline Node **v22.23.5** probe imported the frozen real helpers. For both override shapes, it asserted series values `[150, 200, 400]`, zero exclusions, unchanged source state, and default `workoutVolume` results `[250, 200, 0]`. All assertions passed. One process, no workers, no files written; this was not a suite rerun.
2. RED `096ee44b` precedes GREEN `7a0d9f4c`. Commit body and preserved RED log agree on **5 failed/46 passed**. Initial GREEN log reports **51/51**. The final published-runtime log reports **414/414 across 19 files**, covering Stats and the relevant history/volume/bodyweight/1RM/dumbbell regressions. These counts are inspected author runs, not reviewer reruns.
3. `round2-verified-head.txt` identifies exact runtime `7a0d9f4c` and Node v22.23.5. Independently checked `git diff --exit-code 7a0d9f4c..6434f47c -- frontend`: empty, exit 0. Thus this round's evidence targets the published runtime, with no later frontend delta; it does not depend on the unavailable round 1 pre-rebase object.
4. Build evidence reports success in **2.44 s** with existing warnings retained. Bundle evidence records entry +703 raw/+266 gzip and Stats +3,165 raw/+1,054 gzip against the published baseline. No build was rerun.
5. Inspected the two browser JSON records and the harness adaptations, including their guarded substitutions. Both target-false and entry-false scenarios select Volume/1W, display three one-set rows **150/200/400**, and report three included/zero excluded, visible focus, semantic table roles, no overflow/clipped range labels and no exercise media elements. Each records two expected guest `/api/me` 401 responses and matching network errors. Independently sampled `round2-target-false-rising.png`: the rising chart and three table rows agree and fit at 320 px. No browser or service was launched here.
6. `git diff --check 44b24eed..6434f47c` passed. The checkout remained clean. Changes are limited to the authorized resolver, exercise-volume opt-in, focused tests and EP-03 evidence. No dependencies, persisted state, locale strings, unrelated consumer behavior or Stats runtime changes.

## Practical limits retained

- **The parent's combined-candidate full frontend acceptance gate is still pending.** Original 7,952 passed/1 timeout, outer exit 143/uncaptured child exit and isolated 31/31 remain historical evidence. Neither focused success nor this review reclassifies that full run as green.
- No full suites, heavy jobs, build, live browser, services, installs or provider calls were run by this reviewer. Author publication timing is recorded evidence; remote branch state was not queried. Git reads disabled lazy fetching.
- The two browser cases are narrow correction proof. The earlier Arabic RTL sample remains valid historical evidence but was not repeated in round 2. All-locale quality, full screen-reader behavior, existing picker focus limitations, native/platform/device checks, cold-start offline, staging/deployment and baseline-environment limits remain as previously documented.
- I1's prior addressed status is retained. This is not a new review of unrelated implementation or externally merged changes.

Only `/tmp/opengym-review/ep03-fix2-verdict.md` was written. No implementation or Git-state mutation, subagents or exercise-media access. This correction is ready for the parent's separate combined acceptance gate; no merge or deployment approval is implied.
