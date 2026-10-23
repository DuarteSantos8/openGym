# Fatigue model v2: sets-based, per-muscle half-life (rationale for PR)

## Problem (observed on real history: 1707 workouts, ~daily Jefit splits)

`fatigueOf()` in `frontend/src/lib/recovery.js` reports near-permanent whole-body
`fatigued` for high-frequency split training. Computed on the reporter's state
(`state-ygurXGuvcyWHwpO9.json`, 23 sessions / 30d): quadriceps/calves/hamstring
`1.000`, chest `0.666` and triceps `0.612` even though upper body was last hit
1.9 days ago and legs 1.2 days ago. A rotating upper/lower split can never show
green.

## Root causes in the current model

1. **Tonnage stimulus overweights heavy compounds.** `setTonnage()` scores
   `load x reps x (load/1RM)^1.5`, so a `250x7` leg press counts ~50x a `5x12`
   fly. Hypertrophy dose-response tracks **hard sets near failure**, not tonnage
   (Schoenfeld et al.; review https://pmc.ncbi.nlm.nih.gov/articles/PMC8884877).
2. **One half-life (36h) for every muscle.** 10RM reproducibility data shows
   lower body recovers slower than upper: at 24h squat −12.6% vs bench −9.2%,
   at 36h −6.6% vs −3.0%, full recovery by 48-72h
   (https://pmc.ncbi.nlm.nih.gov/articles/PMC6719818). A single 36h constant
   keeps small upper-body muscles red too long.
3. **Saturation `1-exp(-v)` compresses the top.** Daily training drives raw
   stimulus to 5-13, everything above ~3 maps to >0.95. "Legs yesterday" and
   "chest 2 days ago, light dumbbells" become indistinguishable.
4. **Downward-only reference never adapts up** (`recovery.js:264-265`). A
   trained lifter (repeated-bout effect: faster recovery, strength back in
   ~3d vs −40% in untrained) scores ever-more fatigue at constant training.
   MPS in trained lifters is lower and shorter (peak ~5h, tail 24-48h; Damas /
   Phillips: https://pmc.ncbi.nlm.nih.gov/articles/PMC5023708,
   https://pmc.ncbi.nlm.nih.gov/articles/PMC5401959).

Framework notes: Banister 1975 fitness-fatigue (`performance = fitness - fatigue`,
different time constants; https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager)
justifies per-muscle + systemic components. ACWR (acute 7d / chronic 28d, sweet
spot 0.8-1.3; https://pmc.ncbi.nlm.nih.gov/articles/PMC8138569) is used here
only as a preparedness normalisation idea, not an injury predictor — the latter
claim is disputed (https://www.globalperformanceinsights.com/post/has-the-acute-chronic-workload-ratio-been-debunked).

## Proposed change (this PR: phase 1, monotonicity-preserving)

- **Stimulus in effective hard sets**, not tonnage:
  `stimulus_m = min(cappedSets_m, 12) / 8`. One full session (~8 hard sets on a
  muscle, the per-session growth plateau per Weightology/RP Strength) = 1.0 raw
  unit. Secondary movers count 0.4 (existing `musclesOf` weights). Warm-ups
  still count (mechanical work), rest-pause clusters don't (already covered by
  the row total), drop-set drops count as extra sets. Cardio/timed rows count
  as sets (duration proxy), not tonnage.
- **Session-local relative intensity per set**: `(load/entryBest)^1.5`, unit-free
  (kg/lb histories score identically), zero-load sets count full (assume hard when
  unknown). Ramp-up rows therefore cost a fraction of a set instead of a full one.
  Absolute loads across sessions are intentionally invisible (no RIR data — a lighter
  session may still be the harder one); cross-session load sensitivity belongs to
  the chronic denominator (phase 2).
- **Per-muscle half-life**: arms/deltoids/forearm 24h, chest/upper-back/traps
  30h, glutes/quads/hams/adductors/calves/lower-back 48h, core/small 24h.
  Calibrated so 8 hard sets on legs -> F0 ~0.63 (fatigued), ready in ~4d;
  5 sets chest -> F0 ~0.46, ready in ~2d (matches the 10RM 48-72h recovery).
- **Keep** `1-exp(-v)` scale and `0.25/0.5` thresholds (`recovery-view.js`), so
  no UI/locale changes. Keep chronological accumulation, 30-day scan bound,
  future-date clamp, deleted-snapshot handling, and `strengthOf()` untouched.
- **Preserved invariants** (checked by `scripts/fatigue-monotonic-probe.mjs`):
  rest never increases fatigue; deleting a workout never increases fatigue;
  out-of-scan imports are irrelevant. Stimuli stay non-negative and causal, so
  the probe passes unchanged.
- **Deliberately deferred to phase 2**: chronic-load (EWMA28) normalisation for
  the repeated-bout effect. Any history-derived denominator breaks the
  deletion-monotonicity invariant (deleting an old session lowers the chronic
  base and inflates later scores), which needs maintainer discussion first.

## Calibration on the reporter's data

Measured on `state-ygurXGuvcyWHwpO9.json` (1707 workouts, 23/30d, upper/lower
Jefit rotation; upper last hit 1.9d ago, legs 1.2d ago), `fatigueOf(workouts, now)`:

| Muscle | Before | After | State after |
|---|---|---|---|
| quadriceps / hamstring / calves / gluteal | 1.000 / 1.000 / 1.000 / 0.951 | 0.559 / 0.542 / 0.619 / 0.660 | fatigued (heavy legs yesterday — correct) |
| adductors | 0.982 | 0.471 | recovering |
| chest | 0.666 | 0.251 | recovering (borderline ready) |
| deltoids / upper-back / triceps / biceps | 0.764 / 0.571 / 0.612 / 0.494 | 0.171 / 0.158 / 0.125 / 0.083 | ready |
| abs / serratus / hip-flexors / tibialis | ~0 | 0.000 | ready (untrained lately) |

The split now diverges: legs red after leg day, upper green — the complaint is
fixed while 3x/week full-body demo histories barely move.

## Phase 2 (this change): RIR quality + acute:chronic gain

Two orthogonal multipliers on top of the phase-1 sets, both causal and bounded:

- **RIR weight per set** (`rirWeightFor`, `estimateSetRir`): logged `rir`/`rpe`
  (via `effort.js`, `HARD_RIR = 3`) always wins; otherwise RIR is estimated by
  Epley inverse against the exercise's 90-day rolling best anchor
  (`30*(anchor/w-1)-r`, clamped 0..10, null above `REP_CAP = 12`, for
  load-less rows, or assisted work). The anchor itself is RIR-calibrated: each
  session's best runs on effective reps (done plus logged RIR, a set taken to
  failure adding nothing), so a rated set reads its own rating back and an
  unrated twin of it reads the same. Weight is 1.0 at RIR <= 3, linear down to
  the 0.3 floor at RIR >= 6. Loads canonicalise to kg through the
  set -> target -> entry -> workout -> opts chain, so mixed-unit imports anchor
  correctly (176 lb anchors like 80 kg). A ramp-up row therefore costs a
  fraction of a set; a deload week of half-weight work reads RIR 10 instead of
  8 phantom hard sets (the case session-local intensity could never see).
- **Acute:chronic gain per session and muscle**: `clamp((acute7+4)/(chronicW+4),
  0.5, 2)` with a 4-sets/week novice prior (repeated-bout effect as arithmetic:
  first sessions score amplified, maintained veterans ~1.0 reproduce phase 1).
  Maintenance preserves the phase-1 calibration by construction.

**Contract change (deliberate, probe updated):** anchors and gains are
history-dependent, so deleting a mid-history workout may re-score later sessions
(removing a PR lowers their anchors). What still holds, and is now probed:
rest never increases fatigue, out-of-pool imports stay irrelevant, and deleting
the *chronologically latest* session never increases anything. A subtle
correctness point the probe caught twice during development: the info pool must
span scan + anchor window (120d), otherwise sessions age out of anchors as `now`
advances and rest would raise fatigue; and "latest" means max timestamp, not
array order.

Measured on the same state: gluteal 0.533 fatigued, hamstring/quads/calves
0.31-0.46 recovering (heavy legs 1.2d ago - pyramid ramp sets now correctly
discounted), chest 0.156 ready (upper 1.9d ago). Phase 1 read 0.54-0.66/0.251
on the same day; the direction is the same, the magnitudes now respect quality.

## Follow-up: estimated effort in the Stats Effort card

`EffortCard` only rendered on logged ratings, so import histories saw nothing.
It now falls back to estimates with the same precedence fatigue uses (logged >
Epley-inverse vs 90-day anchor > nothing), sharing `anchorsByWorkout` /
`resolveSetRir` from `recovery.js` (no import cycle: the view wires both,
`effort.js` takes an injected resolver defaulting to logged-only, so default-path
numbers are byte-identical). Well-rated windows (`rated >= MIN_RATED`) keep
logged numbers; the badge `· estimated` plus the `{rated} · {estimated} of
{sets}` denominator keep estimates labeled. Two new locale strings in all 16
packs, pt-BR fingerprint refreshed. Measured on the reporter's history (30d):
358 estimated of 407 sets, avg RIR ~5.3, 37% hard — the Jefit pyramids read
exactly as trained: heavy top sets plus light ramp volume.

- `frontend/src/lib/recovery.js` — phase 1: sets stimulus + per-muscle HL; phase 2:
  RIR weighting, 90-day anchors (kg-canonical), acute:chronic gain, 120d info pool.
- `frontend/src/lib/recovery.test.js`, `recovery-view.test.js`,
  `src/views/Stats.recovery.test.jsx` — re-pinned expectations (same
  structure, sets-based numbers) + RIR/deload/deletion-contract tests.
- `frontend/scripts/fatigue-monotonic-probe.mjs` — latest-session (max timestamp)
  deletion contract (mid-history rescoring is intended, not a violation).

## Validation

- `cd frontend && npm test` — recovery suites green (59); full suite: only 2-3
  pre-existing failures (see phase-1 notes; `useStore.media` is flaky on clean
  tree too).
- `npm run test:fatigue-probe` — PASS (108000 time + 1800 latest-deletion
  comparisons; contract changed, see above).
- `node scripts/check-locales.mjs` — clean (2 new strings in all 16 packs,
  pt-BR fingerprint refreshed).
- `cd api && npm test` — 471 pass / 2 fail, identical on clean tree
  (password-hash timing tests, unrelated).
- `cd mcp && TZ=UTC npm test` — 63/63 (bare `npm test` fails on +07 machines
  for the pre-existing demoSeed/TZ reason, untouched by this change).
- Manual: Stats -> Fatigue map on a daily-split profile shows rotation.
