# Proposal: running, rowing, treadmill and elliptical as first-class work

**Status:** proposal. The PR carrying this document also implements steps 1, 2 and 5 of the
sequencing below, so the idea can be judged by using it rather than by reading about it. Steps 3
and 4 are deliberately left undone — they change existing behaviour, and that is your call, not
a decision to be smuggled in with an enhancement.
**Scope:** the `cardio` logging mode, the exercise catalogue, progression, stats, and what the AI Coach can see and say about endurance work

---

## The short version

openGym has a `cardio` mode already. It is not that endurance work is unsupported — it is that
it is supported *shallowly*, in three specific ways that compound:

1. **The catalogue has almost nothing to log.** 29 of 1,324 exercises are cardio. There is
   **one** treadmill entry, **one** elliptical entry, **no rowing machine at all**, and
   **nothing for running or jogging outdoors**.
2. **The data model measures the wrong thing.** A cardio set is `{ min, speed }` — duration and
   a km/h number. That describes a treadmill dial. It does not describe a run, a row, or an
   elliptical, all of which are measured by *distance* and *pace*.
3. **Cardio cannot progress and does not count.** `POLICIES_FOR.cardio` is `['off']` — there is
   no progression policy that can drive it. And `workoutVolume` sums `w × r`, so a cardio set,
   which has neither, contributes **exactly zero** to volume, to the stats screen, and to every
   load-shaped signal the app derives.

Point 3 is the same class of problem v1.2.4 fixed for bodyweight work, and it has the same
consequence for the Coach: a perfectly good 5 km progression looks, from the inside, like
nothing happened.

---

## Evidence

Measured against `api/coach/library.json` and the current `frontend/src/lib`:

| Claim | Evidence |
|---|---|
| 29 cardio exercises out of 1,324 | `library.json`, `bp === 'cardio'` |
| One treadmill exercise | `walking on incline treadmill` |
| One elliptical exercise | `walk elliptical cross trainer` |
| No rowing machine | every "row" match is a barbell/dumbbell/cable row — strength, `bp: back` |
| No outdoor running | no entry matches `run`/`jog` with `bp: cardio` |
| Cardio cannot progress | `POLICIES_FOR = { reps: […], time: ['off','time'], cardio: ['off'] }` |
| Cardio counts for nothing | `workoutVolume`: `v += (s.w \|\| 0) * (s.r \|\| 0)` |
| Cardio set shape | `{ min, speed }`, default `{ sets: 1, min: 20, speed: 8 }` |

---

## Why `speed` is the wrong primitive

`speed` in km/h is a machine setting, not a training record. It works for a treadmill because a
treadmill *has* a speed dial you set and hold. It fails everywhere else:

- **Running outdoors.** You do not hold a speed. You cover a distance and it takes a time. Pace
  (min/km) is derived from those two, and pace is what runners actually train and talk about.
- **Rowing.** The universal unit is the **500 m split** — time per 500 m — plus stroke rate.
  A km/h figure is meaningless on an erg; nobody reports it and no rowing machine displays it.
- **Elliptical.** Neither speed nor distance is comparable between machines. What is repeatable
  is *duration at a resistance level*, optionally with a machine-reported distance.

The single `speed` field forces all four modalities through the one that happens to fit
treadmills, and quietly discards the number the athlete actually cares about.

### What to store instead

Keep `min`. Add **`dist`** (metres, integer). Derive everything else:

| Modality | Logged | Derived and displayed |
|---|---|---|
| Outdoor run | `min`, `dist` | pace = min/km |
| Treadmill | `min`, `speed` *(kept)*, optional `incline` | distance if speed held |
| Rowing | `min`, `dist`, optional `spm` | 500 m split |
| Elliptical | `min`, optional `resistance`, optional `dist` | — |

`dist` in metres avoids a unit field: it is exact for a 5,000 m run and for a 2,000 m row alike,
and rendering respects the profile's existing `unit` the way weights already do. Nothing about
this is speculative — it is the smallest set of fields that makes the four modalities
representable without inventing a second logging mode.

**Back-compatibility is free.** Every field is additive and optional. A cardio set logged today
is `{ min, speed }` and stays valid; absent `dist` simply means no distance was recorded, the
same way an absent `weight` already means unloaded.

---

## Progression: cardio currently has none

`POLICIES_FOR.cardio` is `['off']`, so the progression engine has nothing to offer endurance
work. That is the honest state of things today — not an oversight to paper over, but the reason
a runner gets no help from an app that helps every lifter.

Proposed: **one** new policy, `endurance`, deliberately not four.

> Hold the session's shape and grow one dimension at a time: extend duration or distance until
> a ceiling, then hold volume and improve pace, then reset volume at the new pace.

That mirrors how `double` already works for reps (grow reps to a ceiling, then add load and
reset) and reuses the ceiling idea `repsMax` introduced for bodyweight work. It also means one
new entry in `POLICIES`, one in `POLICIES_FOR.cardio`, and one policy implementation — not a
parallel engine.

Deliberately **not** proposed: heart-rate zones, VO₂ estimates, or training-load models. They
need sensor data openGym does not collect, and they would be the first feature in the app that
cannot be driven from what the user typed in.

---

## Stats and volume: the v1.2.4 lesson, again

`workoutVolume` sums `w × r`. A cardio set has neither, so an hour on the erg adds nothing to
the number the app uses as its headline measure of work done. A week of running shows as a week
of nothing.

This is precisely the shape of the bodyweight problem v1.2.4 fixed, and it should be fixed the
same way: **do not fold cardio into a load-based number.** Volume in kg·reps and volume in
metres are not commensurable, and adding them produces a figure that means nothing.

Instead:

- keep `workoutVolume` as-is — it is correct for what it measures
- add a sibling aggregate for endurance (total time, total distance, sessions) and show it
  alongside rather than merged
- make the streak and "sessions this week" counters include cardio sessions, which they should
  already and which is the change most visible to a user

---

## What this means for the AI Coach

The Coach's `cardio` change type already exists and carries `{ min, speed }`. Three changes make
endurance work legible to it, and they are small because the boundary is already in the right
place:

1. **`payload.js`** — send `dist` and the new optional fields, and add an endurance block to the
   aggregates (weekly distance, weekly time, session count) so the model can see a trend at all.
   Without this the Coach reads a runner's whole training block as zeros, and the obvious
   proposal from zeros is to add strength work.
2. **`validate.js`** — extend the `cardio` change type to accept `dist`, `incline`, `resistance`
   and `spm`, with bounds, and add `endurance` to the policy list. The closed list stays closed;
   this is one existing member learning more fields.
3. **`prompts/common.md`** — state the same rules the validator enforces: pace is derived, not
   prescribed; a 500 m split is how rowing is discussed; do not prescribe a km/h for an outdoor
   run.

The parity test (`coach-parity.test.js`) already pins the server's copies of the reading rules
against the frontend's. Any new derived reading — pace, split — belongs in the same table, for
the same reason: the two runtimes share no build step, and a silent divergence here would make
every cardio proposal read as stale.

---

## Catalogue

The dataset openGym builds from is a strength-training catalogue; it is not going to grow a
credible running section. These entries have no images and no external source, so they should be
added as **first-party catalogue rows** via `scripts/build-coach-library.mjs`, clearly marked so
a dataset refresh cannot silently drop them:

| Name | `bp` | `eq` | Notes |
|---|---|---|---|
| Run (outdoors) | cardio | body weight | no machine; `dist` + `min` |
| Jog / easy run | cardio | body weight | distinct intent, same fields |
| Treadmill run | cardio | leverage machine | `speed`, optional `incline` |
| Treadmill walk (incline) | cardio | leverage machine | exists already |
| Rowing machine | cardio | leverage machine | `dist` + `min`, optional `spm` |
| Elliptical | cardio | elliptical machine | one exists; add a run variant |
| Stationary bike | cardio | stationary bike | exists; keep |

Seven rows, of which three already exist in some form. This is the smallest set that covers what
people actually do, and it is deliberately not an attempt to model every cardio machine on a gym
floor.

---

## Suggested sequencing

Each step is independently shippable and independently revertible.

| PR | Contents | Risk |
|---|---|---|
| 1 | `dist` and optional machine fields on the cardio set; logging UI; display of derived pace and split | Low — additive, no migration |
| 2 | Catalogue rows + `build-coach-library.mjs --check` coverage | Low — data only |
| 3 | `endurance` progression policy | Medium — touches the progression engine |
| 4 | Endurance aggregate in stats; streak and session counters include cardio | Medium — changes a visible number |
| 5 | Coach: payload fields, validator, prompts, parity test | Low — the seam already exists |

PRs 1 and 2 alone make running, rowing and elliptical work properly loggable, which is most of
the value. 3 through 5 are what make the app *help* with them.

---

## Open questions for the maintainer

1. **Is `dist` in metres acceptable**, with display converted per the profile's `unit`, or would
   you rather store in the user's unit as weights are stored?
2. **Should `endurance` be one policy or two** (one that grows volume, one that improves pace)?
   One is simpler and mirrors `double`; two is more explicit about intent.
3. **Do the new catalogue rows belong in the generated library at all**, or should openGym grow
   a small first-party supplement file that survives a dataset refresh by construction? The
   second is more work now and less fragile later.
4. **How much does cardio belong in the streak?** Counting it is obviously right for a runner and
   changes an existing number for everyone else.

---

*Written against `coach` at the commit that merged the AI Coach UI. All measurements above are
from the repository as it stands rather than from memory; the queries are one-liners over
`api/coach/library.json` and `frontend/src/lib/{history,progression}.js` if you want to
re-run them.*
