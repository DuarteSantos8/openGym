// Flat name lists for the Coach drift test (spec §15.7): the API keeps its own copy in
// api/coach/core/vocabulary.js and the drift test tells you when the two differ.

export const CHANGE_TYPES = [
  'add-exercise', 'remove-exercise', 'swap-exercise',
  'sets', 'reps', 'repsMin', 'repsMax', 'sec', 'cardio',
  'reorder', 'superset',
  'routine-prog', 'exercise-prog', 'inc',
  'add-routine', 'remove-routine', 'rename-routine',
  'week'
]
export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time']
export const POLICY_IDS = POLICIES
export const MODES = ['reps', 'time', 'cardio']
