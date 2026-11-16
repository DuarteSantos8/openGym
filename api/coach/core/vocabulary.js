// The closed lists the Coach validator answers "is it safe to act on" against. Extracted from
// validate.js so the same knowledge has one home on this side — validate.js remains the only
// thing that makes the decision, and the security boundary is untouched.
//
// A leaf module with no imports: the frontend reads the same lists from here
// (frontend/src/lib/prescription/vocabulary.js), never the other way round.
export const CHANGE_TYPES = [
  'add-exercise', 'remove-exercise', 'swap-exercise',
  'sets', 'reps', 'repsMin', 'repsMax', 'sec', 'cardio',
  'reorder', 'superset',
  'routine-prog', 'exercise-prog', 'inc',
  'add-routine', 'remove-routine', 'rename-routine',
  'week', 'warmup', 'programme'
];
export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'steady', 'triple', 'undulating', 'density', 'ladder', 'time'];
export const MODES = ['reps', 'time', 'cardio'];
