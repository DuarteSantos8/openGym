# openGym Next: next development steps (as of 2026-11-15)

Read this first when you resume. Before it: `AGENTS.md` (first-session checklist), `START-HERE.md` (setup and the per-task loop) and `adr/`.

## 1. State

All openGym Next work so far is on `main` (44f837f23). CI is green there: the `Tests` workflow with every job, including `e2e`, passed on its first run on GitHub (run 43719512582, 2026-11-15).

| PR | Content | Status |
|---|---|---|
| #18 | Fork merged onto upstream 1.4.5 | merged |
| #19, #24 | Plan v2, ADRs 0001–0005, NEXT-STEPS, AGENTS.md | merged |
| #20–#23, #25 | EP13, EP09, EP10, EP12 (#25 = all of them, with conflicts resolved) | merged |
| #26, #27 | EP16 (E2E + axe in CI, a11y fixes, rollback, ADR 0007). #27 also restored the add-ons page wiring that the #22 "Update branch" merge had dropped | merged |

Lesson from #22 and #26: pressing "Update branch" can re-resolve a conflict badly, and a PR whose base branch has already been merged goes nowhere. Merge each PR into `main` directly, and keep both sides in `Addons.jsx` / `addons.css` conflicts.

Epic status:
- **Done:** EP09, EP10 (squat), EP12, EP13, EP16-T01/T02/T04.
- **Closed by decision:**
  - EP14-T01: upstream already has local inference (ADR 0007).
  - EP08 and EP11: NO-GO after the spikes.
- **Done (2026-11-15):** emulated devices (WebKit/Chromium phone profiles in CI) and the EP14 real-model run.
- **Merged (2026-11-21, #52, #53):** Today's body picker (module `bodyfocus`, branch `next/today-body-focus`): tap the drawn body or your own photo, see the exercises for those areas. Photos stay in the browser; Reset everything and sign-out delete them. Still open: (1) try it on a real phone with your own photo, front and back; (2) the native apps: decide whether to keep the WebView's IndexedDB out of Android Auto Backup (`backup_rules.xml`, `data_extraction_rules.xml`) and iCloud, checked on a device; (3) add its 20 strings to the translation review (task 7); (4) iOS 15.x: if the bundled MediaPipe WASM needs SIMD (Safari 16.4+), photos there get the "can't look for the body" message and the drawn body.
- **In review (2026-11-21):** the web boot waits at most about 5 s for a server that does not answer, for someone signed out (branch `next/boot-server-wait`, Tier A: store). Before, a server held open behind the Vercel `/api` rewrite left new visitors on "Ironvane is taking too long to start" for 40 s. Needs Soren's manual journey: open the live site in a private window while the API is up, sign in, sign out.
- **Merged 2026-11-22 (#56, #57, #58): the beginner-first and Cloud edition groundwork, EP17 to EP27.** The plan, every task's status and the order from here are in `BEGINNER-CLOUD-PLAN.md`; the decisions are ADR 0008 to 0012. In `main`: experience levels, Find my plan (`/start`), Learn (`/learn`), First wins; the edition flag, the Supabase schema with RLS, the four Stripe functions and the API's token verifier. **Nothing of the Cloud edition has run against a real Supabase project or Stripe.**
- **Merged (#59):** Form guidance on the exercise sheet for the 45 exercises the starter plans use (cues, common mistakes, where to feel it, breathing, easier and harder), How to do it first in a Beginner's exercise menu, Find my plan at the top of the starter chooser, and a rest day that says why. Every guide is a `draft` until someone named has read it.
- **Merged (#60):** "Find my weight" on an exercise never logged (up to three test sets, the weight found fills the open sets), and a Beginner's Library opens on the exercises that have a form guide. Tier A: `Workout.jsx`, `Library.jsx`.
- **Merged (#61):** Five faults in the load finder that the reviews of #60 found after it merged: it could suggest less than the bar weighs, it ran the wrong way on assisted machines (now not offered there), it ignored owned dumbbells and machine stacks, it did not say whether a dumbbell number meant one or both, and a set logged from a watch while it was open could be written over. Tier A: `Workout.jsx`.
- **Merged (#62):** The Cloud edition's backend on a real Supabase project: schema and row level security applied, the app's own sign-in client and account screen (cloud build only), account export and deletion as deployed functions, and live tests that run against the project. Tier A: `App.jsx` (one route, cloud build only), `Settings.jsx` (one row, cloud build only).
- **Merged (#63):** Four faults the review of #62 found after it merged, in the cloud build's account screen and sign-in client: a token refresh could undo a sign-out, the word typed to delete one account carried over to the next, the name could be saved (as empty) before it had loaded, and the account screen had no way on into the app.
- **Merged (#64):** One fault the review of #63 found after it merged: a token refresh that outlived an account switch handed its caller the new account's token, so a request made for one account could act on another.
- **Merged (#66): `next/EP18-cloud-e2e`.** The E2E run now also builds the Cloud edition and drives its account screen against a pretend project on this machine (10 tests, two engines, axe on each step), and shows the default build has no such screen. It found and fixes two faults: a reset link did not lead to choosing a new password, and a dead link showed no message. Tier B: `playwright.config.mjs` (a third server and two projects).
- **Merged (#67): `next/EP19-reset-survives-reload`.** Found in review of #66: after a reset link, loading the page again skipped "choose a new password" and opened the account with the old password still in force, because the step lived in the page's memory while the session the link gave is kept. The step is now kept for the tab (`frontend/src/lib/cloud/pending-reset.js`): the account's id and nothing else, counted only for that account, gone on saving the password, signing out or a different sign-in. The cloud E2E reloads mid-reset on both engines. The same run showed a race in the dead-link E2E step (a reload that could arrive after the link was already spent); the step no longer reloads.
- **Merged (#68): `next/test-no-network`.** After #67 the test job on main failed once with every test passing: "Closing rpc while onUserConsoleLog was pending". Cause, traced: a unit test that opens an exercise sheet asks for the picture indexes with happy-dom's real fetch, which opens a real connection to localhost:3000; it is refused and the refusal is logged later, sometimes while the worker is closing (38 such refusals in one run). The test setup now refuses fetch at once in a DOM environment, with a TypeError that names the address, so no unit test opens a socket; a test's own stub still replaces it. On the real project the same day: leaked-password protection on, minimum password length 8, the stray `>` removed from the two email templates (`supabase/README.md`).
- **Merged (#69): `next/EP19-signup-existing-address`.** Found by the owner on the real project: signing up with an address that already has an account. The server answers exactly as for a new address and sends nothing, so that nobody can probe which addresses are registered; the screen said "we sent a link" and stopped. It cannot know either, so after a sign-up it now says what to do if no email comes (sign in, or reset the password), the same for everyone, with the reset one tap away and the address kept. One new string in 25 languages. Also recorded: custom mail is set up on the real project and checked with a real sign-up (`supabase/README.md`).
- **Merged (#70): `next/EP19-cloud-continue-into-app`.** Found by the owner on the real project: signed in to their account, Continue left them on the app's own sign-in screen, and "Create new profile" there failed with HTTP 401. Two causes. Continue only went to the app's address; and the deployment's `/api` rewrite (`frontend/vercel.json`) points at a host that answers every request with 401 and a password prompt for another project, so nothing that needs the app's own server can work there. Fixed in the cloud build: Continue now opens this device's profile for someone who is in neither (`lib/cloud/enter-app.js`), and where no server of the app's own answers, the sign-in screen offers the account and this device instead of server profiles. Where a server does answer, and in the default edition, nothing changes. **Open for the owner:** where the app's own server is meant to live; until then the `/api` rewrite should be removed or pointed at it (it is also the address ADR 0013's OAuth step waits on).
- **Merged (#71): `next/EP19-account-way-back`.** Found in review of #70: the first screen now sends people to the account, and an app installed to the home screen has no browser back, so someone who decided not to sign in could not return to "Continue without account". The signed-out sign-in and create-account steps now have a Back button to the app (an existing string).
- **Merged (#72): `next/EP19-account-back-returns`.** Found in review of #71: the account's Back always went to the app's front door, so someone who opened the account from Settings was sent to Home, with the account left behind in the history. Back now goes back where this session has somewhere to go back to (the app's own idiom, as in Settings and Add-ons) and to the app otherwise. For that the first screen's account button goes through the router, so the step is numbered in the session's history.
- **In review: `next/EP19-app-knows-the-account`.** Found by the owner on the real project, three things. (1) Save on the account screen showed nothing: the server log held eight accepted saves in a row. Save now says "Saved" and is off until the name changes again. (2) Signed in and past Continue, the app still said "Guest mode" and offered "Sign in". The app now hears who is signed in to the hosted account (`lib/account-badge.js`, which both builds ship and which names no provider; told by `lib/cloud/account-watch.js` through a dynamic import): the line under the status bar names them and says their training is on this device, its button goes to the account, and Settings shows who is signed in. A guest in the Cloud edition is offered the account, not a sign-in to a server. (3) The first screen and the signed-in account screen were redesigned: the first screen is its three-sentence statement set large and to the left; the account screen leads with the way into the app, then the name, then plain rows, with deleting folded away. One new string in 25 languages.
- **Needs the owner before any paid deploy:** the media route (ADR 0009: replace or buy a licence), a Supabase project, a Stripe account, the price and the Pro list (ADR 0011).
- **Needs a person:** EP16-T03 on real phones, translation review.
- **Blocked:** EP15, which needs a named licensed PT reviewer.

## 2. Merging (only the owner merges)

- **Target:** every PR targets `main`.
- **Merge method:** "Create a merge commit", not squash, so each change stays one revert point (`rollback.md`).
- **Before merging:** wait for `Tests / tests-ok` to be green.

## 3. Next tasks, in order

| # | Task | Who | Done when |
|---|---|---|---|
| 1 | ~~Enable Actions; confirm `Tests / tests-ok` (with `e2e`) is green~~ **Done 2026-11-15**: run 43719512582 on `main`, all jobs green | owner | ✅ |
| 2 | **EP16-T03 devices.** **Emulated: done** (WebKit iPhone 13 + Pixel 7 projects in CI, `devices.md`). Still open: real phones, using the checklist in `devices.md` | owner | Real-phone table in `devices.md` filled |
| 3 | ~~EP14 real-model run~~ **Done 2026-11-15**: qwen2.5:7b on the RTX 4070. Test ok, review validated in 8 s, ask in 2.8 s; reasoning quality weak (`devices.md`) | — | ✅ |
| 4 | **EP10-T04 second movement** (hinge or lunge). Record 3 short clips on a phone first, then tune thresholds against them. | agent, after clips exist | Rep count within ±1 on the 3 clips |
| 5 | Report the upstream a11y baseline (`a11y.md`: label-in-name on /home, /plan, /stats) to DuarteSantos8/openGym. Drop each baseline entry once fixed upstream. | owner | Upstream issue linked in `a11y.md` |
| 6 | Manual a11y: VoiceOver/TalkBack, 200 % text, keyboard through the 3D map list | owner | Notes in `a11y.md` |
| 7 | Native-speaker review of the machine-translated strings (cs, da, fa, id, lt, vi + EP13 labels) | reviewer | Reviewer named in a PR |
| 8 | EP09-T03 (apply a progression rule to a routine). Only if users ask for it. | — | — |
| 9 | EP15: start only after a licensed PT reviewer is named in writing | — | — |
| 10 | **Read the 45 exercise guides** in `frontend/src/content/exercise-guides.js`; correct them or set `review: 'reviewed'` with a name and date (ADR 0012). Then the remaining exercises of the routines library (EP23-T03) | owner, then agent | No guide is `draft` that the owner has read; `lib/exercise-guide.test.js` passes |
| 11 | EP24-T03 (warm-up sessions), EP24-T01 (the glossary on more screens), the remaining exercises of EP23-T03 | agent | Per the plan's acceptance column |
| 12 | Cloud, owner's dashboard steps (`supabase/README.md`, "What only the owner can switch on"): leaked-password protection, custom SMTP, the email templates' links, the OAuth server for ADR 0013, `APP_ORIGIN`, and the cloud build's three variables in Vercel | owner | Sign-up and reset emails arrive; the API's "Sign in with Ironvane" completes on a preview |
| 13 | EP18-T04 (media manifest) and EP26-T01 (mannequin demos) | agent | Before any live Stripe key |

## 4. Environment (WSL2 Ubuntu)

```bash
source ~/.nvm/nvm.sh                     # Node 22 locally; CI uses Node 26
cd ~/dev/og-<name>/frontend              # one git worktree per branch
npx vitest run --maxWorkers=8            # full suite; default workers flake under CPU load
npm run build                            # also stages MediaPipe (prebuild)
npx vitest run scripts/check-bundle-syntax.test.mjs   # Safari 15.5 guard: run before every push
npm run test:e2e                         # Playwright + axe; starts API and preview itself (needs a build)
```

- **E2E in WSL:** WSL can't run browsers (missing libs, no `sudo`). Run the E2E specs from Windows against servers started in WSL:
  ```
  E2E_BASE_URL=http://localhost:4173 E2E_CHANNEL=chrome npx playwright test
  ```
- **Seeding a guest:** a guest's state is only written on its first change. `e2e/fixtures.mjs` → `enterAsGuest(page, workouts)` handles that.
- **WSL restarts sometimes**, and that clears `/tmp`. Keep logs under `~/dev/.ogtools/`.

## 5. Rules (unchanged)

- **PRs and merging:** draft PRs on the fork only, with `--repo sorensadrgit-art/openGym`; never upstream. Nothing is merged without the owner.
- **Charter:** local-first; no telemetry; no third-party runtime calls (every E2E test fails on an external request); AGPL; respect media licences.
- **Before every push:** scan the diff for absolute personal paths, emails and secrets, because the fork is public.
- **Dependencies:** a new one must pass `check-bundle-syntax` (Safari 15.5). Pin the last compatible version (three 0.178.0) or strip the call with a build plugin that fails loudly.
- **Accessibility:** never add an a11y baseline entry for a screen this fork changed. Fix it instead.

## 6. Resume prompt for a coding agent

> Repo: `sorensadrgit-art/openGym`. Read `AGENTS.md`, then `docs/next/NEXT-STEPS.md`. Take the first unfinished task in section 3 that an agent can do. Create a worktree from `main`. Write the tests first. Then run the full suite with `--maxWorkers=8`, the build, `check-bundle-syntax` and `test:e2e`. Open a draft PR on the fork with a body that says what was verified and what wasn't. Follow section 5. Stop and ask before anything irreversible.
