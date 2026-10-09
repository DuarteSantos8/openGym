/* A revision that came back as a list of changes instead of a whole plan (#471).
 *
 * The refine task asks for the complete revised plan, and the prompt says so. A model that does
 * not enforce the schema can still answer "swap the leverage machine" in the review format it
 * knows best: one `swap-exercise` against the plan it was shown. Turning that into a failed job
 * throws away an answer whose meaning is perfectly clear, so the exercise-level changes are
 * laid onto `refine.previous` here and the result goes through validatePlan like any other
 * plan. Nothing is trusted on the way: an id, a set count or a rep target that is wrong is
 * still the validator's to refuse.
 *
 * Only changes that can be placed without guessing are taken. A change names a routine by the
 * id it saw, and the model may have read that id off the plan the person trains today rather
 * than the proposal it is revising; then the routine is the one proposed routine that holds the
 * exercise being changed. Anything that cannot be placed exactly, or a change type that reaches
 * past one exercise (a week move, a new routine), returns null and the answer goes to the
 * repair round as before.
 */

const PLACEABLE = new Set(['swap-exercise', 'remove-exercise', 'add-exercise', 'sets', 'reps', 'repsMin', 'repsMax', 'sec']);

/** Is this answer a review-style change list rather than a plan? */
export const isChangeList = data => !!data && typeof data === 'object'
  && Array.isArray(data.changes) && data.changes.length > 0
  && !(Array.isArray(data.routines) && data.routines.length);

function routineFor(routines, target) {
  const byId = routines.find(r => r.id === target.routineId);
  if (byId) return byId;
  if (typeof target.exId !== 'string') return null;
  const holding = routines.filter(r => r.ex.some(e => e.id === target.exId));
  return holding.length === 1 ? holding[0] : null;
}

/**
 * Apply a change list to the plan being revised. Returns a plan answer for validatePlan, or
 * null when any change cannot be placed exactly.
 */
export function changesOntoPlan(previous, data) {
  if (!previous || !Array.isArray(previous.routines) || !isChangeList(data)) return null;
  const routines = previous.routines.map(r => ({ ...r, ex: (r.ex || []).map(e => ({ ...e })) }));
  for (const c of data.changes) {
    if (!c || typeof c !== 'object' || !PLACEABLE.has(c.type)) return null;
    const target = c.target && typeof c.target === 'object' ? c.target : {};
    const routine = routineFor(routines, target);
    if (!routine) return null;
    if (c.type === 'add-exercise') {
      const a = c.after;
      if (!a || typeof a !== 'object' || typeof a.id !== 'string') return null;
      const { position, ...ex } = a;
      const at = Number.isInteger(position) && position >= 0 && position <= routine.ex.length ? position : routine.ex.length;
      routine.ex.splice(at, 0, { sets: 3, ...ex, ...(typeof c.why === 'string' ? { why: c.why } : {}) });
      continue;
    }
    const i = routine.ex.findIndex(e => e.id === target.exId);
    if (i < 0) return null;
    if (c.type === 'remove-exercise') { routine.ex.splice(i, 1); continue; }
    if (c.type === 'swap-exercise') {
      const a = c.after;
      if (!a || typeof a !== 'object' || typeof a.id !== 'string') return null;
      // The new exercise takes the old one's slot and prescription, minus what only described
      // the old one; what the change states itself wins.
      const { id: _old, weight: _w, why: _why, bodyweight: _bw, side: _side, ...kept } = routine.ex[i];
      routine.ex[i] = {
        ...kept, id: a.id,
        ...(a.sets != null ? { sets: a.sets } : {}),
        ...(a.reps != null ? { reps: a.reps } : {}),
        ...(a.weight != null ? { weight: a.weight } : {}),
        ...(typeof c.why === 'string' ? { why: c.why } : {})
      };
      continue;
    }
    // A value of the wrong kind would be quietly defaulted by the plan validator; refuse it here.
    if (!Number.isInteger(c.after)) return null;
    routine.ex[i] = { ...routine.ex[i], [c.type]: c.after };
  }
  return {
    coach_contract: data.coach_contract,
    name: previous.name,
    summary: typeof data.summary === 'string' && data.summary.trim() ? data.summary : previous.summary,
    basedOn: previous.basedOn,
    week: previous.week,
    routines,
    customEx: previous.customEx || []
  };
}
