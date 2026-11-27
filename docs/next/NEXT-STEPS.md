# openGym Next: next development steps (as of 2026-11-15)

Read this first when you resume. Before it: `AGENTS.md` (first-session checklist), `START-HERE.md` (setup and the per-task loop) and `adr/`.

## 1. State

- **Web image startup (prepared).** The nginx entrypoint can run outside Railway when its environment marker is unset. The ordinary Docker image smoke test covers this case.

- **Glossary locale review (06.03).** The coverage test checks glossary label presence in the active dictionary. Deleting the French bracing label triggered a failing test, and restoring it passed.
- **Offline workout durability (06.01, prepared).** Device write failures report a full device only when storage raises a quota error. The change remains available in memory.
- **Separate connector origin (prepared).** The optional MCP_PUBLIC_ORIGIN setting advertises the connector address in discovery and Settings while sign-in and consent use the web app. The SDK regression follows discovery and exchanges the approved code with a shared base path. Hosted routing and connector acceptance await the domain decision.
- **Nutrition sync and import (09.01a).** Serving and amount fields move together when offline edits merge. Browser and API tests check every ordering of three copies, repeated sync and a legacy import with no creation timestamp. Merging restarts the API.
- **Guest workout adoption (A5, prepared).** The local Cloud journey covers saving the tenth workout and attaching its photo from another tab, carrying both into the account, and decoding the photo from signed-out History after an offline reload. Hosted desktop and physical phone evidence is recorded separately.

- **OpenNutriTracker manual file import (09.01a, prepared).** Export a JSON or CSV ZIP in [OpenNutriTracker v2.7](https://github.com/simonoppowa/OpenNutriTracker/blob/5048a9b57f4ab08b17699af556c280f7f058e07c/docs/export-format.md), open Nutrition diary, select the file, review the destination and confirm. A second export refreshes matching intake IDs. The guest diary stays on this device. A signed-in diary uses its normal account sync. Only selected nutrition fields are saved. Photos, links, account settings, weight and raw exports are excluded. Blank IDs, unknown units and rows without enough information are counted as skipped. Native-language review of the import strings is pending.
- **Coach recovery (07.02, prepared).** A local Chromium test runs the provider timeout, API restart, retry, approval and reload on one disposable profile. Restart feedback can arrive on the next idle poll. Hosted MiniMax acceptance remains open.
- **Production domain (A4, prepared).** [Cutover and rollback checklist](CLOUD-SERVER.md#production-address-cutover-a4) awaits the owner’s choice of addresses and cutover window. Verify disposable signup and recovery emails after the API is live on the new origin.
- **Accessible workout controls (06.03, prepared).** Workout actions wrap on narrow phones. The rest timer and return-to-top button clear the raised Start control and enlarged labels. The progression control includes its displayed guidance and exercise settings in its accessible name. Resume has a stable visible label and a separate visual clock. Physical VoiceOver and TalkBack review remain pending.
- **Connector permissions (10.02, isolated).** The loopback acceptance test checks that a plans-only reader cannot log workouts and that revocation ends access. Hosted client verification remains open.
- Nutrition pairing now belongs to one profile on one device. Re-pair an old device-wide link. Hosted pairing, revocation and shared-device verification remain open.

- **Guest sign-in retry (#133, prepared).** Verify the original workouts and photo survive offline on phone and desktop, and account-only workouts stay private. Local HTTPS Chrome verified the ten guest workouts after sign-out and offline reload. Chromium and WebKit both kept a newer sign-in after the older tab received its logout response. Deliberately signing out the newer session then returned 401.
- **Skill ladders from Learn (11.02c / EP26-T04, prepared for review).** Learn → Skill ladders shows the existing exercise sequences from easier to harder. A completed set marks its step and all earlier steps as reached; the marks describe workout history, not technique or readiness. [Local browser evidence](evidence/EP26-T04/README.md). Independent and native-language review remain open.

- **Routine builder weekly sets (11.02b, prepared for review).** Plan → routine → Weekly sets per muscle estimates the whole recurring plan using the existing muscle weights. A saved personal range takes precedence for any goal; existing draft defaults appear only for muscle growth. The saved plan quiz goal takes precedence, with the saved Coach intake goal used when the quiz goal is absent. Other or missing goals show counts wherever there is no personal range. Cardio adds no strength sets, and an EMOM counts only the station visits within its configured duration. Default values are app adaptations of [RP Strength’s volume landmarks](https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth), not numbers validated for each muscle or personalized recommendations. Named source review and native-language review are pending.
- **Guest workout ownership follow-up (A5, prepared).** Verify signed-out History and guest attachments on the deployed build. The store regression suite covers account reset, profile creation, refused storage writes and a second guest tab.

- **Guided workout (E1, prepared).** During a workout, open Workout options > Layout > Guided workout. Read one exercise’s form cues at a time, or enable Spoken cues to hear them. Too hard switches this session to the guide’s easier exercise. [English phone view](evidence/EP26-T03/guided-workout-390-dark.png).

- **Movement patterns (11.02e / E5b, merged in #136).** The exercise sheet shows eight additional symbolic movement-family examples. Each has its own still and matching caption. The [pattern matrix](evidence/EP26-T01/patterns.md) records fixtures, sources and draft status. Named movement review and native-language review are pending.

- **Movement demo (E5a, merged in #130).** An exercise with a form guide now shows the movement it asks for: the mannequin rig on the exercise sheet, in a chunk of its own, with the words that go with the pose. With reduced motion, or on a device that cannot show 3D, the key pose is shown as a picture with the same words and nothing moves. [English phone view](evidence/EP26-T01/mannequin-rig-390-dark.png), [the still without WebGL](evidence/EP26-T01/mannequin-still-390-dark.png).

- **Workout feedback (E3, prepared).** Set checks, records, completed rest timers and confirmed workout saves use the profile’s sound and vibration settings. Reduced motion suppresses the optional cues. Configured rest alarms still announce when to resume.

- **Catalogue level and pattern (D6, prepared).** Rebuild the draft index with `node scripts/catalogue/seed-level.mjs`. All strength, calisthenics, isometric, olympic and plyometric entries count, including unclassified ones. Exercises in mixed categories also count unless text identifies a non-strength activity. The classifier uses the movement name, target and equipment. All 45 authored guides take precedence, and variants inherit their canonical entry. Unknown IDs stay absent. Review the sample before using draft levels in the app.
- **Rest-day mobility freeze (D8, prepared).** Two completed Learn mobility sessions started on scheduled rest days earn one freeze that week when the profile has room. The calendar explains the award. Earlier workouts retain their existing credit. Merging the shared streak code restarts the hosted API.

- **Hosted preview.** The API and Coach are live on the cloud preview. External MCP connector checks and the production-domain cutover remain open. See the [hosted server runbook](CLOUD-SERVER.md).

- **Beginner Settings and tour (D3 and D4, verified on the preview).** Settings starts with the shorter list for Beginners. The short tour walks through a practice workout, Plan, Learn and Settings. It can be replayed from Settings > About & updates.

- **Backups (A3).** One hosted disk snapshot was visible on November 26. The restore test requires disposable data and the owner’s approval. See [Backups](CLOUD-SERVER.md#backups).

- D2 includes keyboard-accessible definitions on Workout, Plan and Progress. All 49 glossary entries have translations in the 25 locale packs. Native-language review is pending (task 7).
- **Hosted account checks (A1, partial).** The owner opened the Admin dashboard. The disposable profile showed no Admin dashboard and the preview API refused access. Signing out removed access to the profile. After one tab signed in, both kept the same authenticated profile when the other regained focus. Confirm HTTP 403 for the disposable account and HTTP 401 after sign-out through the preview. See [Before real users](CLOUD-SERVER.md#before-real-users).

- **Cloud browser coverage (G1, partial).** A linked member opens Settings > Account on the first visit and after reload. Chrome and WebKit verify the Admin dashboard is absent and the local training server returns HTTP 403 for the admin OIDC endpoint. The hosted status checks remain open under A1.

- **Guest sign-in (A5, verified live November 26, 2026; ownership contract November 27).** Ten guest workouts reached the hosted server and appeared once each on their original dates in both browsers. **Add them** copies them into the account and leaves the device's guest profile intact: after sign-out guest History shows the originals again, and workouts logged inside an account stay private to it (regression `useStore.guest-import-ownership.test.jsx`, branch `next/EP19-guest-import-ownership`). See [Before real users](CLOUD-SERVER.md#before-real-users).
- **Starter plan cards (D5, prepared).** All eight lead with the goal and show weekly frequency, estimated minutes per session, level and equipment before loading. A device guest can fit a plan to local equipment offline. The translated hotel equipment label awaits native-language review. [English phone view](evidence/EP22-T03/starter-cards-390-dark.png).

- **Five-person usability study (G2, prepared).** The owner can run the [six-task script](usability/script.md), obtain consent and collect anonymous metrics on a disposable profile. Grades await participant results.

- **Beginner Coach entry (B3, merged in #101).** Home offers three starter questions when the Coach
  is available. A tap fills the editable chat box, including after first-time setup. The person
  chooses when to send. After #102, a fresh three-day profile confirmed Tuesday push and Wednesday
  pull on the preview. MiniMax returned three equipment-free exercises for the French starter.
  A French three-day plan also offered nine distinct substitutes. All 18 movements passed the catalogue check.
  See the [live Coach checks](CLOUD-SERVER.md#live-coach-checks-after-102) for the catalogue evidence.
  All 25 translations have simulated-provider coverage. The four new strings await native-language review.

- **App help (B4, prepared).** Coach and Settings can search local navigation help. The optional provider call shares the question and up to three visible results. Verify on the hosted preview after merge. The three new strings await native-language review.

- **Hosted Coach (B1, 2026-11-25).** A chat and a full plan succeeded on the hosted test
  account. See [The Coach](CLOUD-SERVER.md#the-coach) for the failed first plan attempt,
  successful retry and MiniMax's hourly subscription totals. Per-run billing remains unknown.

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
- **Merged (#73): `next/EP19-app-knows-the-account`.** Found by the owner on the real project, three things. (1) Save on the account screen showed nothing: the server log held eight accepted saves in a row. Save now says "Saved" and is off until the name changes again. (2) Signed in and past Continue, the app still said "Guest mode" and offered "Sign in". The app now hears who is signed in to the hosted account (`lib/account-badge.js`, which both builds ship and which names no provider; told by `lib/cloud/account-watch.js` through a dynamic import): the line under the status bar names them and says their training is on this device, its button goes to the account, and Settings shows who is signed in. A guest in the Cloud edition is offered the account, not a sign-in to a server. (3) The first screen and the signed-in account screen were redesigned: the first screen is its three-sentence statement set large and to the left; the account screen leads with the way into the app, then the name, then plain rows, with deleting folded away. One new string in 25 languages.
- **Merged (#74): `next/EP19-account-follow-ups`.** Four things found in review of #73, each with a test that failed first. (1) The card at the top of Settings still said "Guest" and "Sign in to sync" to someone signed in to the hosted account; in the Cloud edition it now gives their name and "Signed in as … Your training is stored on this device." (`badgeCard` in `frontend/src/lib/account-badge.js`), and is untouched in a default build. (2) A name typed while a save was under way was written over when the save landed; the field is now left alone and Save offers itself again. (3) A save that landed after signing out announced the previous account to the rest of the app; it is now dropped. (4) Stopping the account watcher did not stop a profile read already under way from announcing a name; it does now.
- **Merged (#75): `next/EP19-late-save-live-session`.** Found in review of #74: the check that drops a save landing after sign-out read a value the account screen keeps, which stays at the old person once the screen is gone. A save that landed after leaving the account and then signing out could still announce them to the rest of the app. The check now asks the client who is signed in.
- **Merged (#76): `next/EP19-cloud-server`.** The owner decided (2026-11-23) that the app's own server runs in the cloud, so that training can follow the account and the AI Coach and MCP, both already in the codebase and both switched off without a server, can be turned on. This adds `render.yaml` (one Docker web service for `api/`, a 1 GB disk at `/data`, sign-up through the hosted account only, project addresses typed into the dashboard and never committed), `api/test/render-blueprint.test.js` holding that file to the server it deploys, and the runbook `docs/next/CLOUD-SERVER.md`. Nothing is deployed by this: the account, the card and the Coach's provider key are the owner's steps.
- **Merged (#77): `next/EP19-cloud-server-admin`.** Found in review of #76, before anything was deployed: with `FIRST_USER_ADMIN` the first person to sign in would have owned the hosted server, and anyone can make a hosted account. The blueprint now names the admin by id (`ADMIN_UIDS`, typed into the dashboard after the owner's first sign-in) and the test refuses `FIRST_USER_ADMIN`. The runbook also records a limit confirmed in the code: behind the Vercel rewrite the server's per-address sign-in throttle sees the proxy, not the visitor, so everyone shares a few buckets. Open for the owner: `render.yaml` is not in the `api` path filter of `.github/workflows/test.yml`, so a change to that file alone does not run its test.
- **Merged (#78): `next/EP19-continue-links-server`.** The piece the hosted server needs from the app, built and tested before that server exists. Where the app's own server signs people in with the account (ADR 0013), the account's Continue now goes through that sign-in, so the person becomes a profile on the server and training follows the account; before, it opened a profile on the device and they stayed a guest. The Cloud first screen stays the account and this device when such a server answers (it used to fall back to the server's own sign-in page), shows a sign-in that came back with an error, and its line under the buttons says what an account then does (one new string, 25 locales). The Cloud E2E now runs against a real API whose one way in is an identity provider (`frontend/e2e/cloud/linked-server.mjs`, with the API tests' own small provider standing in for the hosted project), and walks the whole round trip on both engines. Not covered: the hosted provider itself, and someone with training already on the device (the app's own question about that data is upstream's and was not exercised here).
- **Merged (#79): `next/EP19-link-safety`.** Four findings from review of #78, all confirmed, none of them live (no hosted server exists yet). (1) A profile left open on the app's own server outlived the account it was opened through: sign out of the account, let someone else sign in and press Continue, and they were in the first person's training. The two sessions now end together: Continue notes whose account opens the server profile (`frontend/src/lib/cloud/server-link.js`), signing out of the account signs out of the server profile first, and the app does the same whenever the account changes under an open server profile, also over a reload (`link-watch.js`). The Cloud E2E walks this against a real API and fails without the watcher. (2) The Cloud first screen took an admin's passkey away on a provider-only server and hid the other ways in on a server that has them; it now stands only where the server signs everyone in with the account, with the admin's passkey beside it. (3) Deleting the account left the training on the server. With a server profile open, the account screen now says to delete the training first (the app's own Delete my account, with its own proof) and offers no delete until that is done. **Still open, and a blocker before real users:** an account deleted from a device where the server profile is not open leaves that profile on the server (`docs/next/CLOUD-SERVER.md`, "Before real users"). (4) Someone on this device's profile whose server sign-in was refused came back with no word about it; the app now says why.
- **Merged (#80): `next/EP19-link-across-tabs`.** Three findings from review of #79, all confirmed, none live. They share one cause: #79 reasoned about one tab. (1) A tab left open, signed out, went on believing nobody was signed in to the account, and when another tab signed in and opened the server profile it ended that profile for both. The account session now follows the browser's storage across tabs (`frontend/src/lib/cloud/auth.js`, `sync`), a refresh on its way when that happens is thrown away, and the watcher asks storage before acting. (2) A tab that saw no server profile threw away the note of whose profile is open, so a profile that arrived afterwards belonged to nobody and was never ended. A note is no longer dropped because one tab sees nothing; it names the server profile it is about, and a sign-in that never came back stops counting after fifteen minutes. The tab that ends a profile says so in the note for two minutes, so other tabs still showing that profile let go of it. (3) The delete guard named any open server profile as training to delete first, including one that has nothing to do with the account. It now applies only to the profile opened through this account. The Cloud E2E has a two-tab test for (1), which fails with the sync taken out.
- **Merged (#81): `next/EP19-unsaved-session`.** A regression from #80, found in its review: where the browser's storage will not keep the account session (private mode, a full quota) it lives in the page's memory, and following storage across tabs threw it away again, so signing in did nothing. A session that could not be written is now left alone by `sync`, as is everything where storage cannot be read at all.
- **Merged (#82): `next/EP19-session-must-last`.** Found in review of #81: in a browser that is not keeping the account session (private browsing, storage full) Continue still left for the server's sign-in, a full-page trip. The person came back signed out of the account, with the server profile open and noted as theirs, and the watcher ended it again, every time. The account client now says whether the session will outlive the page (`lasting`), Continue does not start the trip where it will not and opens this device's profile instead, and the account screen says why (one new string, 25 locales).
- **In review: `next/EP19-storage-refused`.** Two findings from review of #82, both about a browser whose storage refuses writes. (1) The fallback to this device's profile could not open there either: the app's store keeps that choice in storage and the write throws, so Continue ended in "Something went wrong". `enterApp` now answers `'refused'` and the account screen says the browser stores nothing for the site and what to do. (2) The line added in #82 said training "stays on this device", which is not true where nothing can be stored; it now says that what is logged there may not be kept either. Not changed, and not this fork's to change lightly: on a device profile with full storage the app itself keeps a finished workout only in the page (`persist` in `frontend/src/store/useStore.js`), in both editions.
- **Needs the owner before any paid deploy:** the media route (ADR 0009: replace or buy a licence), a Supabase project, a Stripe account, the price and the Pro list (ADR 0011).
- **Needs a person:** EP16-T03 on real phones, translation review.
- **Blocked:** EP15, which needs a named licensed PT reviewer.

- **Hosted API (2026-11-23):** The Render Blueprint is live with one Starter API service and a 1 GB disk. Direct health returns HTTP 200 with a writable data directory, and API config offers OIDC. The Vercel rewrite needs to reach the preview before the live sign-in and admin checks.
- **In review: `next/EP19-unlink-group-admins`** (Task A2 of `AGENT-DEVELOPMENT-PLAN.md`). The two findings left on #92. Unlinking takes away an admin role the provider's groups gave, but never the owner's; the unlink route judged both the same and refused an owner whose passkey would still have worked. It now asks whether the profile is still an admin once the link is gone, by the rule `applyRoles` uses. And a refused unlink on a provider-only server no longer tells the person to add a passkey that would not help. Server test first (409 where 200 was right), then the fix.
- **Merged (#93): `next/EP27-agent-development-plan`.** `docs/next/AGENT-DEVELOPMENT-PLAN.md`: everything still open in the plan and on the hosted service, as ordered tasks for a coding agent, each with its files, the names it adds, the tests that prove it and who must be present. Docs only.
- **Merged (#92): `next/EP19-oidc-review-fixes`.** The three findings left open on #88, each checked against the code first. (1) On a server where the provider is the only way in for members, a linked member with a passkey or password could unlink the provider; neither signs a member in there, so nothing opened the profile again. A server test showed it (the unlink answered 200). The unlink route now counts no other way in for such a member, an admin whose passkey does sign them in may still unlink, and the sheet says why with a sentence of its own in all 25 packs. (2) After an unlink the profile the app holds still said linked; it is updated. (3) The Cloud first screen, opened from an address that is not the server's own with no use on this device, now says sign-in works only on the server's own site. Also recorded: what was verified on the hosted service on 2026-11-24 (repeat sign-in, one linked deletion; ADR 0014, `CLOUD-SERVER.md`).
- **Merged (#91): `next/EP19-consent-already-given`.** Found by the owner on the hosted server: the first sign-in through the account worked, and every one after it stopped at "Allow" with "That email address is not accepted". The hosted OAuth server asks once; from then on it has approved the request by the time the consent page reads it and answers with where to go. The page showed Allow anyway, and the consent it then sent was refused as no longer pending, a refusal that carries the same code as a badly formed address. Now the browser is sent on at once, and a refused answer on that page gets the general line. Tests beside `cloud/auth.js` and `views/cloud/Account.jsx`, and one in `e2e/cloud/account.e2e.mjs` whose pretend project behaves as the hosted one does. ADR 0013's two open checks are filled in. Not checked on the hosted server until this is on the preview.
- **Linked account deletion:** `next/EP19-delete-fixes` implements ADR 0014 with
  a deletion-only proof, local-workout preservation and hosted subscription
  preflight. Deploy the Edge Function and verify the hosted issuer's
  `auth_time` before activating the preview build.

- **In review: `next/EP19-hosted-mcp`.** The optional hosted MCP service and preview routing are prepared. Provisioning needs owner approval and external connectors need a reachable HTTPS address.
- **Merged (#85): `next/EP19-oidc-origin-guard`.** The Render API advertises the browser OAuth callback origin. A frontend on a different origin keeps its device path and skips the provider sign-in it cannot complete.
- **OIDC follow-up:** Explain when the current website has no sign-in or guest path, and keep the provider row in native Settings.

### Coach chat acceptance (B2)

With a plan already open, a chat message goes to the ask job. A workout action is
offered for the person to start. New routine and weekday actions become a plan
preview. The routines and week are written when the person selects Import.
With no routines or with a proposed plan open, a message uses the plan builder instead.

- **Back workout with no weights:** the ask tests reject a trained cable movement
  and added load on a floor exercise. A full history of equipment-based movements
  still leaves room for new suggestions. A request that names resistance bands
  and rules out weights can use the bands without adding an external load.
  The repair reply proposes a reverse push-up and a floor T raise, both catalogue
  back exercises. The bodyweight tag alone does not guarantee floor-only movements:
  it also includes chin-ups and bench pull-ups. The test verifies those two floor
  movements. The Coach's catalogue should also carry accessory requirements from
  the app (see `accessoriesOf` in `frontend/src/lib/equipment.js`).
- **Add Tuesday push and Wednesday pull:** both routines preview on the requested
  weekdays. Confirming the chat proposal appends them to those days, keeping Monday,
  existing sessions on Tuesday and Wednesday, and per-date overrides. A repeat reuses
  routines with the same name and prescription. Undo restores the original week even
  after a repeat confirmation in the stubbed test. Full-plan imports keep their replacement behavior.
  In the live preview, the first confirmation added Push Day and retained Wednesday’s existing
  pull routine. The repeat produced a text reply with no changes. See [the schedule and restored daily limit](CLOUD-SERVER.md#live-schedule-check-after-99).

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
| 7 | Native-speaker review of the machine-translated strings (cs, da, fa, id, lt, vi + EP13 labels, the twelve EP24-T03 strings in all packs, and all 49 glossary entries in each pack including the derived Swiss German text) | reviewer | Reviewer named in a PR |
| 8 | EP09-T03 (apply a progression rule to a routine). Only if users ask for it. | — | — |
| 9 | EP15: start only after a licensed PT reviewer is named in writing | — | — |
| 10 | **Read the 55 draft exercise guides** in `frontend/src/content/exercise-guides.js`; correct them or set `review: 'reviewed'` with a name and date (ADR 0012). Then the 36 remaining distinct routine exercises (EP23-T03) | owner, then agent | No guide is `draft` that the owner has read; `lib/exercise-guide.test.js` passes |
| 11 | Named review of the eight EP24-T03 Learn sessions prepared on `next/EP24-learn-sessions`, EP24-T01 (the glossary on more screens), the remaining exercises of EP23-T03 | agent | Per the plan's acceptance column |
| 12 | Cloud, owner's dashboard steps (`supabase/README.md`, "What only the owner can switch on"): leaked-password protection, custom SMTP, the email templates' links, the OAuth server for ADR 0013, `APP_ORIGIN`, and the cloud build's three variables in Vercel | owner | Sign-up and reset emails arrive; the API's "Sign in with Ironvane" completes on a preview |
| 13 | EP18-T04 (media manifest) and EP26-T01 (mannequin demos). The squat rig (E5a) merged in #130; the eight draft E5b examples await independent and named movement review | agent | Before any live Stripe key |

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

D2 follow-up bundles the 13 training-screen definitions for offline use and leaves the full Learn library on demand. The full-screen accessibility check covers Workout, Plan and Progress.

Coach App Help now shows when to retry after a daily limit. Check this on the hosted preview after merge.

D3 prepares a short Beginner Settings root; full search, App help and Account stay available. The two new navigation labels in all locale packs await native review.

- **11.02h, Learn ladders.** Cloud browser coverage follows progress across account linking, reload, a clean second browser and sign-out. Hosted and physical-device verification remain open.
