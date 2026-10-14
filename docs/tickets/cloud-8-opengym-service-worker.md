# Cloud handoff 8: openGym service worker fixes

Repo: `steradrian/gains` (fork of openGym). Work in `frontend/public/sw.js` and its tests only. Branch: `fix/service-worker` off the latest `main`. Open one PR into `main`. Stop when the PR is open and CI is green; the owner's main session reviews and merges.

The urgent fix (never caching `/nt/api/*` and `/hub/api/*`) has already landed in main or is landing separately. Check the fetch handler first, and don't redo it.

## Context
"Gains" is a PWA built on this fork. It is one origin with one service worker, and it serves openGym's API at `/api/`, NutriTrace through a gateway at `/nt/api/`, and the hub's sync routes at `/hub/api/`. The app's routes changed to a tab shell: `#/home`, `#/train/...`, `#/food/...`, `#/progress/...`, `#/me/...`. The legacy paths redirect.

## Tasks (each with a test; find how the repo tests `sw.js`, or add a small harness)
1. **Cache cleanup only deletes our own caches.** On activate, it deletes every cache except the current ones (`sw.js` ~103-107). Delete only caches whose names start with our prefix. Rename the prefix from `opengym-` to `gains-` and keep deleting the old `opengym-rt-*` caches once. Never touch caches that belong to anything else on the origin.
2. **A notification tap opens its target.** Today `notificationclick` focuses any window or opens `./`. Push payloads should carry a URL (check what `api/` sends for rest-timer, reminders and so on). On tap:
   - focus an existing window and navigate it to the target;
   - otherwise open the target;
   - accept only same-origin hash routes;
   - map legacy routes to the new tab routes.
3. **Offline cache scope.** The network-first branch caches every same-origin GET with `ignoreSearch: true` on fallback. Confirm that only the app shell and static assets (built files, locale packs, brand icons) are cached, and that any other path (`/nt/`, `/hub/`, a future endpoint) is never cached. Prefer an allow-list of what may be cached over a deny-list.
4. **Updates.** Check how a new build activates: `skipWaiting`, `clientsClaim`, and the page's update prompt, if there is one. Make sure a deploy can't leave an open app running old JS against a new API without telling the user. Document the behaviour in a comment.

## Rules
- Make file changes only with your editor tools, never sed, awk, python or heredocs.
- Run `npx vitest run` and `npx vite build` in `frontend/`, and report the real exit codes.
- Every user-facing string goes through the app's i18n with keys in all locale files. `node scripts/check-locales.mjs` and `node scripts/check-source-strings.mjs --strict` (from `frontend/`) must exit 0.
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage specific paths. No version bumps.
