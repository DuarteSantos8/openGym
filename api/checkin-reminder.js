// The check-in reminder's web push (frontend/src/lib/checkin-reminder.js): which days owe one, read
// from the profile the way the phone reads it. A hand copy of the frontend's dueKeys and dueKind,
// since the api image has no frontend: change both together (test/checkin-reminder.test.js runs the
// same cases as frontend/src/lib/checkin-reminder.test.js). The words are generated into
// checkin-copy.js from the frontend's packs (scripts/build-checkin-copy.mjs).
import { CHECKIN_COPY } from './checkin-copy.js';

export const DEFAULT_TIME = '07:30';
export const EVERY_MAX = 90;
export const OVERDUE_EVERY = 3;
const BP_KEY = 'pair:bp';
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayNum = iso => Math.round(new Date(iso + 'T12:00:00Z').getTime() / 86400000);
const num = v => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);

/** The settings with defaults: { on, time, tz?, items }. */
export function reminderOf(S) {
  const r = isMap(S?.checkinReminder) ? S.checkinReminder : {};
  const items = {};
  for (const [k, v] of Object.entries(isMap(r.items) ? r.items : {})) {
    const every = Math.round(Number(v?.every));
    if (!k || !(every >= 1)) continue;
    items[k] = { every: Math.min(EVERY_MAX, every), ...(ISO.test(String(v.since || '')) ? { since: v.since } : {}) };
  }
  return { on: r.on === true, time: TIME.test(String(r.time || '')) ? r.time : DEFAULT_TIME, ...(typeof r.tz === 'string' && r.tz ? { tz: r.tz } : {}), items };
}

// A photo is any picture the profile keeps on a workout or filed under a day; a video is not one.
const isPhoto = m => isMap(m) && m.kind === 'image' && typeof m.hash === 'string' && MIMES.has(m.mime);

export function lastLogged(S, key, iso = '9999-12-31') {
  let last = null;
  const see = d => { if (ISO.test(String(d || '')) && d <= iso && (!last || d > last)) last = d; };
  if (key === 'weight') {
    for (const b of Array.isArray(S?.bodyweight) ? S.bodyweight : []) if (b && b.w > 0) see(b.d);
  } else if (key === 'photos') {
    for (const p of Object.values(isMap(S?.dayPhotos) ? S.dayPhotos : {})) if (isMap(p) && isPhoto(p.m)) see(p.d);
    for (const w of Array.isArray(S?.workouts) ? S.workouts : []) if (Array.isArray(w?.media) && w.media.some(isPhoto)) see(w.d);
  } else {
    const k = key === BP_KEY ? 'bpSys' : key;
    for (const e of Array.isArray(S?.measurements) ? S.measurements : []) {
      if (!e) continue;
      const v = k.startsWith('other:') ? num((Array.isArray(e.other) ? e.other : []).find(o => o?.id === k.slice(6))?.value) : num(e[k]);
      if (v != null && (k.startsWith('other:') ? v >= 0 : v > 0)) see(e.d);
    }
  }
  return last;
}

export function itemDue(item, last, iso) {
  const anchor = last && (!item.since || last > item.since) ? last : (item.since || last);
  if (!anchor) return true;
  const days = dayNum(iso) - dayNum(anchor);
  if (days < item.every) return false;
  return (days - item.every) % Math.min(item.every, OVERDUE_EVERY) === 0;
}

export function dueKeys(S, iso) {
  const r = reminderOf(S);
  if (!r.on) return [];
  return Object.entries(r.items).filter(([k, item]) => itemDue(item, lastLogged(S, k, iso), iso)).map(([k]) => k);
}

export function dueKind(keys) {
  const photos = keys.includes('photos'), measure = keys.some(k => k !== 'photos');
  return photos && measure ? 'both' : photos ? 'photos' : measure ? 'measure' : null;
}

// de-CH is de with ß written ss, as in the frontend (lib/i18n-core.js DERIVED_LOCALES).
function copyFor(lang) {
  if (lang === 'de-CH') return Object.fromEntries(Object.entries(CHECKIN_COPY.de).map(([k, v]) => [k, v.replace(/ß/g, 'ss')]));
  return CHECKIN_COPY[lang] || CHECKIN_COPY.en;
}

/** The push for a day with `kind` due, in the profile's language. */
export function checkinPush(lang, kind) {
  const c = copyFor(lang);
  return { title: c.title, body: c[kind] || c.measure, tag: 'checkin' };
}
