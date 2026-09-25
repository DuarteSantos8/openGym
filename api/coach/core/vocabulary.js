// The closed lists the Coach validator answers "is it safe to act on" against. Extracted from
// validate.js so the same knowledge has one home on this side — validate.js remains the only
// thing that makes the decision, and the security boundary is untouched.
//
// A leaf module with no imports: frontend/ is not in the API's Docker build context, so the
// mirrored list lives in frontend/src/lib/prescription/vocabulary.js and a drift test
// in the frontend suite asserts the two are set-equal. Changing a list means editing both.
export const CHANGE_TYPES = [
  'add-exercise', 'remove-exercise', 'swap-exercise',
  'sets', 'reps', 'repsMin', 'repsMax', 'sec', 'cardio',
  'reorder', 'superset',
  'routine-prog', 'exercise-prog', 'inc',
  'add-routine', 'remove-routine', 'rename-routine',
  'week'
];
export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time'];
export const MODES = ['reps', 'time', 'cardio'];
