# Beginner-first and Cloud edition plan (EP17 to EP27)

G1 covers a linked member opening Account before and after reload. The local training API returned 403 and both visits hid the Admin dashboard. A1 still needs the protected preview's member 403 and signed-out 401.

D3 status: the short Beginner Settings root and reversible full-list preference are prepared.
## Status on November 26, 2026

Nutrition account isolation is prepared. Shared-device tests cover expired sessions, profile switches and delayed pairing. Hosted checks remain open.

A5 sign-in retry (#133) passed the local two-tab delayed logout check against the real API and a test issuer. Owner verification on phone and desktop is pending.

A5 guest ownership fixes are prepared. Hosted verification of the revised sign-out and attachment behavior is pending.

E3 is prepared. Confirmed workout saves add a vibration on supported browsers. Set, record and session feedback respects reduced motion, and the timer retains its configured alarm.

D6 is prepared. The rule-based draft seed assigns 4,368 of 4,835 strength-eligible canonical exercises (90.34%), 4,388 of 5,632 canonical exercises (77.91%), and 5,135 of 6,554 IDs including aliases (78.35%).
The cloud preview uses the hosted API and Coach. The shorter Beginner Settings and tour reached the preview in #116 and #117.

Read after `NEXT-STEPS.md`. What is left, in order and as tasks for a coding agent, is in
`AGENT-DEVELOPMENT-PLAN.md` (merged in #93).

The origin guard, MCP Blueprint, linked deletion (ADR 0014), browser sign-in guidance and the
repeat sign-in fix are merged in #85–#91 and live on the hosted server. Repeat sign-in and one
linked deletion are verified there. The three findings left open on #88 are merged in #92. Task
A2 merged in #94.

**Hosted account checks (A1).** On the preview, the owner opened the Admin dashboard.
The OIDC configuration showed the provider was enabled and reachable. The browser did not
expose the HTTP status. The health response reported a writable server.

The disposable account saw no Admin dashboard. `GET /api/admin/oidc` returned a forbidden
response. After sign-out, `GET /api/me` reported that the user was signed out.
Confirm HTTP 403 for the disposable account and HTTP 401 after sign-out through the preview.
A separate anonymous request directly to the API returned 401. Two-tab sign-in was verified
on the hosted preview. See [the hosted account checks](CLOUD-SERVER.md#before-real-users).

Task A3 verified one hosted disk snapshot. A restore test awaits the owner’s decision. See
[Backups](CLOUD-SERVER.md#backups).

Task A5 passed on the hosted preview on November 26, 2026. The server and both browsers showed all ten imported guest workouts. The owner decision of November 27 makes **Add them** a copy, not a transfer: the guest keeps the ten on this device after sign-out, and account workouts stay private to their account. See [Before real users](CLOUD-SERVER.md#before-real-users).

The hosted Coach returned a chat reply and a full plan. Its MiniMax subscription usage for the
test hour is recorded in `CLOUD-SERVER.md`. The beginner Home Coach card (B3) merged in #101.
The fixes merged in #102. The preview verified new-profile scheduling, the French no-weights
starter and nine equipment-free substitutions in a three-day MiniMax plan. See the [live Coach
checks](CLOUD-SERVER.md#live-coach-checks-after-102).

Coach B2 status: the two chat prompts have stubbed-provider coverage, including confirmation.
The scheduling follow-up preserves other days and reuses matching routines on repeat
confirmation. The hosted preview also kept Monday and added just one routine across two
identical requests. See [the live schedule check](CLOUD-SERVER.md#live-schedule-check-after-99).

The owner accepted [ADR 0015](adr/0015-coach-app-help.md). B4 app help is prepared in a separate
implementation PR after owner approval. Hosted verification is pending. Coach App Help
daily-limit guidance is prepared. Local search remains available after a refused request.

D2 status: Glossary access is prepared on Workout, Plan and Progress. The 25 locale packs include all 49 entries.
The machine translations await native review. D3 status: the short Beginner Settings root and
reversible full-list preference are prepared. D4 prepares an eight-stop beginner tour with
offline keyboard replay. D5 prepares goal-led starter cards that show weekly frequency, session
length, experience level and equipment. The local chooser works offline.

Eight playable Learn sessions are prepared on `next/EP24-learn-sessions`; their training content
is draft. The G2 usability kit is prepared; five owner-run sessions are pending.

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
| EP18-T02 | E2E for the Cloud edition | `frontend/playwright.config.mjs`, NEW `frontend/e2e/cloud/`, `e2e/no-cloud.e2e.mjs` | the E2E run builds the Cloud edition too and drives its account screen on two engines against a pretend project on this machine, so the rule that nothing leaves the device holds for it as well; the default build is shown to have no account screen | **done** in `next/EP18-cloud-e2e`. It found two faults unit tests could not: the app remounts a view when its address changes, which lost the "choose a new password" step after a reset link and the message for a dead link |
| EP18-T03 | Bundle budget | NEW `frontend/bundle-budget.json`, `scripts/check-bundle-budget.mjs` + test | the first load (what `index.html` asks for up front) stays under 950 kB of script and 62 kB of styles, gzipped, and the guides and Learn text stay out of it | **done** (#60): measured 905 kB and 58 kB. The budget is today's size plus 5%, not a target: the first load is heavy and nothing here has made it lighter |
| EP18-T04 | Media manifest and cloud build filter | `scripts/catalogue/build.mjs`, NEW `catalogue/media-sources.json` | a cloud build holds no file without a commercial-use licence; attribution screen lists every author | open, **blocks a paid deploy** |
| EP18-T05 | Secret scan and env template | `api/test/no-secrets.test.js`, `.env.example` | CI fails on a committed Stripe or Supabase key or a private key block | done, #58 |

### Phase 2: Supabase and Stripe (cloud edition only)

| ID | Task | Files | Acceptance | Status |
|---|---|---|---|---|
| EP19-T01 | Schema: profiles | `supabase/migrations/…_profiles.sql` | applies cleanly; a trigger makes the profile; the user can change name and level only | done, #58 |
| EP19-T02 | Schema: billing and content, RLS, tests | `supabase/migrations/…_billing.sql`, `…_content.sql`, `supabase/tests/rls.sql`, `run-rls-local.sh` | every expectation in `rls.sql` holds; breaking a policy makes it fail | done, same branch (run on PostgreSQL 16; **not** yet on a Supabase project) |
| EP19-T03 | Sign-in, sign-up, reset, account and consent | NEW `frontend/src/lib/cloud/{auth,profile,client}.js`, `views/cloud/Account.jsx` | sign in, sign up, reset, change name, export, delete and approve, each tested; a real browser round trip on a real project | **done** in `next/EP19-cloud-backend` for sign in, name, reload and sign out (real browser, real project, phone and desktop). **Not exercised for real:** sign-up and reset emails (the project's built-in mail only reaches the owner's own address; custom SMTP is the owner's to set), and approving, because the project's OAuth server is off |
| EP19-T04 | API accepts a cloud sign-in | `api/oidc/` (already there), `.env.example`; fallback `api/supabase-jwt.js` | ADR 0013: the API's existing OIDC sign-in is pointed at the project | **part**: on the real project the discovery document's issuer, PKCE S256, ES256 keys, the public-client method and `email_verified` all match what the API needs, and `api/supabase-jwt.js` verifies a real access token and refuses a forged one. **Not done:** a full sign-in through the API, which needs the OAuth server switched on in the dashboard and a running API |
| EP19-T05 | Link an existing account; guest keeps their data | the OIDC flow's own link mode (ADR 0013) | a guest with 10 workouts signs in and has 10 on the server, and still has the 10 as a guest after sign-out; a passkey user links without a second user | guest import verified on the hosted preview, guest retention after sign-out held by `useStore.guest-import-ownership.test.jsx` (owner decision 2026-11-27); passkey linking remains open |
| EP19-T06 | Delete account and export | NEW `supabase/functions/{export-account,delete-account}`, `_shared/{account,http}.js` | export returns only the caller's rows; delete needs the word, removes the auth user and every row with it, and is refused while a subscription runs | **done** in `next/EP19-cloud-backend`: both deployed and run on the real project, including a real deletion. **Not covered:** the app server's own `state-<uid>.json` (it has its own export and delete) and cancelling a Stripe subscription (refused instead, until Stripe is back) |
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
| EP21-T03 | Level in Settings | `views/Settings.jsx`, `settings-pages.js` | **done** (#116): Beginner Settings has a shorter root, full search and a switch to show all settings. |
| EP22-T01 | Planner | `frontend/src/lib/planner.js`, `lib/starter.js` `buildPlanFrom` | all 1,200 answer combinations give a valid plan, deterministic, equipment respected, within the minutes | done, same branch. Draws on the 8 starter plans; `routines/opengym/` is not used yet |
| EP22-T02 | Find my plan | `views/Onboarding.jsx`, `App.jsx` `/start` | six questions, a plan with reasons, "Use this plan"; limitations never stored; E2E with axe | done, same branch |
| EP22-T03 | Plan cards by goal in the starter chooser | `sheets.jsx` `StarterPlanChooser` | each card says days, minutes, level, equipment; the split name is the subtitle | **prepared**: all eight cards show these facts and adapt to the selected equipment profile |
| EP22-T04 | First-session load finder | NEW `lib/load-finder.js`, `components/LoadFinder.jsx`, `Workout.jsx` | an exercise with no history offers "Find my weight": up to three test sets, a fifth up or down each time, and the weight found fills the open sets | **done** (#60), with review fixes in `next/EP22-load-finder-fixes`: it starts on the athlete's own bar and never suggests less, names only owned dumbbells or stack weights when those are listed, uses the column's own heading (each or both dumbbells), and writes to the first set still open. Test sets are not logged. Not offered for bodyweight, band, assisted-machine or per-side rows |
| EP22-T05 | Tour after the quiz, shorter for a Beginner | `lib/tour-offer.js`, `lib/tour.js` | **done** (#117): the tour follows the quiz. Beginners get at most eight stops and can replay it from Settings. |
| EP23-T01 | Exercise guidance: level, pattern, cues, mistakes, feel, breathing, easier and harder | `frontend/src/content/exercise-guides.js`, `lib/exercise-guide.js` | `problems()` is empty: fields complete, ids real, ladders never circular, review status valid | done, `next/EP23-exercise-guidance`. **Kept out of `catalogue/` on purpose for now**: the generated catalogue files stay untouched and the text loads on demand. Moving it into `catalogue/exercises/*.json` is a mechanical step once upstream settles its own "top three mistakes" field |
| EP23-T02 | Seed level and pattern | NEW `scripts/catalogue/seed-level.mjs` | 90% of exercises get a pattern; reviewed diff | open |
| EP23-T03 | Essentials written by hand | `frontend/src/content/exercise-guides.js` | each: 3 or 4 cues, 2 or 3 mistakes with fixes, where to feel it, breathing, a ladder where one exists | **part**: 45 starter-plan exercises plus 10 sourced routine exercises. Tests cover every exercise in Linear Strength, Twice a Week and Ganzkörper zu Hause. The 10 additions have text in all 25 packs. All 55 guides are `draft` pending named review (ADR 0012). 36 distinct routine exercise IDs still lack guides |
| EP23-T04 | Guidance on the exercise sheet | `sheets.jsx`, `components/ExerciseGuide.jsx` | cues, mistakes with fixes, where to feel it, breathing, easier and harder open the other exercise; a draft is never called reviewed | done, `next/EP23-exercise-guidance` |
| EP23-T05 | Library opens on guided exercises for a Beginner | `views/Library.jsx`, `lib/exercise-guide.js` | a Beginner's Library opens on the exercises with a form guide, as a chip anyone can set or clear; a search with nothing guided in it shows what it found | **done** (#60). The search index and the 50 ms target were not needed for this and are not built |
| EP24-T01 | Glossary and words that explain themselves | `content/learn.js`, `lib/learn.js`, `components/Term.jsx` | **part**: 49 searchable terms. The plan result, Workout, Plan and Progress expose definitions. All 25 packs include the complete glossary. Native review remains open |
| EP24-T02 | Learn | `views/Learn.jsx`, `App.jsx` `/learn` | done, same branch: 8 guides and the glossary, offline, no link out, axe clean |
| EP24-T03 | Warm-up, cool-down and mobility as guided sessions | NEW `routines/learn/*.json`, circuit player | 8 routines playable with spoken cues | prepared, content in draft pending named review |
| EP24-T04 | Food, sleep and safety basics | `content/learn.js` | done, same branch: every number names its source; English only for now |
| EP25-T01 | First wins | `lib/wins.js`, `components/FirstWins.jsx` | done, same branch |
| EP25-T02 | Streak shields for rest-day mobility | `lib/streak.js` | Prepared. Two completed Learn mobility sessions on scheduled rest days earn one freeze per week within the chosen rule’s cap. Records without the rest-day date keep their existing streak treatment. |
| EP25-T03 | Rest day explained | `views/Home.jsx` | done, `next/EP23-exercise-guidance`: a Beginner's planned rest day says why it is one and links the guide |

### Phase 4: what nobody else has

| ID | Task | Status |
|---|---|---|
| EP26-T01 | 3D mannequin demos per movement pattern (own work, licence-clean: also the answer to ADR 0009) | E5a (rig and squat) merged in #130. E5b (eight original family examples; [matrix and evidence](evidence/EP26-T01/patterns.md)) merged in #136. Phone framing and offline playback have follow-up coverage. Named movement and native-language review remain open |
| EP26-T02 | "Mistake and fix" ghost overlay on the mannequin | open |
| EP26-T03 | Guided workout: one card at a time, spoken cues, “Too hard” swaps to the easier version | prepared in English; session layout works offline with the existing form guides. Device speech and native-language review remain open |
| EP26-T04 | Ladder skill tree | Prepared for review: Learn opens existing ladders as an ordered, read-only history view. Highest logged step and all earlier steps are marked reached. [Local evidence](evidence/EP26-T04/README.md); independent and native-language review pending. |
| EP26-T05 | Haptics and sound kit that respects mute and reduced motion | open |
| EP26-T06 | Second form-check movement (closes EP10-T04) | open; needs the owner's three clips first |
| EP26-T07 | Routine builder shows weekly sets per muscle against the goal | Prepared locally; personal targets take precedence, draft defaults only for muscle growth; independent and named content review pending |

### Phase 5: proof

| ID | Task | Status |
|---|---|---|
| EP27-T01 | Cloud E2E suite | open |
| EP27-T02 | Stripe test clocks: trial, renewal, failed payment, cancel | open |
| EP27-T03 | Usability kit: five first-time lifters, task script, metrics sheet | [English study kit](usability/script.md) prepared; five owner-run sessions and grading pending |

## Order from here

1. Owner: read the 55 draft exercise guides (`frontend/src/content/exercise-guides.js`) and either correct them or mark them reviewed. They are general cues, but they are the first thing here that tells someone how to move.
2. Owner: create the Supabase project and the Stripe test account. Nothing more of the Cloud edition can be verified without them: ADR 0013's five checks, EP19-T03, T05, EP20-T01, T07 and EP18-T02 all wait on this.
3. Agent: EP23-T03's remaining exercises (the routines library), EP24-T03 (warm-up sessions), EP24-T01 (native review of glossary translations).
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
| Cloud backend branch (`next/EP19-cloud-backend`), on the real project | All 4 migrations applied (the fourth, which answers the project's own advisors, after the owner confirmed it; the performance advisor now reports nothing). 10 live tests passed: sign-in, wrong password, row level security over REST as two users, token refresh, billing tables closed, the API's token check on a real token, the OIDC discovery document, export, the refusals, and a real account deletion |
| Cloud backend branch, real browser | The cloud build signed in, saved a name, kept the session over a reload and signed out, on a phone and a desktop viewport, talking only to the project. It found two races that are now fixed and tested |
| Cloud backend branch, the usual suites | Frontend 970 files, 10,847 tests; API 1,304 tests (3 skipped as before); E2E on the default build 62 passed, 1 skipped; row level security on PostgreSQL 16 with all four migrations; axe clean on all five account steps of the cloud build; the bundle check fails a default build that contains any cloud code |
| Cloud E2E branch (`next/EP18-cloud-e2e`) | The whole E2E run, both builds: 75 passed, 1 skipped (62 as before, 3 showing the default build has no account screen, 10 on the cloud build across Chromium and WebKit, each step scanned with axe) |
| Reset step kept over a reload (`next/EP19-reset-survives-reload`) | Two unit tests that fail on the code before it; the cloud E2E reloads between the link and the new password on Chromium and WebKit, and the dead-link step run 4 times per engine without a failure |
| Cloud preview | Deployed from the `next/cloud-preview` branch with the three variables set for that branch only; production and other previews are unchanged. `APP_ORIGIN` is set to it: the export function answers that origin and no other. Not opened by an agent (it is behind the owner's Vercel sign-in) |
| **Not run** | Real phones; a screen reader by hand; Stripe; sign-up and reset emails end to end; a sign-in through the API's OIDC; the native apps |

### Grades, honestly

Self-grading cannot reach 10. A 10 needs people: five first-time lifters completing the quiz and a first workout unaided, and a week of use.

| Category | Grade | What keeps it from higher |
|---|---|---|
| Beginner-friendliness and clarity | 7 | Every starter-plan exercise has cues, mistakes, where to feel it and an easier version, and a first weight can be found in three test sets. But all 45 guides are unreviewed drafts in English, the glossary reaches one screen, and no first-time lifter has tried any of it |
| UI/UX and fun | 5 | Consistent with the app and accessible, but none of Phase 4 exists: no mannequin, no Coach Mode, no skill tree |
| Feature completeness (all in one) | 5 | 26 of 53 tasks done (5 of those are decisions), 8 in part. Open: warm-up sessions, guidance beyond the starter plans, all of Phase 4, sign-in and the paywall |
| Technical quality and backend | 7 | A real project runs the schema, row level security, sign-in, export and deletion, and the app's client is tested against it. Still missing: email that reaches real people, the OIDC hand-off to the API, payments, and a deployed cloud build |

### EP27-T01 Cloud ladder coverage (11.02h)

The ten-workout Cloud account journey in `frontend/e2e/cloud/account.e2e.mjs` checks the push-up ladder on the original guest device, after linking and reloading, and on a second linked browser. After sign-out, the second browser returns to its empty device ladder and the API refuses the old session. This uses a local linked API and a simulated issuer. The device-only offline and accessibility checks remain in `frontend/e2e/learn-ladders.e2e.mjs`.
