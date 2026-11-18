/* The app's muscle weighting, for the Coach: how many effective sets each muscle gets from the
 * planned week. Hand-copied from the frontend (the API image cannot import it); the parity test
 * in frontend/src/lib/coach-parity.test.js pins every answer to the Stats card's. */
import { LIB_BY_ID } from './library.js';

// frontend lib/muscles.js: MUSCLES, GENERIC, LEGACY, ALIAS, BY_BODYPART, SECONDARY.
export const MUSCLES = ['trapezius', 'front-delts', 'side-delts', 'rear-delts', 'chest', 'lats', 'upper-back', 'serratus', 'biceps', 'triceps', 'forearm', 'abs', 'obliques', 'lower-back', 'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors', 'calves', 'tibialis'];
const GENERIC = { deltoids: { 'front-delts': 1, 'side-delts': 0.6, 'rear-delts': 0.4 } };
const LEGACY = { 'upper-back': ['lats', 'upper-back'] };
const ALIAS = {
  abs: 'abs', pectorals: 'chest', biceps: 'biceps', glutes: 'gluteal', delts: 'deltoids',
  'front delts': 'front-delts', 'side delts': 'side-delts', 'rear delts': 'rear-delts',
  triceps: 'triceps', 'upper back': 'upper-back', lats: 'lats', calves: 'calves',
  quads: 'quadriceps', forearms: 'forearm', hamstrings: 'hamstring', spine: 'lower-back',
  traps: 'trapezius', adductors: 'adductors', 'serratus anterior': 'serratus',
  abductors: 'gluteal', 'levator scapulae': 'trapezius', 'cardiovascular system': 'cardiovascular system',
  shoulders: 'deltoids', deltoids: 'deltoids', 'rear deltoids': 'rear-delts',
  'rotator cuff': 'rear-delts', quadriceps: 'quadriceps', core: 'abs', abdominals: 'abs',
  'lower abs': 'abs', chest: 'chest', 'upper chest': 'chest', 'hip flexors': 'hip-flexors',
  obliques: 'obliques', 'lower back': 'lower-back', rhomboids: 'upper-back',
  trapezius: 'trapezius', back: 'upper-back', 'latissimus dorsi': 'lats',
  brachialis: 'biceps', soleus: 'calves', shins: 'tibialis', wrists: 'forearm',
  'wrist flexors': 'forearm', 'wrist extensors': 'forearm', 'grip muscles': 'forearm',
  groin: 'adductors', 'inner thighs': 'adductors',
};
const BY_BODYPART = {
  chest: { chest: 1 },
  back: { lats: 0.4, 'upper-back': 0.4, 'lower-back': 0.2 },
  shoulders: { 'front-delts': 0.4, 'side-delts': 0.4, 'rear-delts': 0.2 },
  'upper arms': { biceps: 0.5, triceps: 0.5 },
  'lower arms': { forearm: 1 },
  waist: { abs: 0.7, obliques: 0.3 },
  'upper legs': { quadriceps: 0.4, hamstring: 0.35, gluteal: 0.25 },
  'lower legs': { calves: 0.8, tibialis: 0.2 },
  neck: { trapezius: 1 },
  'full body': { chest: 0.2, lats: 0.1, 'upper-back': 0.1, gluteal: 0.2, quadriceps: 0.2, hamstring: 0.1, abs: 0.1 },
  cardio: {},
};
const SECONDARY = 0.4;

const arrayOf = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// muscles.js canonicalMuscle
const canonicalMuscle = value => {
  const name = String(value || '').toLowerCase().trim();
  if (MUSCLES.includes(name) || GENERIC[name]) return name;
  return has(ALIAS, name) ? ALIAS[name] : null;
};
// muscles.js firstPresent + explicitPartsOf
const partsOf = ex => {
  const pick = keys => { for (const k of keys) if (has(ex, k)) return ex[k]; return null; };
  const primary = pick(['primaries', 'primaryMuscles', 'primary']);
  const secondary = pick(['secondaries', 'secondaryMuscles', 'secondary']);
  return primary !== null || secondary !== null ? { primary: arrayOf(primary), secondary: arrayOf(secondary) } : null;
};
// muscles.js metadataOf: an entry with no muscle fields of its own is weighed by its muscleSnapshot.
const DIRECT = ['muscleGroups', 'muscles', 'targetMuscles', 'muscleWeights', 'primaries', 'primaryMuscles', 'primary', 'secondaries', 'secondaryMuscles', 'secondary'];
const metadataOf = ex => {
  const direct = DIRECT.some(k => has(ex, k)) || [ex.tg, ex.mg, ...arrayOf(ex.sm)].some(v => v != null && v !== '');
  const snap = ex.muscleSnapshot;
  return !direct && snap && typeof snap === 'object' && !Array.isArray(snap) ? snap : ex;
};
// muscles.js explicitGroupsOf: a plain list of groups, each counted in full.
const groupsOf = ex => {
  for (const k of ['muscleGroups', 'muscles', 'targetMuscles']) {
    if (has(ex, k)) { const g = arrayOf(ex[k]); return g.length ? g : null; }
  }
  return null;
};
// muscles.js isLegacy: only a custom exercise saved before the 1.4.5 shoulder/lats split.
const isLegacy = ex => ex.mv !== 2 && LIB_BY_ID.get(ex.id) !== ex && !(!ex.custom && !ex.muscleWeights && LIB_BY_ID.has(ex.id));

// lean: old exercise ids (frontend EXALIAS) are not resolved here, so a routine naming one weighs nothing; copy EXALIAS in when the app renames a catalogue id a saved routine can still hold.
/** muscles.js muscleWeightsOf: { slug: weight } for one exercise (a catalogue entry or a custom one). */
export function weightsOf(ex) {
  if (!ex || typeof ex !== 'object') return {};
  const src = metadataOf(ex);
  if (src !== ex) return weightsOf(src);
  const legacy = isLegacy(ex);
  if (ex.muscleWeights && typeof ex.muscleWeights === 'object' && !Array.isArray(ex.muscleWeights)) {
    const snap = {};
    const put = (slug, w) => { snap[slug] = Math.max(snap[slug] ?? 0, w); };
    for (const [key, value] of Object.entries(ex.muscleWeights)) {
      const w = Number(value);
      if (!Number.isFinite(w) || w < 0 || w > 1) continue;
      if (GENERIC[key]) for (const [head, f] of Object.entries(GENERIC[key])) put(head, Math.round(w * f * 100) / 100);
      else if (legacy && LEGACY[key]) LEGACY[key].forEach(s => put(s, w));
      else if (MUSCLES.includes(key)) put(key, w);
    }
    if (Object.keys(snap).length) return snap;
  }
  const out = {};
  const put = (slug, w) => { out[slug] = Math.max(out[slug] || 0, w); };
  const add = (name, w) => {
    const slug = canonicalMuscle(name);
    if (!slug) return;
    if (GENERIC[slug]) for (const [head, f] of Object.entries(GENERIC[slug])) put(head, Math.round(w * f * 100) / 100);
    else if (legacy && LEGACY[slug]) LEGACY[slug].forEach(s => put(s, w));
    else put(slug, w);
  };
  const parts = partsOf(ex);
  if (parts && [...parts.primary, ...parts.secondary].some(canonicalMuscle)) {
    parts.primary.forEach(m => add(m, 1));
    parts.secondary.forEach(m => add(m, SECONDARY));
  } else if (groupsOf(ex)) groupsOf(ex).forEach(m => add(m, 1));
  else {
    add(ex.tg, 1);
    add(ex.mg, SECONDARY);
    arrayOf(ex.sm).forEach(m => add(m, SECONDARY));
  }
  if (!Object.keys(out).length) Object.assign(out, BY_BODYPART[ex.bp] || {});
  return out;
}

// muscles.js loadOf / loadOfRoutine: a routine's effective sets per muscle.
function routineSets(routine, custom, primaryOnly = false) {
  const load = {};
  for (const c of routine?.ex || []) {
    const sets = c?.sets || 1;
    const hist = custom[c.id] || c;
    const src = hist?.muscleWeights ? hist : (LIB_BY_ID.get(c.id) || hist);
    const w = weightsOf(src);
    for (const slug in w) if (primaryOnly ? w[slug] === 1 : w[slug] > 0) load[slug] = (load[slug] || 0) + w[slug] * sets;
  }
  return load;
}
const add = (into, from, scale = v => v) => { for (const [s, v] of Object.entries(from)) into[s] = (into[s] || 0) + scale(v); };
const customOf = S => Object.fromEntries((S?.customEx || []).map(e => [e.id, e]));
const routineMap = S => new Map((S?.routines || []).map(r => [r.id, r]));

// queue.js queueOf, cut to the ids and the validity checks (the dates only decide validity).
function queueOf(S) {
  const q = S?.queue;
  if (!q || typeof q !== 'object' || !Array.isArray(q.ids)) return null;
  if (q.strict === true && !(q.since > 0)) return null;
  const routines = Array.isArray(S.routines) ? S.routines : [];
  const ids = q.ids.filter((id, i) => q.ids.indexOf(id) === i && routines.some(r => r.id === id));
  if (!ids.length || !(typeof q.startsOn === 'string' || q.since > 0)) return null;
  return { ...q, ids };
}
// week-left.js weekTargetOf; rotation.js sequenceOf (rest is 'rest').
const weekTargetOf = S => { const n = Math.round(Number(S?.weekTarget)); return n >= 1 && n <= 7 ? n : null; };
function loopSessions(S) {
  const seq = Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : [];
  const routines = Array.isArray(S?.routines) ? S.routines : [];
  const out = seq.filter(id => id === 'rest' || routines.some(r => r.id === id));
  return out.some(id => id !== 'rest') ? out.filter(id => id !== 'rest') : [];
}

/** muscles.js loadOfWeeklyPlan: effective sets per muscle the planned week holds. */
export function weeklyPlanSets(S) {
  const routines = routineMap(S), custom = customOf(S), q = queueOf(S), target = weekTargetOf(S);
  const load = {};
  if (q && target && S.rotation && q.rotationId === S.rotation.id) {
    const sessions = loopSessions(S);
    if (sessions.length) {
      for (const id of sessions) add(load, routineSets(routines.get(id), custom), v => v * target / sessions.length); // same operation order as the app, so the floats agree
      return load;
    }
  }
  const queued = new Set(q ? (S.queue.ids || []) : []);
  const ids = [...Object.values(S?.week || {}).flatMap(v => [].concat(v || [])).filter(id => !queued.has(id)), ...(q ? q.ids : [])];
  for (const id of ids) if (routines.has(id)) add(load, routineSets(routines.get(id), custom));
  return load;
}

/** One weights-by-sets map per planned weekday session (a combined day is one); null for a rotation.
 *  `primaryOnly` keeps just the sets that hit a muscle as a primary (weight 1). */
export function sessionsOf(S, primaryOnly = false) {
  const q = queueOf(S);
  if (S?.scheduleMode === 'rotation' || (q && S.rotation && q.rotationId === S.rotation.id)) return null;
  const routines = routineMap(S), custom = customOf(S);
  return Object.values(S?.week || {}).map(v => {
    const day = {};
    for (const id of [].concat(v || [])) if (routines.has(id)) add(day, routineSets(routines.get(id), custom, primaryOnly));
    return day;
  }).filter(d => Object.keys(d).length);
}
