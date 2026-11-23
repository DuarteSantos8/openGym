# Beginner-first and Cloud edition plan (EP17 to EP27)

Status as of 2026-11-22, after PRs #56 to #60 were merged and with `next/EP22-load-finder-fixes` in review. Read after `NEXT-STEPS.md`. The decisions behind it are ADR 0008 to 0012.

## Why

An audit of `main` (1.4.5, 2e9c802e) from a first-time lifter's point of view found a strong engine that reads like a tool for people who already train:

| # | Finding | Severity |
|---|---|---|
| F1 | Exercise media cannot ship in a build that takes payment (`NOTICE.md`, Gym visual) | blocks monetisation |
| F2 | Supabase and Stripe contradict the charter as written | blocks the cloud work |
| F3 | No form cues, common mistakes or easier and harder versions per exercise: people leave the app to learn form | high |
| F4 | No way to get a plan without knowing what "PPL" or "5×5" means, unless an AI provider is set up | high |
| F5 | The workout screen offers drop sets, bursts and failure to someone on day one | high |
| F6 | 5,632 exercises with no level and no "start here" | high |
| F7 | No glossary; RIR, RPE, deload, 1RM are never explained in place | medium |
| F8 | No warm-up, cool-down or rest-day guidance | medium |
| F9 | Progress is tuned for people with months of data; nothing to celebrate in week one | medium |
| F10 | Nothing says how heavy to start | medium |
| F11 | Settings is very large | low |
| F12 | The first-run question opens over whatever the person is doing; the welcome card sat below the fold | low |

## Rules for every task here

The repo's own: one branch `next/<EPxx-Tyy-slug>` from `origin/main`, tests first, pure logic in `frontend/src/lib/` with its test beside it, strings through `t()` in all 25 packs, modules behind `isOn`, draft PR on the fork with a verified / not verified list, owner merges with a merge commit. Plus:

- Default build: zero external requests. Cloud code only under `frontend/src/lib/cloud/` and `supabase/` (ADR 0008).
- Nothing under `catalogue/media/` in a paying build, or near a model (ADR 0009).
- Health text is general education with sources (ADR 0012).

## Tasks

`done` means merged-ready code with tests in the named branch. `part` says what is missing. Everything else is open, in the order to take it.

### Phase 0: decisions

| ID | Task | Status |
|---|---|---|
| EP17-T01 | ADR 0008 Cloud edition, charter amended in `AGENTS.md` and `START-HERE.md` | done, merged in #56 |
| EP17-T02 | ADR 0009 media in a commercial build | done, #56. **Owner still chooses A (replace) or B (buy a licence) before a paid deploy** |
| EP17-T03 | ADR 0010 backend: Supabase beside the API | done, #56 |
| EP17-T04 | ADR 0011 payments: Stripe on the web first | done, #56. Price and Pro list need the owner's word |
| EP17-T05 | ADR 0012 health content | done, #56 |

### Phase 1: guardrails

| ID | Task | Files | Acceptance | Status |
|---|---|---|---|---|
| EP18-T01 | Edition flag | `frontend/src/lib/edition.js` + test | `editionOf` is `cloud` only for the exact word; a test reads `src/` and fails on a static import of `lib/cloud` or a provider's name outside it | done, #58 |
| EP18-T02 | E2E network guard per edition | `frontend/e2e/fixtures.mjs`, `frontend/playwright.config.mjs` | default projects unchanged; a `cloud` project allows only ADR 0008's four origins | open |
| EP18-T03 | Bundle budget | NEW `frontend/bundle-budget.json`, `scripts/check-bundle-budget.mjs` + test | the first load (what `index.html` asks for up front) stays under 950 kB of script and 62 kB of styles, gzipped, and the guides and Learn text stay out of it | **done** (#60): measured 905 kB and 58 kB. The budget is today's size plus 5%, not a target: the first load is heavy and nothing here has made it lighter |
| EP18-T04 | Media manifest and cloud build filter | `scripts/catalogue/build.mjs`, NEW `catalogue/media-sources.json` | a cloud build holds no file without a commercial-use licence; attribution screen lists every author | open, **blocks a paid deploy** |
| EP18-T05 | Secret scan and env template | `api/test/no-secrets.test.js`, `.env.example` | CI fails on a committed Stripe or Supabase key or a private key block | done, #58 |

### Phase 2: Supabase and Stripe (cloud edition only)

| ID | Task | Files | Acceptance | Status |
|---|---|---|---|---|
| EP19-T01 | Schema: profiles | `supabase/migrations/…_profiles.sql` | applies cleanly; a trigger makes the profile; the user can change name and level only | done, #58 |
| EP19-T02 | Schema: billing and content, RLS, tests | `supabase/migrations/…_billing.sql`, `…_content.sql`, `supabase/tests/rls.sql`, `run-rls-local.sh` | every expectation in `rls.sql` holds; breaking a policy makes it fail | done, same branch (run on PostgreSQL 16; **not** yet on a Supabase project) |
| EP19-T03 | Sign-in, sign-up, reset and consent pages | NEW `frontend/src/lib/cloud/auth.js`, `components/cloud/SignIn.jsx`, `Consent.jsx` | sign up, sign in, reset and approve pass the cloud E2E; axe clean | open; needs a Supabase project. ADR 0013 adds the consent page |
| EP19-T04 | API accepts a cloud sign-in | `api/oidc/` (already there), `.env.example`; fallback `api/supabase-jwt.js` | **ADR 0013 (proposed): no new server code.** The API's existing OIDC sign-in is pointed at the Supabase project. Confirm ADR 0013's five checks on a real project | **part**: decision written, verifier kept as the tested fallback, nothing confirmed against Supabase |
| EP19-T05 | Link an existing account; guest keeps their data | the OIDC flow's own link mode (ADR 0013) | a guest with 10 workouts signs in and has 10 on the server; a passkey user links without a second user | open: to be shown on a real project, not built |
| EP19-T06 | Delete account and export | NEW `supabase/functions/delete-account`, `export-data` | after delete: auth user, rows, `state-<uid>.json` and the Stripe subscription are gone | open |
| EP20-T01 | Stripe catalogue seed | NEW `scripts/stripe/seed.mjs` | product and two prices created idempotently in test mode | open; needs a Stripe account |
| EP20-T02 | Checkout | `supabase/functions/create-checkout-session`, `_shared/handlers.js` | guest 403, unknown price 400, already subscribed 409, double tap one session | done against a pretend Stripe, same branch. **Not** run against Stripe |
| EP20-T03 | Webhook | `supabase/functions/stripe-webhook` | bad signature 400; replay acted on once; out-of-order events end where Stripe is; failure leaves the event open for the retry | done against a pretend Stripe, same branch |
| EP20-T04 | Customer portal | `supabase/functions/create-portal-session` | own customer only | done against a pretend Stripe, same branch |
| EP20-T05 | Entitlement token and offline check | `supabase/functions/entitlement-token`, `frontend/src/lib/cloud/entitlement.js` | tampered token refused; Pro holds through the grace period offline, then Free with data intact | done, same branch |
| EP20-T06 | Pro gating through modules | `frontend/src/lib/edition.js` `featureAvailable`; then `lib/modules.js` `tier` | default edition: everything available; cloud Free never blocks logging | **part**: the check exists, no module uses it yet |
| EP20-T07 | Paywall screen | NEW `components/cloud/Paywall.jsx` | price, renewal and how to cancel before the button; no pre-ticked extras; axe clean | open |

### Phase 3: beginner core (all editions)

| ID | Task | Files | Acceptance | Status |
|---|---|---|---|---|
| EP21-T01 | Experience levels | `frontend/src/lib/experience.js`, `experience-copy.js` | Beginner, Intermediate, Experienced write four detail modules and nothing that is connected or holds data | done, #57 |
| EP21-T02 | Workout shows less to a Beginner | `views/Workout.jsx` | done: the set menu keeps failure, drop set and burst under More (#57); the exercise menu leads with How to do it (`next/EP23-exercise-guidance`). Supersets and ordering were already under More |
| EP21-T03 | Level in Settings | `views/Settings.jsx`, `settings-pages.js` | **part**: the row, searchable. Still open: a shorter Settings root for a Beginner |
| EP22-T01 | Planner | `frontend/src/lib/planner.js`, `lib/starter.js` `buildPlanFrom` | all 1,200 answer combinations give a valid plan, deterministic, equipment respected, within the minutes | done, same branch. Draws on the 8 starter plans; `routines/opengym/` is not used yet |
| EP22-T02 | Find my plan | `views/Onboarding.jsx`, `App.jsx` `/start` | six questions, a plan with reasons, "Use this plan"; limitations never stored; E2E with axe | done, same branch |
| EP22-T03 | Plan cards by goal in the starter chooser | `sheets.jsx` `StarterPlanChooser` | each card says days, minutes, level, equipment; the split name is the subtitle | **part**: the chooser now opens with Find my plan (`next/EP23-exercise-guidance`). The cards themselves are unchanged |
| EP22-T04 | First-session load finder | NEW `lib/load-finder.js`, `components/LoadFinder.jsx`, `Workout.jsx` | an exercise with no history offers "Find my weight": up to three test sets, a fifth up or down each time, and the weight found fills the open sets | **done** (#60), with review fixes in `next/EP22-load-finder-fixes`: it starts on the athlete's own bar and never suggests less, names only owned dumbbells or stack weights when those are listed, uses the column's own heading (each or both dumbbells), and writes to the first set still open. Test sets are not logged. Not offered for bodyweight, band, assisted-machine or per-side rows |
| EP22-T05 | Tour after the quiz, shorter for a Beginner | `lib/tour-offer.js`, `lib/tour.js` | **part**: the first-run question no longer opens over the quiz. Still open: a Beginner tour of 8 stops or fewer |
| EP23-T01 | Exercise guidance: level, pattern, cues, mistakes, feel, breathing, easier and harder | `frontend/src/content/exercise-guides.js`, `lib/exercise-guide.js` | `problems()` is empty: fields complete, ids real, ladders never circular, review status valid | done, `next/EP23-exercise-guidance`. **Kept out of `catalogue/` on purpose for now**: the generated catalogue files stay untouched and the text loads on demand. Moving it into `catalogue/exercises/*.json` is a mechanical step once upstream settles its own "top three mistakes" field |
| EP23-T02 | Seed level and pattern | NEW `scripts/catalogue/seed-level.mjs` | 90% of exercises get a pattern; reviewed diff | open |
| EP23-T03 | Essentials written by hand | `frontend/src/content/exercise-guides.js` | each: 3 or 4 cues, 2 or 3 mistakes with fixes, where to feel it, breathing, a ladder where one exists | **part**: 45 exercises, which is every exercise a starter plan uses, so every Find my plan result is covered (a test holds that). All `draft`: **the owner or a named reviewer still has to read them** (ADR 0012). About 35 more for the routines library are open |
| EP23-T04 | Guidance on the exercise sheet | `sheets.jsx`, `components/ExerciseGuide.jsx` | cues, mistakes with fixes, where to feel it, breathing, easier and harder open the other exercise; a draft is never called reviewed | done, `next/EP23-exercise-guidance` |
| EP23-T05 | Library opens on guided exercises for a Beginner | `views/Library.jsx`, `lib/exercise-guide.js` | a Beginner's Library opens on the exercises with a form guide, as a chip anyone can set or clear; a search with nothing guided in it shows what it found | **done** (#60). The search index and the 50 ms target were not needed for this and are not built |
| EP24-T01 | Glossary and words that explain themselves | `content/learn.js`, `lib/learn.js`, `components/Term.jsx` | **part**: 49 terms, searchable, one `Term` in use (the plan result). Still open: `Term` in Workout, Plan and Progress; translations of the entries |
| EP24-T02 | Learn | `views/Learn.jsx`, `App.jsx` `/learn` | done, same branch: 8 guides and the glossary, offline, no link out, axe clean |
| EP24-T03 | Warm-up, cool-down and mobility as guided sessions | NEW `routines/learn/*.json`, circuit player | 8 routines playable with spoken cues | open (the guide exists as text) |
| EP24-T04 | Food, sleep and safety basics | `content/learn.js` | done, same branch: every number names its source; English only for now |
| EP25-T01 | First wins | `lib/wins.js`, `components/FirstWins.jsx` | done, same branch |
| EP25-T02 | Streak shields for rest-day mobility | `lib/streak.js` | open (the streak already counts weeks, so rest days never break it) |
| EP25-T03 | Rest day explained | `views/Home.jsx` | done, `next/EP23-exercise-guidance`: a Beginner's planned rest day says why it is one and links the guide |

### Phase 4: what nobody else has

| ID | Task | Status |
|---|---|---|
| EP26-T01 | 3D mannequin demos per movement pattern (own work, licence-clean: also the answer to ADR 0009) | open |
| EP26-T02 | "Mistake and fix" ghost overlay on the mannequin | open |
| EP26-T03 | Coach Mode: one card at a time, spoken cues, "too hard" swaps to the easier version | open |
| EP26-T04 | Ladder skill tree | open |
| EP26-T05 | Haptics and sound kit that respects mute and reduced motion | open |
| EP26-T06 | Second form-check movement (closes EP10-T04) | open; needs the owner's three clips first |
| EP26-T07 | Routine builder shows weekly sets per muscle against the goal | open |

### Phase 5: proof

| ID | Task | Status |
|---|---|---|
| EP27-T01 | Cloud E2E suite | open |
| EP27-T02 | Stripe test clocks: trial, renewal, failed payment, cancel | open |
| EP27-T03 | Usability kit: five first-time lifters, task script, metrics sheet | open; this is what the grades below wait for |

## Order from here

1. Owner: read the 45 exercise guides (`frontend/src/content/exercise-guides.js`) and either correct them or mark them reviewed. They are general cues, but they are the first thing here that tells someone how to move.
2. Owner: create the Supabase project and the Stripe test account. Nothing more of the Cloud edition can be verified without them: ADR 0013's five checks, EP19-T03, T05, EP20-T01, T07 and EP18-T02 all wait on this.
3. Agent: EP23-T03's remaining exercises (the routines library), EP24-T03 (warm-up sessions), EP24-T01 (the glossary on more screens).
4. EP18-T04 and EP26-T01 before any live key.

## What "production ready" still needs, and who can give it

| Needed | Why an agent cannot close it |
|---|---|
| A human read of the exercise guides and the Learn text | ADR 0012: `reviewed` needs a named person |
| A Supabase project and a Stripe account in test mode | Sign-in, checkout and webhooks cannot be proven against pretend services |
| The media decision (ADR 0009) | A licence purchase or a replacement set is the owner's call and cost |
| Real phones, a screen reader, native builds | Not available in CI or to an agent |
| Five first-time lifters (EP27-T03) | The only honest source of a usability grade |
| Native-speaker review of 72 machine-written strings per language | NEXT-STEPS task 7 |

## Verification record (2026-11-22)

What was run, where, and what was not. #56 to #60 are merged; nothing has been deployed by an agent.

| Check | Result |
|---|---|
| Baseline `main`, full frontend suite | 953 files, 10,647 tests, all passed |
| Beginner branch, full frontend suite | 959 files, 10,725 tests, all passed |
| Locale checks (`check-locales`, `check-source-strings --strict`) | 25 packs in sync; every `t()` string present |
| Build and Safari 15.5 bundle check | passed |
| E2E on Chromium phone, iPhone 13 WebKit and Pixel 7, with axe and the no-external-request guard | 47 passed, 1 skipped (the existing camera test on WebKit). The WebKit run found a real bug, fixed in the branch: closing a sheet remounts the page on iPhone, which sent the quiz back to question 1 |
| API suite on the cloud branch | 1,298 tests: 1,295 passed, 3 skipped (they need a non-root user), 0 failed |
| Cloud: function tests | 39 passed; each security check also confirmed to fail when removed |
| Cloud: API token verifier | 12 passed |
| Cloud: RLS on PostgreSQL 16 | all expectations held; two deliberate breaks were caught |
| Guidance branch (`next/EP23-exercise-guidance`), full frontend suite | 964 files, 10,763 tests, all passed |
| Guidance branch, E2E on the three profiles | 53 passed, 1 skipped (the same camera test). The new sheet scan found an older fault, fixed in the branch: the Last and Est. 1RM tiles had spoken names that did not contain the words on them (WCAG 2.5.3) |
| Guidance branch, locale checks, build, Safari 15.5 bundle check, secrets check | passed; 10 new strings in all 25 packs |
| Load finder branch (`next/EP22-load-finder`), full frontend suite | 966 files, 10,785 tests. 4 tests in 2 older files failed here and on `main`: they dated a workout by the UTC day, which on a Sunday evening west of Greenwich is next week. Fixed in the branch and passing in three time zones; CI (UTC) never saw it |
| Load finder branch, E2E on the three profiles | 59 passed, 1 skipped (the same camera test) |
| Load finder branch, bundle budget | first load 905 kB script and 58 kB styles gzipped, inside the budget; guides and Learn text load on demand |
| **Not run** | Real phones; a screen reader by hand; anything against a real Supabase project or Stripe; the native apps |

### Grades, honestly

Self-grading cannot reach 10. A 10 needs people: five first-time lifters completing the quiz and a first workout unaided, and a week of use.

| Category | Grade | What keeps it from higher |
|---|---|---|
| Beginner-friendliness and clarity | 7 | Every starter-plan exercise has cues, mistakes, where to feel it and an easier version, and a first weight can be found in three test sets. But all 45 guides are unreviewed drafts in English, the glossary reaches one screen, and no first-time lifter has tried any of it |
| UI/UX and fun | 5 | Consistent with the app and accessible, but none of Phase 4 exists: no mannequin, no Coach Mode, no skill tree |
| Feature completeness (all in one) | 5 | 26 of 53 tasks done (5 of those are decisions), 8 in part. Open: warm-up sessions, guidance beyond the starter plans, all of Phase 4, sign-in and the paywall |
| Technical quality and backend | 6 | What exists is tested hard, including by breaking it. But no sign-in, no paywall, and nothing run against the real services. ADR 0013 may remove the API wiring altogether, once checked on a real project |
