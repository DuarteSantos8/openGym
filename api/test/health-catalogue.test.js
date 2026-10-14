/* The shared catalogue of Apple Health types (api/health/catalogue.js): units into canonical ones,
 * a category's values into what is kept, an activity into its key — the same for every way a
 * reading comes in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, BY_HK, canonical, categoryValue, workoutKey } from '../health/catalogue.js';
import { createFolder, readingsFromShortcut } from '../health/fold.js';

test('every row is whole: a known kind, a HealthKit identifier, a range that holds', () => {
  const kinds = new Set(['sample', 'sum', 'range', 'mean', 'sleep', 'min', 'ev', 'lvl', 'val', 'wo']);
  for (const x of Object.values(TYPES)) {
    assert.ok(kinds.has(x.kind), x.type);
    assert.match(x.hk, /^HK(Quantity|Category|Workout)TypeIdentifier/, x.type);
    assert.ok(x.min < x.max && typeof x.label === 'string' && x.label, x.type);
    assert.equal(BY_HK[x.hk], x.type, 'one type per identifier: ' + x.hk);
  }
});

test('units convert into the canonical one, and an unknown one is taken as it is', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
  near(canonical('weight', 14, 'st'), 88.9041045);
  near(canonical('dietWater', 1, 'L'), 1000);
  near(canonical('dietWater', 8, 'fl_oz_us'), 236.588236);
  near(canonical('dietCaffeine', 0.1, 'g'), 100);
  near(canonical('vitaminD', 0.01, 'mg'), 10);
  near(canonical('bodyTemperature', 98.6, 'degF'), 37);
  near(canonical('glucose', 5.5, 'mmol<180.1558800000541>/L'), 99.0858);
  near(canonical('walkingSpeed', 1, 'm/s'), 3.6);
  near(canonical('stepLength', 0.7, 'm'), 70);
  near(canonical('sixMinuteWalk', 450, 'm'), 0.45);
  near(canonical('hrv', 0.045, 's'), 45);
  near(canonical('activeEnergy', 418.4, 'kJ'), 100);
  near(canonical('restingEnergy', 1700, 'Cal'), 1700);
  near(canonical('spo2', 0.97, '%'), 97);
  near(canonical('heartRate', 60, 'count/min'), 60);
  near(canonical('dietProtein', 30, 'whatever'), 30);
});

test('a category value: what is kept, and what is nothing to record', () => {
  assert.equal(categoryValue('headache', 'HKCategoryValueSeverityModerate'), 3);
  assert.equal(categoryValue('headache', 0), 1, 'present, severity not given');
  assert.equal(categoryValue('headache', 1), null, 'not present');
  assert.equal(categoryValue('moodChanges', 'HKCategoryValuePresencePresent'), 1);
  assert.equal(categoryValue('menstrualFlow', 'HKCategoryValueMenstrualFlowHeavy'), 4);
  assert.equal(categoryValue('menstrualFlow', 5), null, 'no flow');
  assert.equal(categoryValue('ovulationTest', 'HKCategoryValueOvulationTestResultPositive'), 2);
  assert.equal(categoryValue('standHours', 'HKCategoryValueAppleStandHourIdle'), null);
  assert.equal(categoryValue('handwashing', 'HKCategoryValueNotApplicable'), 1);
  assert.equal(categoryValue('nope', 1), null);
});

test('an activity, however it is named, is one key', () => {
  assert.equal(workoutKey(37), 'running');
  assert.equal(workoutKey('HKWorkoutActivityTypeTraditionalStrengthTraining'), 'traditionalStrengthTraining');
  assert.equal(workoutKey('Outdoor Run'), 'running');
  assert.equal(workoutKey('Indoor Walk'), 'walking');
  assert.equal(workoutKey('Pool Swim'), 'swimming');
  assert.equal(workoutKey('High Intensity Interval Training'), 'highIntensityIntervalTraining');
  assert.equal(workoutKey('Something new'), 'other');
  assert.equal(workoutKey(9999), 'other');
});

test('the folder: a day of events counted once across sources, a level the worst of the day', () => {
  const f = createFolder();
  f.add({ type: 'handwashing', raw: 'HKCategoryValueNotApplicable', start: '2026-10-12T08:00:00+02:00', source: 'Watch' });
  f.add({ type: 'handwashing', raw: 'HKCategoryValueNotApplicable', start: '2026-10-12T12:00:00+02:00', source: 'Watch' });
  f.add({ type: 'handwashing', raw: 'HKCategoryValueNotApplicable', start: '2026-10-12T12:00:00+02:00', source: 'iPhone' });
  f.add({ type: 'nausea', raw: 2, start: '2026-10-12T08:00:00+02:00' });
  f.add({ type: 'nausea', raw: 4, start: '2026-10-12T20:00:00+02:00' });
  f.add({ type: 'nausea', raw: 3, start: '2026-10-12T22:00:00+02:00' });
  f.add({ type: 'mindful', raw: 0, start: '2026-10-12T07:00:00+02:00', end: '2026-10-12T07:15:00+02:00' });
  const x = Object.fromEntries(f.readings().map(r => [r.type, r]));
  assert.equal(x.handwashing.v, 2);
  assert.equal(x.nausea.v, 4);
  assert.equal(x.mindful.v, 15);
  assert.equal(x.nausea.sid, 'nausea:2026-10-12');
});

test('a Shortcut may send any measurement or total the catalogue lists', () => {
  const r = readingsFromShortcut({ metrics: {
    spo2: { values: '0,97\n0,95', dates: '2026-10-12T03:00:00+02:00\n2026-10-12T04:00:00+02:00', unit: '%' },
    dietWater: { values: '1,5', dates: '2026-10-12', unit: 'L' },
    headache: { values: '1', dates: '2026-10-12' },
  } });
  const x = Object.fromEntries(r.readings.map(y => [y.type, y.v]));
  assert.deepEqual(x, { spo2: 96, dietWater: 1500 });
  assert.equal(r.skipped, 1, 'a symptom is not a number a Shortcut sends');
});
