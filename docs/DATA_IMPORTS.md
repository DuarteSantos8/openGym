# Importing and exporting data

Everything here lives in the app under **Settings → Data & backup**, except plan sharing, which is on the
**Plan** screen.

| You want to | Use |
|---|---|
| Bring your workout history from another app | **Import from another app** (CSV) |
| Pull workouts, routines and weigh-ins from Hevy Pro | **Import from Hevy** (API key) |
| Turn a YouTube follow-along workout into a routine | **Plan → Import from a video** (self-hosted, optional) |
| Bring body weight over from an iPhone | **Import from another app** with the Apple Health export |
| Give someone your routines | **Plan → share button (top right) → Export plan file** |
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

1. **The video is read.** The server downloads a small copy (480p at most, no sound) and looks at
   one frame per second. Chapters are not the answer: they are a list of songs as often as of
   exercises, and even a good one gives the names, not the work, the rest and the rounds. They
   help: they name the video's parts (the sections of the draft), and a move the screen leaves
   without a name (a clustered set the demo card explains) takes the name of the chapter it runs
   in, when that chapter reads like an exercise. Only when the frames hold no names at all do the
   chapters (or a timestamped list in the description) become the draft, and the review screen
   says so.
2. **Every second is read** twice for the timer, once for the name; see below for how.
3. **The boxes are found for you.** The program cuts the frame into strips and reads each at a few
   dozen moments of the video. The strip that says a different exercise name every time, in words
   an exercise is called by, is the name box (a label that never changes, such as "NEXT", is not).
   The timer is found by its counting: a few seconds of the video are read in a grid of places, and a
   box whose numbers go down by one is a timer, even in a ring on the floor (up to two, and up to two
   places for the names). Nothing is asked of you when that works. It is asked when the program finds
   nothing it can use, or when what it read comes out thin: names on fewer than 60% of the rows, a low
   confidence, or a countdown it could not follow over most of the video. Then you get three stills
   with the boxes it found already drawn and a note saying it could not read the video reliably on its
   own. Move them, or draw your own (up to three of each: a big name preview in the workout and a
   small one in the warm-up are two places). The boxes you draw are saved for that channel, so its
   next video uses them and skips the search. If the boxes turn out wrong, use *Mark the boxes again*
   on the review screen: it always asks, starting from the boxes that were used.
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
   own row on the review screen. A block that repeats whole, with the same exercises, times and
   rests every round, is saved as one circuit: a named superset of A to E whose exercises each
   have a timed set per round (with its rest), so the app walks it as the video does and round two
   of a squat still has its own weight on the day. A block that does not repeat that way (a round
   you changed, one cut short) stays as separate entries, one timed set each. Picking an exercise
   for one round picks it for the other rounds of the same caption too. The warm-up and the
   stretch each become a named group of single timed holds, done straight through. A left/right
   stretch becomes one per-side hold. The routine keeps a link to the video, and importing the same
   video again replaces the routine instead of adding a second copy.

### Warm-ups and stretches

They are often another format than the workout: no rests, the moves follow one another, and the
name of the next one shows in the last seconds of the one before it (a small "UP NEXT" preview,
often away from the name box) or on a label while it is being done. For every countdown no caption
named, the program reads the whole frame, in narrow pieces (a small card is lost in a full-width
row), in the seconds before it and, if those say nothing, early in it; a caption that shows in at
least two of those moments names it. What it does not take for a name: a screen between moves
("Switch sides", "Block 1", "Link below"), a section title, the name of the move before (even
garbled, or as a part of it), and a line in brackets alone (a subtitle). A caption read with a low
confidence and words no one knows is asked again the same way. A move shown as *(R)*, followed by a
countdown of the same length that no preview names, is that move on its *(L)* side. Moves no screen
names at all arrive unnamed for you to name.

The video and every frame are deleted as soon as the job ends, however it ends. The server keeps
only the boxes per channel (`data/video-import/<profile>.json`); the draft lives in memory for an
hour.

### Setting it up

The worker is a separate container. It is not part of the api or web images, and it is only built
when you ask for it:

```bash
# in .env
VIDEO_IMPORT_URL=http://video-import:3100
VIDEO_IMPORT_TOKEN=some-long-random-string   # at least 16 characters; openssl rand -hex 24

docker compose --profile video-import up -d --build
```

The *Import from a video* entry appears once the API knows the URL. On the phone app it appears
when the phone is paired with a server that runs the worker, and never in local-only mode. The
worker has no access to `./data` and no host port; only the api container talks to it.

| Variable | Default | What it does |
|---|---|---|
| `VIDEO_IMPORT_URL` | *(unset: feature off)* | Where the API finds the worker |
| `VIDEO_IMPORT` | *(on once the URL is set)* | `0` (or `false`, `no`, `off`) switches the feature off while the worker keeps running: no routes, no entry in the app |
| `VIDEO_IMPORT_TOKEN` | *(none: the worker will not start)* | Shared secret between API and worker, at least 16 characters |
| `VIDEO_IMPORT_ALLOW_NO_TOKEN` | *(unset)* | `1` lets the worker start without a token, for a port you have put behind something else |
| `VIDEO_IMPORT_MAX_MINUTES` | `90` | Longest video accepted |
| `VIDEO_IMPORT_CONCURRENCY` | `1` | Videos processed at once (each keeps a core busy) |
| `VIDEO_IMPORT_PER_DAY` | `12` | Imports one profile may start per day (`0` = no cap); read by the API |
| `VIDEO_IMPORT_OCR_PROCS` | up to 4 | Tesseract processes reading at once (one thread each); more is faster until the cores run out |
| `VIDEO_IMPORT_MEM` | `3g` | Memory ceiling of the worker container |
| `VIDEO_IMPORT_TMP` | `2g` | Size of the worker's scratch space (`/tmp`, in memory); it holds the video while it is read |
| `VIDEO_IMPORT_TARGET` | `default` | `paddle` builds the PaddleOCR image (~2 GB) instead of Tesseract (~500 MB) |
| `PADDLE_THREADS` | all cores | CPU threads PaddleOCR may use (paddle image only) |

A 33-minute video took about 5 minutes on a four-core laptop the first time (download, finding the boxes, reading) and about 3 minutes once the boxes were remembered; finding the boxes and naming warm-up and stretch moves add a minute or two to a long video; the reading is Tesseract, one thread per process, up to four processes (`VIDEO_IMPORT_OCR_PROCS`). A busy or smaller server takes longer, and the progress bar says where it is.

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
  (work and rest together), the draft shows 60 s of work and no rest. Fix it on the review screen.
- **Small or thin captions.** A name drawn small, in a thin font, over a light wall is read in some
  seconds and not in others. A move named only by such a card can stay unnamed (a warm-up of fifteen-second
  moves, with the card on screen for four seconds, lost four names of ten in the recorded set), and a
  caption with a note in brackets ("(alternate both sides)") can come out garbled. Rows with no name are
  shown for you to name.
- **The other side with no label.** A *(L)* side is inferred when the move before says *(R)* and nothing
  else is announced; a video that shows neither, or shows the sides only in a tiny caption, has them unnamed.
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

A CSV with a date column and a weight column works the same way, and so does Strong's
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
