// node --test contrib/cloudflare/garmin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeGarmin, iso, clockOf, fromFitnessAge, fromSteps, fromSummaries, fromSleep, fromHrv, fromActivity, mergeInto, BASE } from './garmin.js';

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
