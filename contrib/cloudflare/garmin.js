// /api/garmin: each account's own Garmin Connect data, read with that person's Personal API key
// (connect.garmin.com/app/settings/personalApiToken; docs at
// developer.garmin.com/gc-developer-program/personal/). Read only: openGym never writes to Garmin.
//
//   GET    /api/garmin        -> status + the last 90 days (sleep, HRV, body battery, steps, kcal...)
//                                and the last 100 activities
//   PUT    /api/garmin        { key, days? } -> checks the key with Garmin, keeps it, pulls 28 days
//   POST   /api/garmin/sync   -> pulls the last 7 days now
//   GET    /api/garmin/probe  -> what every endpoint answers for this key (field names, no values)
//   DELETE /api/garmin        -> forgets the key and everything pulled
//
// Lives outside api/ on purpose (upstream merges): worker.js routes /api/garmin* here after the api
// itself said who is signed in (GET /api/me). One file per account in DATA_DIR/garmin/, so the
// object's flush keeps it in D1 like the rest. The key is sealed with the api's own scheme
// (api/integrations/crypto.js: AES-GCM, key derived from DATA_DIR/secret, bound to the account).
// The cron (worker.js /__wake) pulls the last 3 days for every account once an hour.
import fs from 'node:fs';
import path from 'node:path';
import { deriveKey, seal, open } from '../../api/integrations/crypto.js';

export const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN = '/personalapitoken-service/personal-api/personal-api-key/token';
const HOUR = 3600e3, DAY = 86400e3;
const FIRST_DAYS = 28, MANUAL_DAYS = 7, TICK_DAYS = 3, KEEP_DAYS = 90, KEEP_ACTS = 100;

const iso = ms => new Date(ms).toISOString().slice(0, 10);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/* ---------- what is kept from each answer (field names from Garmin's own OpenAPI document) ---------- */

/** /usersummary-service/v2/dailysummaries -> { date: {...} } */
export function fromSummaries(body) {
  const out = {};
  for (const d of Array.isArray(body?.data) ? body.data : []) {
    if (!d?.calendarDate) continue;
    const st = d.movement?.steps, c = d.calories, hr = d.heartRate, im = d.intensityMinutes, s = d.stress, bb = d.bodyBattery;
    out[d.calendarDate] = clean({
      steps: num(st?.value), stepGoal: num(st?.goal), distM: num(st?.distanceInMeters),
      floors: num(d.movement?.floorsAscended?.value),
      kcal: num(c?.burnedTotal), kcalActive: num(c?.burnedActive), kcalRest: num(c?.burnedResting),
      restHr: num(hr?.restingValue), minHr: num(hr?.minValue), maxHr: num(hr?.maxValue),
      imMod: num(im?.moderate), imVig: num(im?.vigorous), imGoal: num(im?.goal),
      stress: num(s?.avgLevel), stressQ: s?.qualifier || undefined,
      bbMax: num(bb?.maxValue), bbMin: num(bb?.minValue), bbNow: num(bb?.latestValue ?? bb?.endOfDayValue),
      bbCharged: num(bb?.chargedValue), bbDrained: num(bb?.drainedValue),
      spo2: num(d.pulseOx?.avgValue), resp: num(d.respiration?.avgValue),
    });
  }
  return out;
}

/** /usersummary-service/stats/steps/daily/{from}/{to}: steps live here, not in the v2 summary. */
export function fromSteps(body) {
  const out = {};
  for (const d of Array.isArray(body) ? body : []) {
    if (d?.calendarDate) out[d.calendarDate] = clean({ steps: num(d.totalSteps), stepGoal: num(d.stepGoal), distM: num(d.totalDistance) });
  }
  return out;
}

/** /sleep-service/sleep/dailySleepSummariesByDate -> { date: {...} } (the date is the wake-up day) */
export function fromSleep(body) {
  const out = {};
  for (const d of Array.isArray(body) ? body : []) {
    if (!d?.calendarDate || !num(d.sleepTimeSeconds)) continue;
    const overall = d.sleepScores?.overall;
    out[d.calendarDate] = clean({
      sleepSec: num(d.sleepTimeSeconds), deepSec: num(d.deepSleepSeconds), lightSec: num(d.lightSleepSeconds),
      remSec: num(d.remSleepSeconds), awakeSec: num(d.awakeSleepSeconds),
      sleepScore: num(overall?.value), sleepQ: overall?.qualifierKey || undefined,
      sleepHr: num(d.avgHeartRate), sleepStress: num(d.avgSleepStress),
    });
  }
  return out;
}

/** /hrv-service/hrv/daily/{from}/{to} -> { date: {...} } */
export function fromHrv(body) {
  const out = {};
  for (const d of Array.isArray(body?.hrvSummaries) ? body.hrvSummaries : []) {
    if (!d?.calendarDate) continue;
    out[d.calendarDate] = clean({
      hrv: num(d.lastNightAvg), hrvWeek: num(d.weeklyAvg), hrvStatus: d.status || undefined,
      hrvLow: num(d.baseline?.balancedLow), hrvHigh: num(d.baseline?.balancedUpper),
    });
  }
  return out;
}

/** One entry of /activitylist-service/activities/search/activities. */
export function fromActivity(a) {
  if (!a?.activityId) return null;
  return clean({
    id: a.activityId, name: a.activityName || undefined, type: a.activityType?.typeKey || undefined,
    start: a.startTimeLocal || undefined, dur: num(a.duration), dist: num(a.distance), kcal: num(a.calories),
    hr: num(a.averageHR), maxHr: num(a.maxHR), elev: num(a.elevationGain), speed: num(a.averageSpeed),
    te: num(a.aerobicTrainingEffect), ana: num(a.anaerobicTrainingEffect), load: num(a.activityTrainingLoad),
    label: a.trainingEffectLabel || undefined, vo2: num(a.vO2MaxValue), steps: num(a.steps),
    sets: num(a.activeSets), reps: num(a.totalReps), bb: num(a.differenceBodyBattery),
  });
}

/** Folds new days and activities into a stored record (mutated), pruned to what is kept. */
export function mergeInto(rec, parts, acts, now) {
  rec.days = rec.days || {};
  for (const part of parts) for (const [date, v] of Object.entries(part)) rec.days[date] = { ...rec.days[date], ...v };
  const oldest = iso(now - KEEP_DAYS * DAY);
  for (const date of Object.keys(rec.days)) if (date < oldest) delete rec.days[date];
  const byId = new Map((rec.acts || []).map(a => [a.id, a]));
  for (const a of acts) if (a) byId.set(a.id, a);
  rec.acts = [...byId.values()].sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))).slice(0, KEEP_ACTS);
  return rec;
}

/** The field paths in an answer that hold something (for the probe): the shape, never the values. */
export function shapeOf(v, prefix = '', out = new Set(), depth = 0) {
  if (out.size >= 80 || depth > 4 || v == null) return out;
  if (Array.isArray(v)) { if (v.length) shapeOf(v[0], prefix + '[]', out, depth + 1); else out.add(prefix + '[] (empty)'); return out; }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) shapeOf(x, prefix ? prefix + '.' + k : k, out, depth + 1); return out; }
  out.add(prefix);
  return out;
}

/* ---------- the service ---------- */

export function makeGarmin({ dataDir, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
  const dir = path.join(dataDir, 'garmin');
  const tokens = new Map();   // uid -> { tok, exp }: 24 h each, memory only
  let box = null;
  const sealKey = () => (box ||= deriveKey(fs.readFileSync(path.join(dataDir, 'secret'), 'utf8').trim()));
  const fileOf = uid => path.join(dir, String(uid).replace(/[^\w-]/g, '_') + '.json');
  const load = uid => { try { return JSON.parse(fs.readFileSync(fileOf(uid), 'utf8')); } catch { return null; } };
  const save = (uid, rec) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(uid), JSON.stringify(rec)); };
  const keyOf = (uid, rec) => (rec?.key ? open(sealKey(), rec.key, 'garmin:' + uid) : null);

  async function call(url, init, ms = 15000) {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw Object.assign(new Error(`Garmin answered ${res.status}`), { status: res.status });
    return res;
  }

  async function token(uid, key, fresh = false) {
    const have = tokens.get(uid);
    if (!fresh && have && have.exp - now() > HOUR) return have.tok;
    const res = await call(BASE + TOKEN, { method: 'POST', headers: { Authorization: 'ApiKey ' + key, Accept: '*/*' } });
    const tok = (await res.text()).trim();
    let exp = now() + 23 * HOUR;
    try { exp = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).exp * 1000 || exp; } catch { /* not a JWT we can read: assume a day */ }
    tokens.set(uid, { tok, exp });
    return tok;
  }

  async function get(tok, p, params) {
    const q = params ? '?' + new URLSearchParams(params) : '';
    const res = await call(BASE + p + q, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
    return res.status === 204 ? null : res.json();
  }

  async function sync(uid, days) {
    const rec = load(uid);
    const key = keyOf(uid, rec);
    if (!key) return rec;
    // ponytail: dates are UTC days; Garmin files by local day. The hourly 3-day pull covers the gap.
    const t = now(), from = iso(t - (days - 1) * DAY), to = iso(t);
    try {
      const tok = await token(uid, key);
      const [sum, sleep, hrv, acts, age, steps] = await Promise.allSettled([
        get(tok, '/usersummary-service/v2/dailysummaries', { startDate: from, endDate: to }),
        get(tok, '/sleep-service/sleep/dailySleepSummariesByDate', { startDate: from, endDate: to }),
        get(tok, `/hrv-service/hrv/daily/${from}/${to}`),
        get(tok, '/activitylist-service/activities/search/activities', { start: 0, limit: 100, startDate: from, endDate: to }),
        get(tok, `/fitnessage-service/fitnessage/v2/${to}`),
        get(tok, `/usersummary-service/stats/steps/daily/${from}/${to}`),
      ]);
      const val = r => (r.status === 'fulfilled' ? r.value : undefined);
      mergeInto(rec, [fromSummaries(val(sum)), fromSteps(val(steps)), fromSleep(val(sleep)), fromHrv(val(hrv))], (val(acts) || []).map(fromActivity), t);
      const fa = [].concat(val(age) || []).at(-1);
      if (fa?.fitnessAge) rec.fitnessAge = clean({ age: num(fa.fitnessAge), real: num(fa.chronologicalAge), best: num(fa.achievableFitnessAge) });
      const failed = [sum, sleep, hrv, acts].filter(r => r.status === 'rejected');
      if (failed.some(r => r.reason?.status === 401)) tokens.delete(uid);
      rec.error = failed.length === 4 ? failed[0].reason.message : null;
    } catch (e) {
      rec.error = e.status === 401 || e.status === 403 ? 'Garmin no longer accepts this key. Make a new one.' : e.message;
    }
    rec.lastSync = t;
    save(uid, rec);
    return rec;
  }

  const view = rec => (!rec?.key ? { connected: false } : {
    connected: true, keyExp: rec.keyExp || null, lastSync: rec.lastSync || null, error: rec.error || null,
    fitnessAge: rec.fitnessAge || null,
    days: Object.entries(rec.days || {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    acts: rec.acts || [],
  });

  async function probe(uid) {
    const key = keyOf(uid, load(uid));
    if (!key) return { connected: false };
    const tok = await token(uid, key);
    const t = now(), today = iso(t), week = iso(t - 6 * DAY);
    const list = await get(tok, '/activitylist-service/activities/search/activities', { start: 0, limit: 1 }).catch(() => []);
    const id = list?.[0]?.activityId;
    const ends = [
      ['/usersummary-service/v2/dailysummaries', { startDate: week, endDate: today }],
      ['/usersummary-service/usersummary/daily', { calendarDate: today }],
      ['/usersummary-service/stats/steps/daily/' + week + '/' + today],
      ['/usersummary-service/stats/stress/daily/' + week + '/' + today],
      ['/usersummary-service/stats/hydration/daily/' + week + '/' + today],
      ['/sleep-service/sleep/dailySleep', { date: today }],
      ['/sleep-service/sleep/dailySleepSummariesByDate', { startDate: week, endDate: today }],
      ['/hrv-service/hrv/' + today],
      ['/hrv-service/hrv/daily/' + week + '/' + today],
      ['/wellness-service/wellness/bodyBattery/reports/daily', { startDate: week, endDate: today }],
      ['/wellness-service/wellness/dailyHeartRate', { date: today }],
      ['/wellness-service/wellness/daily/spo2acclimation/' + today],
      ['/wellnessactivity-service/activity/summary/range/' + week + '/' + today],
      ['/activitylist-service/activities/search/activities', { start: 0, limit: 5 }],
      ...(id ? [['/activity-service/activity/' + id], ['/activity-service/activity/' + id + '/workouts']] : []),
      ['/biometric-service/heartRateZones/v2'],
      ['/fitnessage-service/fitnessage/v2/' + today],
      ['/weight-service/weight/range/' + week + '/' + today, { includeAll: 'true' }],
      ['/goal-service/goal/user/effective/weightgoal/' + week + '/' + today],
      ['/nutrition-service/food/logs/' + today],
      ['/periodichealth-service/menstrualcycle/summary/' + today],
      ['/userprofile-service/userprofile/settings'],
    ];
    // One at a time: twenty calls at once is not how a personal key is meant to be used.
    const out = [];
    for (const [p, params] of ends) {
      try { const body = await get(tok, p, params); out.push({ path: p, ok: true, fields: [...shapeOf(body)] }); }
      catch (e) { out.push({ path: p, ok: false, status: e.status || 0, error: e.message }); }
    }
    return { connected: true, endpoints: out };
  }

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

  /** One request from signed-in account `uid`. */
  async function handle(request, uid) {
    const { pathname } = new URL(request.url);
    const route = request.method + ' ' + pathname.replace(/\/$/, '');
    try {
      switch (route) {
        case 'GET /api/garmin': return json(view(load(uid)));
        case 'GET /api/garmin/probe': return json(await probe(uid));
        case 'POST /api/garmin/sync': return json(view(await sync(uid, MANUAL_DAYS)));
        case 'DELETE /api/garmin': fs.rmSync(fileOf(uid), { force: true }); tokens.delete(uid); return json({ connected: false });
        case 'PUT /api/garmin': {
          const body = await request.json().catch(() => ({}));
          const key = String(body?.key || '').trim();
          if (key.length < 10 || key.length > 2000 || /\s/.test(key)) return json({ error: 'That does not look like a Garmin API key.' }, 400);
          try { await token(uid, key, true); }
          catch (e) { return json({ error: e.status === 401 || e.status === 403 ? 'Garmin did not accept this key.' : 'Could not reach Garmin: ' + e.message }, 400); }
          const days = [30, 90, 180, 365].includes(Number(body.days)) ? Number(body.days) : null;
          save(uid, { ...load(uid), key: seal(sealKey(), key, 'garmin:' + uid), keyExp: days ? now() + days * DAY : null, error: null });
          return json(view(await sync(uid, FIRST_DAYS)));
        }
        default: return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      console.error('garmin:', route, e?.message);
      return json({ error: e.status === 401 ? 'Garmin no longer accepts this key. Make a new one.' : 'Garmin could not be reached.' }, 502);
    }
  }

  /** The cron: every account whose last pull is over an hour old gets its last 3 days. */
  async function tick() {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return; }
    for (const f of files) {
      const uid = f.slice(0, -5);
      const rec = load(uid);
      if (rec?.key && now() - (rec.lastSync || 0) >= HOUR) await sync(uid, TICK_DAYS).catch(e => console.error('garmin tick:', e?.message));
    }
  }

  return { handle, tick, sync };
}
