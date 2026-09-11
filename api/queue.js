// Floating coach week — the "what's next" rule for web-push reminders. Hand-copied (not
// imported) from frontend/src/lib/queue.js / lib/history.js: the same DONE RULE on both sides,
// kept as a tiny standalone module here (rather than inline in server.js) so it can be
// unit-tested without booting the whole server. `S.queue` is written by a planner — any API
// client that PUTs state with a queue (a coaching agent, a script) — never by the app itself.
//
// DONE RULE: a queue session counts as done once a finished workout on its routine exists,
// started at/after the queue was applied (`S.queue.since`) — or a "past workout" logged with an
// early clock but DATED inside the week (on or after `startsOn`) whose merged name (`'A + B'`)
// names the routine under its current title. The date bound keeps a past week's workout, which
// a planner's reused ids and names can make look identical, from counting. Only finished
// workouts (`S.workouts`) count; an in-progress session never does. Missed sets are the
// planner's business, not the queue's.
function routineIdsOf(w) {
  return Array.isArray(w.routineIds) ? w.routineIds : (w.routineId ? [w.routineId] : []);
}
function nameParts(w) {
  return String(w.name || '').split(' + ');
}
function queueDone(S, id, startsOn) {
  const currentName = (S.routines || []).find(r => r.id === id)?.name;
  return (S.workouts || []).some(w => routineIdsOf(w).includes(id)
    && ((w.start ?? 0) >= S.queue.since || (String(w.d || '') >= startsOn && nameParts(w).includes(currentName))));
}
// The reminder tick only ever asks "what's next right now" — there is no separate "today" to
// preview a different date against, so `today` in the spec's `next(iso, today)` is just `iso`.
// That collapses `iso === max(today, startsOn)` to the equivalent, simpler `iso >= startsOn`.
function queueNext(S, iso) {
  const q = S.queue;
  if (!q || typeof q !== 'object' || !Array.isArray(q.ids)) return null;
  // A missing startsOn means active now; a session whose routine was deleted is dropped from the
  // week (the frontend's queue.js does the same — it could never be started or logged).
  const startsOn = typeof q.startsOn === 'string' ? q.startsOn : new Date(q.since || 0).toISOString().slice(0, 10);
  if (iso < startsOn) return null;
  const ids = q.ids.filter(id => (S.routines || []).some(r => r.id === id));
  const remaining = ids.filter(id => !queueDone(S, id, startsOn));
  return remaining.length ? remaining[0] : null;
}

// A weekday can hold a routine-id list (combine routines); the reminder only needs the first.
// Per-date overrides win outright ('rest' -> null; an explicit routine id -> that id); otherwise
// a live queue's next session wins over the plain weekday assignment, falling back to the weekday
// only once the queue is finished, not yet started, or absent.
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const q = queueNext(S, iso);
  if (q) return q;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return [].concat(S.week?.[wd] || []).find(id => S.routines?.some(r => r.id === id)) || null;
}
