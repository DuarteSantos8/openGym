# Mealie: read-only integration spec (not built)

Status: **specification only**. Nothing here is implemented. Every API fact below was read from
Mealie's source, not from a running instance, and is marked where it is inferred rather than seen.

Source read: `mealie-recipes/mealie` at commit `1624c22bf70988c7fe404ad586e2f9689f77748d`
(2026-11-13, `pyproject.toml` version `3.31.0`). Paths below are relative to that repository.

## Goal

Let a profile log a serving of one of its own Mealie recipes, or the recipe planned for a meal, into
the Extension Lab food diary (`frontend/src/lib/nutrition-diary.js`). Read only: openGym never
creates, edits or deletes anything in Mealie.

## Required configuration

- Server: add `mealie` to `INTEGRATIONS` (for example `INTEGRATIONS=webhook,nutritrace,mealie`).
  A Mealie on the home network over plain http also needs `INTEGRATIONS_ALLOW_LAN=1`, exactly as for
  NutriTrace and webhooks.
- Per profile: a Mealie base URL and a long-lived API token, connected through
  `POST /api/integrations/connect` with `{ provider: 'mealie', url, token }`. Both are sealed per
  profile by the hub (`api/integrations/store.js`, AES-256-GCM, AAD bound to user and field) and are
  never returned to the app. One connection per profile (`max: 1`), like NutriTrace.
- A new provider `api/integrations/providers/mealie.js` on the same framework as
  `providers/nutritrace.js`: `events: []` (reader only), `connect`, `update`, `deliver` used as
  "Check connection", `query(op, params, reveal)` for reads.

## Authentication expectations

- Token creation: `POST /api/users/api-tokens` (`mealie/routes/users/api_tokens.py`), done by the
  user in Mealie's UI (profile, API tokens). It is a JWT with `long_token: true`, the user id, a name
  and an `integration_id`, valid for **five years** (`timedelta(1825)`).
- Presentation: `Authorization: Bearer <token>` (`OAuth2PasswordBearer` in
  `mealie/core/dependencies/dependencies.py`; a session cookie is the fallback for the browser).
- **No scopes.** `get_current_user` resolves a long-lived token to the full user
  (`validate_long_live_token`): the token carries every right that user has, including writing
  recipes and meal plans. `integration_id` is a label, not a permission.
- Revocation: tokens are looked up in the `api_tokens` table on every request, so deleting the token
  in Mealie revokes it at once.
- Inferred from the code path, not tested: the long-lived branch returns before the
  `tokens_valid_after` check, so **changing the Mealie password does not revoke API tokens**. Users
  must delete the token itself.
- Scoping: recipes are readable across the user's group (cross-household tests exist in
  `tests/integration_tests/user_recipe_tests/test_recipe_cross_household.py`); meal plans are per
  household (`mealie/routes/households/controller_mealplan.py`, prefix `/households/mealplans`).

Security consequence: since Mealie cannot issue a read-only token, the docs and the connect form
must recommend **a dedicated Mealie user** for openGym, in the household whose plan should be read,
without admin, `can_manage`, `can_manage_household` or `can_organize`. Unconfirmed: whether a plain
user can be stopped from creating recipes at all; assume it cannot, and rely on openGym never sending
a write.

## Relevant endpoints

All under the `/api` prefix (`mealie/routes/__init__.py`). Only GET is ever used.

| Use | Method and path | Query | Fields read |
|---|---|---|---|
| Version and reachability | `GET /api/app/about` | none | `version`, `production` (`mealie/schema/admin/about.py`). Public route (plain `APIRouter`), so it proves reachability only, not the token. |
| Token check | `GET /api/users/self` | none | `id` and group/household for display (`mealie/routes/users/crud.py`, `response_model=UserOut`). Needs a valid token, unlike `/api/app/about`. |
| Recipe search | `GET /api/recipes` | `search`, `page`, `perPage`, `orderBy` | `items[].id`, `slug`, `name`, `recipeServings`, `recipeYieldQuantity`, `recipeYield`; page fields `page`, `per_page`, `total`, `total_pages` |
| Recipe detail | `GET /api/recipes/{slug}` | slug **or id** | `name`, `recipeServings`, `recipeYieldQuantity`, `recipeYield`, `nutrition` |
| Meal plan for days | `GET /api/households/mealplans` | `start_date`, `end_date` (YYYY-MM-DD), `page`, `perPage` | `items[].date`, `entryType`, `title`, `recipeId`, `recipeScale`, `recipe` (a recipe summary, no nutrition) |

Parameter casing is as Mealie's own tests use it: `perPage` camelCase, `start_date`/`end_date`
snake_case (`tests/integration_tests/user_household_tests/test_group_mealplan.py`). Response bodies
of models are camelCase (`MealieModel` uses a camelize alias generator,
`mealie/schema/_mealie/mealie_model.py`); the pagination wrapper (`PaginationBase`, a plain
`BaseModel` in `mealie/schema/response/pagination.py`) is snake_case. `perPage=-1` means "all": the
adapter must never send it and should cap at 25 like NutriTrace.

Week entries (`endDate` set, six days after `date`) are only returned with
`include_week_entries=true`; leave them out, they belong to no single day.

## Nutrition: what Mealie stores

`mealie/schema/recipe/recipe_nutrition.py`, class `Nutrition`, every field `str | None`
(`coerce_numbers_to_str=True`), camelCase on the wire:

`calories`, `proteinContent`, `carbohydrateContent`, `fatContent`, `sugarContent`, `fiberContent`,
`sodiumContent`, `cholesterolContent`, `saturatedFatContent`, `transFatContent`,
`unsaturatedFatContent`.

- Basis: **per serving**. Mealie's UI labels the block "Per serving"
  (`frontend/app/components/Domain/Recipe/RecipeNutrition.vue`, key `recipe.per-serving`).
- Units are implied by the UI, not stored: calories in kcal, macros in grams, sodium and
  cholesterol in milligrams (`frontend/app/composables/recipes/use-recipe-nutrition.ts`).
- Mealie itself reads a value with `Number.parseFloat` (same file, `parseNutritionValue`), so
  `"250 kcal"` reads as 250 and `"abc"` as nothing.
- Servings: `recipeServings` (float, 0 when unset) and `recipeYieldQuantity` with a free-text
  `recipeYield` such as "1 loaf". **There is no serving weight** anywhere in the recipe schema.

## Data normalization (adapter rules)

1. Take each of `calories`, `proteinContent`, `carbohydrateContent`, `fatContent` from the recipe
   detail. Accept only a string or number matching `^\s*\d+(\.\d+)?\s*(kcal|cal|g)?\s*$` (case
   insensitive). Anything else (a range "200-250", "approx", a unit in kJ or mg for a macro) is
   `null`, not a guess. Reject negatives and values above sane per-serving bounds (5000 kcal,
   500 g per macro).
2. A recipe with all four null is listed but cannot be logged ("no nutrition in Mealie").
3. Text: `name` cut to 80 characters, `recipeYield` to 40; no images, descriptions, ingredients or
   instructions are passed to the app.
4. `recipeScale` on a meal-plan entry is how much of the recipe was cooked, not how much was eaten.
   It must not multiply the diary entry; the user picks the servings eaten (default 1).

## Expected diary mapping

The diary today stores `amount` in g or ml and `per100` values. Mealie gives per-serving values
with no weight, so a Mealie entry **cannot be expressed in the current model** without inventing a
serving weight. Proposed extension (not built; needs its own tests in `nutrition-diary.test.js` and
both sync files untouched, since `foodLog` is merged per entry already):

- `basis: 'serving'` added to the allowed bases; `amount` is then the number of servings
  (0.25 to 20, step 0.25), and a new `perServing: { kcal, proteinG, carbohydrateG, fatG }` replaces
  `per100` for that entry.
- `nutrientsOf` multiplies `perServing` by `amount` for that basis; `dayTotals` is unchanged.
- `foodEntryProblem` bounds per serving: kcal 0 to 5000, macros 0 to 500.
- `src: { kind: 'mealie', id: <recipe uuid> }`, read back like the NutriTrace source (string, at
  most 64 characters).
- Older app versions reading an entry with `basis: 'serving'` must drop it rather than show it as
  grams: `readFood` already refuses an unknown basis, so it reads as null on an old client. That
  keeps it out of their totals; confirm the sync merge keeps the entry untouched on such a client
  (it should, as a stamped map entry is copied as a whole).

Meal-plan entry types (`mealie/schema/meal_plan/new_meal.py`, `PlanEntryType`) to diary meals:

| Mealie | openGym |
|---|---|
| `breakfast` | `breakfast` |
| `lunch` | `lunch` |
| `dinner` | `dinner` |
| `side` | the meal the user picks (default `dinner`) |
| `snack`, `dessert`, `drink` | `snack` |

An entry with only a `title` and no `recipeId` has no nutrition and is shown, not logged.

## Security restrictions

- Every request through `net-guard.js` (`outboundUrlError` before the call, the guarded lookup in
  the agent): https only, no loopback, link-local or private addresses unless
  `INTEGRATIONS_ALLOW_LAN=1`, which still blocks loopback and link-local.
- No redirects followed; 8 s timeout; answer capped (512 KB, as NutriTrace; a recipe detail with
  long instructions should fit, confirm on real data); the transport settles once.
- GET only. The provider has no code path that issues POST, PUT, PATCH or DELETE to Mealie; a test
  asserts the method of every call.
- Rate limits: the hub's `query` bucket (30 a minute a profile) plus a per-instance bucket.
- The token never appears in a response, the connection view, a log line or an error message.
- A 401 marks the connection *Needs attention*, as for NutriTrace.

## Required integration tests

Deterministic, with a fake transport (`getJson`), no live service:

1. Connect: URL rules (https, LAN only with the flag, loopback refused), token shape (JWT, three
   base64url parts), secrets sealed at rest, nothing secret in `info`.
2. Check connection: `/api/app/about` reachable but `/api/users/self` 401 reads as a bad token,
   not as reachable.
3. Recipe search: query passed as `search`, `perPage` capped, paging fields read snake_case,
   items read camelCase.
4. Nutrition parsing: `"250"`, `"250 kcal"`, `"12 g"`, `"12.5g"`, numbers; refused: ranges, kJ,
   negatives, huge values, objects. All-null recipe not loggable.
5. Meal plan: `start_date`/`end_date` sent snake_case, week entries excluded, entry type mapping
   table above, title-only entries not loggable, `recipeScale` ignored for the amount.
6. Diary: `basis: 'serving'` scaling, bounds, source read-back, old-client refusal of the basis,
   merge of a serving entry across two devices.
7. Every call is GET; redirect, oversize, timeout, malformed JSON and 5xx each give a readable error
   and write nothing to the diary.
8. Profile isolation: profile B cannot read through profile A's connection.

## Live-instance dependencies and open questions

Needs an authorized Mealie test instance (version noted) with a dedicated low-privilege user and a
token, plus a few recipes with and without nutrition and a week of meal plan. Open questions only a
live instance answers:

- Which `UserOut` fields are safe and useful to show (household name), and do they differ between versions?
- What do real imported recipes put in nutrition strings (units, ranges, localized decimals such
  as "12,5 g")?
- Does the answer for a recipe with many steps stay under 512 KB?
- Can a plain user be prevented from writing recipes (household lock settings)? If not, document
  the residual risk of a leaked token.
- Does the meal plan for a date use the household's time zone?

## Evidence

- `mealie/schema/recipe/recipe_nutrition.py`: nutrition fields, strings, camelCase.
- `mealie/schema/recipe/recipe.py`: `RecipeSummary` and recipe fields (`recipe_servings`,
  `recipe_yield_quantity`, `recipe_yield`, `nutrition`).
- `mealie/routes/recipe/recipe_crud_routes.py`: `GET /recipes` (paginated, `search`), `GET /recipes/{slug}` (slug or id).
- `mealie/schema/response/pagination.py`: `PaginationQuery` (`page`, `per_page` default 50), `PaginationBase` response.
- `mealie/routes/households/controller_mealplan.py` and `mealie/schema/meal_plan/new_meal.py`: meal plan list, entry types, week entries, `recipe_scale`.
- `mealie/routes/users/api_tokens.py`, `mealie/core/dependencies/dependencies.py`: token creation, Bearer, no scopes, revocation by lookup.
- `mealie/routes/app/app_about.py`, `mealie/schema/admin/about.py`: version endpoint.
- `frontend/app/composables/recipes/use-recipe-nutrition.ts`, `frontend/app/components/Domain/Recipe/RecipeNutrition.vue`: units and "Per serving".
- `tests/integration_tests/user_household_tests/test_group_mealplan.py`, `tests/integration_tests/user_recipe_tests/test_recipe_crud.py`: query parameter casing.
