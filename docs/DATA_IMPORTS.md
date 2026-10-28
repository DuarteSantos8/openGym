# Importing and exporting data

Everything here lives in the app under **Settings → Data & backup**, except plan sharing, which is on the
**Plan** screen.

| You want to | Use |
|---|---|
| Bring your workout history from another app | **Import from another app** (CSV or JSON) |
| Bring plans over from Liftosaur or Liftoff | **Import from another app** with the JSON export |
| Pull workouts, routines, weigh-ins and body measurements from Hevy Pro | **Import from Hevy** (API key) |
| Bring body weight over from an iPhone | **Import from another app** with the Apple Health export |
| Give someone your routines | **Plan → share button (top right) → Export plan file** |
| Back up or move everything | **Export backup** / **Import backup** |

## Workout history from another app

Export a file from your old app, then pick it under **Settings → Data & backup → Import from another app**.
openGym works out which app it came from, matches exercise names against its library, and anything
it doesn't recognise becomes one of your own exercises, so nothing in the file is dropped. Days
that already have a workout in openGym are left alone, so importing the same file twice never
duplicates anything. You see a summary (workouts, sets, matched exercises, the unit) before
anything is written. A file that looks like one of the apps below but doesn't read as one is
refused with a message rather than half imported.

These exports work without any editing:

| App | Where to export |
|---|---|
| FitNotes (Android) | Settings → Backup/Export → **Spreadsheet Export** |
| FitNotes 2 (iOS) | Export workouts as CSV |
| Strong | Settings → Export Data |
| Hevy | Profile → Settings → Export & Import Data |
| Gravl | Profile → Export Data |
| Liftosaur | Settings → **Export history to CSV file**, or **Export data to JSON file** (see [Liftosaur](#liftosaur)) |
| Liftoff | No export of its own; use liftoff-export-cli (see [Liftoff](#liftoff)) |
| StrongLifts 5×5 | Settings → **Export** |
| Fitbod | Log → ⋯ → **Export Data** (`WorkoutExport.csv`) |
| JEFIT | jefit.com → Settings → Data Controls → **Export Data** |

Other files work too, as long as they have a date, an exercise name and something measured
(weight and reps, a time or a distance). See [your own CSV](#your-own-csv) below.

> [!NOTE]
> History is a log of what you did, so it's imported separately from your routines. Importing
> workouts doesn't create or change any plan.

## Liftosaur

Liftosaur has two exports under **Settings**, and openGym reads both:

- **Export history to CSV file** gives `liftosaur_<date>.csv`: your workouts, one row per set,
  with warm-ups, RPE, timed sets and each exercise's notes.
- **Export data to JSON file** gives `liftosaur-<date>.json`: the same history plus your
  programs. Each day of a program's first week becomes a routine ("GZCLP · Day 1"), with its sets,
  reps, weight, warm-ups, supersets and timed sets. openGym doesn't run Liftoscript, so a
  progression (`progress: lp(5lb)`) and anything the plain numbers leave out (a rep range, an
  AMRAP set, a weight in % of your 1RM or by RPE) come along as a note on the exercise. Routines
  you imported before are left alone. Programs from before Liftosaur's workout planner are skipped.

Times are read on your phone's clock, so a late session stays on the day you trained.
Exercises are matched with their equipment: Liftosaur's "Front Raise" is the dumbbell one.

## Liftoff

Liftoff has no export button. The unofficial, open-source
[liftoff-export-cli](https://github.com/quantcli/liftoff-export-cli) logs in with your account and
writes JSON that openGym reads:

```sh
liftoff-export auth login
liftoff-export workouts list --format json > liftoff-workouts.json
liftoff-export routines list --format json > liftoff-routines.json
```

Pick either file. Workouts bring their warm-ups, notes, cardio (distance and time) and timed sets;
routines become openGym routines. The file doesn't say whether a weight is kg or lb, so weights
are imported as written: use the same unit in openGym as in Liftoff. The summary will remind you.

## StrongLifts 5×5

In StrongLifts, go to **Settings → Export** and save the CSV. Each exercise's sets come from the
`Set 1 (Reps)` / `Set 1 (KG)` columns, in kg or lb as the file says; a set with 0 reps (skipped)
is left out, and Workout A and B on the same day stay two workouts.

## Fitbod

In Fitbod, open **Log**, tap **⋯** and choose **Export Data**; you get `WorkoutExport.csv`
(steps as the open-source [Fitbod to Hevy converter](https://github.com/sinan92/fitbod-to-hevy-converter)
describes them; the menu may be named a little differently in your version).
Warm-up sets, cardio (time and distance) and timed holds come along; weights are in kg in this
file, whatever your Fitbod setting. On Android there's no export button: Fitbod's support can send
you a data extract (`exercise_name`, `weight_kg`, ...), which openGym reads too.

## JEFIT

Sign in at [jefit.com](https://www.jefit.com/my-jefit/settings), open **Settings → Data Controls →
Export Data** and download the CSV (steps as [JeFit2Hevy](https://github.com/sondrealf/JeFit2Hevy)
describes them). openGym reads its exercise logs (`60x10,65x8` per exercise and
day) and takes the time of each workout from its session. JEFIT doesn't write the unit, so weights
are imported as written.

## Not supported (yet)

Boostcamp, GymBook and Alpha Progression don't document an export format openGym could read
safely, and wger has no export of its workout log (its API names exercises by number only). If you have one of these files, a sample
(with your numbers changed) in a [GitHub issue](https://github.com/DuarteSantos8/openGym/issues)
is the fastest way to get it added. A CSV with a date, an exercise and a weight or reps column
usually works already, see [your own CSV](#your-own-csv).

## Hevy, directly

With **Hevy Pro** you can skip the CSV:

1. In Hevy, open [Settings → Developer](https://hevy.com/settings?developer) and create an API key.
2. In openGym, go to **Settings → Data & backup → Import from Hevy** and paste the key. It's used for this
   import only and isn't saved.
3. Choose workouts, routines, weigh-ins, body measurements or any mix, then confirm.

Routines always arrive as new plans; nothing you already have is overwritten.

Besides the sets, the import brings:

- **Notes:** a workout's description becomes its note, and an exercise's notes its note that day.
- **Rest and rep ranges:** a routine exercise's rest, and a rep range such as 8–12 as double
  progression over that range.
- **Body measurements** (neck, shoulders, chest, arms, forearms, waist, abdomen, hips, thighs,
  calves, body fat) into Measurements, in cm. Days that already have measurements are left alone.
- **Routine links:** a workout done from a Hevy routine is filed under that routine once the
  routine is here, so "last time" and the routine's history read it. A workout from an earlier CSV
  import of the same session (same day, starting within two minutes) is linked too. A routine you
  set on a workout yourself is never changed.
- **Custom exercises' muscles and equipment** from Hevy's exercise, also for custom exercises an
  earlier import made, until you edit them.

Hevy's API gives weights in kg whatever your Hevy account shows; when it shows the other unit, the
import says so.

## Body weight from Apple Health

In the Health app on your iPhone, tap your profile picture, then **Export All Health Data**. Unzip
the result and pick `export.xml` under **Import from another app**. The file is often hundreds of
megabytes; openGym reads only the body-weight records from it, in whatever unit each one was saved
in, and keeps every one with its time, so a morning and an evening weigh-in are both there (#859).
A record at a time the day already has is skipped, so importing the same file twice adds nothing.
Charts and the trend use one value per day, the one **Settings → Units & language → Daily weigh-in
value** picks: the morning (first) one, which is the default, the day's average, or the last one.

A CSV with a date column and a weight column works the same way: a date with a time
(`2026-10-28 07:12`) keeps the time, and a date alone keeps one weigh-in for that day (the file's
last), added only to a day that has none yet. The body CSV openGym exports itself writes one row per
weigh-in that way and reads back the same. So does Strong's
measurements export (Settings → Export Data, the file with *Measurement Type* and *Value*
columns): only its weight rows are read, each in the unit it was logged in.

## Sharing a plan

On the **Plan** screen, tap the share icon:

- **Export plan file** writes your routines and weekly schedule to a small JSON file. It contains
  no workouts and no weigh-ins.
- **Import a plan file** adds someone else's plan to yours. It merges, so your own routines are
  never overwritten.
- **Print / Save as PDF** gives you a clean printout.

An export always contains every routine. To share only some of them, import the file into the
[demo](https://opengym.ch/demo/), delete what you don't want, and export again. The
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
  the phone, or, on Android, choose the sync app's own folder under Settings → Data & backup → **Backup folder**.

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

The CSV parser is `frontend/src/lib/import-csv.js`. The apps whose export isn't a plain one-row-per-set
CSV (Liftosaur, Liftoff, StrongLifts, Fitbod, JEFIT) are read in `frontend/src/lib/import-apps.js`,
which turns each file into the same rows and hands them to the CSV parser; each reader names the
public source its format was taken from. Exercise names are matched through the curated alias
table in `import-csv.js` (`ALIAS_EX`, plus `NO_MATCH` for names that must stay custom), then by
words. The Hevy API import and a detected Hevy CSV
resolve exercises through the same generated lookup, `frontend/src/lib/hevy-id-map.js` (template id
for the API, English title for the CSV). To regenerate it, set `HEVY_API_KEY` in the environment or
`.env` and run `node scripts/build-hevy-id-map.mjs`. Localised (non-English) Hevy titles fall back
to name matching.
