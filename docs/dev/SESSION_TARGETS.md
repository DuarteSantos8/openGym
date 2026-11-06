# Session targets (#972)

The exact rows for one scheduled workout, written into the synced profile by a coach or an
outside planner, without touching the routine or its progression. Code:
`frontend/src/lib/session-targets.js` (applied in `lib/session-start.js buildSessionEntries`).

## Shape

A stamped map on the profile document, one entry per target, merged per id like `exUnit`
(`lib/sync-merge.js` / `api/sync-stamps.js` `STAMPED_MAPS`). Write it with the normal sync
(`GET /api/data`, change, `PUT /api/data` with the revision you read; on 409 merge and retry).
Give every entry a fresh `_ts` (ms) when you write it, or the newer copy on a device wins.

```json
"sessionTargets": {
  "t-2026-11-09-upper": {
    "rid": "<routine id>",
    "d": "2026-11-09",
    "unit": "kg",
    "by": "Coach Ana",
    "ex": [
      { "id": "0025", "rows": [
        { "w": 20, "r": 5, "warmup": true },
        { "w": 30, "r": 3, "warmup": true },
        { "w": 40, "r": 3, "warmup": true },
        { "w": 60, "r": 8, "rest": 180 },
        { "w": 60, "r": 8, "rest": 180 },
        { "w": 60, "r": 8, "rest": 180 }
      ] }
    ],
    "_ts": 1762650000000
  }
}
```

- `rid` + `d` (the profile's local day) bind it. Another routine or another day: nothing happens.
- `unit` is required, `kg` or `lb`; weights are converted to the profile's unit.
- `ex[].slot` (0-based position in the routine) picks one occurrence of an exercise the routine
  holds twice; without it the first one.
- A row is `{ w, r }` for a rep exercise, `{ sec, w? }` for a timed one, plus an optional
  `rest` (seconds, 0 to 900; 0 is no timer) and `warmup: true`. Warm-ups go first. 1 to 20 rows,
  at least one working row.
- Cardio and per-side exercises are refused rather than guessed at.
- A target that does not fit is refused whole (the start of the workout says why) and the routine
  builds as usual. Exercises the target does not name build as usual.
- Once a workout that used it is saved, the app sets `used` (the workout id) on the entry, so the
  routine done again that day opens at its own rows. Remove a target by writing `"off": true`
  with a newer `_ts`.

## What it does not change

The routine, its rep band, its progression rule and its stored weights. The entry's target is
still the routine's prescription, so the finished workout feeds the progression from what was
actually lifted, as any session does. A workout already running is never rewritten by a sync:
targets are read only when a session is built.
