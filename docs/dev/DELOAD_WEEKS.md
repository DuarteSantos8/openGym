# Deload weeks without a programme (1.4.5)

`frontend/src/lib/deload-cycle.js`. A programme has deload weeks of its own; this is for everyone
training plain routines.

- **On a rhythm**: Settings → Advanced → Deload weeks, every 4, 5, 6 or 8 weeks, counted from the
  week it was set (the deloads are weeks N, 2N, …). Home shows next week's deload with *Push it
  back a week* and *Skip this one*, and this week's with *Not this week*.
- **Suggested**: Settings → Advanced → Suggest a deload when I need one (on by default). Home asks
  "Make next week one?" when the signals below say so. Never with a programme running, never with
  a deload this or next week, never within 3 weeks of the last one, at most once a week.
- **What a deload week does** (`lib/session-start.js`): every lifting exercise of a routine trains
  60 % of its work sets (at least one) at last session's weight and the routine's reps, and the
  entry is `noProg`, so the week neither raises nor lowers anything. The workout's progression
  line says "Deload week: 2 of 3 sets, same weight".

State: `S.deloadCycle = { every, from, auto, shift, extra, skip, dismissed }`, one whole setting.

## The daily-form hook (for the check-in feature)

The automatic trigger reads two signals over the last 14 days:

1. **Performance**: best estimated 1RM per exercise, the last 14 days against the 14 before.
   "Falling" when at least 60 % of the exercises logged in both windows dropped by 2 % or more
   (at least 2 exercises compared).
2. **Daily form**, through a hook this file defines and does not fill itself:

```js
import { setDailyFormSource } from './lib/deload-cycle.js'

// source(S, fromIso, toIso) -> [{ d: 'YYYY-MM-DD', score: 0..1 }], 1 = feeling great.
// Days without a check-in are left out. Register once at start-up.
setDailyFormSource((S, from, to) => myCheckins(S).filter(c => c.d >= from && c.d <= to)
  .map(c => ({ d: c.d, score: (c.feel - 1) / 4 })))
```

With at least 4 check-ins in the window, a mean under 0.4 counts as low, and the suggestion needs
low form plus numbers that are not climbing. With no source registered, or fewer check-ins,
falling numbers alone trigger it. A source that throws reads as no data.

The daily check-in (lib/daily-form.js, v1.4.5) is that source: `registerDailyFormSource()` runs in
main.jsx and hands over each answered day's form score (sleep, energy, soreness and stress, the last
two turned round) as `(score - 1) / 4`. Nothing with the Health module off.
