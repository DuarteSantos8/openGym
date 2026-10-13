/* Apple Health readings, from raw samples to one reading per metric and day: what the web app reads
 * out of Health's own export (frontend/src/lib/health/apple-export.js) and what the server takes
 * from an iPhone Shortcut or the Health Auto Export app (POST /api/health/samples). One module so both fold the same way, give a
 * reading the same id whichever way it came in, and never count a day twice:
 *
 *   - a body reading (weight, body fat, lean mass, BMI, height) is itself, keyed by its type and
 *     start time in ms
 *   - a day's total (steps, distance, active and resting energy) is keyed by its type and day; two
 *     sources on one day (an iPhone and a Watch counting the same walk) give the larger total, not
 *     the two added up — the id is the one the iPhone app's HealthKit import gives that day too
 *   - heart rate is the day's mean with its lowest and highest; resting heart rate the day's mean
 *   - sleep is the asleep time of a night, overlapping spans of several sources merged first, on
 *     the day it ended
 *
 * Plain JavaScript with no imports, loadable by bare node (the server) and by Vite (the app).
 * Values arrive in whatever unit the phone used and leave in the health area's canonical units
 * (frontend/src/lib/health/metrics.js): kg, %, cm, km, kcal, bpm, steps, minutes. */

export const APPLE_HEALTH = 'apple-health';
const LB_KG = 0.45359237;

export const FOLD = {
  weight: 'sample', bodyFat: 'sample', leanMass: 'sample', bmi: 'sample', height: 'sample',
  steps: 'sum', distance: 'sum', activeEnergy: 'sum', restingEnergy: 'sum',
  heartRate: 'range', restingHeartRate: 'range',
  sleep: 'sleep',
};

const mass = (v, u) => (/^lbs?$/i.test(u) ? v * LB_KG : /^g$/i.test(u) ? v / 1000 : v);
const percent = v => (v <= 1 ? v * 100 : v);
const length = (v, u) => (u === 'm' ? v * 100 : u === 'mm' ? v / 10 : u === 'in' ? v * 2.54 : u === 'ft' ? v * 30.48 : v);
const distance = (v, u) => (u === 'mi' ? v * 1.609344 : u === 'm' ? v / 1000 : v);
const energy = (v, u) => (u === 'kJ' ? v / 4.184 : v);
const TO = {
  weight: mass, leanMass: mass, bodyFat: percent, height: length,
  distance, activeEnergy: energy, restingEnergy: energy,
};
/** A value in `unit` as the metric's canonical number. */
export const canonical = (type, v, unit = '') => (TO[type] ? TO[type](v, String(unit || '').trim()) : v);

const round = (n, dec) => { const f = 10 ** dec; return Math.round(n * f) / f; };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A time as the phone wrote it, with the day it belongs to as written there (its local day):
 * ISO 8601 ("2026-10-12T07:30:00+02:00", what a Shortcut's Format Date gives), Health's export
 * format ("2026-10-12 07:30:00 +0200"), or a bare day. { ms, d } or null.
 */
export function phoneTime(s) {
  const str = String(s == null ? '' : s).trim();
  let m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(str);
  if (m) {
    const ms = Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
    return Number.isFinite(ms) ? { ms, d: m[1] } : null;
  }
  m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(str);
  if (!m) return null;
  if (!m[2]) { const ms = Date.parse(m[1] + 'T12:00:00Z'); return Number.isFinite(ms) ? { ms, d: m[1] } : null; }
  const ms = Date.parse(str.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? { ms, d: m[1] } : null;
}

/**
 * The folding state. add() takes one raw sample — { type, v, unit, start, end?, source?, asleep? }
 * with `start`/`end` as the phone wrote them — and readings() gives what came of them, in the shape
 * frontend/src/lib/health/records.js imports: { type, v, t, d, sid, src, lo?, hi? }.
 * `since` (YYYY-MM-DD) drops what is older. Returns false for a sample it could not use.
 */
export function createFolder({ since = '', src = APPLE_HEALTH } = {}) {
  const samples = new Map();
  const sums = new Map();
  const ranges = new Map();
  const sleep = [];
  let used = 0;

  function add({ type, v, unit, start, end, source = '', asleep = true, lo, hi }) {
    const fold = FOLD[type];
    if (!fold) return false;
    const a = phoneTime(start);
    if (!a || a.d < since) return false;
    if (fold === 'sleep') {
      const b = phoneTime(end);
      if (!asleep || !b || b.ms <= a.ms) return false;
      sleep.push([a.ms, b.ms, b.d]);
      used++;
      return true;
    }
    const n = canonical(type, Number(v), unit);
    if (!Number.isFinite(n)) return false;
    used++;
    if (fold === 'sample') {
      const sid = `${type}:${a.ms}`;
      samples.set(sid, { type, v: round(n, 3), t: a.ms, d: a.d, sid, src });
    } else if (fold === 'sum') {
      const key = `${type}|${a.d}`;
      let bySrc = sums.get(key);
      if (!bySrc) sums.set(key, bySrc = new Map());
      bySrc.set(source, (bySrc.get(source) || 0) + n);
    } else {
      const key = `${type}|${a.d}`;
      const r = ranges.get(key) || { n: 0, sum: 0, lo: Infinity, hi: -Infinity };
      // A point that is itself a summary (Health Auto Export's Min/Avg/Max) brings its own range.
      r.n++; r.sum += n; r.lo = Math.min(r.lo, Number.isFinite(lo) ? lo : n); r.hi = Math.max(r.hi, Number.isFinite(hi) ? hi : n);
      ranges.set(key, r);
    }
    return true;
  }

  function readings() {
    const out = [...samples.values()];
    // A day's reading sits at noon UTC of that day: the same instant on the server and on any phone.
    const noon = d => Date.parse(d + 'T12:00:00Z');
    for (const [key, bySrc] of sums) {
      const [type, d] = key.split('|');
      const v = Math.max(...bySrc.values());
      if (v > 0) out.push({ type, v: round(v, type === 'steps' ? 0 : 2), t: noon(d), d, sid: `${type}:${d}`, src });
    }
    for (const [key, r] of ranges) {
      const [type, d] = key.split('|');
      out.push({ type, v: round(r.sum / r.n, 1), t: noon(d), d, sid: `${type}:${d}`, src,
        ...(type === 'heartRate' ? { lo: Math.round(r.lo), hi: Math.round(r.hi) } : {}) });
    }
    sleep.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const s of sleep) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) { if (s[1] > last[1]) { last[1] = s[1]; last[2] = s[2]; } } else merged.push([...s]);
    }
    const nights = new Map();
    for (const [a, b, d] of merged) {
      const night = nights.get(d) || { min: 0, end: 0 };
      night.min += (b - a) / 60000;
      night.end = Math.max(night.end, b);
      nights.set(d, night);
    }
    for (const [d, night] of nights) if (night.min >= 1) out.push({ type: 'sleep', v: Math.round(night.min), t: night.end, d, sid: `sleep:${d}`, src });
    return out;
  }

  return { add, readings, count: () => used };
}

/* ---------- what an iPhone Shortcut sends ---------- */

export const MAX_SAMPLES = 20000;
// A Shortcut joins a list into text with new lines, or sends a real list: both are taken.
const listOf = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : v == null ? [] : [v])
  .map(x => (typeof x === 'string' ? x.trim() : x)).filter(x => x !== '' && x != null);
// "80,5" from a phone set to a comma-decimal language is 80.5.
const number = x => Number(typeof x === 'string' ? x.replace(/\s/g, '').replace(',', '.') : x);

/**
 * The readings in a Shortcut's request body:
 *   { metrics: { <type>: { values, dates, unit? } , sleep: { starts, ends, values? } } }
 * `values` and `dates` are parallel lists (or the same as text, one per line); a day's total for
 * steps, distance and energy is one value per day (the Shortcut's "Group by Day"). Sleep is the
 * spans of the night, with `values` the sleep stage of each (in-bed and awake spans are left out).
 * Returns { readings, used, skipped } or { error }.
 */
export function readingsFromShortcut(body, { since = '' } = {}) {
  const metrics = body && typeof body === 'object' && body.metrics && typeof body.metrics === 'object' ? body.metrics : null;
  if (!metrics) return { error: 'metrics required' };
  const folder = createFolder({ since });
  let total = 0, skipped = 0;
  for (const [type, m] of Object.entries(metrics)) {
    if (!FOLD[type] || !m || typeof m !== 'object') { skipped++; continue; }
    if (type === 'sleep') {
      const starts = listOf(m.starts), ends = listOf(m.ends), stages = listOf(m.values);
      total += starts.length;
      if (total > MAX_SAMPLES) return { error: 'too many samples' };
      starts.forEach((s, i) => {
        const stage = String(stages[i] ?? '').toLowerCase();
        const asleep = !/in ?bed|awake|letto|sveglio|bett|wach|lit|éveill|cama|despiert/.test(stage);
        if (!folder.add({ type, start: s, end: ends[i], asleep })) skipped++;
      });
      continue;
    }
    const values = listOf(m.values), dates = listOf(m.dates);
    total += values.length;
    if (total > MAX_SAMPLES) return { error: 'too many samples' };
    values.forEach((v, i) => {
      if (!folder.add({ type, v: number(v), unit: m.unit, start: dates[i], source: 'shortcut' })) skipped++;
    });
  }
  return { readings: folder.readings(), used: folder.count(), skipped };
}

/* ---------- what Health Auto Export sends ---------- */

// Health Auto Export, an iPhone app, posts Apple Health on a schedule (its "REST API" automation):
//   { data: { metrics: [{ name, units, data: [point…] }], workouts, … } }
// A point is { qty, date, source? } with `date` as "yyyy-MM-dd HH:mm:ss Z"; heart rate is
// { Min, Avg, Max, date }; sleep is a summarized night { date, totalSleep (or asleep, core, deep,
// rem), sleepEnd, … } in `units` (hours), or, with Summarize Data off, single stages { startDate,
// endDate, value }. Names are matched without case or punctuation ("weight_&_body_mass").
const AUTO_EXPORT = {
  weightbodymass: 'weight', bodymass: 'weight', weight: 'weight', bodyfatpercentage: 'bodyFat',
  leanbodymass: 'leanMass', bodymassindex: 'bmi', height: 'height', stepcount: 'steps',
  walkingrunningdistance: 'distance', activeenergy: 'activeEnergy', basalenergyburned: 'restingEnergy',
  restingenergy: 'restingEnergy', heartrate: 'heartRate', restingheartrate: 'restingHeartRate',
  sleepanalysis: 'sleep',
};
export const isAutoExport = body => !!body && typeof body === 'object' && !!body.data && Array.isArray(body.data.metrics);
// A number, or null when there is none (Number(null) would be a 0).
const finite = x => { if (x == null || x === '') return null; const n = number(x); return Number.isFinite(n) ? n : null; };

/** The readings in a Health Auto Export request body: { readings, used, skipped } or { error }. */
export function readingsFromAutoExport(body, { since = '' } = {}) {
  if (!isAutoExport(body)) return { error: 'metrics required' };
  const folder = createFolder({ since });
  const nights = new Map();
  let total = 0, skipped = 0, used = 0;
  for (const m of body.data.metrics) {
    const type = AUTO_EXPORT[String(m && m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')];
    const points = m && Array.isArray(m.data) ? m.data : [];
    total += points.length;
    if (total > MAX_SAMPLES) return { error: 'too many samples' };
    if (!type) { skipped += points.length; continue; }
    for (const p of points) {
      if (!p || typeof p !== 'object') { skipped++; continue; }
      let ok;
      if (type === 'sleep' && p.startDate != null) {
        ok = folder.add({ type, start: p.startDate, end: p.endDate, asleep: !/in ?bed|awake/i.test(String(p.value || '')) });
      } else if (type === 'sleep') {
        // A summarized night, on the day it ended: its total sleep, in minutes.
        const slept = finite(p.totalSleep) ?? ['asleep', 'core', 'deep', 'rem'].reduce((n, k) => n + (finite(p[k]) || 0), 0);
        const min = /^min/i.test(String(m.units || '')) ? slept : slept * 60;
        const at = phoneTime(p.sleepEnd) || phoneTime(p.date);
        ok = !!at && at.d >= since && min >= 1 && min <= 1440;
        if (ok) { const cur = nights.get(at.d); if (!cur || min > cur.v) nights.set(at.d, { v: Math.round(min), t: at.ms }); used++; }
      } else if (type === 'heartRate' && p.qty == null) {
        ok = finite(p.Avg) != null && folder.add({ type, v: finite(p.Avg), lo: finite(p.Min), hi: finite(p.Max), start: p.date, source: String(p.source || '') });
      } else {
        ok = finite(p.qty) != null && folder.add({ type, v: finite(p.qty), unit: m.units, start: p.date, source: String(p.source || '') });
      }
      if (!ok) skipped++;
    }
  }
  const readings = folder.readings();
  const have = new Set(readings.map(r => r.sid));
  for (const [d, n] of nights) if (!have.has(`sleep:${d}`)) readings.push({ type: 'sleep', v: n.v, t: n.t, d, sid: `sleep:${d}`, src: APPLE_HEALTH });
  return { readings, used: folder.count() + used, skipped };
}

/* ---------- into a stored profile ---------- */

// The ranges a reading of each metric may have, in canonical units — the same as the app's
// (frontend/src/lib/health/metrics.js): a scale that reports a body fat of 0 % measured nothing.
const RANGE = {
  weight: [1, 700], bmi: [5, 150], bodyFat: [1, 80], leanMass: [1, 400], height: [50, 260],
  steps: [0, 200000], distance: [0, 500], activeEnergy: [0, 20000], restingEnergy: [0, 10000],
  heartRate: [20, 250], restingHeartRate: [20, 200], sleep: [0, 1440],
};
const UNIT = {
  weight: 'kg', bmi: '', bodyFat: '%', leanMass: 'kg', height: 'cm', steps: 'count', distance: 'km',
  activeEnergy: 'kcal', restingEnergy: 'kcal', heartRate: 'bpm', restingHeartRate: 'bpm', sleep: 'min',
};
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);

/**
 * Folds readings into a stored profile `S` (mutated): new readings added, changed ones (a day's
 * steps that grew) updated, readings the user deleted (S.deleted.health) left out, everything the
 * user typed left alone; the weights fill the weigh-in log on days without one, in the profile's
 * unit, never over a weigh-in the user typed. Every record it writes is stamped `now`, which the
 * caller sets after every stamp the profile carries. The same rules as the app's own import
 * (frontend/src/lib/health/records.js importRecords and bridgeWeights; health-parity.test.js).
 * Returns { added, updated }.
 */
export function mergeReadings(S, readings, now) {
  const health = list(S.health).slice();
  const at = new Map();
  health.forEach((r, i) => { if (isMap(r) && r.sid != null && r.src !== 'manual') at.set(`${r.src}|${r.type}|${r.sid}`, i); });
  const gone = isMap(S.deleted) && isMap(S.deleted.health) ? S.deleted.health : {};
  let added = 0, updated = 0;
  const weights = [];
  for (const raw of list(readings)) {
    const range = RANGE[raw?.type];
    const v = Number(raw?.v), t = Number(raw?.t);
    if (!range || !Number.isFinite(v) || !Number.isFinite(t) || v < range[0] || v > range[1] || !ISO_DAY.test(raw.d || '') || raw.sid == null) continue;
    const src = String(raw.src || APPLE_HEALTH), sid = String(raw.sid);
    const key = `${src}|${raw.type}|${sid}`;
    const i = at.get(key);
    const fields = { v, t, d: raw.d, ...(raw.lo != null ? { lo: Number(raw.lo) } : {}), ...(raw.hi != null ? { hi: Number(raw.hi) } : {}) };
    if (i != null) {
      const cur = health[i];
      if (cur.v === fields.v && cur.t === fields.t && cur.d === fields.d && (cur.lo ?? null) === (fields.lo ?? null) && (cur.hi ?? null) === (fields.hi ?? null)) continue;
      health[i] = { ...cur, ...fields, _ts: now };
      updated++;
    } else {
      const id = `${src}:${sid}`;
      if (Number(gone[id]) > 0) continue;
      at.set(key, health.length);
      health.push({ id, type: raw.type, ...fields, u: UNIT[raw.type], src, sid, c: now, _ts: now });
      added++;
    }
    if (raw.type === 'weight') weights.push({ ...fields, src });
  }
  health.sort((a, b) => (Number(a?.t) || 0) - (Number(b?.t) || 0) || (String(a?.id) < String(b?.id) ? -1 : 1));
  S.health = health;
  // Weigh-ins: the latest reading of each day, on a day the log has none or one this source filled.
  const latest = new Map();
  for (const w of weights) { const cur = latest.get(w.d); if (!cur || w.t >= cur.t) latest.set(w.d, w); }
  if (latest.size) {
    const unit = S.unit === 'lb' ? 'lb' : 'kg';
    const log = list(S.bodyweight).slice();
    let changed = false;
    for (const [d, w] of latest) {
      const val = Math.round((unit === 'lb' ? w.v / LB_KG : w.v) * 10) / 10;
      const i = log.findIndex(b => b?.d === d);
      if (i < 0) { log.push({ d, w: val, t: now, src: w.src }); changed = true; }
      else if (log[i].src === w.src && log[i].w !== val) { log[i] = { ...log[i], w: val, t: now }; changed = true; }
    }
    if (changed) S.bodyweight = log.sort((a, b) => (a.d < b.d ? -1 : 1));
  }
  return { added, updated };
}
