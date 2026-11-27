# AI trainer voice

Spec for issue #1393: spoken cues that sound like a personal trainer who knows you. Conceptual
design, written before any code. The research behind it, with every source, is in
[`AI_TRAINER_VOICE_RESEARCH.md`](AI_TRAINER_VOICE_RESEARCH.md). The voice itself (which of the
phone's voices; the person picks it, no Personal Voice) is #1390; this spec assumes the lines are
said with whatever voice that work gives.

Adrián answered the open questions on 2026-11-22. His decisions are folded into the design and
listed under "Decisions" at the end; what is still open for Duarte follows them. Build status:
step 3 (screen off) is built for the iPhone; see "Screen off". The rest is not built yet.

## Why a lifter wants this

A good trainer does not read numbers off a list. They know your last sessions, your goal and
what to be careful with, and between sets they tell you how that set went and what the next one
is for. openGym already knows all of that. Spoken cues today only say the facts ("Set 3, 80
kilos, 8 reps") or a fixed line from a style pack ("Breathe. You earned this break."). They
never say "one rep more than last time", which is the line that makes a lifter feel seen.

Adrián's reason, in his words: to feel coached and encouraged between sets.

What the research supports, and what it does not:

- Encouragement gives a little more effort and a better mood, not more strength. Force on grip and
  isometric tests went up 5 to 12 %; a real squat 1RM moved about 2 kg, inside day-to-day noise
  (McNair 1996, Belkhiria 2018, Engel 2019). Encouragement also raised motivation to train again
  the next day (Edwards 2018).
- Telling a lifter their result helps them push the next set (Weakley 2023 meta-analysis).
- A cue on the bar or the floor beats a cue on the muscle for performance (Chua 2021,
  meta-analysis of 73 studies).
- About a third of people do not like being encouraged at all (Midgley 2018). So it stays opt-in.

What products show: no app does spoken, between-set strength coaching from the lifter's own log.
Apple's Workout Buddy is the closest, and its two named complaints are wrong numbers and
constant cheer. This design answers both: the app says every number, and the Coach writes calm
words that describe what happened.

## Goals

- Between sets, a short line about **this** set and **this** lifter: against the plan and last
  time, what the next set is for, in a trainer's words.
- A short opener (what today is about) and a short closer (how it went).
- Works with the phone in a pocket, **also with the screen off**, like Apple's Workout app, and
  with no network during the workout (see "Screen off").
- Every number is the app's. The Coach writes words, never numbers.
- **Number-aware lines for everyone** with spoken cues on, no Coach needed: fixed, translated
  lines that know the numbers ("One more rep than last time").
- **Lines from the Coach for Coach users**, off until switched on, under the consent they already
  gave. When anything is missing (no network, no answer yet, an exercise added mid-workout), the
  number-aware lines speak instead.
- **How much it says is a setting** with three levels; the default is at most one line per rest.
- The words follow the style already picked in Settings → Timer alerts → Voice (the tone picker
  that exists today). No new tone picker.

## Non-goals (for this version)

- Talking to the trainer (voice questions, "my shoulder hurts"). The Coach's in-workout `adapt`
  job already covers changing the session by tap.
- Cues during a set (rep counting, "two more"). The app does not know when a set is under way or
  how the reps are going; it knows only when a set is ticked.
- The watches speaking. Decided: the watches never speak; when a watch is in use, the words come
  from the phone. A watch speaking through its own AirPods is a later idea (see "Left for later").

## Anti-goals: what would make it annoying or creepy

- **Saying a wrong number.** The fastest way to lose trust (Workout Buddy said a 16-day streak
  for 307).
- **Talking too much.** The person sets how much (see "How much it says"); the default is at most
  one line per rest.
- **Constant cheer.** "Amazing!" after a set that went badly is worse than silence.
- **Saying private things out loud.** The phone speaker is heard by the people around you. A
  line never mentions a limitation or an injury, not even as a hint, and never names a body part's
  condition, body weight or appearance (decided). Limitations are not sent to this job at all, so
  the Coach cannot hint at them. The workout itself already allows for them where the plan does.
- **Guilt.** No "you missed Tuesday", no comparison with other people, no shaming a short set.
- **Lectures.** No studies cited aloud, no science, no long explanations.
- **Medical advice.** The Coach's existing rule holds: it is not a doctor.

## How it works today (the code this builds on)

**Spoken cues** (`frontend/src/lib/spoken-cues.js`). Off by default (`S.spokenCues`). At fixed
moments the app says the facts of the next set and then one line from a style:

| Moment (`cues.*`) | Said today |
|---|---|
| `began` | the first exercise's name and first set |
| `restStarted` | the next set ("Set 3, 80 kilos, 8 reps"), then the style's `restStart` line, or `lastSet` before the exercise's last work set |
| `restLeft` (10 s) | the style's `tenLeft` line |
| `restOver` | the style's `restOver` line |
| `record` | the style's `record` line (`lib/set-records.js` trophy) |
| `movedOn` | the next set in a superset, facts only |
| `count` / `go` | "3", "2", "1", "Go!" for timed holds |

Styles (`lib/voice-styles.js`): `plain`, `calm`, `drill`, `hype`, `deadpan`, or `own` (lines the
person writes, at most 8 per moment, 120 characters each). Lines are English source strings
translated through `t()` into 25 languages; `pickLine` never repeats the line said just before.
Clips of one's own voice (`lib/voice-clips.js`) can replace a moment's line. Lines queue so a
clip and a line never overlap; music turns down for a line and never stops (`lib/speech.js`,
`RestAlertPlugin.swift`, `SpeechCue.java`).

**The Coach** (`api/coach/core/`, run on the server or, with the person's own key, on the phone
through `frontend/src/lib/coach-local.js`, same code). Each job is: an allowlisted payload
(`payload.js`, only named fields leave), a prompt (`api/coach/prompts/*.md`), the provider call,
a parser, a validator (`validate.js`, the security boundary), and one repair round with the
errors sent back. Jobs: `create`, `refine`, `review`, `debrief`, `ask`, `adapt`. A call takes
about 12 to 20 seconds (PR #1382 measured 12.9 s Sonnet, 20.8 s Haiku per review). PR #1382 adds
send-back rules: no number the payload lacks (`numbersOf`), no app field names (`fieldsOf`), no
check ids. Consent is asked once per provider and lists the data categories (`plan`, `training`,
`profile`, ...); the Coach is off until an admin or the phone's owner turns it on.

## Approaches considered

Ideas generated first, from smallest to boldest:

1. **Data-aware fixed lines, no AI.** The app compares each set with the plan and last time and
   picks a translated line with the numbers filled in: "One more rep than last time." Works for
   everyone, offline, free.
2. **A prepared script from the Coach (the issue's idea).** One Coach call when the workout
   starts writes the session's lines, with variants for how each set might go. The app picks and
   fills them live.
3. **On-device live lines.** Apple's Foundation Models or Gemini Nano write each line between
   sets.
4. **Hybrid:** the prepared script, with an on-device model rewording or filling gaps.
5. **A persona to pick:** the Coach writes in the tone of a style the person chooses (calm,
   drill, deadpan).
6. **Spoken debrief:** the existing `debrief` job's summary read out after the workout.
7. **The watch speaks through AirPods** when the phone stays in the locker.
8. **Bold: a live conversational trainer** you talk to through earbuds (a realtime voice API),
   which hears "that was heavy" and answers.

Narrowed to three real approaches:

| | A. Data-aware fixed lines | B. Prepared script + A as fallback | C. On-device live lines |
|---|---|---|---|
| How personal | numbers vs plan and last time; same words for everyone | numbers, plus the goal, the plan's purpose, the recent trend, in a trainer's words | like B, written live |
| Delay during the workout | none | none (written before the first rest) | 1 to 4 s a line, if it runs at all |
| Offline during the workout | yes | yes | yes |
| Who gets it | everyone with spoken cues | everyone with the Coach set up; others get A | iPhone 15 Pro and later with Apple Intelligence on, in 16 languages; Android's model is blocked in the background; no watch |
| Cost | free | one Coach call per workout (about $0.001 to $0.03, see Cost) | free |
| Privacy | nothing leaves | what the Coach already sends, under the same consent | nothing leaves |
| New dependencies | none | none | a native plugin per platform, or a 0.3 to 0.5 GB bundled model |
| Risk | sounds repetitive after weeks | the Coach writes a wrong or odd line (caught by the validator; numbers impossible) | device support, throttling, a 3B model's wording, language gaps |

**Picked: B, built on A, and A ships to everyone (decided).** A is not throwaway: its outcome
check and slot filling are exactly what B needs to pick and fill the Coach's lines, and its lines
are B's fallback. A is also what everyone with spoken cues hears, Coach or not. C fails the
"everyone" test and the dependency rule today; it stays a later option for *preparing* the script
on the phone for free (see "Left for later"). Idea 5 comes for free: the Coach writes in the tone
of the style already picked. Idea 7 is later; ideas 6 and 8 are left for later.

## The design

### Leading words

- **Script:** the lines the Coach writes for one workout, kept until that workout ends.
- **Slot:** a placeholder like `{reps}` in a line. Only the app fills slots, from the log.
- **Outcome:** how a set went, decided by the app: `beat`, `hit`, `short`, `hard`.
- **Number-aware lines:** the fixed, translated, slot-filled lines everyone with spoken cues
  hears, and what a Coach user hears when the script has no usable line.

### Turning it on

- **Number-aware lines**: part of spoken cues for everyone. Nothing to switch on beyond spoken cues
  themselves. They are used in every style except "Your own lines", which stays exactly as today
  (the person chose their own words).
- **Lines from your Coach**: a switch in Settings → Timer alerts → Voice, shown only when the Coach
  is set up for this profile or phone. Switching it on is the opt-in. If the Coach's consent for
  this provider was not given yet, the existing consent sheet asks first; "Not now" leaves it off.
  Spoken cues must be on, as for everything here.

Row copy (English source; translated like every string):
- Title: "Lines from your Coach"
- Subtitle: "Written for each workout by your AI Coach, in the style above. Fixed lines when it
  can't answer."
- With "Your own lines" picked, the subtitle reads "Your own lines are picked, so they are said
  instead." and the switch does nothing until another style is picked.

### When the script is written

When a workout starts with the Coach's lines on, the app starts one Coach job, `voice`, in the
background. Nothing waits for it.

- The first set and its warm-ups take a few minutes, so the script is usually there before the
  first rest (a call takes 12 to 20 s).
- The opener is said when the script arrives, if no work set is ticked yet; otherwise it is
  skipped (decided).
- Until it arrives, and for anything it lacks, the number-aware lines speak.
- A job that fails says nothing about failing during the workout. It is noted in the Coach's
  history like any other job.
- The job counts against the Coach's daily cap, like every job. Over the cap: number-aware lines.
  No other cost cap (decided).

The script is kept on the device for that workout only (in memory and in the Coach's device file
on the phone, so an app restart mid-workout keeps it), never in synced state, and dropped when
the workout ends.

### The moments and how much it says

Facts lines ("Set 3, 80 kilos, 8 reps") and the timer lines (the style's 10-second and rest-over
lines) stay as they are today at every level. What the setting changes is the coaching line after them.

**News** is what a set has to say: the first work set of an exercise (its intro), the set before
the exercise's last work set (`last`), an outcome of `beat`, `short` or `hard`, or a record. A set
that went to plan in the middle of an exercise (`hit`) has no news.

**How much it says** (Settings → Timer alerts → Voice), three levels, for everyone:

| Level | After a work set, besides the facts | Opener and closer |
|---|---|---|
| Records and the end | a record line only | the closer |
| **Once per rest** (default) | one line: the news line when there is news; else the style's usual line, as today (a Coach user hears the Coach's `hit` line) | both |
| After every set | the news line, then the style's usual line (two short lines at most) | both |

The default never says less than today: today every rest gets one style line, and "Once per rest"
keeps one line per rest, picking news over the usual line.

Which line, by moment:

| Moment | Coaching line |
|---|---|
| Workout start (`began`) | the opener (Coach only), once, when the script arrives in time |
| First work set of an exercise (`restStarted`, `movedOn` or `began` naming a new exercise) | that exercise's intro, once per exercise |
| Rest after a work set (`restStarted`) | the outcome line, or `last` before the exercise's last work set, by the level above |
| Record (`record`) | a record line, in place of that rest's outcome line |
| 10 s left, rest over | the style's lines, as today: short and timed, no Coach words |
| Workout finished | the closer, once (a new moment: today nothing is said at the end) |
| Warm-up sets, timed-hold counts | unchanged |

Talk budget:
- A line is at most 120 characters (`LINE_MAX`, about 8 s at normal speed); the opener and closer
  at most 200.
- One idea per line. One cue at a time.

On a typical session of 5 exercises × 3 work sets at the default: the opener, about 15 rest lines
(one each), any records and the closer, around 17 to 20 lines in an hour.

### The outcome: the app decides how a set went

A pure helper in `frontend/src/lib/` with a unit test beside it (training logic; CONTRIBUTING.md).
For the work set just ticked, against its planned target and against the same set last time
(the same comparison `lib/set-trend.js` and `lib/finish-compare.js` already make):

| Outcome | When (first match wins) |
|---|---|
| `short` | fewer reps (or seconds) than planned |
| `hard` | effort rated by hand at the top (`rir` 0 or `rpe` 10 on the row) on a set not marked to failure (`isFailureSet`, `lib/workout-model.js`); a failure set reads as RIR 0 in `rirOf` (`lib/effort.js`) by design, and going to failure on purpose is not "hard" news. An unrated set is never `hard`. |
| `beat` | more reps than planned, or more reps or weight than the same set last time |
| `hit` | everything else |

A record (`lib/set-records.js`) is not an outcome: it is its own moment, as today. The builder
may adjust the thresholds; the rule stays "the app decides, from the log".

### Slots: the app fills every number

A line may hold only these slots. The app fills them, in the units and words the facts line
already uses (`weightWords`, `tn`, `tnf` in `lib/spoken-cues.js`):

| Slot | Filled with | Usable in |
|---|---|---|
| `{exercise}` | the exercise's name in the app's language | any per-exercise line, record |
| `{weight}`, `{reps}` | the set just done ("80 kilos", "8 reps") | outcome lines, record |
| `{nextWeight}`, `{nextReps}` | the next set | outcome lines, `last` |
| `{lastWeight}`, `{lastReps}` | the same set last time | intro, outcome lines |
| `{moreReps}` | how many more reps than last time ("one rep", "2 reps") | `beat` only, and only when it is above 0 |
| `{minutes}`, `{records}`, `{sets}` | today's duration, records set, work sets done | closer |

A line whose slot cannot be filled at that moment (no last time, a weight of 0 on a bodyweight
exercise) is not said; the fallback line for that moment is said instead. The builder may add a
slot; each new slot needs a filler, a test, and an entry in the prompt.

### What the Coach is sent

A new payload kind in `api/coach/core/payload.js`, allowlisted field by field like the others,
built mostly from parts that exist:

- `prefs`: unit, language, effort scale.
- `profile`: goal and experience (the intake answers). **Not** limitations: nothing about them is
  ever said aloud, so they are not sent (decided).
- `today`: the planned session, as `adapt` sends it (`cleanToday`): exercise ids and names,
  targets, planned sets. Each entry carries its index `i`, which the script refers to.
- `previous`: the last three times the same routine was trained, and the stall picture for its
  exercises, as `debrief` sends them.
- `tone`: from the style picked in Settings (the existing tone picker, `cueStyle`): `calm`,
  `drill`, `hype` or `deadpan` as picked; "Just the facts" sends `plain` (short, factual words).
  "Your own lines" sends nothing: the job does not run.
- `level`: how much it says, so the Coach writes `hit` lines only when they will be heard.

Not sent: limitations, session and set notes, body weight, measurements, health data, cohort
medians, media. These categories are all on the existing consent list (`plan`, `training`,
`profile`), so no new consent category is needed. `docs/AI_COACH.md` "What actually leaves your
server" gains the new job.

### What the Coach writes back

A closed shape (a new schema in `schemas.js` and a prompt `api/coach/prompts/voice.md`):

```
{
  "coach_contract": 1,
  "opener": ["<1-2 variants>"],
  "exercises": [
    {
      "i": <index into today.entries>,
      "intro": ["<1-2>"],
      "beat": ["<1-3>"], "hit": ["<0-2, 1-2 when level asks for them>"], "short": ["<1-3>"], "hard": ["<1-3>"],
      "last": ["<1-2>"]
    }
  ],
  "record": ["<2-3, may use {exercise}>"],
  "closer": { "good": ["<1-2>"], "mixed": ["<1-2>"] }
}
```

`hit` lines are written when the level is "Once per rest" (a set with no news gets the Coach's
`hit` line in place of the style's usual line). Which closer is said is the app's choice: `good`
when no set was `short`, else `mixed`.

### What the prompt asks for

The research, turned into rules the prompt states and the evals check:

- Second person, choice-giving: "you could", "let's", not "you must" (Hooyman 2014, Hardy 2019).
- Between sets: what happened (through slots), then one idea for the next set. Describe; do not
  judge the person (Weakley 2023; the Strava AI study).
- Cues outside the body on compound and heavy lifts: "push the floor away", "drive the bar up"
  (Chua 2021, Marchant 2009). A muscle cue only on light isolation work for a muscle-growth goal
  (Calatayud 2016, Schoenfeld 2018).
- Speed words for effort: "drive it", "fast up" (Rendos 2019).
- Calm by default. Praise that matches the set: a `short` line is steady, never cheerful.
- Read the plan's purpose: a top set, a back-off set, a deload week, a stalled lift (from
  `previous` and the stall picture) get different words.
- Never mention a limitation, an injury or a body part's condition, not even as a hint.
- Every number through a slot. No digits in any line.
- The lifter's language; short sentences that sound natural spoken.

### How the lines are checked

`validateVoice` in `validate.js`, run on the server and on the phone alike:

- The shape is closed; every `i` names an entry of `today`; counts within the bounds above.
- Every line: a string, trimmed, 1 to 120 characters (opener and closer 200), **no digits at all**
  (stricter than #1382's number rule: here every number must come through a slot), only known
  slots, each slot allowed for that moment, braces balanced.
- No exercise ids, app field names or check ids in the text (#1382's `fieldsOf` and check-id
  rule).
- One repair round with the reasons, as every job has. **Then, unlike a review, a line that is
  still wrong is dropped on its own** and the rest of the script is kept: lines are independent,
  and a dropped line just falls back. A script with nothing left is treated as no script.
- `lean:` the no-digits rule does not catch numbers spelled as words ("eighty"). The prompt
  forbids them; tighten with a per-language word list if the evals show them.

### Number-aware lines (for everyone)

A new pack in `lib/voice-styles.js` (`PACKS.news`), English source with slots, translated into
every locale like the other packs. One neutral wording, used with every style except "Your own
lines"; it fits next to any style's usual line. Everyone with spoken cues hears it, and a Coach
user hears it whenever the script has no usable line. Examples of the source strings:

- intro: "{exercise}. Last time {lastWeight} for {lastReps}."
- beat: "{moreReps} more than last time."
- short: "A bit short of the plan. Stay steady on the next one."
- hard: "That one was hard. Take the full rest."
- last: "Last set of {exercise}."
- record: "That's a new best on {exercise}."
- closer: "Done in {minutes} minutes."

The opener has no fixed line: with no script, the workout starts with the facts, as today.
`lean:` one neutral wording for all styles; add a variant per style if people find it flat next to
Drill sergeant or Hype man.

### Examples (as heard, after the app fills the slots)

A Coach user with a strength goal, bench stalled at 80 kg for 8 for two weeks, style "Calm coach":

- Opener: "Push day. Bench has stalled lately, so today is about one clean extra rep, not more
  weight."
- Bench intro: "Bench press. Last time 80 kilos for 8 reps. Let's see if one more is in there."
  (the Coach wrote "{exercise}. Last time {lastWeight} for {lastReps}. Let's see if one more is in
  there.")
- After a `beat` set: "One rep more than last time. Take the full rest, the next one counts."
  (written as "{moreReps} more than last time. ...")
- After a `short` set: "Short of the plan. Stay at 80 kilos for the next set rather than chasing
  it." (written with `{nextWeight}`)
- Record: "That's a new best on incline press."
- Closer (`good`): "Done in 52 minutes, two records. That was a good push day."

The same sets for someone with no Coach, style "Calm coach": the bench intro is "Bench press. Last
time 80 kilos for 8 reps."; after the `beat` set "One rep more than last time."; a set that went to
plan gets the Calm coach line it gets today.

### Settings

Settings → Timer alerts → Voice (`components/VoiceSettings.jsx`) already has the tone picker: the
**Style** section, with Just the facts, Calm coach, Drill sergeant, Hype man, Deadpan and Your own
lines (`STYLE_IDS`, `STYLE_COPY` in `lib/voice-styles.js`, saved as `cueStyle`). This feature reuses
it as it is: the Coach writes in the picked style's tone. No new tone picker.

Added to the same screen:
- **How much it says**, a section under Style with three rows and a check on the picked one, built
  like the Style rows: "Records and the end", "Once per rest" (default), "After every set". Saved
  as a profile setting next to `cueStyle` (for example `cueLevel`), synced like it.
- **Lines from your Coach**, the switch above, only with the Coach set up.

The rest of Settings → Voice works as before: voice, speed, pitch, own clips (a clip still wins
over a line for its moment).

### Cost

One Coach call per workout, and one more when the repair round runs. A rough size: about 5 to
7k tokens in (the shared Coach prompt is about 2.5k tokens, the task prompt and the payload the
rest) and 1 to 2k out. With Anthropic's prices on 2026-11-03, per workout:

| Model | Price in / out per million tokens | Per workout |
|---|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 | about $0.001 |
| Claude Haiku 4.5 | $1 / $5 | about $0.01 to $0.02 |
| Claude Sonnet 5.5 | $2 / $10 | about $0.02 to $0.03 |

Estimates, not measured; the builder measures them in the evals. Other providers vary. A model
on the person's own network costs nothing but may take minutes: then the script arrives late,
and the number-aware lines carry the start of the workout.

No cost cap beyond the Coach's daily cap (decided).

### Privacy

- The Coach's lines are off until switched on. With the Coach off (`COACH_DISABLED`, or not set
  up), the switch does not appear and nothing is sent. The number-aware lines send nothing.
- Same provider, same consent sheet, same allowlist discipline as every Coach job.
- Sent once per workout at the start; nothing is sent during the workout.
- Limitations are not sent to this job.
- The script stays on the device and is dropped when the workout ends.
- No health words are said aloud (see Anti-goals).

### Offline

- No network at the start, or no answer: number-aware lines for the whole workout.
- Network lost after the script arrived: no effect; the workout never needs the network.
- openGym Offline (no network build): no Coach, so the switch does not appear; the number-aware lines work as everywhere.

### Screen off (in v1)

**Built so far (iPhone, 2026-11-26).** When a rest is booked, the page sends that rest's "rest
over" line (or the person's own clip for that moment) with it (`restOverCue` in
`lib/spoken-cues.js`). The iPhone writes the end tone, a short gap and the line into one sound
file in Library/Sounds (`RestLineMix` in CueAudioCore joins them, under 30 s; the line gets the
same tail of silence as a tone, so earbuds do not clip it), and the rest notification plays that
file. If the file is not ready, or anything fails, the notification rings the tone alone, as
before. Known limits, accepted: nothing is heard on a locked iPhone with the silent switch on;
with an Apple Watch worn, iOS sends the notification to the watch and the phone stays quiet; no
10-second line when locked. Android comes in its own step. Settings → Timer alerts says it on
the iPhone: "With the iPhone locked, the end of a rest is still said, unless it is on silent."

Decided: it must talk with the screen off, like Apple's Workout app. This helps every spoken cue,
not only this feature's lines. Sources are in the research note, "Speaking with the screen off".

What works today, and what blocks speech:

| | Screen off today | What blocks speech |
|---|---|---|
| iPhone | The rest's end rings: a local notification with the picked end tone, written as a WAV to Library/Sounds (`RestAlertPlugin.swift`, `RestTone.swift`). | The page stops when the app leaves the screen, and `live()` in `lib/spoken-cues.js` drops every cue while `document.hidden`. The app has no `audio` background mode (Info.plist lists `fetch`, `processing`, `bluetooth-central`), so it cannot start a sound on its own in the background. |
| Android | The rest's end rings: `RestTimerService` (a foreground service) and an exact alarm wake the phone, and `RestAlert.fire` plays the tone itself. `SpeechCue` (TextToSpeech) is native and needs no page. | Only `live()`: the page never asks `SpeechCue` to speak while it is hidden. |
| Browser | Nothing. | A hidden tab is throttled. Out of scope. |

The facts line, the record line and the coaching line after a set are said when the set is
ticked, so with the set ticked on the phone the screen is still on and they work today. The gap is
inside the rest: the 10-second line and the rest-over line.

Smallest way there, reusing the alert that already rings with the screen off:

- **Android.** `RestAlert.schedule` also takes the rest's two timer lines and the voice fields
  `speak` already takes (voice, lang, rate, pitch). `RestTimerService` says the 10-second line at
  10 s left, and `RestAlert.fire` says the rest-over line right after the tone, both through
  `SpeechCue`, and only while the page is hidden (on screen, the page speaks as now, so nothing is
  said twice). No new permission or service: the rest's foreground service already runs, and its
  Play declaration ("Shows how long is left in the rest between sets") still describes it.
- **iPhone.** When the rest is scheduled (the app is in front: the set was just ticked), write the
  rest-over line to a WAV with `AVSpeechSynthesizer.write(_:toBufferCallback:)` (public, iOS 13+),
  after the picked end tone, into Library/Sounds beside the tones. The rest notification that
  already goes in when the app leaves the screen plays that file. No background mode, nothing new
  for App Review: it is a local notification sound. Apple's limits apply: at most 30 s, the
  ring/silent switch and Focus can silence it, it plays at ringer volume. The 10-second line is not
  said with the screen off on iPhone in v1: it would need a second lock-screen banner at 10 s.
  Check on a device: a Premium voice writes to a file, and how the sound sits over music and in
  AirPods.
- **Not in v1, iPhone:** keeping the app running with the screen off and speaking live. It would
  need iOS 26's iPhone workout session (`PhoneWorkoutPlugin.swift`, today only with Apple Health
  on) to keep the app awake, plus the `audio` background mode. Apple documents no background run
  time for an iPhone workout session (its "Workout processing" mode is listed for Apple Watch
  only), so that needs a device test first. And an `audio` mode used to stay awake rather than to
  play sound risks rejection under guideline 2.5.4. Add it if the notification sound proves too
  limited (the silent switch).
- **Sets logged with the phone already locked** (Apple Watch, Wear OS, the lock-screen workout
  card): the page applies them only when it wakes (`WatchBridgePlugin.swift` keeps them on disk
  until then), so the phone says nothing for them in v1. See "Still open".

## Build order for the builder

Each step ships on its own and leaves the app working.

1. **Outcome helper and slot filler**, pure functions in `frontend/src/lib/` with unit tests.
2. **Number-aware lines for everyone and "How much it says"**: `PACKS.news`, the new moments
   (intro per exercise, outcome lines, the closer), the three levels, the setting row,
   translations in every locale (`check-locales`, `check-source-strings --strict`, the pt-BR
   fingerprint). Useful without any AI.
3. **Screen off**: Android speaks the timer lines from the rest alert; iPhone bakes the rest-over
   line into the notification sound. Native tests beside each (`rest-alert.native.test.js`).
4. **The `voice` job**: payload kind (no limitations; `tone` from `cueStyle`), schema, prompt,
   `validateVoice`, the server route (`POST /api/coach/voice`, plus `openapi.yaml`, which
   `openapi-routes.test.js` compares), the phone path in `coach-local.js` (same core),
   `build-coach-assets --check`. Payload allowlist test like the existing FR-11 one. Parity test
   still green.
5. **Wire the script into the cues**: the "Lines from your Coach" switch, start the job at
   `began`, keep the script for the workout, pick the line by moment, outcome and level, fall back
   per line.
6. **Evals**: add the `voice` job to the Coach evals (`scripts/coach-evals/`, from PR #1382) on
   the same six lifters: lines that pass the validator first time, lines dropped, digits caught,
   time per job, and a judge on "sounds like a trainer in the picked style who knows this lifter".
7. **Docs**: `docs/AI_COACH.md` (the new job, what it sends), the Settings help for the new rows.

Prompt size: PR #1382 notes the review prompt is near its 20,000-character test limit. The
`voice` prompt is its own task file, so it has its own budget, but it shares `common.md`.

## Left for later (and when to add it)

- **A watch speaking through its own AirPods** (phone in the locker). Decided: later, and until
  then the watches never speak; the words come from the phone. Add after the phone version proves
  people keep it on. Unverified here: speech engines on watchOS and Wear OS, and how a watch shares
  audio with music.
- **Speaking live with the iPhone locked** (workout session plus background audio): see "Screen
  off". Add if the notification sound proves too limited.
- **Writing the script ahead** (when the workout preview opens, or right after the previous
  workout), so even the opener is always ready. Add if the opener is often skipped.
- **On-device writer**: Apple's Foundation Models as one more Coach "provider" for this one job,
  free and private on recent iPhones. Add when a native plugin exists in the project for another
  reason; the validator already guards what a small model writes.
- **A spoken debrief** at the end from the existing `debrief` job.
- **Number-aware lines per style**: see "Number-aware lines".
- **Remembering last week's lines** so wording varies from week to week. Add if evals or users
  say it repeats itself.
- **Live conversation**: not planned; it needs a network during the workout, costs per minute,
  and voice commands in gyms work badly (Vi earbuds reviews).

## Decisions (Adrián, 2026-11-22)

| Question | Decision |
|---|---|
| Why? | To feel coached and encouraged between sets. |
| How chatty? | A setting with several levels: "Records and the end", "Once per rest" (default), "After every set". |
| Mention limitations? | No. Never said aloud, and not sent to this job. |
| Screen-on only for v1? | No. It must talk with the screen off, like Apple's Workout app (see "Screen off"). |
| Number-aware lines for everyone? | Yes: fixed number-aware lines for everyone with spoken cues; the Coach's lines for Coach users. |
| Tone? | Reuse the tone picker that exists (Settings → Timer alerts → Voice → Style). |
| Cost cap? | None beyond the Coach's daily cap. |
| Watch through AirPods in v1? | Later. Until then the watches never speak; the phone does. |
| Skip the opener when the script is late? | Yes. |

## Still open (for Duarte)

1. **iPhone screen off.** v1 bakes the rest-over line into the rest notification's sound (silenced by
   the ring/silent switch, no 10-second line). The fuller path, the iPhone workout session plus
   background audio, needs a device test and carries App Review risk. OK to start with the
   notification sound?
2. **Sets logged with the phone locked** (from a watch or the lock-screen card) get no spoken line
   in v1. Fine for now, or should the native side learn to speak those too?
3. **A new pack in 25 languages** (`PACKS.news`, about 7 lines) for everyone with spoken cues. OK on
   the translation load?
4. **The new Coach job** (`voice`, `POST /api/coach/voice`) and the new profile setting (how much
   it says, synced like `cueStyle`). OK to add?
