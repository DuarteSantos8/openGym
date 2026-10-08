# Importing and exporting data

Everything here lives in the app under **Settings → Data & backup**, except plan sharing, which is on the
**Plan** screen.

| You want to | Use |
|---|---|
| Bring your workout history from another app | **Import from another app** (CSV) |
| Pull workouts, routines and weigh-ins from Hevy Pro | **Import from Hevy** (API key) |
| Bring body weight over from an iPhone | **Import from another app** with the Apple Health export |
| Give someone your routines | **Plan → Share your plan → Export plan file** |
| Back up or move everything | **Export backup** / **Import backup** |

## Workout history from another app

Export a CSV from your old app, then pick it under **Settings → Data & backup → Import from another app**.
openGym matches exercise names against its library; anything it doesn't recognise becomes one of
your own exercises, so nothing in the file is dropped. Days that already have a workout in openGym
are left alone, so importing the same file twice never duplicates anything.

These exports work without any editing:

| App | Where to export |
|---|---|
| FitNotes (Android) | Settings → Backup/Export → **Spreadsheet Export** |
| FitNotes 2 (iOS) | Export workouts as CSV |
| Strong | Settings → Export Data |
| Hevy | Profile → Settings → Export & Import Data |
| Gravl | Profile → Export Data |

Other files work too, as long as they have a date, an exercise name and something measured
(weight and reps, a time or a distance). See [your own CSV](#your-own-csv) below.

> [!NOTE]
> History is a log of what you did, so it's imported separately from your routines. Importing
> workouts doesn't create or change any plan.

## Hevy, directly

With **Hevy Pro** you can skip the CSV:

1. In Hevy, open [Settings → Developer](https://hevy.com/settings?developer) and create an API key.
2. In openGym, go to **Settings → Data & backup → Import from Hevy** and paste the key. It's used for this
   import only and isn't saved.
3. Choose workouts, routines, weigh-ins or any mix, then confirm.

Routines always arrive as new plans; nothing you already have is overwritten.

## Body weight from Apple Health

In the Health app on your iPhone, tap your profile picture, then **Export All Health Data**. Unzip
the result and pick `export.xml` under **Import from another app**. The file is often hundreds of
megabytes; openGym reads only the body-weight records from it, in whatever unit each one was saved
in, and keeps one weigh-in per day. Days that already have a weigh-in are left alone.

A CSV with a date column and a weight column works the same way.

## Sharing a plan

On the **Plan** screen, tap the share icon:

- **Export plan file** writes your routines and weekly schedule to a small JSON file. It contains
  no workouts and no weigh-ins.
- **Import a plan file** adds someone else's plan to yours. It merges, so your own routines are
  never overwritten.
- **Print / Save as PDF** gives you a clean printout.

An export always contains every routine. To share only some of them, import the file into the
[demo](https://opengym.duarte-santos.ch/demo/), delete what you don't want, and export again. The
demo keeps everything in your browser; nothing is uploaded. The same trick works for building a plan
on a computer and then importing it into the phone app.

Writing a plan file by hand is possible but fiddly, because the exercise ids have to match the
library.

## Backups

- **Export backup (JSON)** saves your whole profile as one file. **Export with photos & videos
  (.zip)** includes your media as well.
- **Import backup** restores such a file and *replaces* everything currently in the app.
- **Auto-backup on changes** (phone app only) saves a dated copy to `Documents/openGym` after each
  workout or routine edit and keeps the newest 14. Point a sync app at that folder to get them off
  the phone — or, on Android, choose the sync app's own folder under Settings → Data & backup → **Backup folder**.

If you host openGym yourself, backing up the `./data` folder covers every profile at once; see
[backups](SELF_HOSTING.md#6-backups).

## Your own CSV

The smallest file that works:

```csv
workout name,exercise,date,weight kg,reps
Leg Day,Squat,2026-08-21,120,5
Leg Day,Squat,2026-08-21,125,4
Leg Day,Leg Press,2026-08-21,200,1
```

One row per set. Column names are matched ignoring case and punctuation; the first match wins.

| Field | Accepted headers |
|---|---|
| exercise | `exercise`, `exercise name`, `exercise title` |
| date | `date`, `workout date` |
| start time | `start time`, `start date` |
| end time | `end time` |
| workout name | `workout name`, `title`, `workout` |
| category | `category`, `body part`, `muscle group` |
| weight in kg | `weight kg` |
| weight in lb | `weight lbs`, `weight lb` |
| weight, unit in another column | `weight` |
| weight unit | `weight unit`, `unit` |
| reps | `reps`, `repetitions` |
| RPE | `rpe`, `rpe rating` |
| RIR | `rir`, `reps in reserve` |
| distance in km | `distance km` |
| distance, unit in another column | `distance` |
| distance unit | `distance unit` |
| duration in seconds | `seconds`, `duration seconds`, `set duration sec` |
| duration | `time`, `duration` |
| set type | `set type` |
| note | `comment`, `comments`, `notes`, `note`, `workout notes` |

## For developers

The CSV parser is `frontend/src/lib/import-csv.js`. The Hevy API import and a detected Hevy CSV
resolve exercises through the same generated lookup, `frontend/src/lib/hevy-id-map.js` (template id
for the API, English title for the CSV). To regenerate it, set `HEVY_API_KEY` in the environment or
`.env` and run `node scripts/build-hevy-id-map.mjs`. Localised (non-English) Hevy titles fall back
to name matching.

## JSON plan import API

`GET /api/plans` and `POST /api/plans/import` offer the plan file flow to tools.
They accept normal sessions or a dedicated `Authorization: Bearer opg_plan_…`
credential. A plan credential can only read prescriptions and import plans; it
cannot access `/api/data`, log workout results or weigh-ins, change settings,
administer an account, or issue more credentials.

### Credentials

From a signed-in profile, `POST /api/account/plan-keys` takes a descriptive
`name`, optional `days` (1–365, default 30), and the same fresh owner proof as
adding a passkey: `cid` + `credential` from a passkey ceremony, or `current`
while password sign-in is enabled. A stolen session alone cannot mint a key.
The response includes `id`, `expires`, `scope: "plans:write"` and `token`.
Store the token securely: it is returned once and only its SHA-256 hash is
stored by openGym. No phone pairing is involved. There is currently no Settings
UI for key management; these are API operations for integrations.

`GET /api/account/plan-keys` returns metadata only.
`POST /api/account/plan-keys/revoke` with `{ "id": "…" }` revokes a key.
These operations require a normal account session. Expiry, account disable or
delete, and **sign out everywhere** invalidate the credential too.

### Import

1. Read `GET /api/plans`; keep its `rev` and `wid`.
2. Send `POST /api/plans/import` with the existing plan-file JSON under `plan`,
   `baseRev: rev`, and `baseWid: wid` when a write id exists. Optional
   `schedule: true` replaces the weekly schedule; by default it stays intact.
3. A successful response contains the new `rev`, `wid` and number of added
   `routines`. Existing routines stay; imported routines get fresh ids. Custom
   exercises are reused by name/body part or added, and prescribed loads are
   converted to the profile's unit with the existing browser importer.

Workout history, bodyweight records, date assignments and settings are never
accepted in the payload or changed by the import. Unknown exercise ids and
extra fields are rejected. The file must use `opengym_plan: 1`, contain at most
100 routines (100 exercises each) and 100 custom exercises, and fit the 5 MiB
request limit. Exercise ids must resolve to the catalogue or custom exercises
carried in the file. No Coach/provider call is made.

A missing revision or invalid file returns 400. A concurrent edit or restored
state with a different write id returns 409 with only current `rev`/`wid`,
never full profile state. Review the current plan before retrying. Repeating
the original revision cannot import twice; resending after fetching a fresh
revision intentionally adds another copy, like importing the file again in
the UI. A missing state starts an empty plan; an unreadable state returns 503
and is never replaced.

The [OpenAPI specification](../api/openapi.yaml) documents the complete contract.
