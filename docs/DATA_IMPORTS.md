# Importing and exporting data

Everything here lives in the app under **Settings → Data & backup**, except plan sharing, which is on the
**Plan** screen.

| You want to | Use |
|---|---|
| Bring your workout history from another app | **Import from another app** (CSV) |
| Pull workouts, routines and weigh-ins from Hevy Pro | **Import from Hevy** (API key) |
| Turn a YouTube follow-along workout into a routine | **Plan → Import from a video** (self-hosted, optional) |
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

## A routine from a YouTube video

Follow-along workouts usually show the exercise name and a countdown on screen. With the optional
video-import worker running on your server, openGym can read those and draft a routine for you:
paste the link under **Plan → share icon → Import from a video**, check the draft, and save it.

### What happens

1. **Chapters first.** If the video's chapters, or a list of timestamps in its description, already
   name the exercises, the draft is built from those and nothing is downloaded. Tick *Read the video
   even if it has chapters* to skip this.
2. **Otherwise the video is read.** The server downloads a small copy (480p at most, no sound) and
   looks at one frame per second.
3. **The first time for a channel, you mark the boxes**: one around the exercise name and one
   around the timer. You get three stills from the video, with a suggestion already drawn (labels
   that never change, such as "NEXT", are not suggested; the timer is found by its counting: a
   few seconds of the video are read in a grid of places, and a box whose numbers go down by one
   is the timer, even in a ring on the floor). If the names appear in more than one
   place, for example in a big preview during the workout and a small one in the warm-up, draw a
   box around each one (up to three). The boxes are saved for that channel, so its next video skips
   this step. If they turn out wrong, use *Mark the boxes again* on the review screen.
4. **Reading.** The name and timer are cropped from every frame, thresholded, and read with
   Tesseract (or PaddleOCR, see below). The timer is read as digits only.
5. **The countdown first.** When the video shows a timer the OCR can follow, every countdown to
   zero is one phase (a work, a rest, a warm-up move), as long as it counts, and the captions only
   name the phases: a short countdown between two longer ones is a rest whose caption names the
   next exercise (with equal lengths, 30 s on and 30 s off, the captions decide: one shown over a
   whole countdown between two shown at none is the announcement); a caption that comes up late in a move announces the next one; one at the start
   names its own. The timer is read from its brightest (or darkest) marks only, so white digits
   over a light wall and the ring round a countdown do not get in the way, and it is read twice a
   second, since many timers animate as their number changes. A move no caption named, exactly one
   round after a named move of its length, gets that name (marked as a guess). A move captioned "(one side)" followed by a "SWITCH SIDE" rest has its other side read the same way: the countdown after the rest is that move again. An exercise read two ways
   in two rounds, exactly one round apart, is one exercise. Without a usable timer:
   **Blocks and rounds.** Seconds with the same name are one block. When the timer restarts, a new
   block begins, even if the name stays the same or no name is on screen at all. The timer is only
   trusted when its readings actually count down; a timer drawn in a style OCR cannot read is
   ignored rather than cutting every exercise into pieces. Rings and tick marks around the digits
   are removed before reading. A single misread frame is outvoted by the frames
   around it. "REST", "PAUSE", "GET READY" and "NEXT: …" screens are rest, and a "NEXT: Burpees"
   also names the exercise that follows. A creator who shows the name only on the short screen
   *before* an exercise, and nothing while it is done, is recognised: the name moves onto the
   exercise that follows it. A repeating sequence of names counts as rounds.
6. **Sections.** Short work blocks that alternate with short rests form an interval section. Work
   before the first interval section is the warm-up, and work after the last one is the stretch.
   A chapter that says "warm up" or "cool down" decides the section instead. Chapters that name the
   parts of a video ("Group 1: Lower body") become the review screen's sections, and an exercise
   never runs across two of them.
7. **Review.** Each row shows a thumbnail, its time in the video (which links straight to that
   moment), the text as read, the exercise it matched, and a confidence score. You can re-pick the
   exercise, rename or delete a row, merge it into the row above, and change the work time, rest and
   rounds. Timing comes from the whole section, not from each caption: exercises start at a steady
   beat, so a 40 s exercise that OCR caught for 35 or 45 s is 40 s. A warm-up or cool-down with no
   names on screen is cut into moves by the picture itself: the video cuts at the same point of
   every move, and the rhythm of those cuts gives the length of a move, whatever it is in that
   video. A caption that comes up in the second half of a move names the next one (with no rest
   between moves, follow-alongs announce the next move ten seconds or so before it starts). Moves
   no caption named arrive with their own still for you to name. You can also add an exercise
   again (**+**), or split a long row by hand. A name that matches nothing in the library is never dropped. It becomes
   one of your own exercises (marked *new*), unless you pick an existing one. A row with no name
   at all is not saved until you pick its exercise or delete it. The percentage on a matched row is
   how sure the reading and the match are.
8. **The routine** keeps the video's order: A B C D E, then A B C D E again. Each round is its
   own row on the review screen and its own entry in the routine (one timed set with its rest), so
   the second round of a squat can carry a different weight than the first. Picking an exercise for
   one round picks it for the other rounds of the same caption too. The warm-up and the
   stretch each become a named group of single timed holds, done straight through. A left/right
   stretch becomes one per-side hold. The routine keeps a link to the video, and importing the same
   video again replaces the routine instead of adding a second copy.

The video and every frame are deleted as soon as the job ends, however it ends. The server keeps
only the boxes per channel (`data/video-import/<profile>.json`); the draft lives in memory for an
hour.

### Setting it up

The worker is a separate container. It is not part of the api or web images, and it is only built
when you ask for it:

```bash
# in .env
VIDEO_IMPORT_URL=http://video-import:3100
VIDEO_IMPORT_TOKEN=some-long-random-string

docker compose --profile video-import up -d --build
```

The *Import from a video* entry appears once the API knows the URL. On the phone app it appears
when the phone is paired with a server that runs the worker, and never in local-only mode. The
worker has no access to `./data` and no host port; only the api container talks to it.

| Variable | Default | What it does |
|---|---|---|
| `VIDEO_IMPORT_URL` | *(unset: feature off)* | Where the API finds the worker |
| `VIDEO_IMPORT_TOKEN` | *(none)* | Shared secret between API and worker |
| `VIDEO_IMPORT_MAX_MINUTES` | `90` | Longest video accepted |
| `VIDEO_IMPORT_CONCURRENCY` | `1` | Videos processed at once (each keeps a core busy) |
| `VIDEO_IMPORT_TARGET` | `default` | `paddle` builds the PaddleOCR image (~2 GB) instead of Tesseract (~500 MB) |
| `PADDLE_THREADS` | all cores | CPU threads PaddleOCR may use (paddle image only) |

A 30-minute video takes a few minutes of CPU on one core.

**Keep yt-dlp current.** YouTube changes often, and yt-dlp is what follows it. When imports start
failing with "could not read the video", rebuild the worker:
`docker compose --profile video-import build --pull --no-cache video-import`.

**A channel it reads badly?** Record the video as a regression fixture (the per-second readings
plus what you saw watching it) and the reading rules are checked against it from then on, without
the video: see `video-import/test/fixtures/README.md`.

### What it can't do

- **No text on screen, no import.** A video that only shows the instructor (and has no chapters)
  gives nothing to read, and the review screen says so.
- **Stylised fonts.** Outlined, animated, italic or very thin captions, or text over a busy moving
  background, are hard for Tesseract. Expect misreads; the PaddleOCR build handles them much
  better.
- **Names shown only during the rest.** It works when the rest screen says "NEXT: …". If the name
  only appears in a corner for a second, draw the name box there anyway and check the rows.
- **Moving captions.** The boxes are fixed per channel. A creator who moves the caption around
  between videos needs *Mark the boxes again*.
- **Chapters that include the rest.** When each chapter is "Burpees" for the whole minute
  (work and rest together), the draft shows 60 s of work and no rest. Fix it on the review screen,
  or tick *Read the video even if it has chapters*.
- **A timer OCR cannot read** (a stylised font, white digits over a white wall) gives no timing.
  The blocks then come from the captions alone, and a stretch with no captions arrives as one long
  row for you to split.
- **Rest between rounds** has no place in a routine. The review screen shows how long it was, so you
  can take it after the last exercise of each round.
- **Reps.** Only times are read. A "20 squats" caption becomes a timed set of however long the
  video spent on it.
- **YouTube can refuse the server**: private, age-restricted and members-only videos, live
  streams, and the bot checks YouTube sometimes puts in front of data-centre addresses. These fail
  with a clear message.
- Downloading may be against YouTube's terms of service for some videos; this runs on your own
  server, on your own say-so.

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

The video import is split in two. `video-import/` is the worker: metadata and chapters, frames,
OCR, segmentation, rounds and sections, all of it pure helpers with node:test tests, plus an
end-to-end test on a video ffmpeg generates. `api/video-import.js` handles access, job ownership
and the saved boxes. `frontend/src/lib/import-video.js` matches names to the library and builds
the routine.
