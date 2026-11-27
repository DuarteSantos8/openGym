// The rear fly, chest-down on an incline bench or bent over (README.md, pull-kit.js): reps, how
// high the elbows came, tempo, and from the front whether both arms rose evenly.
//
// The rep is the elbows rising to the shoulders' height (pull-kit's reach signal with the elbow:
// hanging, the upper arm points straight down whatever the view and whatever the bench's angle, so
// its vertical length is the reference). Arms straight out to the sides are level with the
// shoulders at any bench angle (the bench tips the body about the left-right axis, which stays
// level), so "elbows to shoulder height" is one image-vertical test from every view: the signal
// at least FLY_TOP (the elbows within about 3 cm of the shoulders).
//
// The rest between reps is often short of the first hang (pull-kit's settle): bent over, lifters
// keep the dumbbells off the full hang between reps to keep the back of the shoulders working, and
// Vision reads that rest 0.12 to 0.16 of the reach short of the first one, over the kit's start
// line. Read against the first hang one rest never came back far enough, so two reps ran into one.
// A still pause on the way back ends the rep and becomes the new rest.
import { t } from '../i18n-core.js'
import { matchExercise, mean, seen } from './kit.js'
import { createArmTracker } from './pull-kit.js'

export const FLY_TOP = 0.85           // signal at the top at least this: elbows at shoulder height
export const UNEVEN = 0.2             // one elbow this many upper arms under the other at the top: uneven
export const PHASES = { stand: 0.12, descent: 0.18, minRep: 0.35, bottomEps: 0.04, ascentRise: 0.12, topBand: 0.03 }

// Two-armed rear flies with dumbbells or none, on an incline bench or bent over. One arm at a
// time, cables, bands, machines and lying flat on the floor (the arms cannot hang) are left out.
const IDS = new Set(['2500', '2487', '0378', '5303', '4172'])
const NOT_A_FLY = /alternate|single|one arm|cable|band|machine|lever|sled|floor|plank|lunge|sheet|kneeling|rotation|row/i

const STANDARDS = [
  { id: 'shoulder', label: 'Elbows to shoulder height' },
  { id: 'any', label: 'Any raise' },
]

const MISSES = {
  low: { line: 'Elbows under shoulder height. Not counted.', say: 'Elbows higher', row: 'Not counted: elbows under shoulder height' },
}

const SPEC = {
  distal: 'Elbow',
  above: false,
  k: 1.27,                            // shoulder width over the hanging upper arm
  farRef: 0.03,
  phases: PHASES,
  hang: false,
  settle: true,
  needs: { shoulder: { top: true }, any: {} },
  topOf: ({ s }) => s,
  topNeed: FLY_TOP,
  highlight: ['leftElbow', 'rightElbow'],
  extras: {
    front: {
      frame(x, { joints, s, ref }) {
        const l = seen(joints, 'leftElbow'), r = seen(joints, 'rightElbow')
        if (l && r) (x.gaps || (x.gaps = [])).push([s, Math.abs(l[1] - r[1]) / ref])
      },
      finish(x, rec) {
        const top = (x.gaps || []).filter(([s]) => s >= rec.peak - 0.1).map(([, g]) => g)
        const gap = top.length ? Math.round(mean(top) * 100) / 100 : null
        return { gap, uneven: gap == null ? null : gap > UNEVEN }
      },
    },
  },
  text: {
    start: () => t('Let the arms hang to start'),
    ready: () => t('Ready. Raise when you are.'),
    missed: n => t('Reps that did not count: {0}. The elbows stayed under shoulder height.', n),
    none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
    unjudged: () => t('The camera lost you during most reps. Keep your whole body in the frame.'),
    cues: [
      ['uneven', s => s.measures.filter(m => m.uneven).length * 2 > s.count, () => t('One arm stayed lower than the other at the top of most reps. Try raising both evenly.')],
    ],
    topSub: () => t('elbows to shoulder height'),
    topText: ok => (ok ? t('Shoulder height') : t('Under shoulder height')),
    extraRows: m => (m.uneven == null ? [] : [{ label: t('Arms'), value: m.uneven ? t('Uneven') : t('Even') }]),
  },
}

const rearFly = {
  id: 'rear-fly',
  name: 'Rear fly',
  kind: 'reps',
  views: ['side', 'front', 'diagonal'],
  setup: 'Phone at bench height, 2 to 3 m away, side-on or facing your head, your arms and shoulders in the frame. From the front it also compares the two arms.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\brear (delt )?fly\b|\breverse fly\b/i, not: NOT_A_FLY, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'shoulder',
  misses: MISSES,
  create: (opts = {}) => createArmTracker({ ...SPEC, views: rearFly.views, standards: STANDARDS, defaultStandard: 'shoulder' }, opts),
}

export default rearFly
