// The inverted row (README.md, pull-kit.js): lying under a low bar, heels on the floor, pulling
// the chest up to it. Reps, the top and the start of every rep, tempo, and the hips sagging.
//
// The rep is the shoulders rising to the hands (pull-kit's reach signal: at the bottom the arms
// hang straight down from the bar, so the reach there is the arm's length whatever the view).
// The top: the shoulders within 1 - CHEST_S reaches of the wrists, which is about where the chest
// meets the bar (Vision's shoulder joint sits a hand's breadth under the chest). The start: the
// arms straight before the rep, as the pull-up's full hang. Judged side-on and at an angle;
// end-on (the camera at the head or the feet) the body is foreshortened past what Vision reads
// well, so it asks to turn and only counts. Side-on and at an angle it also reads the hips
// against the line from the shoulders to the knees (the knees, not the ankles, so a bent-knee
// row reads the same).
import { t } from '../i18n-core.js'
import { matchExercise, mid } from './kit.js'
import { createArmTracker } from './pull-kit.js'

export const CHEST_S = 0.85           // signal at the top at least this: chest to the bar
export const SAG = 0.15               // hips this many reaches under the shoulder-knee line: sagged
export const PHASES = { stand: 0.3, descent: 0.38, minRep: 0.5, bottomEps: 0.04, ascentRise: 0.12, topBand: 0.03 }

// Rows under a fixed bar, straight or bent knees, weighted too. Tables, chairs, sheets, straps,
// rings and ropes are left out: furniture hides the body and hand-held straps move with the hands.
const IDS = new Set(['0499', '0497', '4917', '5517', '1184', '2300'])
const NOT_A_BAR_ROW = /table|chair|sheet|slide|floor|strap|suspen|rope|band|ring|bench|bed|parallel bars/i

const STANDARDS = [
  { id: 'full', label: 'Straight arms, chest to the bar' },
  { id: 'chest', label: 'Chest to the bar' },
  { id: 'any', label: 'Any pull' },
]

const MISSES = {
  low: { line: 'Chest not to the bar. Not counted.', say: 'Chest not to the bar', row: 'Not counted: chest not to the bar' },
  hang: { line: 'Arms not straight at the bottom. Not counted.', say: 'Straighten the arms', row: 'Not counted: arms not straight at the bottom' },
}

// The hips under the line from the shoulders to the knees, in reaches (positive: sagging).
function sagOf({ joints, sh, ref }) {
  const hip = mid(joints, 'Hip'), knee = mid(joints, 'Knee')
  if (!hip || !knee || Math.abs(knee[0] - sh[0]) < 1e-3) return null
  const f = (hip[0] - sh[0]) / (knee[0] - sh[0])
  if (!(f > 0 && f < 1)) return null
  return (hip[1] - (sh[1] + f * (knee[1] - sh[1]))) / ref
}

const SAG_EXTRA = {
  frame(x, ctx) {
    const v = sagOf(ctx)
    if (v != null && (x.sag == null || v > x.sag)) x.sag = v
  },
  finish(x) {
    const sag = x.sag == null ? null : Math.round(x.sag * 100) / 100
    return { sag, sagged: sag == null ? null : sag > SAG }
  },
}

const SPEC = {
  distal: 'Wrist',
  above: true,
  k: 0.67,
  farRef: 0.06,
  phases: PHASES,
  hang: true,
  needs: { full: { top: true, hang: true }, chest: { top: true }, any: {} },
  topOf: ({ s }) => s,
  topNeed: CHEST_S,
  topViews: ['side', 'diagonal'],
  highlight: ['leftShoulder', 'rightShoulder'],
  extras: { side: SAG_EXTRA, diagonal: SAG_EXTRA },
  text: {
    start: () => t('Hang with straight arms to start'),
    ready: () => t('Ready. Pull when you are.'),
    missed: (n, reason) => (reason === 'hang'
      ? t('Reps that did not count: {0}. The arms did not straighten at the bottom.', n)
      : t('Reps that did not count: {0}. The chest did not get to the bar.', n)),
    none: () => t('No reps were counted. Get your whole body in the frame and try again.'),
    unjudged: () => t('Most reps were filmed end-on, so the top could not be judged. Film from the side.'),
    cues: [
      ['sag', s => s.measures.filter(m => m.sagged).length * 2 > s.count, () => t('The hips sagged in most reps. Try keeping a straight line from the shoulders to the knees.')],
    ],
    topSub: () => t('chest to the bar'),
    hangSub: () => t('from straight arms'),
    topText: ok => (ok ? t('Chest to the bar') : t('Short of the bar')),
    hangText: ok => (ok ? t('Straight arms') : t('Bent arms')),
    extraRows: m => (m.sagged == null ? [] : [{ label: t('Hips'), value: m.sagged ? t('Sagged') : t('In line') }]),
  },
}

const invertedRow = {
  id: 'inverted-row',
  name: 'Inverted row',
  kind: 'reps',
  views: ['side', 'diagonal'],
  setup: 'Phone at bar height, 2 to 3 m away, side-on or a little towards your feet, your whole body in the frame. Keep the rack\'s uprights off your hands.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\binverted rows?\b/i, not: NOT_A_BAR_ROW, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'full',
  misses: MISSES,
  create: (opts = {}) => createArmTracker({ ...SPEC, views: invertedRow.views, standards: STANDARDS, defaultStandard: 'full' }, opts),
}

export default invertedRow
