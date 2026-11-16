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

test('an exercise is named by the person\'s own one with its id, the first of them, then by the catalogue', () => {
  const own = {
    customEx: [{ id: 7, n: 'My press' }, { id: '7', n: 'A later one' }, { id: 'c2', name: 'Old style' }, { id: '0025' }, { id: '0025', n: 'Too late' }, { id: '9', n: 'Nine', name: 'Other' }, null],
    routines: [{ id: 'a', name: 'Push', ex: [{ id: '7' }, { id: 'c2' }, { id: '0025' }, { id: 'nobody' }, { id: 9 }] }],
    week: { 3: ['a'] },
  };
  const ev = events(buildIcs(own, { uid: 'u1', now: NOW, tz: 'UTC' }));
  const plain = events(buildIcs({ ...own, customEx: [] }, { uid: 'u1', now: NOW, tz: 'UTC' }));
  const catalogue = plain[0].DESCRIPTION.split('\\n')[2];
  assert.notEqual(catalogue, '0025', 'the catalogue has a name for 0025');
  assert.equal(ev[0].DESCRIPTION, ['My press', 'Old style', catalogue, 'nobody', 'Nine'].join('\\n'));
});

// A calendar app fetches the feed on its own, every hour, and anyone with the address can fetch it
// as often as the token's limit lets them; it is built in the one thread that answers every
// request. A list walked inside a walk of another (the person's own exercises once per exercise
// named, a routine's exercises once per time a weekday names it) made a crafted profile's feed take
// seconds to minutes, and a routine's icon of any length went into every one of its events. These
// are under the 5 MB limit; each took seconds or more before.
test('the feed: long lists of exercises, workouts and namings of a routine are each read once', () => {
  const within = S => {
    const t = Date.now();
    buildIcs(S, { uid: 'u1', now: NOW, tz: 'UTC', done: true });
    return Date.now() - t;
  };
  const N = 10000;
  const customEx = Array.from({ length: N }, (_, i) => ({ id: 'c' + i, n: 'Mine ' + i }));
  const at = i => NOW - (i % 80) * 86400000;
  // as many workouts as exercises of their own, every entry one of them
  assert.ok(within({ customEx, workouts: Array.from({ length: N }, (_, i) => ({ id: 'w' + i, end: at(i), entries: [0, 1, 2, 3].map(j => ({ id: 'c' + ((i * 4 + j) % N) })) })) }) < 1000);
  // few enough workouts to all be listed, each naming the last of the person's own forty times
  assert.ok(within({ customEx, workouts: Array.from({ length: 400 }, (_, i) => ({ id: 'w' + i, end: at(i), entries: Array(40).fill({ id: 'c' + (N - 1) }) })) }) < 1000);
  // one workout with tens of thousands of entries
  assert.ok(within({ customEx, workouts: [{ id: 'w', end: at(1), entries: Array.from({ length: 4 * N }, (_, i) => ({ id: 'c' + (i % N) })) }] }) < 1000);
  // every weekday naming one long routine thousands of times
  const long = { id: 'r', name: 'R', ex: Array.from({ length: 2 * N }, (_, i) => ({ id: 'x' + i })) };
  const daily = (r, times) => ({ routines: [r], week: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, Array(times).fill('r')])) });
  assert.ok(within(daily(long, 2000)) < 1000);
  // a routine of hundreds of thousands of exercises, named often enough to fill the feed
  assert.ok(within(daily({ id: 'r', name: 'R', ex: Array.from({ length: 50 * N }, (_, i) => ({ id: 'x' + i })) }, 60)) < 1000);
  // an icon of a megabyte on a routine named as often
  const icon = buildIcs(daily({ id: 'r', name: 'R', emoji: ';'.repeat(1 << 20) }, 60), { uid: 'u1', now: NOW, tz: 'UTC' });
  assert.ok(icon.length < 200000, 'the icon is cut like every other text');
});
