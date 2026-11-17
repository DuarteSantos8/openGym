/* What the Coach may do from the chat (coach-146), and the checks every one of them passes.
 *
 * An answer to a question may carry `actions`. None of them writes anything: each becomes a preview
 * the person confirms in the app, and the plan-shaped ones go through the very validators a created
 * plan or a review goes through, so the chat cannot reach further than those can.
 *
 *   routine   a new routine (name, items)                 ┐ together: a created plan (kind 'create'),
 *   schedule  a weekday for a routine of this answer      ┘ the plan card, "add to my week" switch
 *   swap      exercise exId in routine routineId → to     ┐ a review change-set (kind 'review'),
 *   target    sets / reps / sec of exId in routineId      │ the review card, undo
 *   schedule  a weekday for an existing routine (or rest) ┘
 *   workout   a one-off session (name, items), started on a tap
 *   start     start routine routineId now
 *   note      remember a line in the Coach profile's notes
 *   exercise  a custom exercise (name, bp, mode)
 *   show      an exercise card from the catalogue (exId)
 *   import    a routine from the library the payload listed (libraryId)
 *
 * One kind per answer: new routines win, then plan edits, then the rest, so the screen is always
 * one coherent thing to say yes or no to. */
import { libraryHas, LIB_BY_ID, equipmentAllows, isDumbbellLift, machineAllows } from './library.js';
import { validatePlan, validateReview } from './validate.js';

export const ACTION_TYPES = ['routine', 'schedule', 'swap', 'target', 'workout', 'start', 'note', 'exercise', 'show', 'import'];
export const MAX_ACTIONS = 8;
export const MAX_ROUTINE_ACTIONS = 4;
export const MAX_ITEMS = 14;
export const NOTE_ACTION_MAX = 300;
const BODY_PARTS = ['waist', 'back', 'chest', 'upper legs', 'upper arms', 'full body', 'cardio', 'shoulders', 'lower arms', 'lower legs', 'neck'];

const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
// "0024" sent back as 24 or "24", as validate.js asLibraryId reads it.
const libId = v => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) v = String(v);
  return typeof v === 'string' && /^\d{1,5}$/.test(v) && !libraryHas(v) ? v.padStart(4, '0') : v;
};

/** The items of a routine or a one-off workout, as a created plan's `ex`. Errors name the item. */
function itemsOf(a, where, ctx, errors) {
  const known = new Set(ctx.customIds || []);
  const list = Array.isArray(a.items) ? a.items.slice(0, MAX_ITEMS) : [];
  if (!list.length) { errors.push(`${where}.items must list the exercises, each with an id from the library`); return null; }
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i] || {};
    const id = known.has(it.id) ? it.id : libId(it.id);
    if (!libraryHas(id) && !known.has(id)) { errors.push(`${where}.items[${i}].id ${JSON.stringify(it.id)} is not in the exercise library — copy an id exactly as the library lists it`); return null; }
    if (libraryHas(id) && !(ctx.offered && ctx.offered.has(id)) && ((ctx.equipment?.length && !equipmentAllows(ctx.equipment, id)) || (ctx.noDumbbells && isDumbbellLift(id)) || !machineAllows(ctx.machines, id))) {
      errors.push(`${where}.items[${i}].id "${id}" needs equipment the user does not have — use an exercise from the library provided`); return null;
    }
    if (out.some(x => x.id === id)) { errors.push(`${where}.items[${i}].id "${id}" is listed twice — list each exercise once`); return null; }
    const timed = isInt(it.sec, 5, 3600);
    out.push({
      id, sets: isInt(it.sets, 1, 10) ? it.sets : 3,
      ...(timed ? { mode: 'time', sec: it.sec } : { mode: 'reps', reps: isInt(it.reps, 1, 100) ? it.reps : 10 }),
      ...(isNum(it.weight) && it.weight > 0 && it.weight <= 1000 ? { weight: it.weight } : {})
    });
  }
  return out;
}

/**
 * Sorts an answer's actions into one proposal. Returns
 *   { ok:true, kind:'create', proposal:{ bundle, summary } }
 *   { ok:true, kind:'review', proposal:{ summary, changes, … } }
 *   { ok:true, kind:'ask', actions:[…] }                       (the card actions, maybe none)
 *   { ok:false, errors }
 * `payload` is the ask payload (its plan, library and routine library); `answer` the reply text.
 */
export function sortActions(data, payload, answer, ctx = {}) {
  const raw = Array.isArray(data.actions) ? data.actions : [];
  if (!raw.length) return { ok: true, kind: 'ask', actions: [] };
  const errors = [];
  const acts = [];
  raw.slice(0, MAX_ACTIONS).forEach((a, i) => {
    if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) errors.push(`actions[${i}].type ${JSON.stringify(a && a.type)} is not one of: ${ACTION_TYPES.join(', ')}`);
    else acts.push({ ...a, _i: i });
  });
  if (errors.length) return { ok: false, errors };
  const plan = payload.plan || { routines: [], week: {} };
  const routineIds = new Set((plan.routines || []).map(r => r.id));

  /* ---- new routines: a created plan ---- */
  const made = acts.filter(a => a.type === 'routine');
  if (made.length) {
    if (made.length > MAX_ROUTINE_ACTIONS) return { ok: false, errors: [`at most ${MAX_ROUTINE_ACTIONS} routine actions in one answer`] };
    const routines = [];
    made.forEach((a, k) => {
      const where = `actions[${a._i}]`;
      if (!isStr(a.name)) { errors.push(`${where}.name is required for a routine`); return; }
      const ex = itemsOf(a, where, ctx, errors);
      if (ex) routines.push({ id: 'r' + k, name: cut(a.name, 40), emoji: 'figureStrength', ...(isStr(a.why) ? { why: cut(a.why, 600) } : {}), ex });
    });
    const byName = new Map(routines.map(r => [r.name.toLowerCase(), r.id]));
    const week = {};
    acts.filter(a => a.type === 'schedule').forEach(a => {
      const rid = isStr(a.name) ? byName.get(cut(a.name, 40).toLowerCase()) : null;
      if (!isInt(a.day, 0, 6)) errors.push(`actions[${a._i}].day must be a weekday number 0-6 (0 is Sunday)`);
      else if (!rid) errors.push(`actions[${a._i}] schedules ${JSON.stringify(a.name)}, which is not the name of a routine action in this answer`);
      else week[a.day] = rid;
    });
    if (errors.length) return { ok: false, errors };
    const v = validatePlan({ name: routines.length === 1 ? routines[0].name : cut(data.planName || 'Coach routines', 40), summary: answer, week, routines }, ctx);
    if (!v.ok) return v;
    return { ok: true, kind: 'create', proposal: { bundle: v.bundle, summary: v.bundle.summary } };
  }

  /* ---- edits to routines they have: a review change-set ---- */
  const edits = acts.filter(a => a.type === 'swap' || a.type === 'target' || a.type === 'schedule');
  if (edits.length) {
    const changes = [];
    edits.forEach(a => {
      const why = isStr(a.why) ? a.why : answer;
      const target = { routineId: a.routineId, exId: libId(a.exId) };
      if (a.type === 'swap') changes.push({ id: 'a' + a._i, type: 'swap-exercise', target, after: { id: libId(a.to) }, why });
      else if (a.type === 'target') {
        if (isInt(a.sets, 1, 10)) changes.push({ id: 'a' + a._i + 's', type: 'sets', target, after: a.sets, why });
        if (isInt(a.reps, 1, 100)) changes.push({ id: 'a' + a._i + 'r', type: 'reps', target, after: a.reps, why });
        if (isInt(a.sec, 5, 3600)) changes.push({ id: 'a' + a._i + 't', type: 'sec', target, after: a.sec, why });
        if (!isInt(a.sets, 1, 10) && !isInt(a.reps, 1, 100) && !isInt(a.sec, 5, 3600)) errors.push(`actions[${a._i}] (target) needs sets, reps or sec`);
      } else {
        if (!isInt(a.day, 0, 6)) { errors.push(`actions[${a._i}].day must be a weekday number 0-6 (0 is Sunday)`); return; }
        const rest = a.routineId === 'rest' || a.routineId == null;
        if (!rest && !routineIds.has(a.routineId)) { errors.push(`actions[${a._i}].routineId "${a.routineId}" is not one of their routines (or "rest")`); return; }
        changes.push({ id: 'a' + a._i, type: 'week', target: { weekday: a.day }, after: rest ? 'rest' : a.routineId, why });
      }
    });
    if (errors.length) return { ok: false, errors };
    const v = validateReview({ summary: answer, changes }, plan, ctx);
    if (!v.ok) return v;
    // Everything asked for is already so: the answer stands on its own.
    if (v.nochange) return { ok: true, kind: 'ask', actions: [] };
    return { ok: true, kind: 'review', proposal: v.proposal };
  }

  /* ---- the cards ---- */
  const libraryIds = new Set((payload.routineLibrary || []).map(e => e.id));
  const out = [];
  acts.forEach(a => {
    const where = `actions[${a._i}]`;
    switch (a.type) {
      case 'workout': {
        const items = itemsOf(a, where, ctx, errors);
        if (items) out.push({ type: 'workout', name: isStr(a.name) ? cut(a.name, 40) : 'Coach session', items });
        break;
      }
      case 'start':
        if (!routineIds.has(a.routineId)) errors.push(`${where}.routineId "${a.routineId}" is not one of their routines`);
        else out.push({ type: 'start', routineId: a.routineId });
        break;
      case 'note':
        if (!isStr(a.text)) errors.push(`${where}.text is required for a note`);
        else out.push({ type: 'note', text: cut(a.text, NOTE_ACTION_MAX) });
        break;
      case 'exercise': {
        if (!isStr(a.name)) { errors.push(`${where}.name is required for a custom exercise`); break; }
        const bp = BODY_PARTS.includes(a.bp) ? a.bp : 'full body';
        out.push({ type: 'exercise', name: cut(a.name, 60), bp, mode: a.mode === 'time' ? 'time' : 'reps' });
        break;
      }
      case 'show': {
        const id = libId(a.exId);
        if (!libraryHas(id)) errors.push(`${where}.exId ${JSON.stringify(a.exId)} is not in the exercise library`);
        else if (!out.some(x => x.type === 'show' && x.exId === id)) out.push({ type: 'show', exId: id, name: LIB_BY_ID.get(id).n });
        break;
      }
      case 'import':
        if (!libraryIds.has(a.libraryId)) errors.push(`${where}.libraryId ${JSON.stringify(a.libraryId)} is not one of the routineLibrary entries in the payload`);
        else out.push({ type: 'import', libraryId: a.libraryId, title: (payload.routineLibrary.find(e => e.id === a.libraryId) || {}).title || '' });
        break;
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, kind: 'ask', actions: out.slice(0, 6) };
}
