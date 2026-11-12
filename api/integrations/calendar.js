/* The calendar feed (v1.4.5): a private ICS address of a profile's planned sessions, and, if the
 * person wants, the workouts they finished, for Apple Calendar, Google Calendar, Outlook or
 * anything else that subscribes to an iCalendar URL. Settings → Integrations → Calendar feed.
 *
 * The address carries a scoped token (tokens.js) of its own kind, `calendar`: it can read the
 * plan (and the workouts when asked) through this one route and nothing else, the API token routes
 * refuse it, and it ends with "sign out everywhere" like every token. A calendar app cannot send
 * a header, so the token is in the path; it is sealed in db.json (crypto.js) so Settings can show
 * the address again, and a new address ends the old one.
 *
 * What a day holds is the reminder's own rule (queue.js effectiveRoutineId): a per-date override,
 * then a coach week or rotation's next session, then the weekday plan with its combined routines.
 * A floating coach-week or rotation session has no day of its own past today, so after today
 * only pins, overrides and weekdays show. Planned days are all-day events (they have no time);
 * finished workouts are timed events in UTC.
 *
 * Pure, so the tests can feed it documents. docs/CALENDAR.md is the reference. */
import { effectiveRoutineId, queueLiveOn } from '../queue.js';
import { libraryName } from '../coach/core/library.js';
import { workoutTime } from './events.js';

export const PAST_DAYS = 7;
export const AHEAD_DAYS = 56;
export const DONE_DAYS = 90;
const MAX_EVENTS = 400;
const NAME_MAX = 80;

const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []);

/** The calendar date of an instant in `tz` (UTC when unset or unknown). */
export function dayIn(ms, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    const g = t => parts.find(x => x.type === t)?.value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** RFC 5545 text: backslash, semicolon, comma and line breaks escaped, controls dropped. */
export function icsText(v) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** A content line folded at 75 octets, continuation lines starting with a space. */
export function fold(line) {
  const out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const dateValue = iso => iso.replace(/-/g, '');

function exerciseName(id, doc) {
  const own = list(doc?.customEx).find(c => String(c.id) === String(id));
  return String(own?.n || own?.name || libraryName(String(id)) || id).slice(0, NAME_MAX);
}

/** The routine ids a day holds, in the reminder's order of precedence. */
export function dayRoutines(S, iso, today) {
  const routines = list(S?.routines);
  const known = new Set(routines.map(r => r.id));
  const ov = S?.dayPlan?.[iso];
  if (ov === 'rest') return [];
  // A floating session is "today's" on every future day; it has no day of its own there.
  if (iso > today && queueLiveOn(S, iso) && !ov) {
    const wd = new Date(iso + 'T12:00:00').getDay();
    const queued = new Set(Array.isArray(S.queue?.ids) ? S.queue.ids : []);
    return [].concat(S.week?.[wd] || []).filter(id => known.has(id) && !queued.has(id));
  }
  const first = effectiveRoutineId(S, iso);
  if (!first) return [];
  // A plain weekday can combine routines; an override or a queue session is one.
  const wd = new Date(iso + 'T12:00:00').getDay();
  const week = [].concat(S.week?.[wd] || []).filter(id => known.has(id));
  if (!ov && week.includes(first) && !queueLiveOn(S, iso)) return week;
  return [first];
}

/**
 * The feed's text. `opts`: { uid, now, tz, done (with finished workouts), name (the profile's) }.
 * Every event has a stable UID, so a calendar updates an event in place instead of doubling it.
 */
export function buildIcs(S, { uid = 'u', now = Date.now(), tz = S?.reminder?.tz, done = false, name = '' } = {}) {
  const today = dayIn(now, tz);
  const routines = new Map(list(S?.routines).map(r => [r.id, r]));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//openGym//Calendar feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText(name ? `openGym · ${name}` : 'openGym'),
    'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  let n = 0;
  const event = props => {
    if (n >= MAX_EVENTS) return;
    n++;
    lines.push('BEGIN:VEVENT', ...props, 'END:VEVENT');
  };
  const doneDays = new Set();
  if (done) {
    const since = now - DONE_DAYS * 86400000;
    for (const w of list(S?.workouts)) {
      const at = workoutTime(w);
      if (!at || at < since || at > now + 86400000) continue;
      const start = Number(w.start) || at, end = Number(w.end) > start ? Number(w.end) : start + 3600000;
      const names = list(w.entries).map(e => exerciseName(e.id, S)).slice(0, 40);
      const sets = list(w.entries).reduce((a, e) => a + list(e.sets).filter(s => s.done === true || s.sides?.L?.done || s.sides?.R?.done).length, 0);
      if (typeof w.d === 'string') doneDays.add(w.d.slice(0, 10));
      event([
        'UID:' + icsText(`done-${String(w.id).slice(0, 60)}-${uid}@opengym`),
        'DTSTAMP:' + stamp(now),
        'DTSTART:' + stamp(start), 'DTEND:' + stamp(end),
        'SUMMARY:' + icsText('✓ ' + (String(w.name || '').slice(0, NAME_MAX) || 'Workout')),
        'DESCRIPTION:' + icsText([`${sets} ${sets === 1 ? 'set' : 'sets'}`, ...names].join('\n')),
        'CATEGORIES:openGym,Workout', 'TRANSP:TRANSPARENT',
      ]);
    }
  }
  for (let i = -PAST_DAYS; i <= AHEAD_DAYS; i++) {
    const iso = addDays(today, i);
    // A past day that has its workout already shows that one, not the plan as well.
    if (done && iso <= today && doneDays.has(iso)) continue;
    for (const id of dayRoutines(S, iso, today)) {
      const r = routines.get(id);
      if (!r) continue;
      const exNames = list(r.ex).map(e => exerciseName(e.id, S)).slice(0, 40);
      event([
        'UID:' + icsText(`plan-${iso}-${String(id).slice(0, 60)}-${uid}@opengym`),
        'DTSTAMP:' + stamp(now),
        'DTSTART;VALUE=DATE:' + dateValue(iso), 'DTEND;VALUE=DATE:' + dateValue(addDays(iso, 1)),
        'SUMMARY:' + icsText([r.emoji, String(r.name || 'Workout').slice(0, NAME_MAX)].filter(Boolean).join(' ')),
        ...(exNames.length ? ['DESCRIPTION:' + icsText(exNames.join('\n'))] : []),
        'CATEGORIES:openGym,Plan', 'TRANSP:TRANSPARENT',
      ]);
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
