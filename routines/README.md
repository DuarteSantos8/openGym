# Community routines

The plans on [opengym.ch/routines](https://opengym.ch/routines/), one file each. The site, the
app's routines index (`index.json`, read by the AI Coach) and the "Copy to openGym" links are all
built from these files, so a routine merged here is live after the next site deploy.

Most routines arrive through the [submit page](https://opengym.ch/routines/submit/): a person
reviews each one and approved ones land on the `routines-inbox` branch as a ready file. You can
also open a pull request with a file yourself.

## Folders

| Folder | What's in it |
|---|---|
| `starter/` | The plans built into the app. Words only; the days come from `api/coach/core/starter-plans.js` (`"builtin": "<key>"`). Not in `index.json`, every app has them already |
| `opengym/` | Classic programme shapes, written by us in our own words |
| `community/` | Everyone else's. A cover photo sits next to its routine as `<name>.webp` |

The file name is the page address: `community/doorway-strength.json` becomes
`opengym.ch/routines/doorway-strength/`, and its id is `community/doorway-strength`. Names are
lowercase letters, digits and dashes, and unique across all three folders.

## A routine file

```json
{
  "title": "Doorway strength",
  "author": { "name": "Ana", "url": "https://example.org" },
  "license": "CC-BY-4.0",
  "added": "2026-11-08",
  "language": "en",
  "goal": "general",
  "level": "beginner",
  "split": "full-body",
  "duration": 30,
  "description": "Pull-ups and push-ups for a doorway bar, three days a week.",
  "about": "Optional longer text. Paragraphs are separated by an empty line.",
  "tags": ["home", "pull-up bar"],
  "cover": "doorway-strength.webp",
  "coverAlt": "A pull-up bar in a doorway",
  "sessions": [
    { "name": "Bar A", "exercises": [
      { "id": "0652", "sets": 3, "reps": 6, "rest": 120, "note": "Jump up and lower slowly if you can't pull yet." },
      { "id": "0463", "sets": 3, "sec": 40 }
    ] },
    { "name": "Bar B", "exercises": [ { "id": "0662", "sets": 3, "reps": 12, "repsMin": 8 } ] }
  ],
  "schedule": [[1, 0], [3, 1], [5, 0]]
}
```

| Field | Rules |
|---|---|
| `title` | 3 to 80 characters |
| `author` | `name` (2 to 60) and an optional plain `https://` `url`. It is the credit on the page |
| `license` | the licence of the text: `CC-BY-4.0` (what the submit page uses), `CC-BY-SA-4.0` or `CC0-1.0` |
| `added` | `YYYY-MM-DD`, sorts "newest" |
| `language` | the language of the title, description and day names: `en`, `de`, `fr` … (the app's languages). Exercise names show in that language where the catalogue has a translation |
| `goal` | `strength`, `muscle`, `general`, `fatloss` or `endurance` |
| `level` | `beginner`, `intermediate` or `advanced` |
| `split` | `full-body`, `upper-lower`, `ppl`, `push-pull`, `bro-split` or `other` |
| `duration` | minutes per session, 10 to 180 |
| `description` | 20 to 400 characters, no links |
| `about`, `tags`, `cover` + `coverAlt` | optional. At most 8 tags; the cover is the routine's name with `.webp`, `.jpg` or `.png`, under 600 KB and 2400 px, and needs a `coverAlt` sentence |
| `sessions` | 1 to 7 days, each a `name` (up to 40) and 1 to 20 `exercises`, 40 sets at most |
| `exercises[]` | `id` from `catalogue/exercises/`, `sets` 1-10, `reps` 1-100 (with an optional lower `repsMin` for a range) **or** `sec` 5-3600 for a hold (catalogue holds must use `sec`), optional `rest` 0-600 seconds and `note` (up to 160) |
| `schedule` | optional `[weekday, day index]` pairs, weekday 0 (Sunday) to 6, each weekday once and each day at least once |

Equipment, muscle volume and the "muscle focus" are read off the exercises, so they are never
written here. Exercise pictures on the site are the licensed 180 px stills (`catalogue/media`,
see NOTICE.md); never add pictures of exercises as covers.

## Checking and building

```bash
node scripts/routines/validate.mjs                 # what CI runs on every pull request
node scripts/routines/build.mjs --out /tmp/routines # the site, to look at
node --test scripts/routines/routines.test.mjs
```

The submit service and the deploy are described in
[`scripts/routines/service/README.md`](../scripts/routines/service/README.md).
