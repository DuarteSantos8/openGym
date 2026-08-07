/* The gate between a language model's output and someone's training plan.
 *
 * Everything upstream of here is advisory — the prompt asks for a shape, the model usually
 * obliges. This file is where "usually" stops mattering. Nothing reaches a user that has not
 * resolved against the real exercise library, matched the closed list of change types, and
 * stayed inside the two things the Coach is allowed to touch (routines and the week).
 *
 * That closed list is the actual security boundary of the feature. A hostile note in a user's
 * free text can talk the model into saying anything at all; it cannot invent a change type,
 * and a change type that does not exist here does nothing. `parse.js` answers "is there JSON
 * in what the provider said"; this file is the only thing that answers "is it safe to act on".
 *
 * Errors are collected rather than thrown one at a time, because they are fed back to the
 * model verbatim for the one repair round (FR-48) — and a list of six problems produces a
 * better second attempt than the first of them does.
 */
import { libraryHas, libraryName } from './payload.js';

// The closed list (FR-23 / C3). Adding a member here is a deliberate act with an apply
// implementation on the client to match; there is no default case anywhere.
export const CHANGE_TYPES = [
  'add-exercise', 'remove-exercise', 'swap-exercise',
  'sets', 'reps', 'repsMin', 'repsMax', 'sec', 'cardio',
  'reorder', 'superset',
  'routine-prog', 'exercise-prog', 'inc',
  'add-routine', 'remove-routine', 'rename-routine',
  'week'
];
const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time'];
const MODES = ['reps', 'time', 'cardio'];
const MAX_CHANGES = 25;
const MAX_ROUTINES = 7;
const MAX_EX_PER_ROUTINE = 20;

const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n);

/* ---------- the two v1.2.4 flags, enforced rather than merely accepted ----------
   `prompts/common.md` tells the model that unilateral work is prescribed as the total across
   both sides and therefore steps in twos, and that a rep ceiling is what turns "+1 rep
   forever" into "add a set". A prompt that asks is not a guarantee; these are the two rules
   from it that have a single right answer, so they are checked here and the repair round gets
   a chance to fix them. Everything else in that file is coaching judgement and stays advisory. */
const ODD_PER_SIDE = where =>
  `${where} is a per-side exercise, so reps are the total across both sides and must be an even number`;
const INVERTED_RANGE = where =>
  `${where} sets a rep ceiling below its own floor — repsMax must be at least repsMin`;

/* =============================== created plans =============================== */

/**
 * Validate a creation bundle into something `mergePlan` can consume unchanged.
 * Returns { ok, bundle } or { ok:false, errors }.
 */
export function validatePlan(data, ctx = {}) {
  const errors = [];
  if (!data || typeof data !== 'object') return fail(['the answer was not an object']);
  if (data.nochange) return fail(['a plan was requested but the answer said "no change"']);
  if (!Array.isArray(data.routines) || !data.routines.length) errors.push('routines must be a non-empty array');

  const customEx = (Array.isArray(data.customEx) ? data.customEx : [])
    .filter(c => c && isStr(c.id) && isStr(c.n))
    .slice(0, 20)
    .map(c => ({ id: clampStr(c.id, 40), n: clampStr(c.n, 60), bp: clampStr(c.bp || 'waist', 30), ...(c.desc ? { desc: clampStr(c.desc, 400) } : {}) }));
  const proposedIds = new Set(customEx.map(c => c.id));

  const routines = [];
  (Array.isArray(data.routines) ? data.routines : []).slice(0, MAX_ROUTINES).forEach((r, ri) => {
    if (!r || typeof r !== 'object') { errors.push(`routines[${ri}] is not an object`); return; }
    if (!isStr(r.name)) errors.push(`routines[${ri}].name is required`);
    if (r.prog != null && !POLICIES.includes(r.prog)) errors.push(`routines[${ri}].prog "${r.prog}" is not one of ${POLICIES.join(', ')}`);
    const ex = [];
    (Array.isArray(r.ex) ? r.ex : []).slice(0, MAX_EX_PER_ROUTINE).forEach((e, ei) => {
      const where = `routines[${ri}].ex[${ei}]`;
      if (!e || !isStr(e.id)) { errors.push(`${where}.id is required`); return; }
      // FR-16: an id that resolves to nothing invalidates the proposal rather than being
      // dropped into a plan that renders blank the first time it is trained.
      if (!libraryHas(e.id) && !proposedIds.has(e.id)) {
        errors.push(`${where}.id "${e.id}" is not in the exercise library and is not one of your own customEx entries — use an id from the library provided in the payload`);
        return;
      }
      const clean = { id: e.id, sets: isInt(e.sets, 1, 10) ? e.sets : 3 };
      const mode = MODES.includes(e.mode) ? e.mode : 'reps';
      const perSide = !!e.side;
      if (mode === 'cardio') {
        clean.min = isInt(e.min, 1, 180) ? e.min : 20;
        clean.speed = isNum(e.speed) && e.speed > 0 ? e.speed : 8;
      } else if (mode === 'time') {
        clean.mode = 'time';
        clean.sec = isInt(e.sec, 5, 3600) ? e.sec : 45;
        if (isNum(e.weight) && e.weight > 0) clean.weight = e.weight;
      } else {
        clean.mode = 'reps';
        clean.reps = isInt(e.reps, 1, 100) ? e.reps : 10;
        if (perSide && clean.reps % 2) { errors.push(ODD_PER_SIDE(`${where}.reps`)); return; }
        if (isNum(e.weight) && e.weight > 0) clean.weight = e.weight;
      }
      if (e.prog != null) {
        if (!POLICIES.includes(e.prog)) errors.push(`${where}.prog "${e.prog}" is not one of ${POLICIES.join(', ')}`);
        else clean.prog = e.prog;
      }
      if (isNum(e.inc) && e.inc > 0) clean.inc = e.inc;
      if (isInt(e.repsMin, 1, 100)) clean.repsMin = e.repsMin;
      // The ceiling that makes bodyweight progression terminate (upstream #33): reaching it
      // adds a set and restarts the reps. Without it the Coach can neither see nor prescribe
      // how a push-up is meant to get harder.
      if (isInt(e.repsMax, 1, 100)) clean.repsMax = e.repsMax;
      if (clean.repsMax != null && clean.repsMin != null && clean.repsMax < clean.repsMin) {
        errors.push(INVERTED_RANGE(where)); return;
      }
      // Written out only when the plan disagrees with the catalogue, matching plan-share.js —
      // an absent flag means "whatever the exercise says", which is what every plan written
      // before these existed relies on.
      if (e.bodyweight != null) clean.bodyweight = !!e.bodyweight;
      if (perSide) clean.side = true;
      if (isStr(e.sg)) clean.sg = clampStr(e.sg, 20);
      if (isStr(e.why)) clean.why = clampStr(e.why, 400);
      ex.push(clean);
    });
    if (!ex.length) errors.push(`routines[${ri}] has no valid exercises`);
    routines.push({
      id: isStr(r.id) ? clampStr(r.id, 40) : 'r' + ri,
      name: clampStr(r.name || 'Routine', 40),
      emoji: clampStr(r.emoji || '🏋️', 8),
      ...(POLICIES.includes(r.prog) ? { prog: r.prog } : {}),
      ...(isStr(r.why) ? { why: clampStr(r.why, 400) } : {}),
      ex
    });
  });

  // The week may only point at routines this bundle actually defines.
  const known = new Set(routines.map(r => r.id));
  const week = {};
  Object.entries(data.week || {}).forEach(([d, rid]) => {
    const day = +d;
    if (!isInt(day, 0, 6)) { errors.push(`week key "${d}" is not a weekday number 0-6`); return; }
    if (!known.has(rid)) { errors.push(`week[${d}] points at "${rid}", which is not one of the routines in this plan`); return; }
    week[day] = rid;
  });

  // FR-20: never start someone above what they have actually lifted.
  const caps = new Map((ctx.workingWeights || []).map(w => [w.id, w.best]));
  routines.forEach(r => r.ex.forEach(e => {
    const cap = caps.get(e.id);
    if (cap != null && e.weight > cap) e.weight = cap;
  }));

  // FR-17: honour the number of training days the user asked for.
  const want = ctx.daysPerWeek;
  if (isInt(want, 1, 7) && Object.keys(week).length && Object.keys(week).length !== want) {
    errors.push(`the week schedules ${Object.keys(week).length} days but ${want} were asked for`);
  }

  if (errors.length) return fail(errors);
  return {
    ok: true,
    bundle: {
      opengym_plan: 1,
      name: clampStr(data.name || 'Coach plan', 40),
      summary: clampStr(data.summary || '', 1200),
      basedOn: clampStr(data.basedOn || '', 400),
      week, routines, customEx
    }
  };
}

/* =============================== review change-sets =============================== */

/**
 * Validate a review answer. Returns { ok, nochange } | { ok, proposal } | { ok:false, errors }.
 * `plan` is the payload's cleaned plan — every target must resolve against it, so a change
 * aimed at a routine that no longer exists never reaches the review screen.
 */
export function validateReview(data, plan) {
  if (!data || typeof data !== 'object') return fail(['the answer was not an object']);
  if (data.nochange) {
    return { ok: true, nochange: true, reading: clampStr(data.reading || data.summary || '', 1200) };
  }
  const errors = [];
  const routines = new Map((plan?.routines || []).map(r => [r.id, r]));
  const changes = [];
  const list = Array.isArray(data.changes) ? data.changes : null;
  if (!list) return fail(['changes must be an array (or set "nochange": true with a "reading")']);

  list.slice(0, MAX_CHANGES).forEach((c, i) => {
    const where = `changes[${i}]`;
    if (!c || typeof c !== 'object') { errors.push(`${where} is not an object`); return; }
    if (!CHANGE_TYPES.includes(c.type)) {
      errors.push(`${where}.type "${c.type}" is not allowed — use one of: ${CHANGE_TYPES.join(', ')}`);
      return;
    }
    if (!isStr(c.why)) { errors.push(`${where}.why is required — every change must cite the evidence behind it`); return; }
    const target = c.target || {};
    const routine = target.routineId ? routines.get(target.routineId) : null;

    // Targets: everything but add-routine and week must name a routine that exists; anything
    // touching an exercise must name one that is actually in it.
    if (!['add-routine', 'week'].includes(c.type)) {
      if (!routine) { errors.push(`${where}.target.routineId "${target.routineId}" is not one of the routines in the plan`); return; }
    }
    const needsEx = ['remove-exercise', 'swap-exercise', 'sets', 'reps', 'repsMin', 'repsMax', 'sec', 'cardio', 'exercise-prog', 'inc', 'superset'];
    let planned = null;
    if (needsEx.includes(c.type)) {
      if (!target.exId) { errors.push(`${where}.target.exId is required for type "${c.type}"`); return; }
      planned = (routine.ex || []).find(e => e.id === target.exId) || null;
      if (!planned) {
        errors.push(`${where}.target.exId "${target.exId}" is not in routine "${routine.name}"`); return;
      }
    }

    const out = {
      id: isStr(c.id) ? clampStr(c.id, 40) : 'c' + i,
      type: c.type,
      target: {
        ...(target.routineId ? { routineId: target.routineId } : {}),
        ...(target.exId ? { exId: target.exId } : {}),
        ...(isInt(target.weekday, 0, 6) ? { weekday: target.weekday } : {})
      },
      why: clampStr(c.why, 600),
      before: currentOf(c.type, routine, planned, plan, target),
      after: c.after ?? null
    };

    // Per-type checks on `after`. `before` is not checked because it is not taken: it is read
    // off the plan above, which is the only copy either side should trust.
    switch (c.type) {
      case 'add-exercise': {
        const a = c.after || {};
        if (!isStr(a.id) || !libraryHas(a.id)) { errors.push(`${where}.after.id must be an exercise id from the library`); return; }
        const perSide = !!a.side;
        if (perSide && isInt(a.reps, 1, 100) && a.reps % 2) { errors.push(ODD_PER_SIDE(`${where}.after.reps`)); return; }
        if (isInt(a.repsMax, 1, 100) && isInt(a.repsMin, 1, 100) && a.repsMax < a.repsMin) { errors.push(INVERTED_RANGE(`${where}.after`)); return; }
        out.after = {
          id: a.id, name: libraryName(a.id),
          sets: isInt(a.sets, 1, 10) ? a.sets : 3,
          ...(MODES.includes(a.mode) ? { mode: a.mode } : { mode: 'reps' }),
          ...(isInt(a.reps, 1, 100) ? { reps: a.reps } : {}),
          ...(isInt(a.sec, 5, 3600) ? { sec: a.sec } : {}),
          ...(isNum(a.weight) && a.weight > 0 ? { weight: a.weight } : {}),
          ...(POLICIES.includes(a.prog) ? { prog: a.prog } : {}),
          ...(isInt(a.repsMin, 1, 100) ? { repsMin: a.repsMin } : {}),
          ...(isInt(a.repsMax, 1, 100) ? { repsMax: a.repsMax } : {}),
          ...(a.bodyweight != null ? { bodyweight: !!a.bodyweight } : {}),
          ...(perSide ? { side: true } : {}),
          ...(isInt(a.position, 0, MAX_EX_PER_ROUTINE) ? { position: a.position } : {})
        };
        break;
      }
      case 'swap-exercise': {
        const a = c.after || {};
        if (!isStr(a.id) || !libraryHas(a.id)) { errors.push(`${where}.after.id must be an exercise id from the library`); return; }
        if (a.id === target.exId) { errors.push(`${where} swaps an exercise for itself`); return; }
        out.after = {
          id: a.id, name: libraryName(a.id),
          ...(isInt(a.sets, 1, 10) ? { sets: a.sets } : {}),
          ...(isInt(a.reps, 1, 100) ? { reps: a.reps } : {}),
          ...(isNum(a.weight) && a.weight > 0 ? { weight: a.weight } : {})
        };
        break;
      }
      case 'remove-exercise':
      case 'remove-routine':
        out.after = null;
        break;
      case 'sets': if (!isInt(c.after, 1, 10)) { errors.push(`${where}.after must be a whole number of sets (1-10)`); return; } break;
      case 'reps':
        if (!isInt(c.after, 1, 100)) { errors.push(`${where}.after must be a whole number of reps (1-100)`); return; }
        // The plan is what says whether this exercise is unilateral, so the rule is checked
        // against the plan rather than against whatever the change claims about itself.
        if (planned?.side && c.after % 2) { errors.push(ODD_PER_SIDE(`${where}.after`)); return; }
        break;
      case 'repsMin':
        if (!isInt(c.after, 1, 100)) { errors.push(`${where}.after must be a whole number (1-100)`); return; }
        if (planned?.repsMax != null && c.after > planned.repsMax) { errors.push(INVERTED_RANGE(where)); return; }
        break;
      case 'repsMax':
        if (!isInt(c.after, 1, 100)) { errors.push(`${where}.after must be a whole number (1-100)`); return; }
        if (planned?.repsMin != null && c.after < planned.repsMin) { errors.push(INVERTED_RANGE(where)); return; }
        break;
      case 'sec': if (!isInt(c.after, 5, 3600) ) { errors.push(`${where}.after must be seconds (5-3600)`); return; } break;
      case 'cardio': {
        const a = c.after || {};
        // Distance is the third dimension endurance work is actually prescribed in: a run and a
        // row are set by how far, not by a km/h dial. Metres, capped at 200 km — far past any
        // session anyone plans, and low enough that a stray unit conversion is caught here.
        if (!isInt(a.min, 1, 180) && !isNum(a.speed) && !isInt(a.dist, 1, 200000)) {
          errors.push(`${where}.after must carry min, dist and/or speed`); return;
        }
        out.after = {
          ...(isInt(a.min, 1, 180) ? { min: a.min } : {}),
          ...(isInt(a.dist, 1, 200000) ? { dist: a.dist } : {}),
          ...(isNum(a.speed) && a.speed > 0 ? { speed: a.speed } : {})
        };
        break;
      }
      case 'inc': if (!isNum(c.after) || c.after <= 0) { errors.push(`${where}.after must be a positive increment`); return; } break;
      case 'routine-prog':
      case 'exercise-prog':
        if (!POLICIES.includes(c.after)) { errors.push(`${where}.after must be one of ${POLICIES.join(', ')}`); return; }
        break;
      case 'reorder': {
        const order = Array.isArray(c.after) ? c.after : null;
        if (!order) { errors.push(`${where}.after must be an array of exercise ids in the new order`); return; }
        const have = (routine.ex || []).map(e => e.id);
        // Same ids, each exactly once. Length plus membership is not enough: a list that names
        // one exercise twice and omits another satisfies both, and a reorder is the one change
        // type with nothing to show in the diff column — so it deletes an exercise on apply
        // with no way for the person approving it to see that it would.
        if (order.length !== have.length || new Set(order).size !== order.length || order.some(id => !have.includes(id))) {
          errors.push(`${where}.after must list exactly the ${have.length} exercise ids already in "${routine.name}", each once, reordered`); return;
        }
        out.after = order;
        break;
      }
      case 'superset': {
        const a = c.after || {};
        if (a.link && !isStr(a.with)) { errors.push(`${where}.after.with is required when linking a superset`); return; }
        // Supersetting something with itself resolves to a real exercise and passes the
        // membership check below; the apply path then moves the anchor out from under itself.
        if (a.link && a.with === target.exId) { errors.push(`${where} supersets an exercise with itself`); return; }
        if (a.link && !(routine.ex || []).some(e => e.id === a.with)) { errors.push(`${where}.after.with "${a.with}" is not in routine "${routine.name}"`); return; }
        out.after = { link: !!a.link, ...(a.link ? { with: a.with } : {}) };
        break;
      }
      case 'add-routine': {
        const a = c.after || {};
        if (!isStr(a.name)) { errors.push(`${where}.after.name is required`); return; }
        // FR-16 again, and for the same reason it applies to a created plan: an id that
        // resolves to nothing invalidates the proposal. Filtering it out instead would build
        // the routine the model asked for minus the exercises it could not have, and hand that
        // to someone as if it were what they were shown.
        const listed = Array.isArray(a.ex) ? a.ex : [];
        const bad = listed.find(e => !e || !isStr(e.id) || !libraryHas(e.id));
        if (bad) { errors.push(`${where}.after.ex "${bad.id}" is not in the exercise library — use an id from the library provided in the payload`); return; }
        const ex = listed.slice(0, MAX_EX_PER_ROUTINE);
        if (!ex.length) { errors.push(`${where}.after.ex must list at least one exercise from the library`); return; }
        const odd = ex.find(e => e.side && isInt(e.reps, 1, 100) && e.reps % 2);
        if (odd) { errors.push(ODD_PER_SIDE(`${where}.after.ex "${odd.id}"`)); return; }
        out.after = {
          name: clampStr(a.name, 40), emoji: clampStr(a.emoji || '🏋️', 8),
          ...(POLICIES.includes(a.prog) ? { prog: a.prog } : {}),
          ex: ex.map(e => ({
            id: e.id, name: libraryName(e.id),
            sets: isInt(e.sets, 1, 10) ? e.sets : 3,
            mode: MODES.includes(e.mode) ? e.mode : 'reps',
            ...(isInt(e.reps, 1, 100) ? { reps: e.reps } : {}),
            ...(isInt(e.sec, 5, 3600) ? { sec: e.sec } : {}),
            ...(isInt(e.repsMax, 1, 100) ? { repsMax: e.repsMax } : {}),
            ...(e.bodyweight != null ? { bodyweight: !!e.bodyweight } : {}),
            ...(e.side ? { side: true } : {})
          }))
        };
        break;
      }
      case 'rename-routine':
        if (!isStr(c.after)) { errors.push(`${where}.after must be the new routine name`); return; }
        out.after = clampStr(c.after, 40);
        break;
      case 'week': {
        if (!isInt(target.weekday, 0, 6)) { errors.push(`${where}.target.weekday must be 0-6`); return; }
        // null/'rest' clears the day; anything else has to be a routine that exists.
        if (c.after != null && c.after !== 'rest' && !routines.has(c.after)) {
          errors.push(`${where}.after must be a routine id from the plan, "rest", or null`); return;
        }
        out.after = c.after ?? null;
        break;
      }
    }
    changes.push(out);
  });

  if (errors.length) return fail(errors);
  if (!changes.length) {
    // An empty change list and "no changes" are the same outcome; treat it as the latter
    // rather than showing someone an empty proposal screen (FR-25).
    return { ok: true, nochange: true, reading: clampStr(data.summary || data.reading || '', 1200) };
  }
  return {
    ok: true,
    proposal: {
      summary: clampStr(data.summary || '', 1200),
      evidence: {
        from: data.evidence?.from || null,
        to: data.evidence?.to || null,
        sessions: isInt(data.evidence?.sessions, 0, 10000) ? data.evidence.sessions : null
      },
      changes,
      notes: (Array.isArray(data.notes) ? data.notes : []).filter(isStr).slice(0, 6).map(n => clampStr(n, 600))
    }
  };
}

/**
 * What the plan says right now for whatever a change is about — the `before` the client checks
 * for staleness. Read off the plan rather than copied from the answer, because the model's idea
 * of the current value is the one field on a change that nothing else constrains: an object of
 * any size passes through into the proposal and then into the synced Coach log, and a merely
 * mistyped one ("3 sets" where the plan holds 3) makes markStale() disable a change that was
 * perfectly good. The plan is already in scope here, and it is not a matter of opinion.
 *
 * Mirrors `currentValue` in frontend/src/lib/coach.js — structural changes have no single
 * scalar to compare and get null, which that function reads as "nothing to check".
 */
function currentOf(type, routine, planned, plan, target) {
  switch (type) {
    case 'sets': return planned?.sets ?? null;
    case 'reps': return planned?.reps ?? null;
    case 'repsMin': return planned?.repsMin ?? null;
    case 'repsMax': return planned?.repsMax ?? null;
    case 'sec': return planned?.sec ?? null;
    case 'inc': return planned?.inc ?? null;
    case 'exercise-prog': return planned?.prog ?? null;
    case 'routine-prog': return routine?.prog ?? null;
    case 'rename-routine': return routine?.name ?? null;
    case 'week': return plan?.week?.[target?.weekday] ?? null;
    default: return null;
  }
}

function fail(errors) { return { ok: false, errors }; }
