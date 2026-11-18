# The Coach and the research behind it

Design, 2026-11-17. Applies to the AI Coach (`api/coach/`, shared with the phones through
`api/coach/core/`).

## Intent

The Coach should give better advice, and people should trust it more. Today its rule 5, "Cite the
evidence", means the lifter's own log: a stall, an effort trend, a missed session. It never
points to research, and the model works out its own numbers ("your back gets 6 sets") in free
text, where nothing checks them.

The evidence comes from the owner's coAIch plugin (`plugin/references/evidence.md` in
cubetes/coaich, AGPL like openGym, same author). Every study there was checked against PubMed and
graded, and coAIch's scripts do every sum while the model only reads the results. This design keeps that split:
**the app counts, the Coach reads and chooses, and the Coach can only cite from a fixed list.**

## Goals

- **Better advice.** The Coach knows a short set of research-backed rules and gets a list of
  places where the person's plan falls outside them, already worked out by the app.
- **Trust.** A suggested change can carry one source tag. The app turns it into a short
  reference with a link to PubMed, and, when it rests on a check, the app's own numbers.
- **No sums by the model.** Every count the person sees comes from app code with a unit test.

## Non-goals

- No change to the progression engine (it still sets every load) or to the in-workout `adapt`
  job and the chat's quick actions. They get no checks in this version.
- No re-check of the plan after the Coach's changes ("after this, lats 10 sets"). Later, if the
  first version works.
- No nutrition, body composition, wearables or pain rules from coAIch.
- No web research. The existing opt-in web research stays as it is.

## Anti-goals (would make this a failure even if it works)

- A study the model made up, or a real study attached to a claim it does not make.
- A number the model worked out shown as if the app had measured it.
- A prompt so much longer that a small model on a home CPU becomes too slow to use.
- A check that grades the person. Below a range is "room for more", never a failing mark
  (the wording `lib/muscle-targets.js` already uses).

## Approaches considered

- **A. Rules in the prompt, the app computes checks, a source tag per change. Picked (owner),**
  with the owner's condition that the Coach does not calculate by itself.
- B. Rules in the prompt and a docs page only. Better advice, but people never see a source in
  the app, so only half the goal.
- C. The model cites studies in its own words. Dropped: models invent real-looking references.

## Decided

### 1. A fixed list of sources (`api/coach/core/evidence.js`)

One table, shared by the server, the phones and the docs page: tag → short cite, grade, one-line
finding, PubMed id and DOI. The entries are copied from coAIch's `evidence.md` (verified there),
kept as narrow as the study allows, and graded honestly: `SR/MA`, `RCT`, `OBS`, or `our rule`
for a number no study backs.

First tags (source → what the Coach may use it for):

| Tag | Sources | Use |
|---|---|---|
| `volume` | Schoenfeld 2017 (SR/MA), Currier 2026 (ACSM, SR/MA), Pelland 2025 | more weekly sets help, with diminishing returns |
| `volume-cap` | Baz-Valle 2022 (SR/MA); the band itself is a coaching band (our rule) | stacking sets past the range adds little |
| `frequency` | Pelland 2025, Currier 2026, Schoenfeld 2019 (all SR/MA) | twice a week per muscle helps strength; size depends on weekly sets, not on how they are spread |
| `sets-per-exercise` | Krieger 2010 (SR/MA) | 2 to 4 sets per exercise; more on one exercise adds little |
| `effort` | Robinson 2024, Refalo 2023 (SR/MA), Refalo 2024 (RCT) | big lifts stop 1 to 3 reps short; failure adds fatigue, not growth |
| `rep-range` | Schoenfeld 2017b, Lopez 2021 (SR/MA) | size grows across wide rep ranges; heavy loads for strength |
| `progression` | Plotkin 2022, Chaves 2024 (RCT) | adding reps or adding load both work |
| `split` | Ramos-Campo 2024 (SR/MA) | split and full body do equally well; pick by days available |
| `order` | Nunes 2021 (SR/MA) | the lift that matters most goes first |
| `rest` | Singer 2024 (SR/MA); exact seconds our rule | longer rest slightly favoured for growth |
| `supersets` | Zhang 2025 (SR/MA) | supersets save time without losing gains |
| `deload` | Coleman 2024 (RCT), Bell 2023 (consensus); interval our rule | an easy week reduces training, it never removes it |
| `short-session` | Androulakis-Korakakis 2020 (SR), Nuzzo 2024 | a short session is slower, not useless |

### 2. Checks the app computes (`api/coach/core/checks.js`, pure, with a unit test)

Run on the current plan (`S.plan` / routines and week), put in the payload as `checks`, and only
the ones that fall outside a range, so a good plan adds nothing to the prompt. Each check has an
id the Coach can cite, and all its numbers:

| Check id | When it is listed | Fields | Tag |
|---|---|---|---|
| `volume-low:<muscle>` | planned weekly sets for a main muscle under the low end of its range | `muscle, sets, low, high` | `volume` |
| `volume-high:<muscle>` | over the high end (a note, never a fault) | `muscle, sets, low, high` | `volume-cap` |
| `frequency:<muscle>` | a main muscle in only one session a week, **only when the goal is strength** (the studies show it for strength, not size); a session counts when it has at least one set with that muscle as primary | `muscle, sessions` | `frequency` |
| `sets-per-exercise:<routine>:<exercise>` | more than 4 sets on one exercise (3 for a beginner) | `routine, exercise, sets, cap` | `sets-per-exercise` |

**Counting and ranges are openGym's own.** Planned sets per muscle use the same weights as the
Stats card's weekly sets (`lib/muscle-targets.js`: 1.0 for each primary muscle, 0.4 for each
supporting one), and the ranges are the person's own (`S.muscleTargets`, Settings → Plan &
schedule → Weekly sets per muscle), falling back to `DEFAULT_TARGETS`. So the number the Coach
cites matches the one the person sees on Stats. coAIch counts supporting sets as 0.5 and has its
own floors; openGym does not switch to those (owner can overrule).

**Decided (owner, after the builder check): match Stats, the full way.**

- `api/` cannot import the frontend. So the muscle weighting (`muscles.js` `muscleWeightsOf`, its
  tables, and the plan counting in `loadOfWeeklyPlan`, rotations included) is copied into
  `api/coach/core/`. A parity test keeps both copies the same, as the repo already does for other
  rules ("Code that exists twice on purpose", CLAUDE.md).
- `api/coach/core/library-data.js` is generated with each exercise's supporting muscles as well as
  its main one. This adds a few hundred KB, phones included.
- The payload's existing `muscles` block (`context.js` `muscleLoad`, logged sets, main muscle at
  1.0, catalogue names) switches to the same counting and the same muscle names. That way the model
  never sees two different counts for one muscle. This changes the numbers every job sees, not
  only `review`, so the prompt's `muscles` reading note is updated to match.
- Option B (main muscle only, no copy) was turned down. It would read push muscles as short
  and not match Stats.

Jobs that get `checks` and may answer with `ref`: **`review` only** (builder's call, after the
check). `review` is the one job that answers with a list of changes to today's plan. `create` and
`refine` answer with a whole plan (`CREATE_SCHEMA`), and `refine` edits an unaccepted proposal, so
checks on today's plan would cite numbers for a plan the model is not editing. Sources on a new
plan's routines are a later step.

### 3. The Coach's instructions (`api/coach/prompts/common.md`)

A new short section, "What the research says", about 400 words at most:

- the tag list, one plain line each (the "Use" column above), with nothing else (no authors,
  years or journals, so the model has no reference to copy wrongly);
- **"You never work out a number. Counts and ranges come from `checks`, `muscles`, `records` and
  `aggregates`; copy them, do not compute your own."**
- "A change may carry `ref`: one tag from the list, or one `checks` id. Leave it out when no
  tag fits. Never put an author, a year or a study in your own text."

Rule 5 keeps its meaning: the `why` names what in the person's data drove the change.
`prompts.js` is regenerated with `scripts/build-coach-assets.mjs`.

### 4. The answer and its check (`schemas.js`, `validate.js`)

- Each change gets an optional `ref` string.
- The validator keeps `ref` only when it is a known tag or a check id present in this
  payload's `checks`. Anything else is dropped silently, never a refusal, so a small model's
  slip does not cost a repair round.
- A check id maps to its tag through the check (`volume-low:lats` → `volume`).

### 5. What the person sees (the review's change card, `CoachChat.jsx`)

Under a change's `why`, one line, built by the app only from the table and the check:

```
Add a 4th set of rows
More pulling for your back, which is below its range.
Lats: 6 sets a week, your range 10 to 20 · Schoenfeld 2017, Currier 2026 ↗
```

- The number part shows only when `ref` is a check id, and the numbers come from the check.
- The source part is the short cites; the link opens the docs page at that tag. The docs page
  links each study to PubMed. "our rule" shows as such.
- New strings ("Based on", "your range", "our rule", "sets a week") in all 25 locale packs, no em
  dashes. Study names and journals stay as published.

### 6. The docs page (`docs/COACH_EVIDENCE.md`)

Every tag with its studies, grade, finding, PubMed link and what the Coach does with it, plus
an "Our rules" list for the numbers no study backs. A test checks that every tag in
`evidence.js` has its row. Linked from `docs/AI_COACH.md` and `docs/README.md`.

## Left to the builder

- Exact field names inside `checks` items, and the name of the check helper.
- How planned weekly sets are counted for a rotation plan (no weekdays) and a combined day.
- How the line wraps on a narrow phone; the review card's existing styles.
- Whether the docs page is written by hand or generated from `evidence.js` (a test either way).
- The prompt wording, inside the 400-word cap; measure the token count before and after.

## Owner's OK still needed elsewhere

The Coach is Duarte's area. This goes as one issue and a draft pull request on release-1.4.6,
labels suggested in the body, and only Duarte merges.
