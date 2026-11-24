# Upstream files the fork modifies (plan §3.2)

One row per upstream file changed by an openGym Next / Ironvane PR, with the reason. New files the
fork adds (its own components, libs, tests, CSS) are not listed. Keep each feature PR at about 30
changed lines per upstream file or fewer; larger changes need a design note first.

Started 2026-11-20 with the body picker; earlier PRs (#18–#51) did not keep this file.

| File | PR / branch | Lines | Why |
|---|---|---|---|
| `frontend/src/views/Home.jsx` | `next/today-body-focus` | +4 | Renders the body picker card under today's workout, behind `isOn(S, 'bodyfocus')`. |
| `frontend/src/lib/modules.js` | `next/today-body-focus` | +3 −1 | Registers the `bodyfocus` module (on by default) and adds it to the Just training preset, so every preset keeps it. |
| `frontend/src/lib/modules-copy.js` | `next/today-body-focus` | +1 | The module's title and description inside `t()`, as `modules-copy.test.js` requires. |
| `frontend/src/views/settings-pages.js` | `next/today-body-focus` | +1 | The module's Settings search words (without them its search entry read "undefined"). |
| `frontend/src/views/Muscles.jsx` | `next/today-body-focus` | +7 −5 | `?m=` takes several muscles (opens with "Any of them"); back from it goes to Today (`/home`) when opened from there. One muscle behaves as before. |
| `frontend/src/components/MuscleExplorer.jsx` | `next/today-body-focus` | +4 −3 | `initial` may be a list, and `initialMatch` sets All/Any; defaults unchanged. |
| `frontend/src/store/useStore.js` | `next/today-body-focus` | +5 | **Store (Tier A area):** `clearLocalSession` (every sign-out) and `setUser`'s different-account branch (a new account after an expired session) call `forgetBodyFocus()`, so no body photo or picks pass to the next person. Device-local delete only; no change to state, sync or merge. |
| `frontend/src/views/Settings.jsx` | `next/today-body-focus` | +2 | Reset everything also calls `forgetBodyFocus()` (its dialog promises the photos on this device go). |
| `frontend/src/locales/*.js` (25 packs) | `next/today-body-focus` | +20 each | The picker's 20 new strings. Machine-written; add them to the native-speaker review (NEXT-STEPS task 7). pt-BR gets explicit overrides, so the pt-PT inheritance fingerprint is unchanged. |
| `frontend/src/views/Modules.test.jsx` | `next/today-body-focus` | +1 −1 | One more module on: "12 of 14 modules on." |
| `frontend/src/views/Home.modules.test.jsx` | `next/today-body-focus` | +13 | The body picker follows its module; off leaves the rest of Home unchanged (flags-off parity). |
| `frontend/src/components/MuscleExplorer.test.jsx` | `next/today-body-focus` | +20 | Opening on several muscles with "Any of them"; one muscle still opens with "All of them". |
| `frontend/src/views/Settings.media.test.jsx` | `next/today-body-focus` | +11 | Reset everything forgets the body picker's photos and picks. |
| `docs/MODULES.md` | `next/today-body-focus` | +1 | The Body picker row. |
| `docs/next/NEXT-STEPS.md` | `next/today-body-focus` | +1 | The feature's status and open items. |
| `frontend/src/store/useStore.js` | `next/boot-server-wait` (#54), `next/boot-wait-guest-rule` | +24 −7 | **Store (Tier A area), web boot of someone signed out only:** `/api/config`, an owed `/api/logout` and `/api/me` share one 5 s budget (`BOOT_WAIT_MS`, each later request at least 1.5 s) instead of 20 s / 60 s apiece, so a server that never answers no longer leaves the sign-in screen behind the boot screen's 10 s error for 40 s. A config that missed the budget is asked again at once with the usual timeout (the sign-in screen follows the store); a guest who went in meanwhile meets boot's guest rule when it lands. A signed-in copy, a guest (both on screen at once) and a provider sign-in arriving (`?oidc=`) keep the usual timeouts. `loadConfig`/`refreshConfig` pass an optional `opts` to `api()`; `setUser` re-asks after a config still in flight when the sign-in happened. Phones unchanged. |
| `frontend/src/views/Home.jsx` | `next/EP21-EP25-beginner-core` | +18 −7 | The welcome card of a profile with no routines moves to the top (it sat below the body picker and the check-in card) and gains "Find my plan" as its main button and "Learn the basics"; Load starter plan and Build my own plan stay. A Beginner with Motivation on gets the First wins card. |
| `frontend/src/views/Settings.jsx` | `next/EP21-EP25-beginner-core` | +12 | Plan & schedule gains one section: Find my plan, Experience level, Learn. |
| `frontend/src/views/settings-pages.js` | `next/EP21-EP25-beginner-core` | +3 | The three rows' Settings search entries. |
| `frontend/src/views/Workout.jsx` | `next/EP21-EP25-beginner-core` | +19 −9 | The set menu's three rarer actions (taken to failure, drop set, burst) are built once and placed under More when `simpleWorkout(S)` (a Beginner). With no level chosen the menu is exactly as before. |
| `frontend/src/App.jsx` | `next/EP21-EP25-beginner-core` | +5 | Lazy routes `/start` (Find my plan) and `/learn`. |
| `frontend/src/sheets.jsx` | `next/EP21-EP25-beginner-core` | +3 | Exports `starterPlanName(id)` so the quiz names a plan with the chooser's own words. |
| `frontend/src/lib/starter.js` | `next/EP21-EP25-beginner-core` | +8 −3 | `buildStarterPlan` now calls a new exported `buildPlanFrom(plan, …)`, the same code taking the plan as data; behaviour for named plans is unchanged (`starter.test.js` passes untouched). |
| `frontend/src/lib/tour-offer.js` | `next/EP21-EP25-beginner-core` | +3 | The first-run question never opens over `/start`; it comes once the person is back on Home. |
| `frontend/src/views/Workout.test.jsx`, `frontend/src/lib/tour-offer.test.js` | `next/EP21-EP25-beginner-core` | +25, +20 | The Beginner set menu (and that other levels are unchanged); the question waiting for the quiz. |
| `frontend/src/locales/*.js` (25 packs) | `next/EP21-EP25-beginner-core` | +62 each | The quiz, Learn's labels, the level names and First wins. Machine-written; add them to the native-speaker review (NEXT-STEPS task 7). pt-BR gets explicit overrides. The Learn guides and glossary themselves are English data for now and say so on screen in other languages. |
| `frontend/src/sheets.jsx` | `next/EP23-exercise-guidance` | +19 −1 | The exercise sheet's How to block renders `components/ExerciseGuide.jsx` (loaded on demand; nothing for an exercise without a guide). The starter chooser opens with a Find my plan row. |
| `frontend/src/views/Workout.jsx` | `next/EP23-exercise-guidance` | +6 −1 | A Beginner's exercise menu leads with How to do it; for everyone else it stays under More. |
| `frontend/src/views/Workout.jsx` | `next/EP22-load-finder` | +12 −1 | Under the existing "First time?" line of an exercise with no history, a "Find my weight" button opens the load finder; the weight found goes in through `onField`, like one typed into the first open set. |
| `frontend/src/views/Workout.jsx` | `next/EP22-load-finder-fixes` | +11 −2 | The finder is given the bar floor, the owned weights and the column heading the block already computes, is not offered for an assisted machine, and writes to the first work set open at that moment (read from the store). |
| `frontend/src/App.jsx` | `next/EP19-cloud-backend` | +10 −1 | One lazy route, `/account`, that exists only when the build says `VITE_EDITION=cloud` (the comparison is with the build constant, so a default build drops the import). In that edition it is reachable before the app has its own session, because it is where email links and the sign-in approval land. |
| `frontend/src/views/Settings.jsx` | `next/EP19-cloud-backend` | +5 | An Account row, cloud edition only. |
| `frontend/src/lib/tour-offer.js` | `next/EP19-cloud-backend` | +2 | The first-run question does not open over the account screen. |
| `frontend/src/views/Library.jsx` | `next/EP22-load-finder` | +17 −2 | A "With form guide" chip in the filter row, on for a Beginner, off for everyone else. The guide ids load on their own; until they have, the list is whole. |
| `frontend/src/index.css` | `next/EP22-load-finder` | +1 | One rule for the button's spacing under the first-time line. |
| `frontend/src/components/CardioWeek.test.jsx`, `frontend/src/views/Home.modules.test.jsx` | `next/EP22-load-finder` | +4 −1 each | Tests only: "today" is the app's local date (`todayISO`), not the UTC date, so they pass on a Sunday evening west of Greenwich. Worth offering upstream. |
| `frontend/src/views/Home.jsx` | `next/EP23-exercise-guidance` | +7 | A Beginner's planned rest day says why it is one and links the Learn guide. |
| `frontend/src/sheets.starter.test.jsx`, `frontend/src/views/Workout.test.jsx` | `next/EP23-exercise-guidance` | +19 −1, +18 | The chooser's quiz row (the plan-list assertion now skips it); the Beginner exercise menu. |
| `frontend/src/locales/*.js` (25 packs) | `next/EP23-exercise-guidance` | +10 each | Guidance labels and the rest-day line. Machine-written, for the native review. |
| `frontend/src/test-setup.js` | `next/test-no-network` | +18 | In a DOM environment `fetch` refuses at once instead of opening a real connection: unit tests were connecting to localhost:3000, and the late refusal log could fail a run in which every test passed. |
| `frontend/src/views/Login.jsx` | `next/EP19-cloud-continue-into-app` | +15 | Cloud edition only, and only where no server of the app's own answers: offers the account and this device instead of server profiles that cannot be made. Behind `isCloud()`; the default edition and any instance with a server are unchanged. |
| `frontend/src/views/Login.jsx` | `next/EP19-account-back-returns` | +9 −1 | The Cloud first screen's account button goes through the router (a small component of its own), so the account's Back can return to it. Still behind `isCloud()`. |
| `frontend/src/components/ServerSync.jsx` | `next/EP19-app-knows-the-account` | +9 −3 | `connectionView` takes who is signed in to the hosted account: in the Cloud edition a browser with no server names them instead of saying "Guest mode", and a guest there is offered the account. Default edition: the same words and action as before. |
| `frontend/src/components/SyncBanner.jsx` | `next/EP19-app-knows-the-account` | +4 | The line follows the account, and its button can go to `/account`. |
| `frontend/src/views/Settings.jsx` | `next/EP19-app-knows-the-account` | +3 −1 | The Cloud edition's Account row says who is signed in. |
| `frontend/src/App.jsx` | `next/EP19-app-knows-the-account` | +8 | Cloud edition only: starts the account watcher through a dynamic import. |
| `frontend/src/views/Login.jsx` | `next/EP19-app-knows-the-account` | +12 −8 | The Cloud first screen's layout (classes from `views/first-screen.css`); still behind `isCloud()`. |
| `frontend/src/views/Settings.jsx` | `next/EP19-account-follow-ups` | +6 −3 | The Cloud edition's account card at the top of Settings says who is signed in; a default build is untouched. |
| `frontend/src/views/Login.jsx` | `next/EP19-continue-links-server` | +10 −5 | The Cloud first screen also stands where the app's own server signs people in with the account; still behind `isCloud()`. |
| `frontend/src/views/Login.jsx` | `next/EP19-link-safety` | +11 −5 | The Cloud first screen stands only on a provider-only server and keeps the admin's passkey there; still behind `isCloud()`. |
| `frontend/src/App.jsx` | `next/EP19-link-safety` | +16 −2 | Cloud edition only (`CLOUD`): starts `lib/cloud/link-watch.js` by dynamic import, and says a refused server sign-in to someone who stays in the app. Imports three readers from `lib/oidc.js`, which both builds have. |
| `frontend/vercel.json` | `next/EP19-render-rewrite` | +1 -1 | Routes the existing API rewrite to the hosted Render service. |
| `docs/MCP_REMOTE.md` | `next/EP19-hosted-mcp` | Docs | Explains hosted activation, verification and rollback. |
