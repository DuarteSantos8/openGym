/* The routines library the Coach can search and import from (coach-146).
 *
 * Sources plug in as indexes of one small JSON format (docs/ROUTINES_LIBRARY.md): the built-in
 * starter plans today, the opengym.ch community routines when that index exists (read from a
 * configurable URL by the app, never by the server). Every entry is normalised here, field by
 * field, and only catalogue exercise ids survive, so whatever an index says, an import is a plan
 * the app can run. Searching is plain word matching: small, deterministic, the same on every
 * runtime, and it only decides which few entries the model gets to see. */
import { LIB_BY_ID } from './library.js';
import { STARTER_PLANS } from './starter-plans.js';

export const FORMAT = 'opengym-routines';
export const FORMAT_VERSION = 1;
export const DEFAULT_INDEX_URL = 'https://opengym.ch/routines/index.json';
export const MAX_ENTRIES = 500;
export const MAX_SESSIONS = 7;
export const MAX_EXERCISES = 20;
export const GOALS = ['strength', 'muscle', 'general', 'fatloss', 'endurance'];
export const LEVELS = ['beginner', 'intermediate', 'advanced'];

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const ID = /^[a-z0-9][a-z0-9/_.-]{1,79}$/;

function cleanExercise(e) {
  if (!isMap(e) || typeof e.id !== 'string' || !LIB_BY_ID.has(e.id)) return null;
  const sets = int(e.sets, 1, 10) ?? 3;
  const sec = int(e.sec, 5, 3600);
  const reps = int(e.reps, 1, 100);
  return { id: e.id, sets, ...(sec ? { sec } : { reps: reps ?? 10 }), ...(int(e.rest, 0, 600) != null ? { rest: e.rest } : {}) };
}

/** One index entry as the app will use it, or null when it cannot be one (no title, no session
 *  with a catalogue exercise in it, an exercise the catalogue does not hold). */
export function cleanEntry(raw) {
  if (!isMap(raw)) return null;
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : null;
  const title = str(raw.title, 80);
  if (!id || !title) return null;
  const sessions = [];
  for (const s of (Array.isArray(raw.sessions) ? raw.sessions : []).slice(0, MAX_SESSIONS)) {
    if (!isMap(s)) return null;
    const list = (Array.isArray(s.exercises) ? s.exercises : []).slice(0, MAX_EXERCISES);
    const ex = list.map(cleanExercise);
    // An exercise the catalogue does not hold means the entry was written for another catalogue:
    // importing it short of that exercise would be a different routine than the one described.
    if (!ex.length || ex.some(x => !x)) return null;
    sessions.push({ name: str(s.name, 40) || `Day ${sessions.length + 1}`, exercises: ex });
  }
  if (!sessions.length) return null;
  const schedule = (Array.isArray(raw.schedule) ? raw.schedule : [])
    .filter(p => Array.isArray(p) && int(p[0], 0, 6) != null && int(p[1], 0, sessions.length - 1) != null)
    .slice(0, 7).map(p => [p[0], p[1]]);
  const equipment = [...new Set((Array.isArray(raw.equipment) ? raw.equipment : []).map(e => str(e, 30)).filter(Boolean).map(e => e.toLowerCase()))].slice(0, 12);
  const url = typeof raw.url === 'string' && /^https:\/\/[^\s]{1,300}$/.test(raw.url) ? raw.url : null;
  return {
    id, title,
    author: str(raw.author, 60) || null,
    goal: GOALS.includes(raw.goal) ? raw.goal : null,
    level: LEVELS.includes(raw.level) ? raw.level : null,
    split: str(raw.split, 30),
    days: int(raw.days, 1, 7) ?? (schedule.length || sessions.length),
    duration: int(raw.duration, 5, 300),
    equipment: equipment.length ? equipment : equipmentOf(sessions),
    language: typeof raw.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(raw.language) ? raw.language : 'en',
    description: str(raw.description, 400),
    ...(url ? { url } : {}),
    sessions,
    ...(schedule.length ? { schedule } : {})
  };
}

/** A whole index, normalised: { entries } with the broken ones left out, or { entries: [], error }. */
export function normalizeIndex(raw) {
  if (!isMap(raw) || raw.format !== FORMAT) return { entries: [], error: 'not an openGym routines index' };
  if (raw.version !== FORMAT_VERSION) return { entries: [], error: `index version ${raw.version} is not ${FORMAT_VERSION}` };
  const seen = new Set();
  const entries = [];
  for (const r of (Array.isArray(raw.routines) ? raw.routines : []).slice(0, MAX_ENTRIES)) {
    const e = cleanEntry(r);
    if (e && !seen.has(e.id)) { seen.add(e.id); entries.push(e); }
  }
  return { entries };
}

function equipmentOf(sessions) {
  const eq = new Set();
  sessions.forEach(s => s.exercises.forEach(x => { const q = LIB_BY_ID.get(x.id)?.eq; if (q && q !== 'body weight') eq.add(q); }));
  return [...eq].sort();
}

/* The starter plans as index entries. Titles are the chooser's English names; the app shows its
   own translated ones, the model only needs to know what they are. */
const STARTER_META = {
  ppl: { title: 'Push, pull, legs', goal: 'muscle', level: 'intermediate', split: 'ppl' },
  'upper-lower': { title: 'Upper / lower', goal: 'muscle', level: 'intermediate', split: 'upper-lower' },
  'full-body': { title: 'Full body', goal: 'general', level: 'beginner', split: 'full-body' },
  '5x5': { title: '5×5 strength', goal: 'strength', level: 'beginner', split: 'full-body' },
  'home-bw': { title: 'Bodyweight at home', goal: 'general', level: 'beginner', split: 'full-body' },
  dumbbells: { title: 'Dumbbells only', goal: 'general', level: 'beginner', split: 'full-body' },
  bands: { title: 'Resistance bands', goal: 'general', level: 'beginner', split: 'full-body' },
  hotel: { title: 'Hotel room', goal: 'general', level: 'beginner', split: 'full-body' }
};
let builtin = null;
/** The built-in starter plans, in the index format. */
export function builtinIndex() {
  if (builtin) return builtin;
  builtin = Object.entries(STARTER_PLANS).map(([key, plan]) => {
    const keys = plan.routines.map(r => r[0]);
    return cleanEntry({
      id: 'starter/' + key, author: 'openGym', language: 'en',
      ...STARTER_META[key],
      days: plan.schedule.length,
      duration: 45,
      sessions: plan.routines.map(([, name, , list]) => ({
        name, exercises: list.map(([id, sets, amount, mode]) => (mode === 'time' ? { id, sets, sec: amount } : { id, sets, reps: amount }))
      })),
      schedule: plan.schedule.map(([day, k]) => [day, keys.indexOf(k)])
    });
  }).filter(Boolean);
  return builtin;
}

const WORDS = s => (String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
// Words that ask for a no-equipment plan, in the languages people asked in.
const BODYWEIGHT = /\b(body ?weight|calisthenics?|no equipment|without equipment|at home|home workout|eigengewicht|ohne gerate|sans materiel|poids du corps|peso corporal|peso corporeo|senza attrezzi|sin equipo|sem equipamento|pull[- ]?up bar|klimmzugstange)\b/i;
export const asksForBodyweight = text => BODYWEIGHT.test(String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));

/**
 * The few entries worth showing the model for this question: word overlap with the title, split,
 * goal and description, a plan that fits the person's equipment first. `equipment` empty means
 * any; a question asking for bodyweight keeps to plans that need nothing.
 */
export function searchRoutines(entries, { text = '', equipment = [], limit = 6 } = {}) {
  const q = new Set(WORDS(text).filter(w => w.length > 2));
  const bw = asksForBodyweight(text);
  const have = new Set((equipment || []).map(e => String(e).toLowerCase()));
  const scored = [];
  for (const e of entries || []) {
    if (bw && e.equipment.length) continue;
    const fits = !have.size || e.equipment.every(x => have.has(x));
    const hay = new Set(WORDS([e.title, e.split, e.goal, e.level, e.description, ...e.equipment].join(' ')));
    let score = 0;
    for (const w of q) if (hay.has(w)) score += 2;
    if (bw) score += 3;
    if (fits) score += 1;
    if (score > 0) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || (a.e.id < b.e.id ? -1 : 1)).slice(0, limit).map(x => x.e);
}

/** What the model reads of an entry: enough to describe it and name it back by id. */
export function compactEntry(e) {
  return {
    id: e.id, title: e.title,
    ...(e.author ? { author: e.author } : {}), ...(e.goal ? { goal: e.goal } : {}), ...(e.level ? { level: e.level } : {}),
    ...(e.split ? { split: e.split } : {}), days: e.days, ...(e.duration ? { duration: e.duration } : {}),
    equipment: e.equipment,
    sessions: e.sessions.map(s => ({ name: s.name, ex: s.exercises.map(x => x.id) }))
  };
}

/** The import as a Coach plan bundle (what validatePlan and applyCreatedPlan take). */
export function entryToBundle(e) {
  const routines = e.sessions.map((s, i) => ({
    id: 'r' + i, name: s.name, emoji: 'figureStrength',
    ex: s.exercises.map(x => ({ id: x.id, sets: x.sets, ...(x.sec ? { mode: 'time', sec: x.sec } : { mode: 'reps', reps: x.reps }) }))
  }));
  const week = {};
  (e.schedule || []).forEach(([day, i]) => { week[day] = 'r' + i; });
  return { name: e.title.slice(0, 40), summary: e.description || '', week, routines };
}

/** Entries the app sent along with a question (compactEntry shape), checked again: the request is
 *  the client's. At most 8, catalogue ids only. */
export function cleanHits(list) {
  const out = [];
  for (const h of Array.isArray(list) ? list.slice(0, 8) : []) {
    if (!isMap(h) || typeof h.id !== 'string' || !ID.test(h.id) || !str(h.title, 80)) continue;
    const sessions = (Array.isArray(h.sessions) ? h.sessions : []).slice(0, MAX_SESSIONS)
      .map(s => (isMap(s) ? { name: str(s.name, 40) || 'Day', ex: (Array.isArray(s.ex) ? s.ex : []).filter(id => typeof id === 'string' && LIB_BY_ID.has(id)).slice(0, MAX_EXERCISES) } : null))
      .filter(s => s && s.ex.length);
    if (!sessions.length) continue;
    out.push({
      id: h.id, title: str(h.title, 80),
      ...(str(h.author, 60) ? { author: str(h.author, 60) } : {}),
      ...(GOALS.includes(h.goal) ? { goal: h.goal } : {}), ...(LEVELS.includes(h.level) ? { level: h.level } : {}),
      ...(str(h.split, 30) ? { split: str(h.split, 30) } : {}),
      days: int(h.days, 1, 7) ?? sessions.length,
      ...(int(h.duration, 5, 300) ? { duration: h.duration } : {}),
      equipment: (Array.isArray(h.equipment) ? h.equipment : []).map(e => str(e, 30)).filter(Boolean).slice(0, 12),
      sessions
    });
  }
  return out;
}
