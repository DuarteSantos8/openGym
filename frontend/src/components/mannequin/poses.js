// The original mannequin rig (EP26-T01, E5a): the pose schema the 3D movement demos are drawn
// from, and the skeleton those poses describe. The geometry is this app's own, so the demos carry
// no third-party licence (ADR 0009).
//
// A PATTERN is a movement family from content/exercise-guides.js ('squat', 'lunge', ...).
// A FRAME is one key pose in that pattern's loop:
//   at:     when it happens, in MILLISECONDS from the start of the loop
//   name:   a short name for it
//   note:   the sentence shown beside it, so the picture is never the only explanation
//   key:    true for the one frame that is the key pose: the still shown when the device cannot
//           animate, and the one the words describe
//   joints: the rig's joint angles, in DEGREES
//
// The angles read this way:
//   thigh      the hip: 0 is straight down, positive swings the knee forwards
//   shin       the knee: 0 is straight, positive folds the heel back
//   foot       the ankle: 0 is flat on the floor, positive lifts the toes
//   spine      the torso's lean forwards
//   armU       the shoulder: positive swings the elbow forwards
//   armL       the elbow: positive folds the forearm forwards
//   head       the neck
//   pelvisTilt the whole upper body's lean, relative to the hips
//
// The rig is a chain of segment lengths (RIG) hung off the sole of the feet, so a pose says where
// each joint ends up and the feet stay on the floor without being told to.

const D = Math.PI / 180

/** The rig's own measurements, in metres. */
export const RIG = {
  footLen: 0.21,       // heel to toe
  ankleInFoot: 0.075,  // heel to the ankle joint
  ankleY: 0.065,       // the ankle's height above the sole when the foot is flat
  shin: 0.42,          // ankle to knee
  thigh: 0.44,         // knee to hip
  hipHalf: 0.105,      // half the distance between the hips
  torso: 0.46,         // hips to chest
  shoulderUp: 0.10,    // chest to the shoulder line
  shoulderHalf: 0.185, // half the distance between the shoulders
  upperArm: 0.30,
  forearm: 0.27,
  neck: 0.26,          // chest to the centre of the head
  headR: 0.105,
}

/** Every joint a frame may name. */
export const JOINT_NAMES = ['pelvisTilt', 'spine', 'head', 'armLU', 'armLL', 'armRU', 'armRL',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']

/** The bounds a pose has to keep inside, so a pattern stays readable and quick. */
export const POSE_LIMITS = {
  angle: [-180, 180],
  minFrames: 2,
  maxFrames: 12,
  minLoopMs: 800,
  maxLoopMs: 8000,
}

/** The frames of each movement pattern. */
export const POSES = {
  squat: [
    {
      at: 0, name: 'standing',
      note: 'Standing tall, feet about shoulder width apart.',
      joints: { thighL: 0, shinL: 0, footL: 0, thighR: 0, shinR: 0, footR: 0, spine: 3, head: -2, armLU: 6, armLL: 8, armRU: 6, armRL: 8 },
    },
    {
      at: 700, name: 'descending',
      note: 'Knees and hips bend together as you sit down.',
      joints: { thighL: 42, shinL: 48, footL: 6, thighR: 42, shinR: 48, footR: 6, spine: 12, head: -4, armLU: 45, armLL: 16, armRU: 45, armRL: 16 },
    },
    {
      at: 1400, name: 'bottom', key: true,
      note: 'Hips back and down between the heels, chest up, knees over the toes.',
      joints: { thighL: 90, shinL: 112, footL: 22, thighR: 90, shinR: 112, footR: 22, spine: 30, head: -10, armLU: 85, armLL: 25, armRU: 85, armRL: 25 },
    },
    {
      at: 2100, name: 'ascending',
      note: 'Push through the floor: hips and chest rise together.',
      joints: { thighL: 35, shinL: 40, footL: 5, thighR: 35, shinR: 40, footR: 5, spine: 11, head: -3, armLU: 40, armLL: 14, armRU: 40, armRL: 14 },
    },
  ],
}

/** How long one loop of each pattern takes, in milliseconds. */
export const POSE_LOOPS = { squat: 2800 }

export const poseFor = pattern => (Object.hasOwn(POSES, pattern) ? POSES[pattern] : null)
export const loopFor = pattern => (Object.hasOwn(POSE_LOOPS, pattern) ? POSE_LOOPS[pattern] : null)

/** Whether a movement pattern has a rig to show. */
export const hasPose = pattern => Object.hasOwn(POSES, pattern)

/** The frame a pattern shows when it cannot animate: the one marked as the key pose. */
export function keyFrameFor(pattern) {
  const frames = poseFor(pattern)
  return frames ? frames.find(f => f.key) || null : null
}

/** The words that go with the still. Empty when the pattern has no pose. */
export function stillTextFor(pattern) {
  const key = keyFrameFor(pattern)
  return key ? key.note : ''
}

/** Which frame a moment in the loop belongs to. */
export function frameIndexAt(pattern, at) {
  const frames = poseFor(pattern)
  const loop = loopFor(pattern)
  if (!frames || !loop) return -1
  const t = ((at % loop) + loop) % loop
  let i = 0
  for (let k = 0; k < frames.length; k++) if (frames[k].at <= t) i = k
  return i
}

/** The joint angles at a moment in the loop, read from the frames around it. */
export function jointsAt(pattern, at) {
  const frames = poseFor(pattern)
  const loop = loopFor(pattern)
  if (!frames || !loop) return null
  const t = ((at % loop) + loop) % loop
  const i = frameIndexAt(pattern, t)
  const cur = frames[i]
  const next = frames[(i + 1) % frames.length]
  const nextAt = i + 1 < frames.length ? next.at : loop + next.at
  const u = nextAt > cur.at ? Math.min(1, Math.max(0, (t - cur.at) / (nextAt - cur.at))) : 0
  const out = {}
  for (const joint of new Set([...Object.keys(cur.joints), ...Object.keys(next.joints)])) {
    const a = cur.joints[joint] ?? 0
    const b = next.joints[joint] ?? 0
    out[joint] = a + (b - a) * u
  }
  return out
}

/** One leg, hung off the sole of its foot. */
function leg(side, j) {
  const thigh = j['thigh' + side] ?? 0
  const shin = j['shin' + side] ?? 0
  const foot = j['foot' + side] ?? 0
  const x = side === 'L' ? RIG.hipHalf : -RIG.hipHalf
  // The sole lies on the floor and turns with the ankle; the shin leans by the difference
  // between the hip and the knee, so the knee travels forwards over the toe as the hips go.
  const sole = (thigh - shin + foot) * D
  const dir = [0, Math.sin(sole), Math.cos(sole)]
  const heel = [x, 0, 0]
  const toe = [heel[0] + dir[0] * RIG.footLen, heel[1] + dir[1] * RIG.footLen, heel[2] + dir[2] * RIG.footLen]
  const ankle = [
    heel[0] + dir[0] * RIG.ankleInFoot,
    heel[1] + dir[1] * RIG.ankleInFoot + RIG.ankleY * Math.cos(sole),
    heel[2] + dir[2] * RIG.ankleInFoot - RIG.ankleY * Math.sin(sole),
  ]
  const shinAbs = (thigh - shin) * D
  const knee = [
    x,
    ankle[1] + RIG.shin * Math.cos(shinAbs),
    ankle[2] - RIG.shin * Math.sin(shinAbs),
  ]
  const hip = [
    x,
    knee[1] + RIG.thigh * Math.cos(thigh * D),
    knee[2] - RIG.thigh * Math.sin(thigh * D),
  ]
  return { ankle, knee, hip, heel, toe }
}

/**
 * Where every part of the rig is at a moment in the loop, in metres: X is across the body, Y is
 * up and Z is the way the rig faces. The 3D rig and the still picture are drawn from this and
 * from nothing else, so they always agree.
 */
export function skeletonAt(pattern, at) {
  const j = jointsAt(pattern, at)
  if (!j) return null
  const L = leg('L', j)
  const R = leg('R', j)
  const pelvis = [
    (L.hip[0] + R.hip[0]) / 2,
    (L.hip[1] + R.hip[1]) / 2,
    (L.hip[2] + R.hip[2]) / 2,
  ]
  const lean = ((j.pelvisTilt ?? 0) + (j.spine ?? 0)) * D
  const up = [0, Math.cos(lean), Math.sin(lean)]
  const chest = [pelvis[0], pelvis[1] + RIG.torso * up[1], pelvis[2] + RIG.torso * up[2]]
  const neck = ((j.pelvisTilt ?? 0) + (j.spine ?? 0) + (j.head ?? 0)) * D
  const head = [chest[0], chest[1] + RIG.neck * Math.cos(neck), chest[2] + RIG.neck * Math.sin(neck)]

  const arm = (side, shoulderX, u, l) => {
    const shoulder = [shoulderX, chest[1] + RIG.shoulderUp * up[1], chest[2] + RIG.shoulderUp * up[2]]
    const ua = u * D
    const elbow = [shoulder[0], shoulder[1] - RIG.upperArm * Math.cos(ua), shoulder[2] + RIG.upperArm * Math.sin(ua)]
    const fa = (u + l) * D
    const wrist = [elbow[0], elbow[1] - RIG.forearm * Math.cos(fa), elbow[2] + RIG.forearm * Math.sin(fa)]
    return { shoulder, elbow, wrist }
  }
  const armL = arm('L', RIG.shoulderHalf, j.armLU ?? 0, j.armLL ?? 0)
  const armR = arm('R', -RIG.shoulderHalf, j.armRU ?? 0, j.armRL ?? 0)

  return {
    ankleL: L.ankle, kneeL: L.knee, hipL: L.hip, heelL: L.heel, toeL: L.toe,
    ankleR: R.ankle, kneeR: R.knee, hipR: R.hip, heelR: R.heel, toeR: R.toe,
    pelvis, chest, head,
    shoulderL: armL.shoulder, elbowL: armL.elbow, wristL: armL.wrist,
    shoulderR: armR.shoulder, elbowR: armR.elbow, wristR: armR.wrist,
  }
}

/** How far round the rig the picture is taken from: a little past its side, so both legs show. */
export const VIEW_BETA = 18 * D

/** Where a point lands on the picture: across and up, with the rig facing to the right. */
export function project(p, beta = VIEW_BETA) {
  return [-p[0] * Math.sin(beta) + p[2] * Math.cos(beta), -p[1]]
}
