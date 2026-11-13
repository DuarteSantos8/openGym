# Zones and Muscles pages on Wear OS

Status: designs picked by the lifter 2026-11-13 (Z1 for Zones, M3 for Muscles; mockups beside this file:
`2026-11-13-wear-zones-muscles-zones.png`, `2026-11-13-wear-zones-muscles-muscles.png`). The lifter said to go on
without waiting for Duarte's protocol OK in #777.

Two branches, built in parallel, both on `wear/pulse-range` (#1180, whose Metrics stack and Pulse page they extend):

- `wear/zones`: the Zones page, plus the phone sending the profile's birth year.
- `wear/muscles`: the Muscles page. Its phone side is the Apple PR #1187 (`watch/metrics-muscles`), which this branch
  depends on and does not copy.

Both add a page to `MetricsStack`; the second to land rebases over the first (a few lines in one `when`).

## Why

On the Apple Watch the Metrics pages already show heart-rate zones (#1108) and the sets each muscle got today
(#1187). On Wear OS the lifter has to open the phone for both. Zones answer "am I resting enough, am I pushing hard
enough" during conditioning and between sets; Muscles answers "what have I hit so far, is something short" mid-session.
Wear should match the Apple Watch, made for a round screen.

## Goals

1. Zones page: five stacked bars, Z5 on top, each with its zone, its bpm band and the time spent in it, the current
   zone outlined and its text bigger (mockup Z1).
2. Muscles page: a share arc on the left rim and a typographic list of the top muscles by sets today (mockup M3).
3. Same numbers as the Apple Watch for the same session: same zone formula, same muscle tally.
4. An older phone breaks nothing: no birth year, no Zones page; no muscle fields, Muscles says "No sets yet".

## Non-goals

- A birth-year or zones switch in the Android phone app (the profile's "Sex and year of birth" already exists).
- Zones from a measured max heart rate, custom zone limits, or excluding paused time (Apple counts paused time too).
- Muscle history, weekly sets, recovery colours, a body map.
- Animations.
- Changing the phone's live-tile zones (`live-tiles.js hrZone`, which has a 50 % floor); left as it is.

## Anti-goals

- Zone or muscle numbers that differ from the Apple Watch for the same readings and workout.
- A page that does not fit a 40 mm round watch (192 dp) at text 1.0 or 1.3, or text under 12 sp.
- Text over the clock or the page dots.
- A Zones page that shows zones from a guessed age.

## Zones

### Data

- Phone: `watchExtras(S)` in `frontend/src/lib/watch-sync.js` adds `birthYear` when `S.birthYear` gives an age of 10 to
  100 this year (the same bounds as `live-tiles.js`), else nothing. Unit test beside it.
- Wear `WatchSettings` gets `birthYear: Int? = null`; `WatchShow` gets `zones: Boolean? = null` (missing = on, as on
  the Apple Watch; the phone sends `show.zones` only once #1108 lands).
- Age = current year − birth year (whole years; up to a year off from Apple's exact birth date, accepted).

### Formula (port of WatchCore `Metrics.swift` from #1108, into Wear's `object Metrics` in `WatchLogic.kt`)

- Max heart rate = 208 − 0.7 × age (Tanaka), a Double.
- `zone(bpm, max)`: null if bpm ≤ 0 or max ≤ 0; tenths = floor(bpm × 10 / max + 1e-9); zone = clamp(tenths − 4, 1, 5).
  Zone 1 is everything under 60 % (no floor: resting between sets counts as Z1).
- `zoneBands(max)`: floor of Z2..Z5 = ceil(max × (z + 4) / 10 − 1e-9); Z1 has no low end, Z5 no high end; each high end
  is the next floor − 1. Shown as "<109", "109–126", "164+".
- `timeInZones(samples, max)`: for each pair of readings in a row, the first one's zone gets the gap in seconds,
  capped at 30 s. The last reading counts nothing. Result: 5 values, index 0 = Z1.
- Port #1108's three WatchCore tests one for one (values in `MetricsTests.swift`: max(40) = 180; zone 68/107 → 1,
  108 → 2, 126 → 3, 161 → 4, 200 → 5, 0 → null; bands(180) lows [–,108,126,144,162], highs [107,125,143,161,–];
  bands agree with `zone` for max(37); samples (0,100),(10,130),(20,170),(120,170) at max 180 → [10,0,10,0,30]).

### Page (mockup Z1)

- The page exists when the stack has heart rate (`hasPulse`), `show.zones != false` and a birth year. Order:
  Summary, Pulse, Effort, Zones, then Muscles. If it disappears while shown, the stack goes back to Summary.
- Five rows, Z5 on top. Each row is as wide as the circle allows at its height; rows start below the clock and stop
  above the page dots (sizes and paddings as in the mockup notes).
- Row: track in the zone colour at 22 %; fill at 50 % (30 % in Always On), width = time ÷ longest zone time, at least
  a little stub when the time is above 0, none at 0. "Z3", the band (smaller, 85 % white) and the time (m:ss, h:mm:ss
  from an hour) on one line, white.
- Current zone (zone of the latest reading): 2 dp outline in its colour and its text one step bigger; the other rows at
  70 %. No reading yet: all rows full, none outlined, times 0:00.
- Colours Z1..Z5: `Og.Teal`, `Og.Green`, `Og.Yellow`, `Og.Orange`, `Og.Red` (the fixed green, not the accent).
- Always On: fill 30 %, rows at 60 %. The stack already returns to Summary in Always On.
- Text 1.3: the band is capped so the time keeps its room; nothing cut.
- TalkBack: each row reads "Zone 3, 127 to 145, 21 minutes 5 seconds", the current one also "current".
- Redraws on each reading, like the Pulse page (`readingCount`).

## Muscles

### Data (from #1187, unchanged)

- Snapshot: `active.entries[].muscles: { slug: weight }` (main muscle 1, helper 0.4, rounded to 2 places) and
  `active.muscleNames: { slug: name in the phone's language }`. Both optional.
- Wear `Entry` gets `muscles: Map<String, Double>? = null`, `ActiveWorkout` gets `muscleNames: Map<String, String>? = null`.
- Wear test fixture `snapshot.json` gets the same fields #1187 gives the Apple one.

### Tally (port of WatchCore `Metrics.muscles` from #1187)

- For each entry: done = sets done and not warm-ups; skip if 0; each muscle with weight > 0 adds weight × done.
- Name = `muscleNames[slug]` or the slug. Sorted by sets (most first), then by name.
- Counts the sets the watch shows as done, including ones logged on the watch the phone has not confirmed yet (the
  same state the set page draws).
- Port #1187's WatchCore test (Bench {chest 1, triceps 0.4}: warm-up done, done, done, not done; Pushdown {triceps 1}:
  1 done; an entry with no muscles: 1 done → chest 2, triceps 1.8, names from `muscleNames`; no workout → empty), plus:
  ties sorted by name, a slug with no name shows the slug.

### Page (mockup M3)

- Last page of the Metrics stack, always present during a workout (like Effort).
- No title (Effort has none); the clock stays where it is.
- Left rim: a C-shaped arc split into segments by each muscle's share of all sets, top muscle brightest, later ones
  in dimmer accent shades; muscles beyond the list merge into one dim tail.
- List: up to 5 rows at 40 mm (fewer when they do not fit, 3 at text 1.3); each row a dot in its segment's shade, the
  number (bold, 14 to 16 sp, tabular, 0 or 1 decimals in the phone's language, e.g. "5,2"), the name (13 sp, may
  wrap to 2 lines with hyphens). The top number is in the accent. "+N more" (12 sp) under the list.
- Content stays 22 dp clear of the right edge (page indicator) and 24 dp above the bottom (page dots).
- Empty (no sets done, or an older phone): the dim arc track and "No sets yet".
- Always On: thinner, dimmer arc, text at 75 %.
- TalkBack: each row reads "Chest, 8 sets".
- Colours: the phone's accent (`Og.Green` follows it), as the Apple page.

## Strings

"Zones", "Muscles", "No sets yet", "+%d more", "%s sets", the zone row's spoken text: reuse the Apple Watch keys
through `wear-strings.mjs` where they exist; any new key goes into every language.

## Where the logic lives

- Pure Kotlin in `WatchLogic.kt` `object Metrics` with JVM tests; views only draw.
- No new dependencies, no exercise media.

## Checks before done

- `:wear:testDebugUnitTest`, `:wear:compileReleaseKotlin`, `:wear:assembleDebug`, one build at a time; the phone test
  `npx vitest run src/lib/watch-sync.test.js` (Zones branch).
- Emulator shots at 40 and 45 mm, text 1.0 and 1.3, German, Always On, empty states; side by side with the mockups.
- Debug demo seeds: a birth year and readings for Zones; muscles and names for Muscles.
- On a real watch (lifter): readings cadence against the 30 s cap, the arc's look.
