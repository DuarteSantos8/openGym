// The calendar feed's text (integrations/calendar.js): what a day holds, the RFC 5545 details a
// calendar app is strict about, and the finished workouts when asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, dayRoutines, icsText, fold } from '../integrations/calendar.js';

const NOW = Date.parse('2026-11-04T10:00:00Z');   // a Wednesday
const S = {
  routines: [
    { id: 'a', name: 'Push, heavy', emoji: '💪', ex: [{ id: '0025' }] },
    { id: 'b', name: 'Core', ex: [] },
    { id: 'c', name: 'Legs', ex: [] },
  ],
  week: { 3: ['a', 'b'], 5: ['c'] },
  dayPlan: { '2026-11-06': 'rest', '2026-11-07': 'a' },
  workouts: [{ id: 'w1', d: '2026-11-02', name: 'Monday thing', start: Date.parse('2026-11-02T17:00:00Z'), end: Date.parse('2026-11-02T18:05:00Z'), entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] }] }],
};
const events = ics => ics.split('BEGIN:VEVENT').slice(1).map(e => Object.fromEntries(e.split('\r\n').filter(l => l.includes(':')).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)])));

test('a day holds a combined weekday, an override, or nothing on a rest override', () => {
  assert.deepEqual(dayRoutines(S, '2026-11-04', '2026-11-04'), ['a', 'b']);
  assert.deepEqual(dayRoutines(S, '2026-11-06', '2026-11-04'), []);
  assert.deepEqual(dayRoutines(S, '2026-11-07', '2026-11-04'), ['a']);
  assert.deepEqual(dayRoutines(S, '2026-11-05', '2026-11-04'), []);
});

test('the feed: all-day plan events with stable ids, escaped, folded', () => {
  const ics = buildIcs(S, { uid: 'u1', now: NOW, tz: 'UTC', name: 'Duarte' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
  assert.match(ics, /X-WR-CALNAME:openGym · Duarte\r\n/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'folded: ' + line);
  const ev = events(ics);
  const wed = ev.filter(e => e['DTSTART;VALUE=DATE'] === '20261104');
  assert.deepEqual(wed.map(e => e.SUMMARY), ['💪 Push\\, heavy', 'Core']);
  assert.equal(wed[0]['DTEND;VALUE=DATE'], '20261105');
  assert.equal(wed[0].UID, 'plan-2026-11-04-a-u1@opengym');
  assert.ok(!ev.some(e => e['DTSTART;VALUE=DATE'] === '20261106'), 'rest override');
  assert.ok(ev.some(e => e['DTSTART;VALUE=DATE'] === '20261107' && e.SUMMARY.endsWith('Push\\, heavy')));
  assert.ok(!ics.includes('✓'), 'no workouts unless asked');
  // eight weeks of Wednesdays and Fridays, a week back
  assert.ok(ev.some(e => e['DTSTART;VALUE=DATE'] === '20261230'));
  assert.ok(!ev.some(e => e['DTSTART;VALUE=DATE'] === '20270107'));
});

test('with done: the finished workouts as timed events, and their day without its plan', () => {
  const ev = events(buildIcs({ ...S, week: { ...S.week, 1: ['c'] } }, { uid: 'u1', now: NOW, tz: 'UTC', done: true }));
  const w = ev.find(e => e.UID === 'done-w1-u1@opengym');
  assert.equal(w.DTSTART, '20261102T170000Z');
  assert.equal(w.DTEND, '20261102T180500Z');
  assert.equal(w.SUMMARY, '✓ Monday thing');
  assert.match(w.DESCRIPTION, /^1 set\\n/);
  assert.ok(!ev.some(e => e['DTSTART;VALUE=DATE'] === '20261102'), 'the plan of a day with its workout is left out');
});

test('a coach week: today has its next session, later days only what has a day', () => {
  const Q = { ...S, week: { 4: ['c'] }, dayPlan: {}, queue: { ids: ['a', 'b'], startsOn: '2026-11-01', since: 1 }, workouts: [] };
  assert.deepEqual(dayRoutines(Q, '2026-11-04', '2026-11-04'), ['a']);
  assert.deepEqual(dayRoutines(Q, '2026-11-05', '2026-11-04'), ['c']);
  assert.deepEqual(dayRoutines(Q, '2026-11-09', '2026-11-04'), []);
});

test('text and folding by the rules', () => {
  assert.equal(icsText('a,b;c\\d\ne\u0007'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'ü'.repeat(60);
  const f = fold(long).split('\r\n');
  assert.ok(f.length > 1 && f.slice(1).every(l => l.startsWith(' ')));
  assert.ok(f.every(l => Buffer.byteLength(l) <= 75));
  assert.equal(f.map((l, i) => (i ? l.slice(1) : l)).join(''), long);
});
