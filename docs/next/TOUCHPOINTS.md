# Upstream files the fork modifies (plan §3.2)

One row per upstream file changed by an openGym Next / Ironvane PR, with the reason. New files the
fork adds (its own components, libs, tests, CSS) are not listed. Keep each feature PR at about 30
changed lines per upstream file or fewer; larger changes need a design note first.

Started 2026-11-20 with the body picker; earlier PRs (#18–#51) did not keep this file.

| File | PR / branch | Lines | Why |
|---|---|---|---|
| `mcp/test/http.e2e.test.js` | next/EP27-mcp-plans-readonly | Scoped HTTP tools | Check a plans-only grant against both workout histories, then revoke it. |
| `api/server.js`, `api/openapi.yaml`, `api/test/server-token-refresh.test.js` | #133 | Browser logout | End the presented session while leaving a later browser sign-in and other devices signed in. |
| `api/oidc/routes.js`, `api/test/server-oidc.test.js` | #133 | Verified provider callback | Clear the pending logout fallback when issuing the replacement browser session. |
| `frontend/src/lib/sister-nutrition.js`, `frontend/src/lib/sister-nutrition.test.js` | next/EP27-nutrition-isolation-proof | Nutrition pairing | Keep cached totals and pending requests within their owning profile. |
| `frontend/src/store/useStore.js`, `frontend/src/store/useStore.signout-nutrition.test.jsx`, `frontend/src/store/useStore.stash-unit.test.jsx` | next/EP27-nutrition-isolation-proof | Session transitions | Gate nutrition on confirmed identity and test shared-device privacy. |
| `frontend/src/components/SisterApps.jsx` | next/EP27-nutrition-isolation-proof | Pairing sheet | Reset drafts and scope unlink confirmations to the pairing shown. |
| `frontend/src/store/useStore.js`, `frontend/src/lib/api.js`, `frontend/src/lib/oidc.js`, `frontend/src/lib/oidc.test.js` | #133 | Sign-in retry | Preserve the newer session when logout responses overlap or storage is full. |
| `frontend/src/components/Ladders.jsx`, `frontend/src/index.css` | `next/EP26-learn-ladder` | Learn sheet | Reuse the existing ladder cards and history calculation for a read-only, text-only Learn view. |
| `frontend/src/lib/ladders.test.js` | `next/EP26-learn-ladder` | Test | Pin built-in rung counts and push-up order; cover unrelated, incomplete, repeated and out-of-order sets. |
| `frontend/src/locales/*.js` | `next/EP26-learn-ladder` | +4 each | Translate rung status, the meaning of reached, and the empty state in all 25 packs. |
| `frontend/src/lib/media-sync.js`, `frontend/src/lib/media-sync.test.js` | `next/EP19-guest-privacy-followup` | Cache size limit | Preserve original guest and stashed attachments when trimming downloaded files. |
| `frontend/src/store/useStore.js` | `next/EP19-guest-privacy-followup` | Account transitions | Protect guest training and attachments, and clean up a login or pairing when the guest snapshot cannot be saved. |
| `frontend/src/store/useStore.mobile-remote.test.jsx` | `next/EP19-guest-privacy-followup` | Pairing | Cover refused guest storage and the next successful pairing. |
| `frontend/src/lib/api.js`, `frontend/src/lib/oidc.js` | `next/EP19-guest-privacy-followup` | Sign-in | Wait for a failed adoption's cookie cleanup before the next sign-in. |
| `frontend/src/views/Login.jsx` | `next/EP19-guest-privacy-followup` | Sign-in | Restore the provider sign-in button when cookie cleanup cannot reach the server. |
| `frontend/public/sw.js`, `frontend/src/lib/sw-offline-launch.test.js` | `next/EP26-mannequin-framing` | Offline exercise sheet | Answer uncached offline resource requests with HTTP 503. |
| `frontend/src/components/mannequin/`, `frontend/e2e/mannequin-demo.e2e.mjs` | `next/EP26-mannequin-framing` | Exercise demo | Fit the rig in narrow panels, follow the nearest pose caption and exercise playback from an offline reload. |
| `frontend/public/sw.js`, `frontend/src/lib/sw-media.test.js` | `next/EP26-mannequin-patterns` | Offline exercise sheets | Return a non-cacheable HTTP failure when uncached media cannot be fetched offline. |
| `frontend/src/components/ExerciseGuide.test.jsx` | `next/EP26-mannequin-patterns` | Guide integration | Cover switching from the squat to a newly supported pull demo. |
| `frontend/src/components/mannequin/` | `next/EP26-mannequin-patterns` | Demo | Complete the nine-family pose table; keep the existing lazy loader and match the still caption after WebGL loss. |
| `frontend/e2e/mannequin-demo.e2e.mjs` | `next/EP26-mannequin-patterns` | Tests | Verify each family from its normal Library sheet with exercise media blocked. |
| `frontend/src/locales/*.js` | `next/EP26-mannequin-patterns` | Copy | Translate one heading and sixteen pose captions across 25 packs. |
| `frontend/src/components/ExerciseGuide.jsx` | `next/EP26-mannequin-squat` | Demo | Show the movement demo for the guide's pattern, loaded on demand, so the 3D code stays out of the app's first download. |
| `frontend/public/sw.js` | `next/EP26-T03-guided-workout` | Hashed assets | Reuse the installed immutable module when an offline module request sends an Origin header. |
| `frontend/src/views/Workout.jsx` | `next/EP26-T03-guided-workout` | Layout | Offer the session layout and pass its active exercise to the existing swap flow. |
| `frontend/src/views/FocusView.jsx`, `FocusView.css` | `next/EP26-T03-guided-workout` | Guided card | Keep set logging and show the selected exercise’s cues and controls. |
| `frontend/src/sheets.jsx` | `next/EP26-T03-guided-workout` | Swap | Announce the easier exercise only after a confirmed active-session swap. |
| `frontend/src/views/Workout.test.jsx` | `next/EP26-T03-guided-workout` | Tests | Include Guided workout in the two layout-menu expectations. |
| `frontend/src/locales/*.js` | `next/EP26-T03-guided-workout` | Copy | Translate the layout name and swap confirmation in all 25 packs. |
| `frontend/src/views/Workout.jsx` | `next/EP26-workout-feedback` | Set checks | Route existing set and record signals through the shared preferences. |
| `frontend/src/store/useUI.js` | `next/EP26-workout-feedback` | Rest timer | Keep the native alarm and selected tone on a live rest completion. |
| `frontend/src/sheets.jsx` | `next/EP26-workout-feedback` | Finish | Play completion feedback after the workout is saved. |
| `frontend/src/sheets.finish-hold.test.jsx` | `next/EP26-workout-feedback` | Finish test | Confirm a pending finish produces no cue and a saved session produces one. |
| `api/coach/core/streak.js` | `next/EP25-mobility-freeze` | Streak | Bank one freeze for two verified mobility sessions in a week under the active rule. |
| `frontend/src/lib/finish-workout.js` | `next/EP25-mobility-freeze` | Workout | Preserve the rest-day date only for a completed Learn circuit. |
| `frontend/src/lib/streak.js`, `streak-explain.js` | `next/EP25-mobility-freeze` | Calendar | Document the shared rule and explain a mobility award. |
| `frontend/src/lib/streak.test.js`, `streak-parity.test.js`, `streak-explain.test.js` | `next/EP25-mobility-freeze` | Tests | Check weekly limits, history, trainer parity and calendar wording. |
| `frontend/src/locales/*.js` | `next/EP25-mobility-freeze` | Copy | Translate the mobility award in all 25 packs. |
| `frontend/e2e/cloud/account.e2e.mjs` | #120 | +12 −1 | Check member access on the first Account visit and after reload against the local training server. |
| `frontend/src/lib/tour.js` | `next/EP22-beginner-tour` | +12 −3 | Register eight beginner stops and select the existing walk for other levels. |
| `frontend/src/lib/tour.test.js` | `next/EP22-beginner-tour` | +21 −2 | Check the beginner targets, default walk, named tutorials and replay. |
| `frontend/src/components/Tour.jsx` | `next/EP22-beginner-tour` | +9 −2 | Read the experience level and drive the practice and navigation stops. |
| `frontend/src/views/Settings.jsx` | `next/EP22-beginner-tour` | +1 −1 | Anchor the real Learn row shown in the tour. |
| `frontend/src/views/Workout.jsx` | `next/EP22-beginner-tour` | +1 −1 | Anchor the exercise menu containing Swap exercise. |
| `frontend/src/lib/workout-keys.js` | `next/EP22-beginner-tour` | +1 −1 | Let focused tour dialog controls handle the keyboard during practice. |
| `frontend/src/views/Settings.jsx` | `next/EP21-beginner-settings` | Settings | Render the short root and its profile preference. |
| `frontend/src/views/settings-pages.js` | `next/EP21-beginner-settings` | Settings | Select the visible page IDs for the current experience. |
| `frontend/src/views/settings-pages.test.jsx` | `next/EP21-beginner-settings` | Settings | Verify page selection and retain the existing layout check across line endings. |
| `frontend/src/locales/*.js` | `next/EP21-beginner-settings` | Settings | Translate the two Settings navigation controls in all 25 packs. |
| `frontend/src/sheets.jsx` | `next/EP22-starter-plan-cards` | Chooser | Show frequency, session length, level and kit, with each split name below. |
| `frontend/src/lib/starter.js` | `next/EP22-starter-plan-cards` | Preview | Estimate the sessions and equipment in the selected plan. |
| `frontend/src/lib/starter.test.js` | `next/EP22-starter-plan-cards` | Test | Retain the weekly schedule contract with the expanded preview. |
| `frontend/src/sheets.starter.test.jsx` | `next/EP22-starter-plan-cards` | Test | Select plans by their secondary name and check the primary weekly frequency. |
| `frontend/src/views/starter-entry.test.jsx` | `next/EP22-starter-plan-cards` | Test | Open the real chooser and verify the facts on all eight cards. |
| `frontend/src/locales/*.js` (25 packs) | `next/EP22-starter-plan-cards` | +1 each | Identify both chairs used by the hotel routine. |
| `frontend/src/views/AppHelp.jsx` | `next/EP19-coach-help-quota` | UI | Explain a daily Coach limit while local help stays available. |
| `frontend/src/views/AppHelp.test.jsx` | `next/EP19-coach-help-quota` | Test | Distinguish the daily cap from other failures and open a local match. |
| `frontend/src/store/useStore.js` | `next/EP19-delete-fixes` | +6 | Clear the local signed-in copy only when its profile ID matches the deleted server profile. |
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
| `api/server.js`, `api/oidc/config.js` | `next/EP19-oidc-origin-guard` | API config | Reports the callback origin with OIDC configuration. |
| `frontend/src/views/Login.jsx`, `frontend/src/lib/oidc.js` | `next/EP19-oidc-origin-guard` | Browser sign-in | Offers provider sign-in only where the callback can complete. |
| `api/test/server-oidc.test.js`, `frontend/src/views/Login.oidc.test.jsx` | `next/EP19-oidc-origin-guard` | Tests | Cover the advertised origin and the two browser outcomes. |
| `frontend/src/views/Login.jsx` | `next/EP19-oidc-signin-followups` | +1 | Explains unavailable sign-in when guest use is off. |
| `frontend/src/components/OidcAccount.jsx` | `next/EP19-oidc-signin-followups` | +2 -1 | Preserves the provider row on native builds. |
| 25 files in `frontend/src/locales/` | `next/EP19-oidc-signin-followups` | +25 | Translates the browser sign-in explanation. |
| `api/oidc/routes.js` | `next/EP19-oidc-review-fixes` | +6 -2 | Unlink counts no other way in for a member where the provider is the only way in. |
| `frontend/src/components/OidcAccount.jsx` | `next/EP19-oidc-review-fixes` | +12 -2 | No Unlink for such a member, with why; the held profile is updated after an unlink. |
| `frontend/src/views/Login.jsx` | `next/EP19-oidc-review-fixes` | +6 -3 | The Cloud first screen says when sign-in cannot work from this address. |
| `api/test/server-oidc.test.js`, `frontend/src/components/OidcAccount.test.jsx` | `next/EP19-oidc-review-fixes` | Tests | The lockout, shown first; the sheet; the held profile. |
| 25 files in `frontend/src/locales/` | `next/EP19-oidc-review-fixes` | +25 | One sentence for the sheet. |
| `api/oidc/routes.js` | `next/EP19-unlink-group-admins` | +7 -3 | Unlink asks whether the profile is still an admin once the link is gone. |
| `frontend/src/components/OidcAccount.jsx` | `next/EP19-unlink-group-admins` | +6 -3 | A refused unlink on a provider-only server gets the sentence that fits. |
| `api/test/server-oidc.test.js`, `frontend/src/components/OidcAccount.test.jsx` | `next/EP19-unlink-group-admins` | Tests | The owner and the group-made admin; the refusal's wording. |
| `frontend/src/views/Home.jsx` | `next/EP24-learn-sessions` | Small edit | Offer one mobility session on beginner rest days. |
| `frontend/src/views/Learn.jsx` | `next/EP24-learn-sessions` | Small edit | Choose and launch a guided session in the warm-up guide. |
| `frontend/src/views/Learn.test.jsx`, `frontend/src/views/Home.restday.test.jsx` | `next/EP24-learn-sessions` | Tests | Cover both entry points. |
| `frontend/src/index.css` | `next/EP24-learn-sessions` | Small edit | Keep the moving countdown ring still under reduced motion. |
| `scripts/routines/lib.mjs`, `scripts/routines/validate.mjs`, `scripts/routines/routines.test.mjs` | `next/EP24-learn-sessions` | Small edit | Validate Learn drafts separately from the published library. |
| `web/Dockerfile` | `next/EP24-learn-sessions` | Small edit | Include the offline routines in self-hosted web builds. |
| `25 files in frontend/src/locales/` | `next/EP24-learn-sessions` | Small edit | Translate session names and the start action. |
| `frontend/src/lib/history.js` | `next/EP24-learn-sessions` | +2 -1 | Keep the previous group clock out of a standalone exercise. |
| `frontend/src/store/useCircuit.js` | `next/EP24-learn-sessions` | Small edit | Release an untouched Learn preview when its Ready screen closes. |
| `api/coach/core/routine-library.js`, `api/coach/core/payload.js`, `api/coach/core/ask-actions.js` | `next/EP19-coach-prompts` | Small edit | Recognize explicit no-weights requests and reject weighted routine or workout items in those chat proposals. |
| `api/test/coach-ask.test.js`, `frontend/src/views/CoachChat.test.jsx` | `next/EP19-coach-prompts` | Tests | Exercise both prompts with a stubbed provider, including schedule confirmation and a repeat. |
| `frontend/src/lib/coach.js`, `frontend/src/lib/plan-share.js` | `next/EP19-coach-add-days` | Small edit | Append scheduled routines from chat and reuse matching prescriptions on repeat confirmation. |
| `frontend/src/views/CoachChat.jsx`, `frontend/src/views/CoachChat.test.jsx` | `next/EP19-coach-add-days` | UI and tests | Show the additive schedule choice and verify preservation, repeat confirmation and Undo. |
| `frontend/src/App.jsx`, `frontend/src/views/Home.jsx`, `frontend/src/views/Home.modules.test.jsx` | `next/EP19-beginner-coach-card` | UI and tests | Offer the beginner starter card and pass its draft through the Coach routes. |
| `frontend/src/views/CoachChat.jsx`, `frontend/src/views/CoachIntake.jsx` and their tests | `next/EP19-beginner-coach-card` | UI and tests | Keep the starter editable through consent and intake until the person sends it. |
| `frontend/src/components/AskCoach.jsx` and its tests | `next/EP19-beginner-coach-card` | UI and tests | Show three translated prompts when the Coach is reachable. |
| All 25 locale packs | `next/EP19-beginner-coach-card` | UI and tests | Translate the card heading and starter prompts. |
| `frontend/src/views/CoachChat.jsx` | `next/EP19-coach-starter-fixes` | UI | Send first-use scheduling questions through Coach actions and keep full-plan retries. |
| `frontend/src/views/CoachChat.test.jsx` | `next/EP19-coach-starter-fixes` | Tests | Confirm Tuesday push and Wednesday pull on a new three-day profile in English and French. |
| `frontend/src/views/CoachChat.refusal.test.jsx` | `next/EP19-coach-starter-fixes` | Tests | Cover a typed scheduling request and a failed full-plan retry on an empty profile. |
| `api/coach/core/routine-library.js` | `next/EP19-coach-starter-fixes` | Core | Recognize translated no-weights requests. |
| `api/coach/core/library.js` | `next/EP19-coach-starter-fixes` | Core | Limit equipment-free choices to known catalogue exercises. |
| `api/coach/core/payload.js` | `next/EP19-coach-starter-fixes` | Core | Offer equipment-free exercises when the request calls for them. |
| `api/coach/core/pipeline.js` | `next/EP19-coach-starter-fixes` | Core | Pass the equipment restriction into first-plan validation. |
| `api/coach/core/ask-actions.js` | `next/EP19-coach-starter-fixes` | Core | Apply the equipment restriction to chat proposals. |
| `api/coach/core/validate.js` | `next/EP19-coach-starter-fixes` | Core | Check proposed exercise choices against the equipment restriction. |
| `api/test/coach-ask.test.js` | `next/EP19-coach-starter-fixes` | Tests | Exercise translated requests and unsafe proposals with a simulated provider. |
| `frontend/src/App.jsx`, `frontend/src/views/Settings.jsx`, `frontend/src/views/CoachChat.jsx` | `next/EP19-coach-app-navigation` | UI | Open local app help from Settings or Coach with the existing Settings availability context. |
| `frontend/src/components/Tour.jsx`, `frontend/src/lib/tour.js` | `next/EP19-coach-app-navigation` | UI | Share the navigation stops and their displayed instructions with local help. |
| `frontend/src/locales/*.js` (25 packs) | `next/EP19-coach-app-navigation` | Copy | Translate the app-help label and empty result. |
| `docs/AI_COACH.md` | `next/EP19-coach-app-navigation` | Docs | Document local lookup, optional disclosure and destination handling. |
| `api/coach/jobs.js`, `api/coach/routes.js` | `next/EP19-coach-app-navigation` | API | Bound and rate-limit a help request with only a question and visible directions. |
| `api/openapi.yaml`, `website/api.html` | `next/EP19-coach-app-navigation` | API docs | Document the read-only explanation endpoint and update its generated reference. |
| `frontend/src/views/settings-pages.test.jsx` | `next/EP19-coach-app-navigation` | Test | Verify the app-help entry after the existing Settings root rows. |
| `frontend/e2e/cloud/account.e2e.mjs` | `next/EP19-guest-workouts` | E2E | Verify ten guest workouts in the linked server profile and in History on both devices. |
| `frontend/src/views/Workout.jsx` | `next/EP24-glossary-workout-plan-progress` | UI | Explain terms for sets and effort before and during a session. |
| `frontend/src/content/learn.js` | `next/EP24-glossary-accessibility` | Content | Share the 13 offline definitions with the full Learn index. |
| `frontend/src/views/week-start.test.jsx` | `next/EP24-glossary-accessibility` | Test | Check reordered weekdays by their full weekday names. |
| `frontend/src/views/Plan.day-rows.test.jsx` | `next/EP24-glossary-workout-plan-progress` | Test | Check that the weekday button names its visible routine. |
| `frontend/src/views/Plan.routine-count.test.jsx` | `next/EP24-glossary-workout-plan-progress` | Test | Find weekday buttons with their routine details. |
| `frontend/src/views/Plan.jsx` | `next/EP24-glossary-workout-plan-progress` | UI | Explain terms for the weekly schedule. |
| `frontend/src/views/RoutineEdit.jsx`, `frontend/src/index.css` | `next/EP26-weekly-muscle-sets` | UI | Show recurring planned sets in the routine editor; reuse Stats' muscle weights and keep textual statuses. |
| `frontend/src/lib/muscle-targets.js` | `next/EP26-weekly-muscle-sets` | Logic | Resolve valid saved ranges for planning without changing the logged-volume fallback. |
| `frontend/src/lib/muscles.js` | `next/EP26-weekly-muscle-sets` | Logic | Share recurring-plan aggregation; keep the Stats map default and apply cardio/EMOM counting rules only in the editor. |
| `frontend/src/locales/*.js` | `next/EP26-weekly-muscle-sets` | Copy | Preserve localized estimate, empty state, range status and source labels. |
| `frontend/src/views/Stats.jsx` | `next/EP24-glossary-workout-plan-progress` | UI | Explain record and volume metrics in Progress. |
| `frontend/src/components/Term.jsx` | `next/EP24-glossary-workout-plan-progress` | UI | Reuse the definition sheet for small, screen-specific glossaries. |
| `frontend/src/views/onboarding.css` | `next/EP24-glossary-workout-plan-progress` | UI | Move shared term styles to the component stylesheet. |
| `api/coach/core/adapters/http.js`, `api/test/chatgpt-plan.test.js` | `next/EP19-coach-app-navigation` | API and tests | Allow provider discovery and credential refresh within a single generation request. |
| `frontend/src/views/settings-pages.js` | `next/EP19-coach-app-navigation` | Search | Expose the visible Settings index to app help to rank full translated labels in a question. |
| `frontend/src/components/ExerciseGuide.jsx`, `frontend/src/lib/i18n{,-core}.js` | `next/EP23-routine-guide-batch-1` | UI | Show the English notice only when a guide actually falls back to English. |
| `frontend/src/locales/*.js` (25 packs) | `next/EP23-routine-guide-batch-1` | Copy | Translate the cues, mistake and correction pairs, muscle descriptions and breathing for ten routine exercises. |
| `frontend/src/store/useStore.js` | `next/EP19-guest-import-ownership` | +32 −3 | **Store (Tier A area):** the device's own guest profile is snapshotted into `gym_guest_state` when a sign-in adopts the device data, and `clearLocalSession` (every sign-out) puts it back instead of a blank profile — **Add them** copies a guest's workouts into the account, it never consumes them (owner decision 2026-11-27, `DECISION-01.01.md`). Account workouts never reach the guest slot. Just over the 30-line guide; the owner decision is the design note. |
| `frontend/e2e/cloud/account.e2e.mjs` | 11.02h / EP27-T01 | Cloud Learn ladder journey | Exercises the shipped ladder from a linked account and checks that linked progress disappears on a clean device after sign-out; no runtime behavior changed. |
