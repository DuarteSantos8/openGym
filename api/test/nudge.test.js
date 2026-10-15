// Missed-workout nudge — the pure half (nudge.js) and its push text (push-messages.js). The tick
// in server.js is covered end to end in server-nudge.test.js; the rules themselves are here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excusedOn, nudgeFor, nudgeMinute, nudgeWindowOpen, toneOf, lineIndex } from '../nudge.js';
import { nudgePush } from '../push-messages.js';
import { NUDGE_COPY } from '../nudge-copy.js';

const routines = [{ id: 'push', name: 'Push Day' }, { id: 'pull', name: 'Pull Day' }];
// 2026-09-07 is a Monday. Push on Mon/Wed/Fri, nothing else.
const S = (over = {}) => ({ routines, week: { 1: 'push', 3: 'push', 5: 'push' }, dayPlan: {}, workouts: [], reminder: { on: true, nudge: true, time: '08:00' }, ...over });
const w = d => ({ id: 'w' + d, d, routineId: 'push' });

test('when: 20:00, or 2 hours after a late reminder, and never after 21:30', () => {
  assert.equal(nudgeMinute('08:00'), 20 * 60);
  assert.equal(nudgeMinute('19:00'), 21 * 60);
  assert.equal(nudgeMinute('19:30'), 21 * 60 + 30);
  assert.equal(nudgeMinute('19:31'), null, 'a reminder this late leaves no evening for a nudge');
  assert.equal(nudgeMinute(undefined), 20 * 60);
  assert.equal(nudgeWindowOpen('08:00', '19:59'), false);
  assert.equal(nudgeWindowOpen('08:00', '20:00'), true);
  assert.equal(nudgeWindowOpen('08:00', '21:30'), true);
  assert.equal(nudgeWindowOpen('08:00', '21:31'), false);
  assert.equal(nudgeWindowOpen('19:00', '20:30'), false);
  assert.equal(nudgeWindowOpen('21:00', '21:15'), false);
});

test('which: a planned day with nothing logged; not a rest day, not a trained day', () => {
  assert.equal(nudgeFor(S({ workouts: [w('2026-09-04')] }), '2026-09-07'), 'push');   // Monday, missed
  assert.equal(nudgeFor(S(), '2026-09-08'), null);                                    // Tuesday, rest
  assert.equal(nudgeFor(S({ workouts: [w('2026-09-07')] }), '2026-09-07'), null);     // trained
  assert.equal(nudgeFor(S({ dayPlan: { '2026-09-07': 'rest' }, workouts: [w('2026-09-04')] }), '2026-09-07'), null); // moved to rest
  assert.equal(nudgeFor(S({ dayPlan: { '2026-09-08': 'pull' }, workouts: [w('2026-09-07')] }), '2026-09-08'), 'pull'); // moved onto Tuesday
});

test('back-off: quiet after 3 missed days in a row, back after the next workout', () => {
  // last workout Fri 09-04; missed Mon 07, Wed 09, Fri 11 -> nudged on each of those three
  const s = S({ workouts: [w('2026-09-04')] });
  assert.equal(nudgeFor(s, '2026-09-07'), 'push');
  assert.equal(nudgeFor(s, '2026-09-09'), 'push');
  assert.equal(nudgeFor(s, '2026-09-11'), 'push');
  // the fourth missed day in a row: silent, and so is every one after it
  assert.equal(nudgeFor(s, '2026-09-14'), null);
  assert.equal(nudgeFor(s, '2026-09-16'), null);
  // a workout resets the count
  const back = S({ workouts: [w('2026-09-04'), w('2026-09-15')] });
  assert.equal(nudgeFor(back, '2026-09-16'), 'push');
  // rest days in between are not misses
  assert.equal(nudgeFor(S({ week: { 1: 'push' }, workouts: [w('2026-08-31')] }), '2026-09-14'), 'push');
});

test('back-off: a profile with no workouts at all is not nagged for ever', () => {
  const every = S({ week: { 0: 'push', 1: 'push', 2: 'push', 3: 'push', 4: 'push', 5: 'push', 6: 'push' } });
  assert.equal(nudgeFor(every, '2026-09-07'), null, 'the 14 days looked back on are all misses');
});

test('coach week / rotation: the day right after a workout is rest, the second day off is a miss', () => {
  const queue = { ids: ['push', 'pull'], since: 0, startsOn: '2026-09-07' };
  const s = S({ week: {}, queue, workouts: [{ id: 'a', d: '2026-09-07', routineId: 'push', start: 1 }] });
  assert.equal(nudgeFor(s, '2026-09-08'), null, 'the day after a session');
  assert.equal(nudgeFor(s, '2026-09-09'), 'pull', 'two days off in a row');
});

// #261, the mirror of frontend/src/lib/nudge.test.js: a day with a note on it is excused.
test('a noted day is excused: not nudged, and not counted towards the back-off', () => {
  const notes = { '2026-09-07': { tag: 'sick', _ts: 1 } };
  assert.equal(nudgeFor(S({ workouts: [w('2026-09-04')], dayNotes: notes }), '2026-09-07'), null);
  assert.equal(nudgeFor(S({ workouts: [w('2026-09-04')], dayNotes: { '2026-09-07': { text: 'Flight to Lisbon', _ts: 1 } } }), '2026-09-07'), null);
  assert.equal(nudgeFor(S({ workouts: [w('2026-09-04')], dayNotes: { '2026-09-07': { _ts: 2 } } }), '2026-09-07'), 'push', 'a cleared note is no excuse');
  const s = S({ workouts: [w('2026-09-04')], dayNotes: notes });
  assert.deepEqual(['2026-09-09', '2026-09-11', '2026-09-14', '2026-09-16'].map(d => !!nudgeFor(s, d)), [true, true, true, false]);
  assert.equal(excusedOn(S({ dayNotes: { '2026-09-07': { tag: 'nope', text: '  ' } } }), '2026-09-07'), false);
  assert.equal(excusedOn({ dayNotes: 'x' }, '2026-09-07'), false);
});

test('a malformed state reads as nothing to nudge about', () => {
  assert.equal(nudgeFor({}, '2026-09-07'), null);
  assert.equal(nudgeFor({ workouts: 'x', routines: null, week: { 1: 'push' } }, '2026-09-07'), null);
  assert.equal(nudgeFor(S({ workouts: [null, w('2026-09-04')] }), '2026-09-07'), 'push');
  assert.equal(toneOf({ tone: 'mean' }), 'friendly');
  assert.equal(toneOf(undefined), 'friendly');
  assert.equal(toneOf({ tone: 'drill' }), 'drill');
});

test('push text: by tone, one line per date, routine name filled in, localized', () => {
  const iso = '2026-09-07';
  const i = lineIndex(iso, 4);
  const en = nudgePush('en', 'guilt', { name: 'Push Day' }, iso);
  assert.equal(en.title, 'I miss you');
  assert.equal(en.body, NUDGE_COPY.en.guilt.lines[i].replace('{0}', 'Push Day'));
  assert.equal(en.tag, 'nudge');
  // the next day takes the next line
  assert.notEqual(nudgePush('en', 'guilt', { name: 'Push Day' }, '2026-09-08').body, en.body);
  // every tone, every language: a title and the routine's name where the line has a slot
  for (const lang of Object.keys(NUDGE_COPY)) {
    for (const tone of ['friendly', 'guilt', 'drill']) {
      for (let d = 0; d < 4; d++) {
        const p = nudgePush(lang, tone, { name: 'Ω' }, `2026-09-0${d + 1}`);
        assert.ok(p.title && p.body && !p.body.includes('{0}'), `${lang}/${tone}`);
      }
    }
  }
  assert.equal(nudgePush('de', 'drill', null, iso).title, 'Achtung, Rekrut!');
  assert.equal(nudgePush('pt-BR', 'friendly', null, iso).title, 'Está tudo bem?');
  // unknown language and tone fall back to English and friendly; de-CH writes ss
  assert.deepEqual(nudgePush('xx', 'mean', { name: 'A' }, iso), nudgePush('en', 'friendly', { name: 'A' }, iso));
  for (const tone of ['friendly', 'guilt', 'drill']) {
    for (let d = 0; d < 4; d++) assert.doesNotMatch(nudgePush('de-CH', tone, { name: 'A' }, `2026-09-0${d + 1}`).body, /ß/);
  }
  // a name with $-patterns is inserted literally
  assert.match(nudgePush('en', 'friendly', { name: '$& $1' }, '2026-09-04').body + nudgePush('en', 'friendly', { name: '$& $1' }, '2026-09-05').body, /\$& \$1/);
});
