// Floating coach week — the "what's next" rule for web-push reminders. Hand-copied (not
// imported) from frontend/src/lib/queue.js / lib/history.js: the same rules on both sides, kept
// as a tiny standalone module here (rather than inline in server.js) so it can be unit-tested
// without booting the whole server. `S.queue` is written by a planner — any API client that PUTs
// state with a queue (a coaching agent, a script) — or by the frontend's own rotation feature
// (marked by `rotationId`; see frontend/src/lib/rotation.js). Three rules live here:
//
// DONE RULE (shared with the frontend, and the rule a planner has to mirror): a queue session
// counts as done once a finished workout on its routine exists, started at/after the queue was
// applied (`S.queue.since`) — or a "past workout" logged with an early clock but DATED inside the
// week (on or after `startsOn`) whose merged name (`'A + B'`) names the routine under its current
// title. The date bound keeps a past week's workout, which a planner's reused ids and names can
// make look identical, from counting. Only finished workouts (`S.workouts`) count; an in-progress
// session never does. Missed sets are the planner's business, not the queue's. A queue with
// `strict: true` (the app's "Start new pass") drops the dated name clause: only a workout started
// at/after `since` counts, so a session logged earlier that day stays the old pass's. `since` is
// a clock only while it is positive: 0 is no apply time at all, and every workout ever logged
// would start after it. The name clause stops at today: a workout dated later has not happened
// yet (one an API client wrote, or the one that closed the previous rotation pass on a device
// whose calendar runs ahead). Here today is the date the reminder asks about (`iso`).
//
// NEXT RULE (shared with the frontend): once `startsOn` is reached, the day's session is the
// first not-done one in slot order — unless pins say otherwise.
//
// PINS (shared with the frontend; a planner need not read them — `dayPlan` is the athlete's): the
// day sheet can give a session a day by writing the per-date override that already exists,
// `S.dayPlan[iso] = <queue routine id>`; nothing new is stored. An active pin is a dayPlan entry
// dated today or later that names a session still to do. On its day the pinned session is the
// day's session, ahead of the floating order; on every other day from today on the floating rule
// skips it. A pin on a past day is stale (the session floats again), and a pin on a done session
// is fulfilled (`pinState === 'done'`) and reads as no override at all. Pins change which session
// is NEXT, never what counts as DONE, so the tally a planner reads is untouched.
function routineIdsOf(w) {
  return Array.isArray(w.routineIds) ? w.routineIds : (w.routineId ? [w.routineId] : []);
}
// Does this workout's name name this routine? The frontend's namesRoutine: a routine can itself
// be named 'Push + Pull', so the name is looked for at a ' + ' boundary, never split out.
function namesRoutine(w, name) {
  if (!name) return false;
  const n = String(w.name || '');
  return n === name || n.startsWith(name + ' + ') || n.endsWith(' + ' + name) || n.includes(' + ' + name + ' + ');
}
function queueDone(S, id, startsOn, today) {
  const currentName = (S.routines || []).find(r => r?.id === id)?.name;
  return (S.workouts || []).some(w => routineIdsOf(w).includes(id)
    && ((S.queue.since > 0 && (w.start ?? 0) >= S.queue.since) || (S.queue.strict !== true && String(w.d || '') >= startsOn && String(w.d || '') <= today && namesRoutine(w, currentName))));
}
// The calendar date of an instant where the USER is. The frontend's fallback for a missing
// startsOn is the device's local date of the apply; the closest thing here is the zone the
// reminder already fires by (S.reminder.tz), so the two copies name the same day. UTC when the
// zone is unset or invalid (Intl throws on an unknown zone).
function dayIn(ms, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    const g = t => parts.find(x => x.type === t)?.value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}
// Tolerant reader, as in the frontend: a missing or malformed queue reads as none. A missing
// startsOn means active since the day of the apply (dayIn above), and one with no apply time
// either is none, as in the frontend: dated from 0 the week began in 1970 and read as finished.
// A session whose routine was deleted is dropped from the week (the frontend's queue.js does the
// same — it could never be started or logged).
function queueOf(S) {
  const q = S.queue;
  if (!q || typeof q !== 'object' || !Array.isArray(q.ids)) return null;
  if (q.strict === true && !(q.since > 0)) return null; // a strict pass with no clock, as in the frontend
  const startsOn = typeof q.startsOn === 'string' ? q.startsOn : (q.since > 0 ? dayIn(q.since, S.reminder?.tz) : null);
  if (!startsOn) return null;
  // First valid occurrence of each id — the same normalization as the frontend's queueOf.
  const ids = q.ids.filter((id, i) => q.ids.indexOf(id) === i && (S.routines || []).some(r => r?.id === id));
  if (!ids.length) return null;
  return { ids, startsOn };
}
// The reminder tick only ever asks "what's next right now" — there is no separate "today" to
// preview a different date against, so `today` in the spec's `next(iso, today)` is just `iso`.
// That collapses `iso === max(today, startsOn)` to the equivalent, simpler `iso >= startsOn`, and
// "pins dated today or later" to "pins dated `iso` or later", and the DONE RULE's "up to today"
// to "up to `iso`".
function queueNext(S, iso) {
  const q = queueOf(S);
  if (!q || iso < q.startsOn) return null;
  const remaining = q.ids.filter(id => !queueDone(S, id, q.startsOn, iso));
  const pins = Object.entries(S.dayPlan || {}).filter(([d, id]) => d >= iso && remaining.includes(id));
  const here = pins.find(([d]) => d === iso);
  if (here) return here[1];
  return remaining.find(id => !pins.some(([, id2]) => id2 === id)) ?? null;
}

// What a per-date override pointing at `id` means for the queue: 'open' — a pin on a session
// still to do (its day's session, skipped elsewhere); 'done' — a fulfilled pin, to be read as no
// override; null — not a queue session (no queue, a malformed one, a routine override, 'rest', a
// deleted routine), so the plain override rules apply. As of `today`: by default the user's
// date in the zone the reminder fires by, as the frontend's copy defaults to the device's.
export function pinState(S, id, today = dayIn(Date.now(), S.reminder?.tz)) {
  const q = queueOf(S);
  if (!q || !id || !q.ids.includes(id)) return null;
  return queueDone(S, id, q.startsOn, today) ? 'done' : 'open';
}

// A weekday can hold a routine-id list (combine routines); the reminder only needs the first.
// The `?.` on each routine entry is this copy's own: it reads whatever is on disk, including a
// file written before PUT /api/data dropped null entries.
// Per-date overrides: 'rest' -> null; a pin on an open queue session -> that session; a pin on a
// done one is fulfilled and ignored; an explicit routine id -> that id. Otherwise a live queue's
// next session wins over the plain weekday assignment, falling back to the weekday only once the
// queue is finished, not yet started, or absent.
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  const pin = pinState(S, ov, iso);
  if (pin === 'open') return ov;
  if (!pin && ov && S.routines?.some(r => r?.id === ov)) return ov;
  const q = queueNext(S, iso);
  if (q) return q;
  const wd = new Date(iso + 'T12:00:00').getDay();
  // The planner's weekday pointers stay hidden on a live queue day even when it has no session for
  // it (every remaining one pinned to another day): those sessions have their days.
  const live = queueLiveOn(S, iso);
  return [].concat(S.week?.[wd] || []).find(id => S.routines?.some(r => r?.id === id) && !(live && S.queue.ids.includes(id))) || null;
}

// Is `iso` a day the queue speaks for, with sessions still to do? (`today === iso` here, so
// "the queue's day" is any day from startsOn on.)
export function queueLiveOn(S, iso) {
  const q = queueOf(S);
  return !!q && iso >= q.startsOn && q.ids.some(id => !queueDone(S, id, q.startsOn, iso));
}
