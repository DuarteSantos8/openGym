/* The weekly cadence used to be due for exactly one minute a week: `now.hhmm === wantTime`, on a
   60-second tick that is not aligned to anything. A restart across that minute, a redeploy, or an
   event loop busy with a big state file, and the whole week was skipped in silence — nobody is
   told a scheduled review did not happen.

   It is now due once the week's slot has passed and this week's review has not run, judged
   against the run marker the job history already carries. The clock is faked here, because that
   is the whole of what this function reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { isDue } = await import('../coach/cadence.js');

const DAY = 86400000, MIN = 60000;
// Sunday 20 September 2026, 18:00 UTC — the default slot (day 0, 18:00).
const SLOT = Date.UTC(2026, 8, 20, 18, 0);
const weekly = { day: 0, time: '18:00' };

// The shape startCadence hands in: the user's own wall clock, from their reminder timezone.
const wallClock = ms => {
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16), weekday: new Date(ms).getUTCDay() };
};
// The same wall clock the tick hands in — server.js userNow, for a real zone.
const wallClockIn = (tz, ms) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type === t).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
};
const coach = lastReviewAt => ({ cadence: { weekly }, lastReview: { at: lastReviewAt } });
// One workout, logged right after the last review — so "nothing new to read" is never the reason.
const state = lastReviewAt => ({ workouts: [{ id: 'w1', d: '2026-09-18', end: lastReviewAt + MIN }] });

/** isDue as the tick calls it, with the clock stopped at `at`. */
const dueAt = (t, at, lastReviewAt) => {
  t.mock.timers.enable({ apis: ['Date'], now: at });
  try { return isDue(coach(lastReviewAt), state(lastReviewAt), wallClock(at), 0); }
  finally { t.mock.timers.reset(); }
};

test('a review the tick missed by a minute is still due', t => {
  // Ran last Sunday on time; this Sunday the tick landed at 18:00:30 and then at 18:01:30.
  assert.equal(dueAt(t, SLOT + 90 * 1000, SLOT - 7 * DAY), true);
  // …and half an hour later, if the restart took that long.
  assert.equal(dueAt(t, SLOT + 30 * MIN, SLOT - 7 * DAY), true);
  // …and the next morning, which is still this week's review rather than none at all.
  assert.equal(dueAt(t, SLOT + 15 * 60 * MIN, SLOT - 7 * DAY), true);
});

test('the minute itself is unchanged, and so is the week after it ran', t => {
  assert.equal(dueAt(t, SLOT, SLOT - 7 * DAY), true, 'on the slot, as before');
  assert.equal(dueAt(t, SLOT + MIN, SLOT + 30 * 1000), false, 'it ran half a minute ago');
  assert.equal(dueAt(t, SLOT + 6 * DAY, SLOT + 30 * 1000), false, 'and still not again this week');
});

test('before the slot is not due, however long ago the last one was', t => {
  assert.equal(dueAt(t, SLOT - 2 * DAY, SLOT - 7 * DAY), false, 'Friday: this week has not come round yet');
  assert.equal(dueAt(t, SLOT - MIN, SLOT - 7 * DAY), false, 'a minute early is early');
});

test('a box that was off over the slot runs the review when it comes back', t => {
  // Down from Saturday to Wednesday: the slot passed with nothing running. Three days late is
  // late; a week with no review at all is what the exact-minute test used to produce.
  assert.equal(dueAt(t, SLOT + 3 * DAY, SLOT - 8 * DAY), true);
});

test('the gates that already existed still hold', t => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT + 30 * MIN });
  t.after(() => t.mock.timers.reset());
  const lastAt = SLOT - 7 * DAY;
  assert.equal(isDue(coach(lastAt), { workouts: [] }, wallClock(SLOT + 30 * MIN), 0), false, 'nothing logged since');
  assert.equal(isDue({ cadence: 'off', lastReview: { at: lastAt } }, state(lastAt), wallClock(SLOT + 30 * MIN), 0), false);
  assert.equal(isDue(coach(lastAt), state(lastAt), null, 0), false, 'an unreadable timezone is skipped, not guessed');
  // A review the server finished counts even when the client never stamped lastReview.
  assert.equal(isDue({ cadence: { weekly } }, state(lastAt), wallClock(SLOT + 30 * MIN), SLOT + 60 * 1000), false);
});

test('the slot is read on the user\'s clock, not the server\'s', t => {
  // Sunday 18:00 in Tokyo is Sunday 09:00 UTC. At the same instant — 09:01 UTC — the Tokyo
  // profile's slot passed a minute ago and the UTC profile's is nine hours away.
  const at = Date.UTC(2026, 8, 20, 9, 1);
  t.mock.timers.enable({ apis: ['Date'], now: at });
  t.after(() => t.mock.timers.reset());
  // Last week's review, after both profiles' slots on that Sunday.
  const lastAt = Date.UTC(2026, 8, 13, 19, 0);
  const tokyo = { date: '2026-09-20', hhmm: '18:01', weekday: 0 };
  assert.equal(isDue(coach(lastAt), state(lastAt), tokyo, 0), true, 'Tokyo is a minute past its slot');
  assert.equal(isDue(coach(lastAt), state(lastAt), wallClock(at), 0), false, 'UTC has not reached 18:00');
});

/* The slot has to be resolved at its own instant, not at today's offset. `lastAt` is an epoch
   timestamp and the slot arrives as a wall clock reading, and twice a year the zone moves in
   between: on the fall-back Sunday, last Sunday's 18:00 read with today's offset lands an hour
   late, which makes the week's review due at ten in the morning — and then due again at six,
   so the week gets two of them. */
const dueIn = (t, tz, at, lastReviewAt) => {
  t.mock.timers.enable({ apis: ['Date'], now: at });
  try { return isDue(coach(lastReviewAt), state(lastReviewAt), wallClockIn(tz, at), 0, tz); }
  finally { t.mock.timers.reset(); }
};

test('the clocks going back does not make the week\'s review due eight hours early', t => {
  const TZ = 'America/New_York';                       // EDT (−4) until Sun 1 Nov 2026 02:00
  const ranLastWeek = Date.UTC(2026, 9, 25, 22, 0);    // Sun 25 Oct 18:00 EDT — the slot before

  assert.equal(dueIn(t, TZ, Date.UTC(2026, 10, 1, 15, 0), ranLastWeek), false,
    '10:00 EST on the fall-back Sunday: the slot is eight hours away, and it used to read due');
  assert.equal(dueIn(t, TZ, Date.UTC(2026, 10, 1, 22, 59), ranLastWeek), false, '17:59 EST, a minute early');
  assert.equal(dueIn(t, TZ, Date.UTC(2026, 10, 1, 23, 1), ranLastWeek), true, "18:01 EST: this week's slot has passed");

  // And the hour is not lost on the way back either: at 18:01 EST, a review that already ran
  // this week (at its slot, 23:00 UTC) is not due again.
  assert.equal(dueIn(t, TZ, Date.UTC(2026, 10, 1, 23, 1), Date.UTC(2026, 10, 1, 23, 0) + 1000), false);
});

test('the clocks going forward are unchanged', t => {
  const TZ = 'America/New_York';                       // EST (−5) until Sun 8 Mar 2026 02:00
  const ranLastWeek = Date.UTC(2026, 2, 1, 23, 0);     // Sun 1 Mar 18:00 EST

  assert.equal(dueIn(t, TZ, Date.UTC(2026, 2, 8, 21, 59), ranLastWeek), false, '17:59 EDT, a minute early');
  assert.equal(dueIn(t, TZ, Date.UTC(2026, 2, 8, 22, 1), ranLastWeek), true, "18:01 EDT: this week's slot");
  assert.equal(dueIn(t, TZ, Date.UTC(2026, 2, 8, 22, 30), ranLastWeek), true, 'and still due half an hour later');
});

test('a zone that never moves is unaffected', t => {
  const TZ = 'Asia/Tokyo';                             // no DST, ever
  const ranLastWeek = Date.UTC(2026, 8, 13, 9, 0);     // Sun 13 Sep 18:00 JST

  assert.equal(dueIn(t, TZ, Date.UTC(2026, 8, 20, 8, 59), ranLastWeek), false, '17:59 JST');
  assert.equal(dueIn(t, TZ, Date.UTC(2026, 8, 20, 9, 1), ranLastWeek), true, '18:01 JST');
  // A caller with no zone to give falls back to the offset at the wall clock it did give, which
  // is all this had to go on before. In a zone that never moves the two agree by definition.
  // (The tick never reaches here without a zone: userNow returns null for one Intl refuses, and
  // isDue skips a profile with no `now` at all.)
  const at = Date.UTC(2026, 8, 20, 9, 1);
  t.mock.timers.enable({ apis: ['Date'], now: at });
  t.after(() => t.mock.timers.reset());
  assert.equal(isDue(coach(ranLastWeek), state(ranLastWeek), wallClockIn(TZ, at), 0), true);
});
