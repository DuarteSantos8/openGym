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
