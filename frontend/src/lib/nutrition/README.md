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
- Settings writes: `useNutrition.saveSetting(key, value)` (`NtApi.putSetting`, one key per
  `PUT /api/settings`) updates the cache once the server has it. The Goals page owns
  `calorieGoalMode`, `calorieGoalFactor`, `goals`, `goalTemplates`, `waterGoalMl`,
  `calorieAdjustFromActivity` and `diaryShowActivity`; `goals.js` holds its rules and
  `use-goals-form.js` its state. The hub takes exactly `{ key, value }` per write, type-checks
  the value, and answers a refused body with 400; a failed save shows `writeErrorText` and keeps the draft.
- Profile's Nutrition pages (Diary & meals, Water, Foods & scanning, Food sources, Categories,
  Custom units) wrap in `components/NtSettingsGate.jsx` and write through `use-nt-settings.js`:
  `useNtSettings()` gives `{ data, busy, save }` (`save` resolves false after a toast),
  `useSheetSave(close)` the save behind an add sheet (the sheet stays open with its fields and the
  reason), `settingOf(data, key)` a value or NutriTrace's default (`NT_DEFAULTS`). Screens read a
  setting with `settingOf` too, so a setting on a page changes a screen: a page gets a setting only
  where a Gains screen reads it (see the table in the PR that added them). `settings-lists.js` holds
  the list rules and the shapes the hub takes: a custom unit `{ abbr, full }`, a category a name or
  `{ name, label }`, a water container `{ id, name, volumeMl }`. A stored entry is cleaned to those
  fields before a list is written back. Not here: sharing, the scanner flashlight (device-only),
  Yesterday's meals, the diary's nutrition bar and rail widgets, fasting notifications and schedule,
  USDA's key, Open Food Facts' login (the hub refuses them), and the options Gains has no screen
  for (custom and visible nutrients, day notes and completion, photos, unit details).
  `water.js` is the quick-add water buttons, `meal-rows.js` a meal's rows on Home.
- `diary.js`: NutriTrace's arithmetic (`totalsOf`, `atPortion`, `calorieTarget`, `macroTarget`),
  units (`energyOf` for kcal or kJ, `waterOf`), `mealsOf` (`isDefault` names are English: translate
  them; saved names show as saved), `recentFoods` and `matchesFood`.
- `off.js`: Open Food Facts search URL and hit-to-food mapping. `offResults` ranks products sold
  in Romania first (`countries_tags`, client side: the hub's search URL takes only q, page,
  page_size and langs).
- `use-food-search.js`: `useFoodSearch(query)` is the one search behind every food picker
  (recents, your foods, Open Food Facts; `components/FoodSearch.jsx` renders it). Online results
  have no `id`: a place that needs a saved food calls `saveFood` first (the result's `client_key`
  makes a retry one food). Do not write another search; the Foods online tab uses `use-online-search.js`.
- `selection.js`: `useDiarySelection` is the one date and meal everything logs to. In
  components use `useDiaryTarget(settings)`, which updates on a pick, at midnight and as the
  clock moves the meal. A sheet that logs takes `{ date, meal }` once when it opens and keeps
  it. Default meal (a Gains rule; NutriTrace has none): the meal whose reminder time
  (`notifMealTimes`) is nearest now. A hand pick (`setMeal`) holds 30 minutes, and
  `setDate` clears it. `setDate` never goes past today, and the store refuses to log to a later day.
- `sync.js`: `syncNow()` pushes openGym first, coalesces concurrent calls, keeps at least 5 s
  between runs, and never throws. Also `refreshHubStatus()`, `useHubTrouble()` and
  `workoutSyncRow(id)`. The status is `null` until the hub has stored the person.
- `trends.js` and `use-trends.js` (Progress › Trends): `useTrends` holds every diary day
  (`GET /api/diary`, read once); `trends.js` turns them into a metric's series over the hub's range
  (`windowOf` ends yesterday: today is still being logged), its summary, and the goal line
  (`goalOf`: none for a Dynamic or Adaptive calorie target, which is worked out per day). Fasting
  insights are `components/FastInsights.jsx` with `since`.
- `wellness.js` and `useWellness` (Progress › Recovery): the last year of `GET /api/wellness/fitbit/data`
  (Fitbit, Google Health, Health Connect) and `.../garmin/data`, read only for a wearable the
  settings say is connected, merged with Garmin winning. A source that fails does not hide the
  other. The hub's Recovery card shows only when something was reported.

## Tests

`fake-nutritrace.js` fakes NutriTrace and the hub at the fetch boundary. It applies the hub's
rules and NutriTrace's merge and tombstones, and offers `failNext` (refused, offline, or saved
with the answer lost) and `hold` (answers delivered out of order). Examples are in
`nutrition-core.test.jsx`. Set it up with `vi.stubGlobal('fetch', createFakeNutriTrace({...}).fetch)`.
In `beforeEach`: `useStore.setState({ user: {...}, pushState: vi.fn() })`,
`useNutrition.getState().reset()` and `resetSyncThrottle()`.
