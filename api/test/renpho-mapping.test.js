/* RENPHO's readings → openGym's (api/providers/renpho/mapping.js), and the protocol pieces of the
   client that need no network (client.js): the AES envelope and long ids read without loss. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMeasurement, mapFriendDay, externalIdOf, belongsTo } from '../providers/renpho/mapping.js';
import { encrypt, decrypt, losslessParse, createRenphoClient, offsetHours } from '../providers/renpho/client.js';

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

test('the RENPHO Health app\'s segment names: la/ra/t/ll/rl masses in kg, impedances per hand, foot and body', () => {
  const m = mapMeasurement({
    ...BASE, bodyScore: 81,
    laBodyFatMass: 0.9, laBodyFatPct: 140, laMuscleMass: 3.1, laMuscle: 105, raBodyFatMass: 0.95, raMuscleMass: 3.2,
    tBodyFatMass: 8.1, tMuscleMass: 23.5, llBodyFatMass: 2.4, llMuscleMass: 8.8, rlBodyFatMass: 2.5, rlMuscleMass: 8.9,
    z20HandL: 260, z20HandR: 265, z20Body: 25, z20FootL: 250, z20FootR: 255,
    z100HandL: 225, z100HandR: 230, z100Body: 20, z100FootL: 215, z100FootR: 220,
    bfmMax: 14, smmStd: 28, weightTarget: 65, appleHealthSync: '1,1', reportId: 'P1', syncTimeStamp: 1760000000123,
  });
  const v = by(m);
  assert.equal(v.bodyScore, 81);
  assert.equal(v.segFatLeftArm, 0.9);
  assert.equal(v.segMuscleLeftArm, 3.1);
  assert.equal(v.segFatTrunk, 8.1);
  assert.equal(v.segMuscleRightLeg, 8.9);
  assert.equal(v.imp20LeftArm, 260);
  assert.equal(v.imp20Trunk, 25);
  assert.equal(v.imp100RightLeg, 220);
  assert.equal(Object.keys(v).filter(k => /^(segFat|segMuscle|imp20|imp100)/.test(k)).length, 20);
  // The share of the standard, the reference ranges and the app's switches are not values, nor unknown.
  assert.deepEqual(m.unknown, []);
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

test('the sign-in carries the app\'s headers, and a refusal in `message` says why', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = init.headers;
    return new Response(JSON.stringify({ code: -114, message: 'Decryption failed' }), { status: 200 });
  };
  const client = createRenphoClient({ fetchFn, baseUrl: 'http://renpho.test' });
  await assert.rejects(client.login({ email: 'a@example.com', password: 'x' }, { devId: 'ABC', zone: 'Europe/Rome' }),
    e => e.code === 'auth' && /code -114: Decryption failed/.test(e.message));
  assert.equal(seen.appVersion, '7.10.1');
  assert.equal(seen.platform, 'android');
  assert.equal(seen.devId, 'ABC');
  assert.equal(seen.zoneId, 'Europe/Rome');
  assert.match(seen.timeZone, /^[+-]\d{1,2}$/);
  assert.equal(seen.token, undefined, 'no session yet');
});

test('a time zone as RENPHO wants it: whole hours, summer time included', () => {
  assert.equal(offsetHours('Europe/Rome', Date.UTC(2026, 6, 1)), 2);
  assert.equal(offsetHours('Europe/Rome', Date.UTC(2026, 11, 1)), 1);
  assert.equal(offsetHours('America/New_York', Date.UTC(2026, 11, 1)), -5);
  assert.equal(offsetHours('Not/AZone'), 0);
});

test('a friend\'s day: its values in openGym\'s types, muscle and bone in kg, fat mass from the weight', () => {
  const m = mapFriendDay('77', { day: '2026-10-20', ts: 1792500000, weightUnit: 1, values: { weight: 80, bodyfat: 20, muscle: 60, bone: 3, water: 0, odd: 5 } });
  assert.equal(m.externalId, 'day:77:2026-10-20');
  assert.equal(m.d, '2026-10-20');
  assert.equal(m.t, 1792500000000);
  const v = Object.fromEntries(m.readings.map(r => [r.type, r.v]));
  assert.deepEqual(v, { weight: 80, bodyFat: 20, muscleMass: 60, boneMass: 3, fatMass: 16 });
  assert.ok(m.readings.every(r => r.src === 'renpho' && r.sid === `day:77:2026-10-20:${r.type}`));
  assert.equal(mapFriendDay('77', { day: '2026-10-20', ts: 1792500000, weightUnit: 2, values: { weight: 176 } }).readings[0].v, 79.832);
  assert.equal(mapFriendDay('77', { day: 'x', ts: 1 }), null);
});
