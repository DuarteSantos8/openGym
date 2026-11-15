// The server's copy of the check-in reminder rule (checkin-reminder.js). The cases are the ones
// frontend/src/lib/checkin-reminder.test.js runs on the app's copy: the two must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dueKeys, dueKind, itemDue, reminderOf, checkinPush } from '../checkin-reminder.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const photo = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/jpeg', size: 10, width: 10, height: 10 };

test('an item is due once its days have passed, then every few days while undone', () => {
  const item = { every: 14 };
  assert.equal(itemDue(item, '2026-11-01', '2026-11-14'), false);
  assert.equal(itemDue(item, '2026-11-01', '2026-11-15'), true);
  assert.equal(itemDue(item, '2026-11-01', '2026-11-16'), false);
  assert.equal(itemDue(item, '2026-11-01', '2026-11-18'), true);
  assert.equal(itemDue({ every: 2 }, '2026-11-01', '2026-11-05'), true);
  assert.equal(itemDue({ every: 14, since: '2026-11-10' }, null, '2026-11-24'), true);
  assert.equal(itemDue({ every: 14, since: '2026-11-10' }, null, '2026-11-20'), false);
  assert.equal(itemDue({ every: 7 }, null, '2026-11-20'), true);
});

test('due keys read weigh-ins, measurements, blood pressure and photos', () => {
  const S = {
    checkinReminder: { on: true, time: '07:30', items: { weight: { every: 7 }, waist: { every: 14 }, 'pair:bp': { every: 7 }, photos: { every: 28 }, 'other:x': { every: 7 } } },
    bodyweight: [{ d: '2026-11-01', w: 80 }],
    measurements: [{ d: '2026-10-25', waist: 82, bpSys: 120, bpDia: 80, other: [{ id: 'x', value: 0 }] }],
    workouts: [{ d: '2026-10-11', media: [photo] }],
  };
  // weight 7 days on, waist 14, photos 28: due. Blood pressure and the custom field are 14 days
  // past a 7-day item: they came back on days 10 and 13 and do again on day 16.
  assert.deepEqual(dueKeys(S, '2026-11-08').sort(), ['photos', 'waist', 'weight']);
  assert.deepEqual(dueKeys(S, '2026-11-10').sort(), ['other:x', 'pair:bp']);
  assert.deepEqual(dueKeys({ ...S, checkinReminder: { ...S.checkinReminder, on: false } }, '2026-11-08'), []);
  assert.equal(dueKind(['photos']), 'photos');
  assert.equal(dueKind(['waist']), 'measure');
  assert.equal(dueKind(['waist', 'photos']), 'both');
  assert.equal(dueKind([]), null);
});

test('settings keep their defaults and drop junk', () => {
  assert.deepEqual(reminderOf({ checkinReminder: { on: true, time: '25:00', items: { waist: { every: 0 }, hips: { every: 500 } } } }),
    { on: true, time: '07:30', items: { hips: { every: 90 } } });
});

test('the push speaks the profile language, de-CH without ß', () => {
  assert.equal(checkinPush('en', 'photos').tag, 'checkin');
  assert.ok(checkinPush('xx', 'both').body.length > 0);
  assert.ok(!/ß/.test(checkinPush('de-CH', 'measure').body + checkinPush('de-CH', 'measure').title));
});

test('api/checkin-copy.js matches the frontend strings (node scripts/build-checkin-copy.mjs)', async t => {
  if (!fs.existsSync(path.join(API, '..', 'frontend', 'src', 'lib', 'checkin-reminder.js'))) return t.skip('no frontend next to the api');
  const { buildCheckinCopy } = await import('../scripts/build-checkin-copy.mjs');
  assert.equal(fs.readFileSync(path.join(API, 'checkin-copy.js'), 'utf8'), await buildCheckinCopy(),
    'api/checkin-copy.js is out of date: run node scripts/build-checkin-copy.mjs in api/');
});
