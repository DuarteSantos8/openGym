/* Apple Health readings, from raw samples to one reading per metric and day: what the web app reads
 * out of Health's own export (frontend/src/lib/health/apple-export.js), what the iPhone app reads
 * from HealthKit (frontend/src/lib/health/apple-health.js) and what the server takes from an
 * iPhone Shortcut or the Health Auto Export app (POST /api/health/samples). One module so all of
 * them fold the same way, give a reading the same id whichever way it came in, and never count a
 * day twice. How each kind of reading folds is its `kind` in catalogue.js:
 *
 *   - a body reading is itself, keyed by its type and start time in ms
 *   - a day's total (steps, energy, food; minutes of a category; how many times something
 *     happened) is keyed by its type and day; two sources on one day (an iPhone and a Watch
 *     counting the same walk) give the larger total, not the two added up
 *   - every other measurement is the day's mean (heart rate also its lowest and highest)
 *   - sleep is the asleep time of a night, overlapping spans of several sources merged first, on
 *     the day it ended
 *   - a symptom or a flow is the day's highest level, a test the day's latest answer
 *   - a workout is itself, keyed by its start time, with its activity, energy and distance
 *
 * Plain JavaScript, loadable by bare node (the server) and by Vite (the app). Values arrive in
 * whatever unit the phone used and leave in the catalogue's canonical units. */
import { TYPES, WORKOUT, canonical, categoryValue, workoutKey, EXTRA_FIELDS, trimImported } from './catalogue.js';

export { canonical };
export const APPLE_HEALTH = 'apple-health';
const LB_KG = 0.45359237;

const round = (n, dec) => { const f = 10 ** dec; return Math.round(n * f) / f; };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const kindOf = type => TYPES[type]?.kind || null;

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
 * The folding state. add() takes one raw sample — { type, v, unit, start, end?, source?, raw?,
 * asleep?, lo?, hi? } with `start`/`end` as the phone wrote them; a category sample brings its
 * value as `raw` (HealthKit's number or the export's name), a total from an app that already
 * counted brings `v`. addWorkout() takes one workout. readings() gives what came of them, in the
 * shape frontend/src/lib/health/records.js imports: { type, v, t, d, sid, src, lo?, hi?, a?, kc?, km? }.
 * `since` (YYYY-MM-DD) drops what is older. Both return false for what they could not use.
 */
export function createFolder({ since = '', src = APPLE_HEALTH } = {}) {
  const samples = new Map();
  const sums = new Map();
  const ranges = new Map();
  const levels = new Map();
  const sleep = [];
  let used = 0;

  const total = (type, d, source, n) => {
    const key = `${type}|${d}`;
    let bySrc = sums.get(key);
    if (!bySrc) sums.set(key, bySrc = new Map());
    bySrc.set(source, (bySrc.get(source) || 0) + n);
  };

  function add({ type, v, unit, start, end, source = '', raw, asleep = true, lo, hi }) {
    const kind = kindOf(type);
    if (!kind || kind === 'wo') return false;
    const a = phoneTime(start);
    if (!a || a.d < since) return false;
    if (kind === 'sleep') {
      const b = phoneTime(end);
      if (!asleep || !b || b.ms <= a.ms) return false;
      sleep.push([a.ms, b.ms, b.d]);
      used++;
      return true;
    }
    if (kind === 'min' || kind === 'ev' || kind === 'lvl' || kind === 'val') {
      // A category sample (`raw`) or, from an app that counted already, a number (`v`).
      let n;
      if (v == null) {
        const kept = categoryValue(type, raw);
        if (kept == null) return false;
        if (kind === 'min') {
          const b = phoneTime(end);
          if (!b || b.ms <= a.ms) return false;
          n = (b.ms - a.ms) / 60000;
        } else n = kind === 'ev' ? 1 : kept;
      } else {
        n = kind === 'min' ? canonical(type, Number(v), unit || 'min') : Number(v);
        if (!Number.isFinite(n) || n <= 0) return false;
      }
      used++;
      if (kind === 'min' || kind === 'ev') total(type, a.d, source, n);
      else {
        const key = `${type}|${a.d}`;
        const cur = levels.get(key);
        if (!cur || (kind === 'lvl' ? n > cur.v : a.ms >= cur.at)) levels.set(key, { v: n, at: a.ms });
      }
      return true;
    }
    const n = canonical(type, Number(v), unit);
    if (!Number.isFinite(n)) return false;
    used++;
    if (kind === 'sample') {
      const sid = `${type}:${a.ms}`;
      samples.set(sid, { type, v: round(n, 3), t: a.ms, d: a.d, sid, src });
    } else if (kind === 'sum') total(type, a.d, source, n);
    else {
      const key = `${type}|${a.d}`;
      const r = ranges.get(key) || { n: 0, sum: 0, lo: Infinity, hi: -Infinity };
      // A point that is itself a summary (a day's or an hour's Min/Avg/Max) brings its own range.
      const l = lo == null ? NaN : canonical(type, lo, unit), h = hi == null ? NaN : canonical(type, hi, unit);
      r.n++; r.sum += n; r.lo = Math.min(r.lo, Number.isFinite(l) ? l : n); r.hi = Math.max(r.hi, Number.isFinite(h) ? h : n);
      ranges.set(key, r);
    }
    return true;
  }

  /** One workout: { activity, start, end?, minutes?, kcal?, km? } — minutes from the times when not given. */
  function addWorkout({ activity, start, end, minutes, kcal, km }) {
    const a = phoneTime(start);
    if (!a || a.d < since) return false;
    let min = Number(minutes);
    if (!Number.isFinite(min) || min <= 0) {
      const b = phoneTime(end);
      min = b && b.ms > a.ms ? (b.ms - a.ms) / 60000 : NaN;
    }
    if (!Number.isFinite(min) || min <= 0) return false;
    const sid = `${WORKOUT}:${a.ms}`;
    const w = { type: WORKOUT, v: round(min, 1), t: a.ms, d: a.d, sid, src, a: workoutKey(activity) };
    if (Number(kcal) > 0) w.kc = Math.round(Number(kcal));
    if (Number(km) > 0) w.km = round(Number(km), 2);
    samples.set(sid, w);
    used++;
    return true;
  }

  function readings() {
    const out = [...samples.values()];
    // A day's reading sits at noon UTC of that day: the same instant on the server and on any phone.
    const noon = d => Date.parse(d + 'T12:00:00Z');
    for (const [key, bySrc] of sums) {
      const [type, d] = key.split('|');
      const v = Math.max(...bySrc.values());
      const dec = TYPES[type].unit === 'count' ? 0 : 2;
      if (v > 0) out.push({ type, v: round(v, dec), t: noon(d), d, sid: `${type}:${d}`, src });
    }
    for (const [key, r] of ranges) {
      const [type, d] = key.split('|');
      out.push({ type, v: round(r.sum / r.n, 2), t: noon(d), d, sid: `${type}:${d}`, src,
        ...(kindOf(type) === 'range' ? { lo: Math.round(r.lo), hi: Math.round(r.hi) } : {}) });
    }
    for (const [key, l] of levels) {
      const [type, d] = key.split('|');
      out.push({ type, v: l.v, t: noon(d), d, sid: `${type}:${d}`, src });
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

  return { add, addWorkout, readings, count: () => used };
}

/* ---------- what an iPhone Shortcut sends ---------- */

export const MAX_SAMPLES = 20000;
// A Shortcut joins a list into text with new lines, or sends a real list: both are taken.
const listOf = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : v == null ? [] : [v])
  .map(x => (typeof x === 'string' ? x.trim() : x)).filter(x => x !== '' && x != null);
// "80,5" from a phone set to a comma-decimal language is 80.5.
const number = x => Number(typeof x === 'string' ? x.replace(/\s/g, '').replace(',', '.') : x);
// The kinds a Shortcut sends as numbers (Find Health Samples' Value), every measurement and total.
const NUMERIC = new Set(['sample', 'sum', 'range', 'mean']);

/**
 * The readings in a Shortcut's request body:
 *   { metrics: { <type>: { values, dates, unit? } , sleep: { starts, ends, values? } } }
 * `<type>` is any measurement or total of catalogue.js (weight, bodyFat, steps, spo2, dietWater…).
 * `values` and `dates` are parallel lists (or the same as text, one per line); a day's total is
 * one value per day (the Shortcut's "Group by Day"). `unit` once, or once per value. Sleep is the
 * spans of the night, with `values` the sleep stage of each (in-bed and awake spans are left out).
 * Returns { readings, used, skipped } or { error }.
 */
export function readingsFromShortcut(body, { since = '' } = {}) {
  const metrics = body && typeof body === 'object' && body.metrics && typeof body.metrics === 'object' ? body.metrics : null;
  if (!metrics) return { error: 'metrics required' };
  const folder = createFolder({ since });
  let total = 0, skipped = 0;
  for (const [type, m] of Object.entries(metrics)) {
    const kind = kindOf(type);
    if (!(kind === 'sleep' || NUMERIC.has(kind)) || !m || typeof m !== 'object') { skipped++; continue; }
    if (kind === 'sleep') {
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
      // A Shortcut may send the unit once or once per value (the samples' Unit): the first is it.
      if (!folder.add({ type, v: number(v), unit: listOf(m.unit)[0], start: dates[i], source: 'shortcut' })) skipped++;
    });
  }
  return { readings: folder.readings(), used: folder.count(), skipped };
}

/* ---------- what Health Auto Export sends ---------- */

// Health Auto Export, an iPhone app, posts Apple Health on a schedule (its "REST API" automation):
//   { data: { metrics: [{ name, units, data: [point…] }], workouts: [workout…], … } }
// A point is { qty, date, source? } with `date` as "yyyy-MM-dd HH:mm:ss Z"; heart rate is
// { Min, Avg, Max, date }; blood pressure { systolic, diastolic, date }; sleep a summarized night
// { date, totalSleep (or asleep, core, deep, rem), sleepEnd, … } in `units` (hours), or, with
// Summarize Data off, single stages { startDate, endDate, value }. A workout is { name, start,
// end, duration (s), activeEnergyBurned: { qty, units }, distance: { qty, units } }. Names are
// matched without case or punctuation ("weight_&_body_mass"): the app's own name (`hae`), the
// label, or the type.
const flat = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const AUTO_EXPORT = {};
for (const t of Object.values(TYPES)) for (const n of [t.type, t.label, t.hae]) if (n) AUTO_EXPORT[flat(n)] = t.type;
AUTO_EXPORT.weightbodymass = 'weight';
AUTO_EXPORT.basalenergyburned = 'restingEnergy';
AUTO_EXPORT.restingenergy = 'restingEnergy';

export const isAutoExport = body => !!body && typeof body === 'object' && !!body.data && Array.isArray(body.data.metrics);
// A number, or null when there is none (Number(null) would be a 0).
const finite = x => { if (x == null || x === '') return null; const n = number(x); return Number.isFinite(n) ? n : null; };
const qtyOf = x => (x && typeof x === 'object' ? x : { qty: x });

/** The readings in a Health Auto Export request body: { readings, used, skipped } or { error }. */
export function readingsFromAutoExport(body, { since = '' } = {}) {
  if (!isAutoExport(body)) return { error: 'metrics required' };
  const folder = createFolder({ since });
  const nights = new Map();
  let total = 0, skipped = 0, used = 0;
  for (const m of body.data.metrics) {
    const name = flat(m && m.name);
    const type = AUTO_EXPORT[name];
    const points = m && Array.isArray(m.data) ? m.data : [];
    total += points.length;
    if (total > MAX_SAMPLES) return { error: 'too many samples' };
    if (!type && name !== 'bloodpressure') { skipped += points.length; continue; }
    for (const p of points) {
      if (!p || typeof p !== 'object') { skipped++; continue; }
      let ok;
      const source = String(p.source || '');
      if (name === 'bloodpressure') {
        ok = finite(p.systolic) != null && folder.add({ type: 'systolic', v: finite(p.systolic), start: p.date, source });
        ok = (finite(p.diastolic) != null && folder.add({ type: 'diastolic', v: finite(p.diastolic), start: p.date, source })) || ok;
      } else if (type === 'sleep' && p.startDate != null) {
        ok = folder.add({ type, start: p.startDate, end: p.endDate, asleep: !/in ?bed|awake/i.test(String(p.value || '')) });
      } else if (type === 'sleep') {
        // A summarized night, on the day it ended: its total sleep, in minutes.
        const slept = finite(p.totalSleep) ?? ['asleep', 'core', 'deep', 'rem'].reduce((n, k) => n + (finite(p[k]) || 0), 0);
        const min = /^min/i.test(String(m.units || '')) ? slept : slept * 60;
        const at = phoneTime(p.sleepEnd) || phoneTime(p.date);
        ok = !!at && at.d >= since && min >= 1 && min <= 1440;
        if (ok) { const cur = nights.get(at.d); if (!cur || min > cur.v) nights.set(at.d, { v: Math.round(min), t: at.ms }); used++; }
      } else if (p.qty == null && finite(p.Avg) != null) {
        ok = folder.add({ type, v: finite(p.Avg), lo: finite(p.Min), hi: finite(p.Max), unit: m.units, start: p.date, source });
      } else if (kindOf(type) === 'lvl' || kindOf(type) === 'val') {
        ok = false; // a symptom's or a test's answer comes only from the phone itself or the export
      } else {
        ok = finite(p.qty) != null && folder.add({ type, v: finite(p.qty), unit: m.units, start: p.date, source });
      }
      if (!ok) skipped++;
    }
  }
  for (const w of Array.isArray(body.data.workouts) ? body.data.workouts : []) {
    if (!w || typeof w !== 'object') { skipped++; continue; }
    const e = qtyOf(w.activeEnergyBurned ?? w.activeEnergy), dist = qtyOf(w.distance);
    const kcal = finite(e.qty) == null ? null : canonical('activeEnergy', finite(e.qty), e.units || 'kcal');
    const km = finite(dist.qty) == null ? null : canonical('distance', finite(dist.qty), dist.units || 'km');
    if (!folder.addWorkout({ activity: w.name, start: w.start, end: w.end, minutes: finite(w.duration) == null ? null : finite(w.duration) / 60, kcal, km })) skipped++;
  }
  const readings = folder.readings();
  const have = new Set(readings.map(r => r.sid));
  for (const [d, n] of nights) if (!have.has(`sleep:${d}`)) readings.push({ type: 'sleep', v: n.v, t: n.t, d, sid: `sleep:${d}`, src: APPLE_HEALTH });
  return { readings, used: folder.count() + used, skipped };
}

/* ---------- into a stored profile ---------- */

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const extrasOf = raw => {
  const o = {};
  for (const k of EXTRA_FIELDS) if (raw[k] != null && raw[k] !== '') o[k] = k === 'a' ? String(raw[k]) : Number(raw[k]);
  return o;
};
const sameExtras = (a, b) => EXTRA_FIELDS.every(k => (a[k] ?? null) === (b[k] ?? null));

/**
 * Folds readings into a stored profile `S` (mutated): new readings added, changed ones (a day's
 * steps that grew) updated, readings the user deleted (S.deleted.health) left out, everything the
 * user typed left alone, and the imported readings kept within catalogue.js MAX_IMPORTED; the
 * weights fill the weigh-in log on days without one, in the profile's unit, never over a weigh-in
 * the user typed. Every record it writes is stamped `now`, which the caller sets after every
 * stamp the profile carries. The same rules as the app's own import (frontend/src/lib/health/
 * records.js importRecords and bridgeWeights; health-parity.test.js). Returns { added, updated }.
 */
export function mergeReadings(S, readings, now) {
  const health = list(S.health).slice();
  const at = new Map();
  health.forEach((r, i) => { if (isMap(r) && r.sid != null && r.src !== 'manual') at.set(`${r.src}|${r.type}|${r.sid}`, i); });
  const gone = isMap(S.deleted) && isMap(S.deleted.health) ? S.deleted.health : {};
  let added = 0, updated = 0;
  const weights = [];
  for (const raw of list(readings)) {
    const t0 = TYPES[raw?.type];
    const v = Number(raw?.v), t = Number(raw?.t);
    if (!t0 || !Number.isFinite(v) || !Number.isFinite(t) || v < t0.min || v > t0.max || !ISO_DAY.test(raw.d || '') || raw.sid == null) continue;
    const src = String(raw.src || APPLE_HEALTH), sid = String(raw.sid);
    const key = `${src}|${raw.type}|${sid}`;
    const i = at.get(key);
    const fields = { v, t, d: raw.d, ...extrasOf(raw) };
    if (i != null) {
      const cur = health[i];
      if (cur.v === fields.v && cur.t === fields.t && cur.d === fields.d && sameExtras(cur, fields)) continue;
      health[i] = { ...cur, ...fields, _ts: now };
      updated++;
    } else {
      const id = `${src}:${sid}`;
      if (Number(gone[id]) > 0) continue;
      at.set(key, health.length);
      health.push({ id, type: raw.type, ...fields, u: t0.unit, src, sid, c: now, _ts: now });
      added++;
    }
    if (raw.type === 'weight') weights.push({ ...fields, src });
  }
  health.sort((a, b) => (Number(a?.t) || 0) - (Number(b?.t) || 0) || (String(a?.id) < String(b?.id) ? -1 : 1));
  S.health = trimImported(health);
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
