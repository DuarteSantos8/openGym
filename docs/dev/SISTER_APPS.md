# Sister apps: openNutrition and openRunning

openGym has two sister apps: **openNutrition** (food, live as a self-hosted app) and
**openRunning** (runs and rides, planned, working name). They stay separate apps with separate
data. openGym only ever **reads** from them, only after you link them, and every link can be
undone from both sides.

This page is the contract: what openGym reads, from where, and what each sister app has to
serve. The openGym side is in `frontend/src/lib/sister-nutrition.js` (openNutrition) and
`frontend/src/lib/activities.js` (runs and other sport, from any source).

| | Where in openGym | Off by default | Network |
|---|---|---|---|
| openNutrition link | Settings → Integrations → Sister apps → openNutrition | yes (nothing until linked) | yes |
| Nutrition in the performance report | Stats / History → Performance report (PDF), section "Nutrition" | linked + switch "Performance report" | cached |
| Nutrition in the month story | Stats → Your month, card "Fuel" | linked + switch "Your month" | cached |
| Fasting window on Home | Home, under today's session | linked + switch "Fasting window on Home" | cached |
| Runs and matches from Apple Health / Health Connect | Settings → Integrations → Apple Health / Health Connect → "Runs, rides and matches from other apps" | yes | no (on the phone) |
| Sport in the week streak | Settings → Look & Home → "Sport counts for the streak" | yes | no |
| Sport in the recovery map | Stats → Muscles, Home recovery hint | on whenever there are activities (`S.activityRecovery === false` turns it off) | no |
| Sport days from imports | Settings → Data → Import (Apple Health export.xml workouts; Hevy / Strong sessions that were only sport) | the import itself is the opt-in | no |
| Sport in the calendar and History | Stats → calendar (blue dot), History rows, a day's sheet ("Log an activity") | shows whatever came in | no |

**openGym Offline** (the Android flavour without the INTERNET permission, `lib/build-caps.js`)
cannot reach openNutrition, so the openNutrition card belongs in `OFFLINE_OFF_CARDS`
(card id `opennutrition`). The health-store read and imports work offline.

## Activities: the data openGym keeps

Sport that is not a gym workout is an **activity**, stored per session in the profile document:

```js
S.activities = {
  '<id>': { d: '2026-11-06', sport: 'run', min: 42, km: 8.1, at: 1762412400000,
            title: 'Morning loop', note: '', src: 'hc' | 'ah' | 'import' | 'manual' | 'or', _ts },
}
```

- `sport` is one of `run ride swim hike row ski football racket ball climb fight yoga dance other`.
- A removal is a stamped empty entry (`{ _ts }`), merged per key like `recoverySessions`
  (`lib/sync-merge.js` and `api/sync-stamps.js` `STAMPED_MAPS`). An id that came from a health
  store or a file is derived from the source's own id, so reading it again never adds a second
  one and a removed one is never brought back.
- Activities never enter `S.workouts`: no sets, no volume, no records.
- Streak: counted only with `S.activityStreak === true` (the shared walk,
  `api/coach/core/streak.js`, so a trainer sees the same number).
- Recovery: `activityStimuli(S)` turns each activity of the last 30 days into hard-set
  equivalents per muscle (`SPORT_LOAD`: per 30 minutes; football 3 sets spread over quads,
  hamstrings, calves, glutes, adductors and hip flexors, a run 3 sets mostly calves and quads,
  yoga half a set), which `fatigueOf(..., { activities })` adds with the muscle's usual half-life
  and the per-session cap of 12 sets.
- Scoped tokens and the MCP server see them under the `workouts` category (`api/tokens.js`).

## openNutrition → openGym

### Linking (the same pattern as openNutrition → openGym, mirrored)

openNutrition already links to openGym: openGym shows a pairing code (Settings → Account →
"Pair the mobile app"), openNutrition redeems it at `POST /api/pair/redeem` and keeps the token
server side. The other direction works the same way, with the roles swapped and a narrower token:

1. openNutrition, Settings → Connected apps → **Link openGym**: shows an 8-character code,
   valid 10 minutes, for the scope `summary:read`.
2. openGym, Settings → Integrations → Sister apps → openNutrition: the openNutrition address
   (guessed as `nutrition.<your domain>`) and the code.
3. openGym redeems it:

   ```http
   POST /api/v1/integration/pair/redeem
   Content-Type: application/json

   { "code": "GYM12345", "app": "opengym", "scopes": ["summary:read"] }
   ```

   ```json
   { "token": "on_…", "scopes": ["summary:read"] }
   ```

   A wrong or expired code answers 401. Rate limited like any sign-in.
4. openGym reads the summary once with the token before it keeps anything, then keeps the token
   in the phone's secure storage (the browser's storage on the web), **never** in the synced
   profile or a backup. Each device links on its own.

**Today, before step 1 exists:** openNutrition's Settings → Connected apps can already create a
personal token with `summary:read`. Pasting that `on_…` token into the same field works the same,
so the link is usable now against any openNutrition that serves the summary.

### What openGym reads

```http
GET /api/v1/integration/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer on_…
```

The schema `opennutrition.summary.v1` as openNutrition serves it today
(`docs/integration-opengym.md` in openNutrition): `days[]` with `date`, `energy`, `protein`,
`carbohydrate`, `fat`, `complete`, `targets: { energy, protein }`. openGym uses energy, protein
and the targets, and says so in the report when a day was `complete: false`.

Two **additive** fields openGym reads when they are there (v1 stays v1: older openNutrition
simply does not send them and the cards leave those lines out):

- `days[].proteinMeals`: how many meals that day reached openNutrition's protein-meal threshold
  (its "Protein meals" dots, 0.4 g per kg body weight), an integer 0 to 12. openGym never guesses
  it from the day's total.
- `fasting`: the fasting timer, or absent when it is off:

  ```json
  "fasting": {
    "enabled": true, "goalHours": 16,
    "startedAt": "2026-11-03T20:00:00.000Z",
    "last": { "start": "2026-11-02T20:00:00.000Z", "end": "2026-11-03T12:00:00.000Z" },
    "window": { "opensAt": "2026-11-03T12:00:00.000Z", "closesAt": "2026-11-03T20:00:00.000Z" }
  }
  ```

  `startedAt` is the running fast (null when none runs). `window` is optional: without it openGym
  takes the eating window as the end of the last fast plus `24 - goalHours` hours.

How often: when a screen that shows it opens and the last read is older than 30 minutes, the
report sheet for its range, the month story for its month. The answer is cached on the device
(400 days at most). The Home line only trusts an answer younger than six hours.

### CORS

The phone apps ask from native code (`lib/capacitor-fetch.js` nativeFetch): no CORS involved.
The **web** app runs on openGym's own origin and needs openNutrition to allow it on the
integration routes:

```
Access-Control-Allow-Origin: https://gym.example.com      (from an allow-list, never *)
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
Vary: Origin
```

for `OPTIONS` and the real request on `/api/v1/integration/summary` and
`/api/v1/integration/pair/redeem`, with the allow-list from openNutrition's environment
(`INTEGRATION_ORIGINS`, defaulting to its own `OPENGYM_URL`).

### Errors openGym tells apart

| Answer | openGym says |
|---|---|
| network error, CORS refused | could not reach it (check the address) |
| 401 / 403 | revoked: link again |
| 404 on the redeem route | this openNutrition has no codes yet: paste a token |
| 429 | slow down |
| anything not `opennutrition.summary.v1` | not openNutrition |

Unlinking in openGym forgets the token and the cached days. Revoking the token in openNutrition
ends access; openGym shows "Needs attention" on the card and keeps the old numbers until unlinked.

### The trainer dashboard

`api/sources/nutrition.js` (the trainer's nutrition category, `NUTRITION_SOURCE=opennutrition`)
reads the same summary. Its `cleanDay` reads both openNutrition's names (`energy`, `carbohydrate`,
`targets`) and its own older ones (`kcal`, `carbs`, `target`). A server-side link (so the trainer
dashboard gets the member's token) is not built: the device link above keeps the token on the
phone on purpose.

## openRunning → openGym (planned)

openRunning does not exist yet. Until it does, runs, rides and matches reach openGym through the
phone's health store (any app that writes workouts there: Strava, Garmin, Apple Workout, Runna,
Polar, Zepp) and through imports. When openRunning is built, it can feed the same activities
directly, with this contract. Its concept (`openStride`, KONZEPT.md) plans one account and one
server for all three apps; the pairing below is the fallback for two different servers or a
phone without one.

### Pairing

The same as openNutrition, scope `activities:read`:

- `POST /run/api/v1/integration/pair/redeem { code, app: 'opengym', scopes: ['activities:read'] }`
  → `{ token: 'or_…', scopes }`.
- On a shared server with a shared login, no pairing: openGym reads with its own session once the
  user allowed it in openRunning's settings (consent stays explicit and revocable).

### What openGym reads

```http
GET /run/api/v1/integration/activities?since=<cursor>
Authorization: Bearer or_…
```

```json
{
  "schema": "openrunning.activities.v1",
  "cursor": "opaque, for the next call",
  "activities": [
    { "id": "uuid", "start": "2026-11-05T06:30:00Z", "end": "2026-11-05T07:12:00Z",
      "sport": "run", "title": "Morning loop", "km": 8.1, "elevationM": 85,
      "load": { "trimp": 72 }, "muscles": { "calves": 0.8, "quadriceps": 0.6 },
      "deleted": false }
  ]
}
```

- `sport` uses openGym's names above (`run`, `ride`, …); anything else is `other`.
- `load.trimp` (optional) scales the recovery load instead of the minutes; `muscles` (optional)
  overrides openGym's own `SPORT_LOAD` for that activity.
- `deleted: true` removes it in openGym too (stamped, so it stays gone).
- No GPS track, no heart-rate stream, no photos: openGym needs the day, the time and the effort.
- openGym stores each as an activity with `src: 'or'` and the id `or<uuid>`. When the same
  session also arrives through the health store, openRunning's copy wins (openRunning writes
  `clientRecordId` / `HKMetadataKeySyncIdentifier` = `openrunning-<uuid>` so openGym can match it).

### Deep links

openGym opens an activity in openRunning with `https://opengym.ch/r/a/<id>` (KONZEPT.md 7.2);
without the app installed, the link goes to the web version of the instance.

### openGym → openRunning

Out of openGym's scope here: openRunning reads strength days the way openNutrition does today
(an openGym pairing code, `POST /api/pair/redeem`, then `/api/data`), better with a scoped
`ogt_` token (`docs/API_TOKENS.md`, category `workouts`, read only).
