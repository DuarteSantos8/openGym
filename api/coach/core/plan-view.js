/* The Coach speaks v1 exercise fields (sets, reps, repsMin, repsMax, sec, min, weight, prog, inc);
 * the plan stores a PlanRule per occurrence. This is the one translation between them — read
 * here, written back by ruleFromView — so the wire contract, the prompts and the validators never
 * learn the rule format. An object with no `rule` (a v1 state file not yet migrated, or a Coach
 * bundle item) is passed through untouched. */
import { PRESETS, defaultPlanRule, editPlan, isTemplateRule, planOptions, planPhase, policyOfPreset, presetForPolicy } from '../../engine/index.js';

const modeOfOcc = (occ, ex) => occ.mode || (ex && ex.bp === 'cardio' ? 'cardio' : planPhase(occ.rule).parameters.durationSeconds ? 'time' : 'reps');

export function coachExOf(occ, ex = null) {
  if (!occ || !occ.rule) return occ;
  const r = occ.rule, p = planPhase(r).parameters, step = planOptions(r).step;
  const mode = modeOfOcc(occ, ex);
  const policy = policyOfPreset(r.preset);
  const o = { id: occ.exerciseId, mode, sets: p.sets.min };
  if (p.sets.max > p.sets.min) o.setsMax = p.sets.max;
  if (mode === 'reps') {
    o.reps = p.reps.min;
    if (p.reps.min !== p.reps.max) { o.repsMin = p.reps.min; o.repsMax = p.reps.max; }
  } else if (p.durationSeconds) {
    if (mode === 'cardio') { o.min = p.durationSeconds.min / 60; if (p.speed) o.speed = p.speed; } else o.sec = p.durationSeconds.min;
  }
  if (p.load.mode === 'absolute' && p.load.value > 0) o.weight = p.load.value;
  // v1's `inc` is a load step, or the seconds a timed hold grows by.
  if ((step?.type === 'absolute' || step?.type === 'seconds') && step.value > 0 && PRESETS[r.preset].steps) o.inc = step.value;
  o.prog = policy ?? 'off';
  if (policy == null) o.preset = r.preset;
  if (occ.sg) o.sg = occ.sg;
  return o;
}

/** Routines with every occurrence read through coachExOf. `exOf(id)` resolves the catalogue entry. */
export const coachRoutinesOf = (S, exOf) =>
  (S.routines || []).map(r => ({ ...r, ex: (r.ex || []).map(e => coachExOf(e, exOf(e.exerciseId ?? e.id))) }));

/** A rule carrying the Coach's v1 fields in `view`. Same preset → its template numbers edited; a
 *  new policy → that preset's defaults. `revision` is left as it was — the caller bumps it for an
 *  edit. The Coach speaks one flat plan: a program it cannot express that way (several phases, or
 *  one edited past its template) is refused with a reason, never flattened. */
export function ruleFromView(rule, view, { unit, bodyweight = false }) {
  const policy = policyOfPreset(rule.preset) ?? 'off';
  const preset = view.prog != null && view.prog !== policy ? presetForPolicy(view.prog, view.mode, bodyweight) : rule.preset;
  const base = preset === rule.preset ? rule : { ...defaultPlanRule(preset, { id: rule.id, exerciseId: view.id, routineId: rule.routineId, unit }), revision: rule.revision };
  if (preset === rule.preset && !isTemplateRule(rule)) throw new Error('coach-cannot-edit-custom-program');
  const p = planOptions(base);
  const o = {};
  const fixed = n => ({ min: n, max: n });
  if (view.sets > 0) o.sets = preset === 'triple' ? { min: view.sets, max: Math.max(view.sets, view.setsMax ?? p.sets.max) } : fixed(view.sets);
  if (view.mode === 'reps') {
    // ponytail: a range wins over `reps` on a preset that allows one; a lone `reps` change on a
    // double-progression exercise is therefore a no-op. Upgrade if the Coach starts proposing it.
    if (PRESETS[preset].ranges.reps !== 'fixed' && view.repsMin > 0 && view.repsMax >= view.repsMin) o.reps = { min: view.repsMin, max: view.repsMax };
    else if (view.reps > 0) o.reps = fixed(view.reps);
  } else {
    const seconds = view.mode === 'cardio' ? (view.min > 0 ? view.min * 60 : 0) : (view.sec > 0 ? view.sec : 0);
    // coachExOf reads a seconds range as its minimum: an unchanged `sec` keeps the range.
    if (seconds && seconds !== p.durationSeconds?.min) Object.assign(o, { reps: fixed(1), durationSeconds: fixed(seconds) });
    if (view.mode === 'cardio' && view.speed > 0 && (o.durationSeconds || p.durationSeconds)) o.speed = view.speed;
  }
  if (view.weight > 0) o.load = { mode: 'absolute', value: view.weight, unit };
  if (view.inc > 0) o.step = preset === 'hold_seconds' ? { type: 'seconds', value: view.inc } : { type: 'absolute', value: view.inc, unit };
  const shape = ['sets', 'reps', 'durationSeconds'].filter(k => k in o && JSON.stringify(o[k]) !== JSON.stringify(p[k]));
  if (shape.length && base.program.phases.length > 1 && !['bodyweight_ladder', 'linear', 'greyskull', 'double', 'triple'].includes(preset)) throw new Error('coach-cannot-flatten-phases');
  return editPlan({ ...base, exerciseId: view.id }, o);
}
