// The side plank, on the forearm, legs straight (README.md): a hold, counted and said like the
// plank (plank.js createHoldDrill): seconds with shoulders, hips and ankles in one line, the hips
// dropping or hiking not counted.
//
// Here the body lies across the view when the camera faces the lifter's chest or back: the line
// and its bend at the hip are then plain image geometry. Seen from the head or the feet the body
// runs along the view and the hips hide behind the shoulders or the legs, so only that front (or
// back) view is judged. The kit's view detector cannot tell it (the shoulders stack up, not side
// by side), so the view comes from the torso's image length over the supporting upper arm's: the
// arm stands upright under the shoulder and is never foreshortened by turning, the torso is,
// about 1.7 facing the camera and under 1.45 once turned more than about 30° away (FACING).
import { t } from '../i18n-core.js'
import { dist, ema, matchExercise, mid, seen } from './kit.js'
import { UNSEEN, lineBend, tilt } from './arms-kit.js'
import { MISSES, STANDARDS, createHoldDrill, holdFraming } from './plank.js'

export const FACING = 1.45            // torso over upper arm at least this: facing the camera (or back to it)
export const SIDE_ON = 0.9            // under this: seen from the head or the feet
export const LYING_TILT = 45          // the shoulder-to-ankle line steeper than this: seen from the head or the feet
export const UPRIGHT_ARM = 0.5        // the supporting upper arm's sideways lean at most this share of its drop

const CUE = {
  missed: {
    sag: n => t('Out of line for {0} s: the hips dropped. Try pushing them up towards the ceiling.', n),
    pike: n => t('Out of line for {0} s: the hips rose. Try lowering them into one line with your shoulders and ankles.', n),
  },
  none: () => t('No time was counted. Get your whole body in the frame and try again.'),
  framing: () => t('The camera lost you during most of the hold. Keep your whole body in the frame.'),
  sinking: () => t('The hips sank lower as the hold went on.'),
  steady: () => t('The line held steady through the hold.'),
}

// The supporting arm is the one under the lower shoulder; the view from torso over that upper arm.
function read(fr, st) {
  const why = holdFraming(fr)
  const view = () => (st.ratio == null ? null : st.ratio >= FACING ? 'front' : st.ratio < SIDE_ON ? 'side' : 'diagonal')
  if (why) return { why, view: view(), pose: null }
  const j = fr.joints, a = fr.aspect
  const ls = seen(j, 'leftShoulder'), rs = seen(j, 'rightShoulder')
  const sh = mid(j, 'Shoulder'), hip = mid(j, 'Hip'), an = mid(j, 'Ankle')
  if (!ls || !rs || !hip || !an) return { why: null, view: view(), pose: UNSEEN }
  const low = ls[1] >= rs[1] ? 'left' : 'right'
  const bs = low === 'left' ? ls : rs
  const el = seen(j, low + 'Elbow')
  if (!el) return { why: null, view: view(), pose: UNSEEN }
  const drop = el[1] - bs[1]
  // Held up on an upright arm, the shoulders one above the other: a side plank. With the body's
  // line steep in the image it is one seen from the head or the feet.
  const held = drop > 0 && Math.abs(el[0] - bs[0]) * a <= UPRIGHT_ARM * drop && Math.abs(ls[1] - rs[1]) > Math.abs(ls[0] - rs[0]) * a
  if (!held) return { why: null, view: view(), pose: null }
  if (tilt(sh, an, a) > LYING_TILT) return { why: null, view: 'side', pose: null }
  const r = dist(sh, hip, a) / drop
  st.ratio = st.ratio == null ? r : ema(st.ratio, r, 0.25)
  st.n++
  return { why: null, view: st.n >= 4 ? view() : null, pose: { bend: lineBend(sh, hip, an, a), knees: false, joints: ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'leftAnkle', 'rightAnkle'] } }
}

// Straight-leg side planks held still. Left out: bent-knee and beginner side planks, and ones that
// move (leg lifts, hip dips, rotations, rows, reaches), on a band or an incline.
const IDS = new Set(['0715', '0714', '4811', '1470'])
const NOT_A_PLAIN_SIDE_PLANK = /bent|beginner|knee|leg|lift|raise|hip|crunch|rotation|twist|row|reach|clamshell|pull|tap|push|incline|band|dumbbell|kettlebell|form check|to /i

const MY_MISSES = { sag: MISSES.sag, pike: MISSES.pike }

const sidePlank = {
  id: 'side-plank',
  name: 'Side plank',
  kind: 'hold',
  views: ['front'],
  setup: 'Phone low and turned sideways, 2 to 3 m away, facing your chest or your back, your whole body in the frame. Seconds count while your shoulders, hips and ankles stay in one line.',
  matches: ex => matchExercise(ex, { ids: IDS, name: /\bside plank\b/i, not: NOT_A_PLAIN_SIDE_PLANK, cats: new Set(['isometric']) }),
  standards: STANDARDS.map(({ id, label }) => ({ id, label })),
  defaultStandard: 'straight',
  misses: MY_MISSES,
  create: createHoldDrill({
    views: ['front'],
    state: () => ({ ratio: null, n: 0 }),
    read,
    misses: MY_MISSES,
    cue: CUE,
  }),
}

export default sidePlank
