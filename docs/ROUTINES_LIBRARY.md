# Routines library index

The AI Coach can suggest and import routines from a library (`api/coach/core/routine-library.js`).
The built-in starter plans are always in it. More come from an **index**: one JSON file at an
https address, by default `https://opengym.ch/routines/index.json`, set per instance on the admin
card (AI Coach → Advanced → Routines library, `off` for none).

The app fetches the index, never the server, caches it for a day, and carries on without it when it
is missing or broken. When someone asks the Coach a question, the few entries that match go along
with it (title, goal, level, split, days, equipment and the exercise ids per session), and the Coach
may offer one as an "Add to my plan" card. Importing adds the routines next to the person's own,
the weekly schedule only if they tick it.

## Format, version 1

```json
{
  "format": "opengym-routines",
  "version": 1,
  "updated": "2026-11-08",
  "routines": [
    {
      "id": "community/pullup-bar-basics",
      "title": "Pull-up bar basics",
      "author": "Ana",
      "goal": "general",
      "level": "beginner",
      "split": "full-body",
      "days": 3,
      "duration": 40,
      "equipment": [],
      "language": "en",
      "description": "Three short sessions for a doorway bar and the floor.",
      "url": "https://opengym.ch/r#…",
      "sessions": [
        { "name": "Bar A", "exercises": [ { "id": "0662", "sets": 3, "reps": 10 }, { "id": "0463", "sets": 3, "sec": 40 } ] },
        { "name": "Bar B", "exercises": [ { "id": "2921", "sets": 3, "reps": 8, "rest": 90 } ] }
      ],
      "schedule": [ [1, 0], [3, 1], [5, 0] ]
    }
  ]
}
```

| Field | Rules |
| --- | --- |
| `format`, `version` | exactly `"opengym-routines"` and `1`; anything else and the whole index is ignored |
| `id` | unique, lowercase, `[a-z0-9][a-z0-9/_.-]{1,79}`; a source prefix (`community/…`) keeps it apart from `starter/…` |
| `title` | required, up to 80 characters |
| `author`, `description` | optional, up to 60 and 400 characters |
| `goal` | `strength`, `muscle`, `general`, `fatloss` or `endurance` |
| `level` | `beginner`, `intermediate` or `advanced` |
| `split` | a word: `full-body`, `upper-lower`, `ppl`… |
| `days` | sessions per week, 1-7 (defaults to the schedule's length) |
| `duration` | minutes per session, 5-300 |
| `equipment` | catalogue equipment words (`barbell`, `dumbbell`, `cable`, `band`…); empty means body weight only. Left out, it is read off the exercises |
| `language` | the language of `title` and session names, `en` by default |
| `url` | optional https link to the routine's page |
| `sessions` | 1-7, each a `name` and 1-20 `exercises` |
| `exercises[]` | `id` from the openGym catalogue (`catalogue/exercises/<id>.json`), `sets` 1-10, `reps` 1-100 **or** `sec` 5-3600 for a hold, optional `rest` in seconds |
| `schedule` | optional `[weekday, session index]` pairs, weekday 0 (Sunday) to 6 |

An entry with an exercise id the catalogue does not hold is left out whole, so an import is always
the routine that was described. At most 500 entries are read.

Serve it with `Content-Type: application/json` and, for the web app, `Access-Control-Allow-Origin: *`
(the phone apps read it natively).

## The opengym.ch library

`https://opengym.ch/routines/index.json` is built from the files in [`routines/`](../routines/README.md)
by `node scripts/routines/build.mjs`, together with the browsable pages at opengym.ch/routines (search,
filters, a page per routine with "Copy to openGym") and a submit page. Copying uses the app's own
formats: each day is a routine link (`https://opengym.ch/r#…`, `opengym://r#…`), the whole routine a
plan file for Plan > Import plan (`/routines/plans/<slug>.opengym-plan.json`, with the author in
`from`). The page itself is a link into the app too, like a Spotify link: with openGym installed,
`https://opengym.ch/routines/<slug>/` (or its QR code, scanned with the phone camera or with Plan >
Scan a QR code) opens the app, which fetches that plan file and shows the import sheet
(`frontend/src/lib/library-link.js`; the iPhone's `website/.well-known/apple-app-site-association`
and the Android intent filter claim one path segment and leave the list, the submit form and the
files alone). Without the app it is just the page. The built-in starter plans are on the site but left out of the
index, since every app has them already. Submissions are reviewed in Telegram and land on the
`routines-inbox` branch (`scripts/routines/service/README.md`).
