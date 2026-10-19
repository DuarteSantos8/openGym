/* An hour at a time while recent (catalogue.js hourlyFrom, compactHourly; fold.js): the totals and
   means of the last days kept per hour, heart rate for 90 days and the rest for 30, folded into one
   reading a day once they are older, the same way on every device and on the server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hourlyFrom, compactHourly, trimImported } from '../health/catalogue.js';
import { createFolder, readingsFromShortcut } from '../health/fold.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const at = (d, hh, mm = 0) => `${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+00:00`;
const hourMs = (d, hh) => Date.parse(`${d}T${String(hh).padStart(2, '0')}:00:00Z`);

test('the window: heart rate 90 days, everything else 30', () => {
  assert.equal(hourlyFrom('heartRate', NOW), '2026-07-22');
  assert.equal(hourlyFrom('steps', NOW), '2026-09-20');
  assert.equal(hourlyFrom('spo2', NOW), '2026-09-20');
});

test('recent totals and means come an hour at a time; older ones, and whole-day totals, a day at a time', () => {
  const f = createFolder({ now: NOW });
  const add = (type, v, start, source = 'iPhone', more = {}) => f.add({ type, v, unit: type === 'heartRate' ? 'count/min' : 'count', start, source, ...more });
  add('steps', 300, at('2026-10-18', 9, 5));
  add('steps', 200, at('2026-10-18', 9, 40));
  add('steps', 450, at('2026-10-18', 9, 10), 'Watch');   // the same walk counted by the Watch
  add('steps', 800, at('2026-10-18', 14, 0));
  add('heartRate', 60, at('2026-10-18', 9, 0));
  add('heartRate', 90, at('2026-10-18', 9, 30));
  add('heartRate', 70, at('2026-08-01', 7, 0));           // 79 days ago: still hourly for heart rate
  add('steps', 5000, at('2026-08-01', 7, 0));             // but not for steps
  add('steps', 9000, '2026-10-17');                       // a day's total a Shortcut already summed
  const r = f.readings();
  const by = sid => r.find(x => x.sid === sid);
  assert.equal(by(`steps:${hourMs('2026-10-18', 9)}`).v, 500, 'an hour of two sources: the larger, not both');
  assert.equal(by(`steps:${hourMs('2026-10-18', 14)}`).v, 800);
  assert.equal(by(`steps:${hourMs('2026-10-18', 9)}`).t, hourMs('2026-10-18', 9));
  const hr = by(`heartRate:${hourMs('2026-10-18', 9)}`);
  assert.equal(hr.v, 75);
  assert.equal(hr.lo, 60);
  assert.equal(hr.hi, 90);
  assert.ok(by(`heartRate:${hourMs('2026-08-01', 7)}`));
  assert.equal(by('steps:2026-08-01').v, 5000);
  assert.equal(by('steps:2026-10-17').v, 9000);
  assert.ok(!r.some(x => x.sid === 'steps:2026-10-18'), 'a recent day of samples has no day reading');
});

test('a Shortcut sending times gets hours too', () => {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const { readings } = readingsFromShortcut({ metrics: { heartRate: { values: '60\n140', dates: `${at('2026-10-18', 9)}\n${at('2026-10-18', 10)}` } } });
    assert.deepEqual(readings.map(x => x.sid).sort(), [`heartRate:${hourMs('2026-10-18', 9)}`, `heartRate:${hourMs('2026-10-18', 10)}`]);
  } finally { Date.now = realNow; }
});

const rec = (type, sid, v, d, more = {}) => ({ id: `apple-health:${sid}`, type, v, u: '', t: 1, d, src: 'apple-health', sid, c: 5, _ts: 7, ...more });

test('an old day\'s hours become its one reading: the total, or the mean with its lowest and highest', () => {
  const d = '2026-09-01';
  const health = [
    rec('steps', `steps:${hourMs(d, 9)}`, 500, d), rec('steps', `steps:${hourMs(d, 14)}`, 800, d, { _ts: 9 }),
    rec('heartRate', `heartRate:${hourMs(d, 9)}`, 75, d, { lo: 60, hi: 90 }), rec('heartRate', `heartRate:${hourMs(d, 10)}`, 65, d, { lo: 55, hi: 70 }),
    rec('steps', 'steps:2026-09-01', 999, d),   // an earlier day reading of the same day
    { id: 'm1', type: 'steps', v: 10, d, src: 'manual', t: 1 },
  ];
  const out = compactHourly(health, NOW);
  const steps = out.filter(r => r.type === 'steps' && r.src === 'apple-health');
  assert.deepEqual(steps.map(r => [r.id, r.sid, r.v, r._ts, r.c]), [['apple-health:steps:2026-09-01', 'steps:2026-09-01', 1300, 9, 5]]);
  assert.equal(steps[0].t, Date.parse('2026-09-01T12:00:00Z'));
  // Heart rate is kept by the hour for 90 days: still its hours.
  assert.equal(out.filter(r => r.type === 'heartRate').length, 2);
  assert.ok(out.some(r => r.id === 'm1'), 'what was typed is never touched');
  // Later, heart rate too.
  const later = compactHourly(out, Date.parse('2027-01-15T12:00:00Z'));
  const hr = later.filter(r => r.type === 'heartRate');
  assert.equal(hr.length, 1);
  assert.deepEqual([hr[0].v, hr[0].lo, hr[0].hi, hr[0].sid], [70, 55, 90, 'heartRate:2026-09-01']);
  // Run again: nothing more to do, the very same list back.
  assert.equal(compactHourly(later, Date.parse('2027-01-15T12:00:00Z')), later);
});

test('a recent day with its hours does not also count the same source\'s day reading', () => {
  const d = '2026-10-18';
  const health = [rec('steps', `steps:${hourMs(d, 9)}`, 500, d), rec('steps', 'steps:2026-10-18', 9000, d), rec('steps', 'steps:2026-10-17', 7000, '2026-10-17')];
  const out = compactHourly(health, NOW);
  assert.deepEqual(out.map(r => r.sid).sort(), ['steps:2026-10-17', `steps:${hourMs(d, 9)}`].sort());
});

test('trimImported folds old hours first, so two copies settle on the same records', () => {
  const d = '2026-09-01';
  const a = [rec('steps', `steps:${hourMs(d, 9)}`, 500, d), rec('steps', `steps:${hourMs(d, 10)}`, 200, d)];
  const b = [rec('steps', 'steps:2026-09-01', 700, d)];
  const one = trimImported(a, 15000, NOW), two = trimImported(b, 15000, NOW);
  assert.deepEqual(one.map(r => [r.id, r.v]), two.map(r => [r.id, r.v]));
});
