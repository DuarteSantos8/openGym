# Task: build a weekly training plan

Design a complete plan from `coachProfile` (their intake answers) and, if present, `history` (what they have already been lifting).

## Constraints

- Schedule exactly `coachProfile.daysPerWeek` training days. `preferredDays` (0 = Sunday … 6 = Saturday), when given, are the days that suit them: train on those. If there are fewer of them than `daysPerWeek`, add the missing days yourself, spaced for recovery; if there are more, pick `daysPerWeek` of them. The count always wins.
- Fit `coachProfile.sessionMin` minutes: roughly 2–3 minutes per straight set including rest; supersets (`sg`) buy time back when the session is tight.
- Only exercises from `library`. Respect `equipment`, `limitations`, and `dislikes` — a plan someone will not do is a plan that failed.
- If `history.workingWeights` is present, any starting `weight` you set must be at or below what they have already handled for that exercise. For anything they have not trained, omit `weight` entirely — the app's first session sets the baseline.
- 1–7 routines, each 3–12 exercises, compound work before accessories.

## Output

```
{
  "coach_contract": 1,
  "opengym_plan": 1,
  "name": "<short plan name>",
  "summary": "<2-4 sentences: the shape of the plan and why it fits what they asked for>",
  "basedOn": "<what you used — e.g. 'your last 12 weeks' or 'no history yet'>",
  "week": { "0": "rest", "1": "r1", "2": "rest", "3": "r2", "4": "rest", "5": "r3", "6": "rest" },
  "routines": [
    {
      "id": "r1",
      "name": "<routine name>",
      "emoji": "<one icon: figureStrength, arm, abs, legs, pullup, dumbbell, barbell, kettlebell, plate, machine, figureRun, bike, swim, boxing, timer, stretch, moon, heart, flame or bolt>",
      "prog": "linear",
      "why": "<1-2 sentences: what this day is for>",
      "ex": [
        {
          "id": "<library id>",
          "sets": 3,
          "mode": "reps",
          "reps": 8,
          "prog": "linear",
          "inc": 2.5,
          "repsMin": 8,
          "sg": "a",
          "why": "<1-2 sentences naming why this exercise, here, at this prescription>",
          "note": "<one short cue to keep in mind while doing it, e.g. 'Brace your core before each rep'>",
          "subs": ["<library id>", "<library id>"]
        }
      ]
    }
  ],
  "customEx": []
}
```

- `week` lists **all seven** weekdays, `"0"` (Sunday) to `"6"` (Saturday). A day that trains holds
  `routines[].id` from this same answer; a day that does not holds `"rest"`. Exactly
  `coachProfile.daysPerWeek` days carry an id.
- `mode` is `reps` (use `reps`), `time` (use `sec`), or `cardio` (use `min` and `speed`).
- `prog` on a routine is its default; on an exercise it overrides. `inc` is the load step in `meta.unit`; `repsMin` only matters for `double`.
- `sg`: give two exercises the same short string to superset them. They must be adjacent in the list.
- `note` is saved with the routine and shown under the exercise during every workout: one or two practical cues for doing it well and safely (setup, bracing, range, tempo), under 300 characters. Not why it is in the plan (that is `why`), not a pep talk. Leave it out when there is nothing worth saying. If `plan` already gives this exercise a `note`, keep it unless it is wrong, and build on it rather than replacing it.
- `subs` are up to three backups for when the machine or rack is taken: `library` ids that train the same muscle in a similar way, on equipment they have, never the exercise itself. The app offers them first in a swap. Prefer ones that need different kit (a cable or dumbbell option for a machine). Keep the ones `plan` already lists for this exercise when they still fit.
- `customEx` stays empty unless the library genuinely lacks something the plan needs; then add `{ "id": "cx1", "n": "<name>", "bp": "<body part>", "desc": "<how to do it>" }` and reference `cx1` from a routine.
