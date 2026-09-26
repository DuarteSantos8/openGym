/* The Coach speaks v1 exercise fields (sets, reps, repsMin, repsMax, sec, min, weight, prog, inc);
 * the plan stores a PlanRule per occurrence. This is the one translation between them — read
 * here, written back by ruleFromView — so the wire contract, the prompts and the validators never
 * learn the rule format. An object with no `rule` (a v1 state file not yet migrated, or a Coach
 * bundle item) is passed through untouched. */
import { PRESETS, defaultPlanRule, policyOfPreset, presetForPolicy } from '../../engine/index.js';

const modeOfOcc = (occ, ex) => occ.mode || (ex && ex.bp === 'cardio' ? 'cardio' : occ.rule.parameters.durationSeconds ? 'time' : 'reps');

export function coachExOf(occ, ex = null) {
  if (!occ || !occ.rule) return occ;
  const r = occ.rule, p = r.parameters;
  const mode = modeOfOcc(occ, ex);
  const policy = policyOfPreset(r.preset);
  const o = { id: occ.exerciseId, mode, sets: p.sets.min };
  if (mode === 'reps') {
    o.reps = p.reps.min;
    if (p.reps.min !== p.reps.max) { o.repsMin = p.reps.min; o.repsMax = p.reps.max; }
  } else if (p.durationSeconds) {
    if (mode === 'cardio') o.min = p.durationSeconds.min / 60; else o.sec = p.durationSeconds.min;
  }
  if (p.load.mode === 'absolute' && p.load.value > 0) o.weight = p.load.value;
  if (r.increment.type === 'absolute' && r.increment.value > 0) o.inc = r.increment.value;
  o.prog = policy ?? 'off';
  if (policy == null) o.preset = r.preset;
  if (occ.sg) o.sg = occ.sg;
  return o;
}

/** Routines with every occurrence read through coachExOf. `exOf(id)` resolves the catalogue entry. */
export const coachRoutinesOf = (S, exOf) =>
  (S.routines || []).map(r => ({ ...r, ex: (r.ex || []).map(e => coachExOf(e, exOf(e.exerciseId ?? e.id))) }));

/** A rule carrying the Coach's v1 fields in `view`. Same preset → a clone; a new policy → that
 *  preset's defaults. `revision` is left as it was — the caller bumps it for an edit. */
export function ruleFromView(rule, view, { unit, bodyweight = false }) {
  const policy = policyOfPreset(rule.preset) ?? 'off';
  const preset = view.prog != null && view.prog !== policy ? presetForPolicy(view.prog, view.mode, bodyweight) : rule.preset;
  const out = preset === rule.preset
    ? JSON.parse(JSON.stringify(rule))
    : { ...defaultPlanRule(preset, { id: rule.id, exerciseId: view.id, routineId: rule.routineId, unit }), revision: rule.revision };
  out.exerciseId = view.id;
  const p = out.parameters;
  const fixed = n => ({ min: n, max: n });
  if (view.sets > 0) p.sets = fixed(view.sets);
  if (view.mode === 'reps') {
    // ponytail: a range wins over `reps` on a preset that allows one; a lone `reps` change on a
    // double-progression exercise is therefore a no-op. Upgrade if the Coach starts proposing it.
    if (PRESETS[preset].ranges.reps !== 'fixed' && view.repsMin > 0 && view.repsMax >= view.repsMin) p.reps = { min: view.repsMin, max: view.repsMax };
    else if (view.reps > 0) p.reps = fixed(view.reps);
  } else {
    const seconds = view.mode === 'cardio' ? (view.min > 0 ? view.min * 60 : 0) : (view.sec > 0 ? view.sec : 0);
    // coachExOf reads a seconds range as its minimum: an unchanged `sec` keeps the range.
    if (seconds && seconds !== p.durationSeconds?.min) Object.assign(p, { reps: fixed(1), durationSeconds: fixed(seconds) });
  }
  if (view.weight > 0) p.load = { mode: 'absolute', value: view.weight, unit };
  if (view.inc > 0) out.increment = { type: 'absolute', value: view.inc, unit };
  return out;
}
