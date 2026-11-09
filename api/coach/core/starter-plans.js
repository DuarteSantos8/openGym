/* The starter plans as data, shared by the app's plan chooser (frontend/src/lib/starter.js) and
 * the Coach's routines library (core/routine-library.js), so both offer exactly the same plans.
 *
 * A routine is [key, name, glyph, [[exerciseId, sets, reps], …]]; a timed exercise (a plank, a
 * hang) is [exerciseId, sets, seconds, 'time'] (#964). The key is what a plan's schedule points
 * at, so a weekday never depends on the position of a routine in the array. Names stay canonical
 * English: they become ordinary user routines, which are not translated. */
const PPL = [
  ['push', 'Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['pull', 'Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['legs', 'Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

const UPPER_LOWER = [
  ['upper-a', 'Upper A', 'barbell', [['0025', 3, 8], ['2330', 3, 10], ['0047', 2, 10], ['1323', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
  ['lower-a', 'Lower A', 'legs', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
  ['upper-b', 'Upper B', 'barbell', [['0047', 3, 8], ['0027', 3, 8], ['0426', 2, 10], ['2330', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0313', 2, 12]]],
  ['lower-b', 'Lower B', 'legs', [['0739', 3, 10], ['0085', 2, 10], ['0585', 2, 12], ['0586', 3, 12], ['0605', 3, 15]]]
]

const FULL_BODY = [
  ['fb-a', 'Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 3, 12], ['0334', 2, 12], ['0031', 2, 12]]],
  ['fb-b', 'Full Body B', 'figureStrength', [['0085', 3, 8], ['0047', 3, 10], ['1323', 3, 10], ['0585', 3, 12], ['0334', 2, 12], ['0241', 2, 12]]],
  ['fb-c', 'Full Body C', 'figureStrength', [['0739', 3, 10], ['0025', 2, 10], ['0027', 3, 10], ['0426', 2, 10], ['0586', 3, 12], ['0605', 3, 15]]]
]

const FIVE_BY_FIVE = [
  ['5x5-a', '5×5 A', 'barbell', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
  ['5x5-b', '5×5 B', 'barbell', [['0085', 5, 5], ['0426', 5, 5], ['2330', 5, 5]]],
  ['5x5-c', '5×5 C', 'barbell', [['0739', 5, 5], ['0047', 5, 5], ['1323', 5, 5]]]
]

// Away from the gym (1.4.5): no kit, a pair of dumbbells, a set of bands, a hotel room. Two
// routines each, taken in turns, so a short week still covers the whole body.
const HOME_BW = [
  ['home-a', 'Bodyweight A', 'figureStrength', [['0662', 3, 10], ['1197', 3, 15], ['3381', 3, 8], ['2471', 3, 15], ['0463', 3, 40, 'time']]],
  ['home-b', 'Bodyweight B', 'figureStrength', [['2921', 3, 8], ['0781', 3, 10], ['0815', 3, 10], ['0726', 3, 10], ['0715', 3, 30, 'time']]]
]
const DUMBBELLS = [
  ['db-a', 'Dumbbells A', 'dumbbell', [['1760', 3, 10], ['2982', 3, 10], ['0293', 3, 10], ['0426', 3, 10], ['0294', 2, 12]]],
  ['db-b', 'Dumbbells B', 'dumbbell', [['1459', 3, 10], ['2960', 3, 10], ['4742', 3, 12], ['0293', 3, 10], ['0334', 3, 12], ['0313', 2, 12]]]
]
const BANDS = [
  ['band-a', 'Bands A', 'figureStrength', [['1004', 3, 15], ['0915', 3, 10], ['3896', 3, 12], ['0997', 3, 12], ['4063', 2, 15]]],
  ['band-b', 'Bands B', 'figureStrength', [['4618', 3, 12], ['0909', 3, 10], ['0905', 3, 12], ['1503', 3, 15], ['4143', 2, 15]]]
]
const HOTEL = [
  ['hotel', 'Hotel room', 'figureStrength', [['0662', 3, 12], ['1197', 3, 20], ['3387', 3, 10], ['0781', 3, 10], ['2471', 3, 15], ['0463', 3, 45, 'time']]]
]

// [weekday, routineKey] — weekday is a DAYN index, so 1 is Monday. Fixed weeks only: every
// plan repeats the same seven days, which is all the weekly plan model can represent.
export const STARTER_PLANS = {
  ppl: { routines: PPL, schedule: [[1, 'push'], [3, 'pull'], [5, 'legs']] },
  'upper-lower': { routines: UPPER_LOWER, schedule: [[1, 'upper-a'], [2, 'lower-a'], [4, 'upper-b'], [5, 'lower-b']] },
  'full-body': { routines: FULL_BODY, schedule: [[1, 'fb-a'], [3, 'fb-b'], [5, 'fb-c']] },
  '5x5': { routines: FIVE_BY_FIVE, schedule: [[1, '5x5-a'], [3, '5x5-b'], [5, '5x5-c']] },
  'home-bw': { routines: HOME_BW, schedule: [[1, 'home-a'], [3, 'home-b'], [5, 'home-a']] },
  dumbbells: { routines: DUMBBELLS, schedule: [[1, 'db-a'], [3, 'db-b'], [5, 'db-a']] },
  bands: { routines: BANDS, schedule: [[1, 'band-a'], [3, 'band-b'], [5, 'band-a']] },
  hotel: { routines: HOTEL, schedule: [[2, 'hotel'], [4, 'hotel']] }
}
// What a plan needs, for the chooser's "Away from the gym" group (sheets.jsx StarterPlanChooser).
export const AWAY_PLANS = ['home-bw', 'dumbbells', 'bands', 'hotel']

