# Cloud handoff 13: kit accessibility and starter plans

Repo: `steradrian/gains` (fork of openGym; React 19 JSX in `frontend/`). Branch: `fix/kit-a11y-starter` off the latest `main`. One PR into `main`. Stop when it's open and CI is green; the owner's main session runs the tests locally, reviews and merges.

Other work in flight that you must avoid:
- Cloud batches migrating `frontend/src/sheets/*.jsx` (branches `refactor/sheets-s1..s4`). **Don't edit `src/sheets/`.**
- A Nutrition settings PR (`feat/nutrition-settings-pages`).
- Onboarding (`feat/onboarding-api`, `api/` only).

## Context
The UI kit is in `frontend/src/components/` (`ui.jsx`, `layout.jsx`, `blocks.jsx`, `sheet-layout.jsx`) and `src/ui-kit.css`. Read `components/README-ui-kit.md`. The guard tests in `src/ui-guards.test.js` must stay green; lower the baseline only for files you improve.

## Tasks (each with a behaviour test)
1. **44 px targets.** `Button size="sm"` renders about 36 px tall. Give it a 44 px hit area across the kit, without changing its visual size: use a pseudo-element hit-area extension, or min-height if the design allows. Check the other small kit controls too (`Chip`, icon buttons) and fix them the same way.
2. **Dialog semantics for every sheet.** Sheets opened through `useUI.openSheet` (`components/Modals.jsx`) have no dialog role and no focus handling. The + sheet already does it right via `lib/use-dialog-focus.js`. Apply that to every sheet in `Modals.jsx`:
   - `role="dialog"`, `aria-modal`, and a label taken from the sheet's header;
   - focus moves in on open and is trapped;
   - `inert` on the background;
   - focus returns to the opener on close;
   - Escape closes it, where the sheet allows closing.

   Make sure nested and stacked sheets work, and that the tab-shell back behaviour with sheets still passes its tests (`App.tab-shell.test.jsx`).
3. **Starter plans for 2, 5 and 6 days.** `frontend/src/lib/starter.js` has plans for 3 and 4 days only. Add well-structured 2-, 5- and 6-day plans:
   - 2 days: full body A/B;
   - 5 days: upper/lower plus push/pull/legs, or similar;
   - 6 days: push/pull/legs twice.

   Use exercises that exist in the library, and include a sensible version for each experience level (new / coming back / regular) if the module supports levels. Follow the existing data shape exactly. Onboarding will choose a plan by days and experience.

## Rules
- File changes only with your editor tools, never sed/awk/python/heredocs.
- If you can, run `npx vitest run --maxWorkers=4` and `npx vite build` in `frontend/`, plus `node scripts/check-locales.mjs` and `node scripts/check-source-strings.mjs --strict`, and report real exit codes. If you can't, say so.
- Every user-facing string goes through `t()`, with keys in all locale files (English values).
- No screenshots. Commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage specific paths. No version bumps.
