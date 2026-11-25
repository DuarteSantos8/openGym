// The dip (README.md, press-kit.js): reps, depth and tempo on parallel bars, rings, a straight bar
// or a bench, plus the elbow angle side-on. It measures, it never grades.
//
// The hands stay on the bars and the shoulders sink towards them (press-kit's arm drop): the rep
// is the shoulder's drop towards the wrists, the depth the shoulder's height against the elbow's,
// level being the upper arm horizontal, the usual dip standard. Side-on the camera's height does
// not matter; from the front or at an angle the elbows sit behind the shoulders at the bottom, so
// depth is judged only with the phone at elbow height (with arms straight) and level.
import { t } from '../i18n-core.js'
import { createViewDetector, framing, matchExercise } from './kit.js'
import { ARM, createArmDropTracker, DROP_STANDARDS, SHALLOW_MISS } from './press-kit.js'

// Body-weight and weighted dips on bars, rings, a straight bar or a bench. Machines (the kneeling
// pad and the lever hide the body), dips on the floor (too small a motion), holds, and one-arm,
// Korean and impossible dips (another rep) are left out.
const IDS = new Set([
  '0251', '0814', '1430', '2462', '2363', '8143', '0677', '1755', '1767', '3313', '4205', '4719',
  '0129', '4360', '0830', '0812', '0813',
])
const DIP = /^\s*(weighted |ring |chest |triceps? |bench |parallel bar |straight bar )*dips?\s*$/i

const SPEC = {
  framing: frame => framing(frame, ARM),
  viewDetector: createViewDetector,
  startHint: () => t('Arms straight to start'),
  readyHint: () => t('Ready. Go when you are.'),
  notes: {
    side: () => t('Filmed from the side: depth, tempo and elbow angle.'),
    diagonal: () => t('Filmed at an angle: depth and tempo only.'),
    front: () => t('Filmed from the front: depth and tempo only.'),
  },
}

const dip = {
  id: 'dip',
  name: 'Dip',
  kind: 'reps',
  views: ['side', 'diagonal', 'front'],
  setup: 'Phone side-on, 2 to 3 m away, your upper body and arms in the frame. From the front, put it at elbow height and level.',
  matches: ex => matchExercise(ex, { ids: IDS, name: DIP, cats: new Set(['strength', 'calisthenics']) }),
  standards: DROP_STANDARDS,
  defaultStandard: 'level',
  misses: SHALLOW_MISS,
  create: opts => createArmDropTracker(dip, SPEC, opts),
}

export default dip
