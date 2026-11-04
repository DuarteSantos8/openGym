// Flat name lists for the Coach drift test: the API keeps its own copy in
// api/coach/core/vocabulary.js and the drift test tells you when the two differ.

export const CHANGE_TYPES = [
  'add-exercise', 'remove-exercise', 'swap-exercise',
  'sets', 'reps', 'repsMin', 'repsMax', 'sec', 'cardio',
  'reorder', 'superset',
  'routine-prog', 'exercise-prog', 'inc',
  'add-routine', 'remove-routine', 'rename-routine',
  'week', 'warmup', 'programme'
]
export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'triple', 'time']
export const POLICY_IDS = POLICIES
export const MODES = ['reps', 'time', 'cardio']

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  triple: 'Triple progression',
  time: 'Add time'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up (twice as much if you double the reps). One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  triple: 'Reps climb to the top of the range, then a set is added, up to your most sets. All of them at the top and the weight goes up, back to your first sets and reps.',
  time: 'Hold every set for the full duration and the target goes up.'
}

export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double', 'triple'],
  time: ['off', 'time'],
  cardio: ['off']
}
export const profileRule = S => POLICIES_FOR.reps.includes(S?.progDefault) ? S.progDefault : 'linear'
