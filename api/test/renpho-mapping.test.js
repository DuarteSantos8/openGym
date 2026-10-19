/* RENPHO's readings → openGym's (api/providers/renpho/mapping.js), and the protocol pieces of the
   client that need no network (client.js): the AES envelope and long ids read without loss. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMeasurement, externalIdOf, belongsTo } from '../providers/renpho/mapping.js';
import { encrypt, decrypt, losslessParse } from '../providers/renpho/client.js';

const BASE = {
  id: '1834567890123456789', timeStamp: 1760000000, localCreatedAt: '2025-10-09 10:53:20', bUserId: '777',
  weightUnit: 1, weight: 80, bmi: 24.7, bodyfat: 20, water: 55.1, muscle: 45, bone: 3.2, protein: 17.5,
  visfat: 9, subfat: 18.2, bmr: 1750, bodyage: 31, sinew: 41.3, fatFreeWeight: 64, heartRate: 62,
};
const by = m => Object.fromEntries(m.readings.map(r => [r.type, r.v]));

test('the values, in openGym\'s types and units, with fat and muscle mass worked out from the weight', () => {
  const m = mapMeasurement(BASE);
  const v = by(m);
  assert.equal(m.externalId, '1834567890123456789');
  assert.equal(m.t, 1760000000000);
  assert.equal(m.d, '2025-10-09');
  assert.deepEqual(v, {
    weight: 80, bmi: 24.7, bodyFat: 20, bodyWater: 55.1, boneMass: 3.2, protein: 17.5, visceralFat: 9,
    subcutaneousFat: 18.2, bmr: 1750, metabolicAge: 31, skeletalMuscle: 41.3, leanMass: 64, heartRate: 62,
    muscleMass: 36, fatMass: 16,
  });
  for (const r of m.readings) {
    assert.equal(r.src, 'renpho');
    assert.equal(r.sid, `1834567890123456789:${r.type}`);
    assert.equal(r.g, 'renpho:1834567890123456789');
  }
});

test('a weight in pounds or stone is stored in kg', () => {
  assert.equal(by(mapMeasurement({ ...BASE, weightUnit: 2, weight: 176.4, fatFreeWeight: null })).weight, 80.014);
  assert.equal(by(mapMeasurement({ ...BASE, weightUnit: 4, weight: 12.6 })).weight, 80.014);
});

test('missing fields are simply not there, and a reading with no time is no reading', () => {
  const m = mapMeasurement({ id: 5, timeStamp: 1760000000, weight: 70 });
  assert.deepEqual(m.fields, ['weight']);
  assert.equal(mapMeasurement({ id: 5, weight: 70 }), null);
  // No fat percentage: no fat mass either; no muscle percentage: no muscle mass.
  assert.equal(by(m).fatMass, undefined);
  assert.equal(by(m).muscleMass, undefined);
});

test('unknown fields are reported and the known metadata is not', () => {
  const m = mapMeasurement({ ...BASE, scaleName: 'ES-CS20M', mac: 'AA', brandNewMetric: 3, internalModel: 'x' });
  assert.deepEqual(m.unknown, ['brandNewMetric']);
});

test('segmental fat, muscle and impedances, in either spelling or inside extraField', () => {
  const top = mapMeasurement({ ...BASE, bodyfat_left_arm: 1.1, sinewRightLeg: 9.8, resistance20Trunk: 21, resistance100_left_leg: 260 });
  assert.equal(by(top).segFatLeftArm, 1.1);
  assert.equal(by(top).segMuscleRightLeg, 9.8);
  assert.equal(by(top).imp20Trunk, 21);
  assert.equal(by(top).imp100LeftLeg, 260);
  const extra = mapMeasurement({ ...BASE, extraField: JSON.stringify({ segment: { fatTrunk: 8.2, muscleLeftArm: 3.1 }, impedance20RightArm: 310, odd: 1 }) });
  assert.equal(by(extra).segFatTrunk, 8.2);
  assert.equal(by(extra).segMuscleLeftArm, 3.1);
  assert.equal(by(extra).imp20RightArm, 310);
  assert.ok(extra.unknown.includes('extraField.odd'));
  // A top-level value wins over the same one in extraField.
  assert.equal(by(mapMeasurement({ ...BASE, fatTrunk: 7, extraField: { fatTrunk: 8 } })).segFatTrunk, 7);
});

test('a reading RENPHO marks invalid brings no values', () => {
  const m = mapMeasurement({ ...BASE, invalidFlag: 1 });
  assert.equal(m.readings.length, 0);
  assert.equal(m.invalid, true);
});

test('without an id, the reading is known by its time, its scale and its owner', () => {
  assert.equal(externalIdOf({ timeStamp: 1760000000, mac: 'AA:BB', bUserId: 7 }), 'ts:1760000000:AA:BB:7');
  assert.equal(externalIdOf({ timeStamp: 1760000000, mac: 'AA:BB', bUserId: 7 }), externalIdOf({ timeStamp: 1760000000, mac: 'AA:BB', bUserId: 7, weight: 81 }));
});

test('a family member\'s reading on the same scale is not the account\'s', () => {
  assert.equal(belongsTo({ bUserId: '777' }, '777'), true);
  assert.equal(belongsTo({ bUserId: '778' }, '777'), false);
  assert.equal(belongsTo({}, '777'), true);
});

test('the protocol: AES round trip, and ids past 2^53 read as strings, also negative or in arrays', () => {
  const text = '{"a":1834567890123456789,"b":"1834567890123456789","c":[12345678901234567,-12345678901234567],"d":1.5e3,"e":"x\\"9999999999999999"}';
  assert.equal(decrypt(encrypt(text)), text);
  assert.deepEqual(losslessParse(text), { a: '1834567890123456789', b: '1834567890123456789', c: ['12345678901234567', '-12345678901234567'], d: 1500, e: 'x"9999999999999999' });
});
