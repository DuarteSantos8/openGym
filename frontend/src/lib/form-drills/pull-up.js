// Pull-ups and chin-ups (README.md, pull-kit.js): reps, the top and the start of every rep, tempo,
// from the front, the side or at an angle. It measures, it never grades.
//
// The rep is the shoulders rising to the hands (pull-kit's reach signal, image-vertical, so the
// view does not change it). The top is the nose's height over the wrists, in reaches at a dead
// hang: Vision has no chin and no bar, and the wrists sit a few centimetres under the bar, so
// "chin over the bar" is read as the nose at least CHIN_OVER reaches over the wrists (about 9 cm
// for a usual build; about where the chin clears the bar). The start is the lowest the shoulders
// came before the rep: within HANG_S of a dead hang means the arms were straight. Filmed from
// behind, Vision does not see the face: the top is then judged from the shoulders against the
// nose's height measured at the hang, or not at all (said so, and the rep counts).
// Side-on it adds the body's swing (the hips against the shoulders, so the whole body moving back
// under the bar at the top is not swing); from the front, the shoulders tilting at the top.
import { t } from '../i18n-core.js'
import { ema, matchExercise, mean, mid, seen } from './kit.js'
import { createArmTracker } from './pull-kit.js'

export const CHIN_OVER = 0.15         // nose over the wrists by this many reaches: chin over the bar
export const SWING = 0.35             // the hips' fore-aft travel against the shoulders over the rep, in reaches: swung
export const TILT_DEG = 8             // the shoulder line this far off level at the top: tilted
export const PHASES = { stand: 0.3, descent: 0.38, minRep: 0.5, bottomEps: 0.04, ascentRise: 0.12, topBand: 0.03 }

// Two-handed pulls of the body to a fixed bar. Machines, one arm, negatives, holds, jumps,
// side-to-side, behind the neck, rings and straps (the hands move) and seated or table pulls are
// left out: either the rep is not one pull from a hang or the top cannot be read the same way.
const IDS = new Set(['1326', '0652', '4102', '0841', '1327', '1429', '0651', '5473', '0253', '5479', '0674', '0627', '8189', '5474', '2987', '2986', '1865', '1866', '0970', '4718'])
const NOT_A_PLAIN_PULL = /assist|negative|isometric|hold|jump|commando|archer|one arm|one hand|single|rear|behind|scapular|seated|chair|bench|l-pull|around|rocky|kneel|squat|table|plank|swing|stretch|uneven|towel|lever|machine|cable|partner|box|eccentric|top half|bent knee|tuck|sternum|gorilla|side-to-side|dip|curl|inverse|ring|suspen|strap|rope|sheet|band|biceps/i

const STANDARDS = [
  { id: 'full', label: 'Full hang, chin over the bar' },
  { id: 'chin', label: 'Chin over the bar' },
  { id: 'any', label: 'Any pull' },
]

const MISSES = {
  low: { line: 'Chin not over the bar. Not counted.', say: 'Chin not over', row: 'Not counted: chin not over the bar' },
  hang: { line: 'Not from a full hang. Not counted.', say: 'Not from a full hang', row: 'Not counted: not from a full hang' },
}

// The nose over the wrists, in reaches; from the shoulders and the nose's height at the hang when the nose is not seen.
function topOf({ joints, sh, d, ref, state }) {
  const nose = seen(joints, 'nose')
  if (nose) return (d[1] - nose[1]) / ref
  if (state.head == null) return null
  return (d[1] - (sh[1] - state.head * ref)) / ref
}

function onRest(state, { joints, sh, ref }) {
  state.rest = (state.rest || 0) + 1
  const nose = seen(joints, 'nose')
  if (nose) state.head = ema(state.head, (sh[1] - nose[1]) / ref, 0.2)
}

const SPEC = {
  distal: 'Wrist',
  above: true,
  k: 0.67,                            // shoulder width over the reach at a dead hang
  farRef: 0.06,
  phases: PHASES,
  hang: true,
  needs: { full: { top: true, hang: true }, chin: { top: true }, any: {} },
  topOf,
  topNeed: CHIN_OVER,
  onRest,
  extraHint: (state, phase) => ((phase === 'waiting' || phase === 'standing') && state.rest >= 8 && state.head == null
    ? t('Film from the front or the side, with your face in view') : ''),
  highlight: ['nose'],
  extras: {
    side: {
      frame(x, { joints, aspect, sh, ref }) {
        const hip = mid(joints, 'Hip')
        if (!hip) return
        const v = (hip[0] - sh[0]) * aspect / ref
        x.lo = x.lo == null ? v : Math.min(x.lo, v)
        x.hi = x.hi == null ? v : Math.max(x.hi, v)
      },
      finish(x) {
        const swing = x.lo == null ? null : Math.round((x.hi - x.lo) * 100) / 100
        return { swing, swung: swing == null ? null : swing > SWING }
      },
    },
    front: {
      frame(x, { joints, aspect, s }) {
        const l = seen(joints, 'leftShoulder'), r = seen(joints, 'rightShoulder')
        if (!l || !r) return
        const tilt = Math.atan2(Math.abs(l[1] - r[1]), Math.abs(l[0] - r[0]) * aspect) * 180 / Math.PI
        ;(x.tilts || (x.tilts = [])).push([s, tilt])
      },
      finish(x, rec) {
        const top = (x.tilts || []).filter(([s]) => s >= rec.peak - 0.1).map(([, a]) => a)
        const tilt = top.length ? Math.round(mean(top)) : null
        return { tilt, tilted: tilt == null ? null : tilt > TILT_DEG }
      },
    },
  },
  text: {
    start: () => t('Hang with straight arms to start'),
    ready: () => t('Ready. Pull when you are.'),
    missed: (n, reason) => (reason === 'hang'
      ? t('Reps that did not count: {0}. They did not start from a full hang.', n)
      : t('Reps that did not count: {0}. The chin did not get over the bar.', n)),
    none: () => t('No reps were counted. Keep your hands, head and shoulders in the frame and try again.'),
    unjudged: () => t('The face was not seen at the top of most reps. Film from the front or the side, not from behind.'),
    cues: [
      ['swing', s => s.measures.filter(m => m.swung).length * 2 > s.count, () => t('The body swung in most reps. Try keeping the legs still under the bar.')],
      ['tilt', s => s.measures.filter(m => m.tilted).length * 2 > s.count, () => t('The shoulders tilted to one side at the top of most reps. Try pulling evenly with both arms.')],
    ],
    topSub: () => t('chin over the bar'),
    hangSub: () => t('from a full hang'),
    topText: ok => (ok ? t('Chin over the bar') : t('Chin under the bar')),
    hangText: ok => (ok ? t('Full hang') : t('Bent arms')),
    extraRows: m => {
      const rows = []
      if (m.swung != null) rows.push({ label: t('Swing'), value: m.swung ? t('Swung') : t('Still') })
      if (m.tilted != null) rows.push({ label: t('Shoulders'), value: m.tilted ? t('Tilted {0}°', m.tilt) : t('Level') })
      return rows
    },
  },
}

const pullUp = {
  id: 'pull-up',
  name: 'Pull-up and chin-up',
  kind: 'reps',
  views: ['front', 'side', 'diagonal'],
  setup: 'Phone at head height, 2 to 3 m away, facing you or side-on, the bar and your hands in the frame. Keep your face in view: from behind the chin cannot be judged.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\b(chin|pull)[- ]?ups?\b/i, not: NOT_A_PLAIN_PULL, cats: new Set(['strength', 'calisthenics']) }),
  standards: STANDARDS,
  defaultStandard: 'full',
  misses: MISSES,
  create: (opts = {}) => createArmTracker({ ...SPEC, views: pullUp.views, standards: STANDARDS, defaultStandard: 'full' }, opts),
}

export default pullUp
