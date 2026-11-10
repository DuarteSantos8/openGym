// node --test contrib/cloudflare/garmin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeGarmin, iso, clockOf, fromFitnessAge, fromSteps, fromSummaries, fromSleep, fromHrv, fromActivity, mergeInto, BASE, fromBodyBattery, needOf, minuteIn, cleanPrefs, sharedOf } from './garmin.js';

const DAY = 86400e3;
const NOW = Date.parse('2026-11-10T09:00:00Z');

test('keeps the useful fields of each answer', () => {
  assert.deepEqual(fromSummaries({ data: [{ calendarDate: '2026-11-09', movement: { steps: { value: 9000, goal: 8000 } },
    calories: { burnedTotal: 2600, burnedActive: 700 }, heartRate: { restingValue: 52 }, bodyBattery: { maxValue: 90, minValue: 20, latestValue: 35 } }] }),
  { '2026-11-09': { steps: 9000, stepGoal: 8000, kcal: 2600, kcalActive: 700, restHr: 52, bbMax: 90, bbMin: 20, bbNow: 35 } });
  assert.deepEqual(fromSleep([{ calendarDate: '2026-11-10', sleepTimeSeconds: 27000, deepSleepSeconds: 5400, sleepScores: { overall: { value: 81, qualifierKey: 'GOOD' } } }]),
    { '2026-11-10': { sleepSec: 27000, deepSec: 5400, sleepScore: 81, sleepQ: 'GOOD' } });
  assert.deepEqual(fromHrv({ hrvSummaries: [{ calendarDate: '2026-11-10', lastNightAvg: 48, status: 'BALANCED', baseline: { balancedLow: 40, balancedUpper: 55 } }] }),
    { '2026-11-10': { hrv: 48, hrvStatus: 'BALANCED', hrvLow: 40, hrvHigh: 55 } });
  assert.deepEqual(fromActivity({ activityId: 7, activityName: 'Run', activityType: { typeKey: 'running' }, distance: 5000, duration: 1500, calories: 400, averageHR: 150 }),
    { id: 7, name: 'Run', type: 'running', dist: 5000, dur: 1500, kcal: 400, hr: 150 });
  assert.deepEqual(fromSteps([{ calendarDate: '2026-11-09', totalSteps: 9000, stepGoal: 8000, totalDistance: 7000 }]), { '2026-11-09': { steps: 9000, stepGoal: 8000, distM: 7000 } });
  assert.deepEqual(fromSummaries(null), {});
  assert.equal(clockOf(Date.UTC(2026, 10, 9, 23, 12)), 23 * 60 + 12);
  assert.equal(clockOf('2026-11-10T06:45:00.0'), 6 * 60 + 45);
  assert.equal(clockOf(null), undefined);
  assert.deepEqual(fromSleep([{ calendarDate: '2026-11-10', sleepTimeSeconds: 100, averageRespirationValue: 14.5, sleepStartTimestampLocal: Date.UTC(2026, 10, 9, 23, 0) }]),
    { '2026-11-10': { sleepSec: 100, sleepResp: 14.5, bed: 1380 } });
  assert.deepEqual(fromFitnessAge({ fitnessAge: 31.2, chronologicalAge: 38, components: { rhr: { value: 52 }, vigorousMinutesAvg: { value: 40, targetValue: 75, potentialAge: 29, priority: 1 } } }),
    { age: 31.2, real: 38, levers: { vigMin: { value: 40, target: 75, age: 29, priority: 1 }, rhr: { value: 52 } } });
  assert.deepEqual(fromActivity({ activityId: 8, calories: 300, bmrCalories: 60, hrTimeInZone_2: 600.4, hrTimeInZone_4: 120 }),
    { id: 8, kcal: 300, bmr: 60, zones: [0, 600, 0, 120, 0] });
  // 23:30 UTC is already the next day in Amsterdam.
  assert.equal(iso(Date.parse('2026-11-09T23:30:00Z'), 'Europe/Amsterdam'), '2026-11-10');
  assert.equal(iso(Date.parse('2026-11-09T23:30:00Z'), null), '2026-11-09');
  assert.equal(fromActivity({}), null);
});

test('merging keeps older fields, prunes old days, newest activity first', () => {
  const rec = { days: { '2026-01-01': { steps: 1 }, '2026-11-09': { steps: 5, restHr: 50 } }, acts: [{ id: 1, start: '2026-11-01 08:00:00' }] };
  mergeInto(rec, [{ '2026-11-09': { steps: 6 } }, { '2026-11-09': { sleepSec: 100 } }], [{ id: 2, start: '2026-11-09 07:00:00' }, null], NOW);
  assert.deepEqual(rec.days, { '2026-11-09': { steps: 6, restHr: 50, sleepSec: 100 } });
  assert.deepEqual(rec.acts.map(a => a.id), [2, 1]);
});

test('connect, read, sync on the hour, disconnect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-'));
  fs.writeFileSync(path.join(dir, 'secret'), 'x'.repeat(64));
  let now = NOW;
  const calls = [];
  const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: NOW / 1000 + 86400 })).toString('base64url') + '.s';
  const fetchFn = async (url, init) => {
    calls.push(url);
    if (url === BASE + '/personalapitoken-service/personal-api/personal-api-key/token') {
      return init.headers.Authorization === 'ApiKey good-key-123' ? new Response(jwt) : new Response('', { status: 401 });
    }
    assert.equal(init.headers.Authorization, 'Bearer ' + jwt);
    if (url.includes('dailysummaries')) return Response.json({ data: [{ calendarDate: '2026-11-10', movement: { steps: { value: 1234 } } }] });
    if (url.includes('activities/search')) return Response.json([{ activityId: 9, activityType: { typeKey: 'running' }, startTimeLocal: '2026-11-10 07:00:00', calories: 300 }]);
    return new Response('', { status: 500 });
  };
  const g = makeGarmin({ dataDir: dir, fetchFn, now: () => now });
  const req = (method, p, body) => new Request('https://gym.example' + p, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

  assert.equal((await g.handle(req('PUT', '/api/garmin', { key: 'wrong-key-123' }), 'u1')).status, 400);
  const put = await (await g.handle(req('PUT', '/api/garmin', { key: 'good-key-123', days: 90 }), 'u1')).json();
  assert.equal(put.connected, true);
  assert.equal(put.keyExp, NOW + 90 * DAY);
  assert.deepEqual(put.days, [{ date: '2026-11-10', steps: 1234 }]);
  assert.equal(put.acts[0].kcal, 300);
  assert.equal(put.error, null);   // sleep and HRV failing alone is not an error
  // The key is sealed on disk, not readable.
  assert.ok(!fs.readFileSync(path.join(dir, 'garmin', 'u1.json'), 'utf8').includes('good-key-123'));
  // Another account sees nothing.
  assert.deepEqual(await (await g.handle(req('GET', '/api/garmin'), 'u2')).json(), { connected: false });

  calls.length = 0;
  await g.tick();
  assert.equal(calls.length, 0, 'pulled less than an hour ago');
  now += 61 * 60e3;
  await g.tick();
  assert.ok(calls.some(u => u.includes('dailysummaries')));
  assert.ok(!calls.some(u => u.includes('token')), 'the token is reused');

  assert.equal((await g.handle(req('DELETE', '/api/garmin'), 'u1')).status, 200);
  assert.deepEqual(await (await g.handle(req('GET', '/api/garmin'), 'u1')).json(), { connected: false });
});

test('body battery curve, sleep need, exercise sets', () => {
  const t0 = Date.parse('2026-11-10T06:00:00Z');   // 07:00 in Zurich
  const bb = fromBodyBattery([{ date: '2026-11-10',
    bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' }, { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }],
    bodyBatteryValuesArray: [[t0, 80], [t0 + 5 * 60e3, 79], [t0 + 20 * 60e3, 75]],
    bodyBatteryActivityEvent: [{ eventType: 'ACTIVITY', eventStartTimeGmt: '2026-11-10T16:00:00.0', durationInMilliseconds: 3600e3, bodyBatteryImpact: -12 }] }], 'Europe/Zurich');
  assert.deepEqual(bb['2026-11-10'], { bb15: [[420, 79], [435, 75]], bbEvents: [{ type: 'ACTIVITY', start: 1020, dur: 3600, impact: -12 }] });
  assert.equal(minuteIn(t0, 'Europe/Zurich'), 420);
  assert.deepEqual(needOf({ baseline: 480, actual: 500, recommendedBedtimeStartMins: 1350 }), { min: 500, bedFrom: 1350 });
  assert.equal(needOf(null), undefined);
  assert.equal(fromSleep([{ calendarDate: '2026-11-10', sleepTimeSeconds: 1, sleepNeed: { baseline: 470 } }])['2026-11-10'].sleepNeed, 470);
  assert.deepEqual(fromActivity({ activityId: 1, summarizedExerciseSets: [{ category: 'BENCH_PRESS', sets: 3, reps: 24, volume: 1800 }] }).exSets, [{ cat: 'BENCH_PRESS', sets: 3, reps: 24, vol: 1800 }]);
});

test('settings keep only what is known, sharing shows only what was picked', () => {
  assert.deepEqual(cleanPrefs({ cards: ['ready', 'x y', 3], sleepMin: '480', push: { morning: 1 }, share: { with: ['u2', '../x'], what: ['steps', 'secret'] }, evil: 1 }),
    { cards: ['ready'], sleepMin: 480, push: { morning: true, expiry: true }, share: { with: ['u2'], what: ['steps'] } });
  const rec = { tz: 'UTC', days: { '2026-11-10': { steps: 5000, sleepSec: 27000, imMod: 10, imVig: 5 }, '2026-11-09': { steps: 7000 } } };
  assert.deepEqual(sharedOf(rec, ['steps', 'im'], NOW), { steps: 5000, weekSteps: 12000, weekIm: 20 });
});

test('partners, settings and the morning push', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-'));
  fs.writeFileSync(path.join(dir, 'secret'), 'x'.repeat(64));
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b64u = b => Buffer.from(b).toString('base64url');
  fs.writeFileSync(path.join(dir, 'vapid.json'), JSON.stringify({ publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateKey: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d }));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Peter' }, { id: 'u2', name: 'Valeria' }],
    subs: [{ userId: 'u1', endpoint: 'https://push.example/1', keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64u(new Uint8Array(16)) } }] }));
  const pushed = [];
  const jwt = 'h.' + Buffer.from(JSON.stringify({ exp: NOW / 1000 + 86400 })).toString('base64url') + '.s';
  const fetchFn = async (url, init) => {
    if (url.startsWith('https://push.example')) { pushed.push(init.headers.Authorization); return new Response('', { status: 201 }); }
    if (url.includes('token')) return new Response(jwt);
    if (url.includes('dailySleepSummaries')) return Response.json([{ calendarDate: '2026-11-10', sleepTimeSeconds: 20000, sleepScores: { overall: { value: 50 } } }]);
    if (url.includes('dailysummaries')) return Response.json({ data: [{ calendarDate: '2026-11-10', bodyBattery: { maxValue: 30 }, movement: { steps: { value: 4000 } } }] });
    return Response.json([]);
  };
  let now = NOW;
  const g = makeGarmin({ dataDir: dir, fetchFn, now: () => now, subject: 'mailto:a@b.c' });
  const req = (method, p, body) => new Request('https://gym.example' + p, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  await g.handle(req('PUT', '/api/garmin', { key: 'good-key-123', days: 365 }), 'u1');
  await g.handle(req('PUT', '/api/garmin', { key: 'good-key-456' }), 'u2');
  const v = await (await g.handle(req('PUT', '/api/garmin/prefs', { push: { morning: true }, hidden: ['zones'] }), 'u1')).json();
  assert.deepEqual(v.prefs, { push: { morning: true, expiry: true }, hidden: ['zones'] });
  assert.deepEqual(v.partners, []);
  assert.deepEqual(v.people, [{ uid: 'u2', name: 'Valeria' }]);
  await g.handle(req('PUT', '/api/garmin/prefs', { share: { with: ['u1'], what: ['steps'] } }), 'u2');
  assert.deepEqual((await (await g.handle(req('GET', '/api/garmin'), 'u1')).json()).partners, [{ uid: 'u2', name: 'Valeria', steps: 4000, weekSteps: 4000 }]);

  await g.tick();   // 09:00 UTC, sleep 50 and battery 30: an easy day
  assert.equal(pushed.length, 1);
  assert.match(pushed[0], /^vapid t=/);
  await g.tick();
  assert.equal(pushed.length, 1, 'once a morning');
  now += 360 * DAY;   // a week before the key runs out
  await g.notify('u1', JSON.parse(fs.readFileSync(path.join(dir, 'garmin', 'u1.json'), 'utf8')));
  assert.equal(pushed.length, 2);
});
