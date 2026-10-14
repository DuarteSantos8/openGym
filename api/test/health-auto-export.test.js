/* What the Health Auto Export app posts (its REST API automation, JSON, Health Metrics) read into
 * the same readings as the Shortcut and the Health app's export: the same units, the same ids,
 * so a day that came in one way and then another is still one day. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutoExport, readingsFromAutoExport, readingsFromShortcut } from '../health/fold.js';

const BODY = {
  data: {
    metrics: [
      { name: 'weight_&_body_mass', units: 'lb', data: [{ qty: 180, date: '2026-10-12 07:31:00 +0200', source: 'Scale' }] },
      { name: 'body_fat_percentage', units: '%', data: [{ qty: 0.184, date: '2026-10-12 07:31:00 +0200' }] },
      { name: 'step_count', units: 'count', data: [
        { qty: 4000, date: '2026-10-12 00:00:00 +0200', source: 'iPhone' },
        { qty: 5500, date: '2026-10-12 00:00:00 +0200', source: 'Watch' },
        { qty: 8123, date: '2026-10-11 00:00:00 +0200', source: 'iPhone' }] },
      { name: 'walking_running_distance', units: 'mi', data: [{ qty: 5, date: '2026-10-12 00:00:00 +0200' }] },
      { name: 'active_energy', units: 'kJ', data: [{ qty: 4184, date: '2026-10-12 00:00:00 +0200' }] },
      { name: 'heart_rate', units: 'count/min', data: [
        { Min: 52, Avg: 70, Max: 150, date: '2026-10-12 00:00:00 +0200' },
        { Min: 60, Avg: 90, Max: 120, date: '2026-10-12 12:00:00 +0200' }] },
      { name: 'resting_heart_rate', units: 'count/min', data: [{ qty: 54, date: '2026-10-12 00:00:00 +0200' }] },
      { name: 'sleep_analysis', units: 'hr', data: [
        { date: '2026-10-12', totalSleep: 7.25, core: 4, deep: 1.25, rem: 2, asleep: 0, inBed: 8, sleepStart: '2026-10-11 23:00:00 +0200', sleepEnd: '2026-10-12 06:45:00 +0200' }] },
      { name: 'blood_pressure', units: 'mmHg', data: [{ systolic: 120, diastolic: 80, date: '2026-10-12 08:00:00 +0200' }] },
    ],
    workouts: [],
  },
};

const by = rs => Object.fromEntries(rs.map(r => [`${r.type}@${r.d}`, r]));

test('the body is told apart from a Shortcut by its shape', () => {
  assert.equal(isAutoExport(BODY), true);
  assert.equal(isAutoExport({ metrics: {} }), false);
  assert.equal(isAutoExport({ data: { metrics: 'x' } }), false);
  assert.equal(isAutoExport(null), false);
});

test('each metric in canonical units, a day of two sources counted once', () => {
  const r = readingsFromAutoExport(BODY);
  const x = by(r.readings);
  assert.equal(x['weight@2026-10-12'].v, 81.647, 'lb to kg');
  assert.equal(x['bodyFat@2026-10-12'].v, 18.4, 'a fraction is a percentage');
  assert.deepEqual([x['steps@2026-10-12'].v, x['steps@2026-10-12'].sid], [5500, 'steps:2026-10-12'], 'iPhone and Watch: the larger, not the sum');
  assert.equal(x['steps@2026-10-11'].v, 8123);
  assert.equal(x['distance@2026-10-12'].v, 8.05, 'mi to km');
  assert.equal(x['activeEnergy@2026-10-12'].v, 1000, 'kJ to kcal');
  assert.deepEqual([x['heartRate@2026-10-12'].v, x['heartRate@2026-10-12'].lo, x['heartRate@2026-10-12'].hi], [80, 52, 150]);
  assert.equal(x['restingHeartRate@2026-10-12'].v, 54);
  assert.deepEqual([x['sleep@2026-10-12'].v, x['sleep@2026-10-12'].sid, x['sleep@2026-10-12'].t], [435, 'sleep:2026-10-12', Date.parse('2026-10-12T06:45:00+02:00')]);
  assert.ok(r.readings.every(x => x.src === 'apple-health'));
  assert.deepEqual([x['systolic@2026-10-12'].v, x['diastolic@2026-10-12'].v], [120, 80], 'blood pressure is two readings');
  assert.equal(r.skipped, 0);
});

test('sleep without a total adds its stages; single stages leave out in bed and awake', () => {
  const night = readingsFromAutoExport({ data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-10-12', asleep: 1, core: 3, deep: 1, rem: 1.5 }] }] } });
  assert.equal(by(night.readings)['sleep@2026-10-12'].v, 390);
  const stages = readingsFromAutoExport({ data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data: [
    { startDate: '2026-10-11 23:00:00 +0200', endDate: '2026-10-12 03:00:00 +0200', qty: 4, value: 'Core' },
    { startDate: '2026-10-12 03:00:00 +0200', endDate: '2026-10-12 03:30:00 +0200', qty: 0.5, value: 'Awake' },
    { startDate: '2026-10-12 03:30:00 +0200', endDate: '2026-10-12 06:00:00 +0200', qty: 2.5, value: 'REM' },
    { startDate: '2026-10-11 22:30:00 +0200', endDate: '2026-10-12 06:30:00 +0200', qty: 8, value: 'In Bed' }] }] } });
  assert.equal(by(stages.readings)['sleep@2026-10-12'].v, 390);
});

test('the same weigh-in by Shortcut or by Health Auto Export is the same reading', () => {
  const a = readingsFromAutoExport({ data: { metrics: [{ name: 'weight_&_body_mass', units: 'kg', data: [{ qty: 80.1, date: '2026-10-12 07:31:00 +0200' }] }] } }).readings[0];
  const b = readingsFromShortcut({ metrics: { weight: { values: ['80.1'], dates: ['2026-10-12T07:31:00+02:00'], unit: 'kg' } } }).readings[0];
  assert.deepEqual(a, b);
});

test('bad points are skipped, too many refused', () => {
  const r = readingsFromAutoExport({ data: { metrics: [{ name: 'step_count', units: 'count', data: [null, { qty: 'x', date: '2026-10-12' }, { qty: 10, date: 'yesterday' }] }, { name: 'step_count' }] } });
  assert.deepEqual([r.readings.length, r.skipped], [0, 3]);
  const empty = readingsFromAutoExport({ data: { metrics: [
    { name: 'body_fat_percentage', units: '%', data: [{ qty: null, date: '2026-10-12 07:31:00 +0200' }] },
    { name: 'heart_rate', units: 'count/min', data: [{ Avg: 70, date: '2026-10-12 00:00:00 +0200' }, { Min: 50, date: '2026-10-12 01:00:00 +0200' }] }] } });
  assert.equal(empty.readings.length, 1, 'no value is no reading, never a 0');
  assert.deepEqual([empty.readings[0].v, empty.readings[0].lo, empty.readings[0].hi], [70, 70, 70]);
  const many = { data: { metrics: [{ name: 'step_count', units: 'count', data: Array.from({ length: 20001 }, () => ({ qty: 1, date: '2026-10-12' })) }] } };
  assert.deepEqual(readingsFromAutoExport(many), { error: 'too many samples' });
});

test('a Shortcut may send the unit once per value', () => {
  const r = readingsFromShortcut({ metrics: { weight: { values: '180\n181', dates: '2026-10-11T07:30:00+02:00\n2026-10-12T07:30:00+02:00', unit: 'lb\nlb' } } });
  assert.deepEqual(r.readings.map(x => x.v), [81.647, 82.1]);
});

test('every metric a Shortcut can send, in the units a phone may use', () => {
  const at = '2026-10-12T08:00:00+02:00';
  const one = (v, unit) => ({ values: [String(v)], dates: [at], unit });
  const r = readingsFromShortcut({ metrics: {
    weight: one(12.5, 'st'), bodyFat: one('0,2', '%'), leanMass: one(140, 'lb'), bmi: one(24.1, 'count'), height: one(70, 'in'),
    steps: one(9000, 'count'), distance: one(5, 'mi'), activeEnergy: one(2092, 'kJ'), restingEnergy: one(1700, 'Cal'),
    heartRate: { values: '60\n100', dates: `${at}\n2026-10-12T09:00:00+02:00`, unit: 'count/min' }, restingHeartRate: one(55, 'count/min'),
  } });
  const x = Object.fromEntries(r.readings.map(x => [x.type, x.v]));
  assert.deepEqual(x, { weight: 79.379, bodyFat: 20, leanMass: 63.503, bmi: 24.1, height: 177.8, steps: 9000, distance: 8.05,
    activeEnergy: 500, restingEnergy: 1700, heartRate: 80, restingHeartRate: 55 });
  assert.equal(r.skipped, 0);
});
