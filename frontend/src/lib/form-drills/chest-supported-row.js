// The chest-supported row on an incline bench (README.md, pull-kit.js): reps, whether the elbows
// came back past the torso, and tempo.
//
// The rep is the elbows rising towards the shoulders (pull-kit's reach signal with the elbow,
// image-vertical, so it counts from any view). The top is judged side-on only: there the back is
// seen edge-on, as the line from the shoulders to the hips, and the elbows are past the torso when
// they come over that line by ROW_PAST upper arms (Vision's shoulder and hip sit mid-body, so the
// line runs through the middle of the torso, not along the back; ROW_PAST puts the elbows about
// level with the back). From any other angle the back is a surface, not a line, and the top cannot
// be read: it asks to turn side-on, counts, and says the top was not judged.
import { t } from '../i18n-core.js'
import { matchExercise, mid } from './kit.js'
import { createArmTracker } from './pull-kit.js'

export const ROW_PAST = 0.2           // elbows this many upper arms over the shoulder-hip line: past the torso
export const PHASES = { stand: 0.1, descent: 0.15, minRep: 0.25, bottomEps: 0.04, ascentRise: 0.1, topBand: 0.03 }

// Two-armed dumbbell rows lying chest-down on a bench. One arm, machines, the Smith machine,
// cables and rear-delt rows (elbows out wide: another top) are left out.
const IDS = new Set(['9698', '5661'])
const NOT_A_SUPPORTED_ROW = /single|one arm|lever|smith|cable|machine|lateral|rear delt|barbell/i

const STANDARDS = [
  { id: 'torso', label: 'Elbows past the torso' },
  { id: 'any', label: 'Any row' },
]

const MISSES = {
  low: { line: 'Elbows not past the torso. Not counted.', say: 'Pull further', row: 'Not counted: elbows not past the torso' },
}

// The elbows over the line from the shoulders to the hips, in upper arms (positive: past it). The
// torso must lie tipped in the image (an upright one gives no line to be above).
function pastOf({ joints, aspect, sh, d, ref }) {
  const hip = mid(joints, 'Hip')
  if (!hip || Math.abs(hip[0] - sh[0]) * aspect < 0.3 * ref) return null
  const f = (d[0] - sh[0]) / (hip[0] - sh[0])
  return (sh[1] + f * (hip[1] - sh[1]) - d[1]) / ref
}

const SPEC = {
  distal: 'Elbow',
  above: false,
  k: 1.27,
  farRef: 0.03,
  phases: PHASES,
  hang: false,
  needs: { torso: { top: true }, any: {} },
  topOf: pastOf,
  topNeed: ROW_PAST,
  topViews: ['side'],
  highlight: ['leftElbow', 'rightElbow'],
  text: {
    start: () => t('Let the arms hang to start'),
    ready: () => t('Ready. Row when you are.'),
    missed: n => t('Reps that did not count: {0}. The elbows did not get past the torso.', n),
    none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
    unjudged: () => t('Most reps were not filmed side-on, so the top could not be judged. Film from the side.'),
    cues: [],
    topSub: () => t('elbows past the torso'),
    topText: ok => (ok ? t('Past the torso') : t('Short of the torso')),
  },
}

const chestSupportedRow = {
  id: 'chest-supported-row',
  name: 'Chest-supported row',
  kind: 'reps',
  views: ['side'],
  setup: 'Phone at bench height, 2 to 3 m away and side-on, your arms, shoulders and hips in the frame.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bchest[- ]supported (dumbbell )?rows?\b|\brow with chest support\b/i, not: NOT_A_SUPPORTED_ROW, cats: new Set(['strength']) }),
  standards: STANDARDS,
  defaultStandard: 'torso',
  misses: MISSES,
  create: (opts = {}) => createArmTracker({ ...SPEC, views: chestSupportedRow.views, standards: STANDARDS, defaultStandard: 'torso' }, opts),
}

export default chestSupportedRow
