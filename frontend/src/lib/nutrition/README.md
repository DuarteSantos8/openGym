# lib/nutrition: NutriTrace from the Gains frontend

Calls go through the hub on the same origin: `/nt/api/*` (only the routes allow-listed in
fitness-hub `src/nt-routes.ts`; anything else is a 404) and `/hub/api/sync/*`. No tokens. Gate
UI on `nutritionAvailable(user)`: phones and guests have no nutrition. A route you need that
is not on the list needs a hub PR first.

- `api.js`: `NtApi.*` and `HubSync.*`. The typedefs at the top are NutriTrace's real shapes.
  Errors are an `NtError` with `status` (0 = no answer) and `code`: `offline`, `timeout`,
  `http`, `bad-response`, `aborted` or `invalid`. Never render `e.message`; map `code` and
  `status` to `t()` strings. Foods are always saved private and without an image.
- `store.js`: `useNutrition` holds per-date `days`, `settings`, `activity`, `foods` and `logged`,
  with `load*` methods. Writes are retry-safe: build the entry once with `draftFood`,
  `draftQuick` or `draftWater` (these throw `invalid`), keep it, and pass that same draft to
  `logFood(date, draft)`, `logQuick(date, item)` or `logWater(date, log)`, including on retry.
  Writes are not optimistic and throw an `NtError`. `removeItem` and `removeWater` undo. Stale
  answers and answers from a previous account are dropped.
- `diary.js`: NutriTrace's arithmetic (`totalsOf`, `atPortion`, `calorieTarget`, `macroTarget`),
  units (`energyOf` for kcal or kJ, `waterOf`), `mealsOf` (`isDefault` names are English: translate
  them; saved names show as saved), `recentFoods` and `matchesFood`.
- `off.js`: Open Food Facts search URL and hit-to-food mapping.
- `selection.js`: `useDiarySelection` is the one date and meal everything logs to. In
  components use `useDiaryTarget(settings)`, which updates on a pick, at midnight and as the
  clock moves the meal. A sheet that logs takes `{ date, meal }` once when it opens and keeps
  it. Default meal (a Gains rule; NutriTrace has none): the meal whose reminder time
  (`notifMealTimes`) is nearest now. A hand pick (`setMeal`) holds 30 minutes, and
  `setDate` clears it.
- `sync.js`: `syncNow()` pushes openGym first, coalesces concurrent calls, keeps at least 5 s
  between runs, and never throws. Also `refreshHubStatus()`, `useHubTrouble()` and
  `workoutSyncRow(id)`. The status is `null` until the hub has stored the person.

## Tests

`fake-nutritrace.js` fakes NutriTrace and the hub at the fetch boundary. It applies the hub's
rules and NutriTrace's merge and tombstones, and offers `failNext` (refused, offline, or saved
with the answer lost) and `hold` (answers delivered out of order). Examples are in
`nutrition-core.test.jsx`. Set it up with `vi.stubGlobal('fetch', createFakeNutriTrace({...}).fetch)`.
In `beforeEach`: `useStore.setState({ user: {...}, pushState: vi.fn() })`,
`useNutrition.getState().reset()` and `resetSyncThrottle()`.
