# Importing Data

## Plans

Plans/routines can be imported from a plain text json file.  
The app supports exporting and an export always contain *every* current routine.  

If you don't want to share every plan that you have currently created, you can either:
- edit the exported json with a text editor  
  or (if you don't feel like editing json files):
- open the [Demo](https://opengym.duarte-santos.ch/demo/#/home)
    - import your plans
    - make changes 
    - export a new json file for sharing

If you are using the standalone app on your mobile, you can use the demo for creating plans on your PC and import them.  
The demo stores all data in your browser, it is not public or shared in any way.

Writing a json file yourself will be a bit of a complex task since the IDs of the exercises have to match the IDs in the database.  

## History

To import your history from other applications, you'll need an export that is in `CSV` format.
The app tries to match the exercise names to link them to the exercises in the database.

> Note: The history is a log of past exercises.  
> Because plans change and history does not, it is completely disconnected from routines.  
> 
> Exercises depend on name matching, so custom exercises might be named differently, as they might be in other apps.

These apps have been tested to work without adjustments to the column names:

| App | How to export | 
|---|---|
| **FitNotes (Android)** | Settings → Backup/Export → **Spreadsheet Export** | 
| **FitNotes 2 (iOS)** | Export workouts as CSV; also manual/auto iCloud backups |
| **Strong** | Settings → Export Data | 
| **Gravl** | Profile → Export Data | 
| **Hevy** | Profile → Settings → Export & Import Data (Workouts or Measurements), **or** Settings → Import from Hevy with a Pro API key |

### Hevy API (direct)

If you have **Hevy Pro**, you can skip the CSV and import straight from Hevy:

1. Open [Hevy → Settings → Developer](https://hevy.com/settings?developer) and create an API key
2. In openGym: **Settings → Import from Hevy**
3. Paste the key (used only for that import — it is not saved)
4. Choose whether to bring **workouts**, **routines**, **weigh-ins**, or any mix, then confirm

Both the API import and a detected **Hevy CSV** resolve exercises through the same generated
lookup (`frontend/src/lib/hevy-id-map.js`): template id for the API, English title for the CSV.
To regenerate (developers): set `HEVY_API_KEY` in the environment or `.env`, then run
`node scripts/build-hevy-id-map.mjs`. Unmapped lifts become your own exercises. Workout days
that already have data here are left alone; routines are always added as **new** plans
(nothing you already have is overwritten). Localized CSV titles (non-English) still fall back
to name matching.

You can also create your own `CSV` file:

### Minimal Example

```csv
workout name,exercise,date,weight kg,reps
Leg Day,Squat,2026-08-21,120,5
Leg Day,Squat,2026-08-21,125,4
Leg Day,Leg Press,2026-08-21,200,1
```
These field names are supported:

| Canonical Field | Supported CSV Headers (first match wins) |
|---|---|
| `exercise` | `exercise`, `exercise name`, `exercise title` |
| `date` | `date`, `workout date` |
| `startTime` | `start time`, `start date` |
| `endTime` | `end time` |
| `workoutName` | `workout name`, `title`, `workout` |
| `category` | `category`, `body part`, `muscle group` |
| `weightKg` | `weight kg` |
| `weightLb` | `weight lbs`, `weight lb` |
| `weight` | `weight` |
| `weightUnit` | `weight unit`, `unit` |
| `reps` | `reps`, `repetitions` |
| `rpe` | `rpe`, `rpe rating` |
| `rir` | `rir`, `reps in reserve` |
| `distanceKm` | `distance km` |
| `distance` | `distance` |
| `distanceUnit` | `distance unit` |
| `seconds` | `seconds`, `duration seconds`, `set duration sec` |
| `time` | `time`, `duration` |
| `setType` | `set type` |
| `note` | `comment`, `comments`, `notes`, `note`, `workout notes` |


