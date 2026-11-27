// The pressing drills' shared pieces (press-kit.js) on hand-made frames.
import { describe, expect, it } from 'vitest'
import {
  createFlatViewDetector, dropDepthOf, dropDepthShare, dropMeets, elbowAngle, flatFraming,
  flatYawSine, LEVEL_BAND, lockMeets, TORSO_OVER_ARM,
} from './press-kit.js'

// A body lying face down at the top of a push-up, seen with x stretched already (aspect 1): arms
// upright `arm` long, the torso TORSO_OVER_ARM of it, inclined `incline` degrees, turned `yaw`.
function flat({ yaw = 0, incline = 20, arm = 0.2, conf = 0.9 } = {}) {
  const r = d => d * Math.PI / 180
  const T = TORSO_OVER_ARM * arm
  const sh = [0.6, 0.5], hip = [0.6 - T * Math.cos(r(incline)) * Math.cos(r(yaw)), 0.5 + T * Math.sin(r(incline))]
  const half = 0.07 * Math.sin(r(yaw))
  const j = {}
  for (const [s, k] of [['left', 1], ['right', -1]]) {
    j[s + 'Shoulder'] = [sh[0] + k * half, sh[1], conf]
    j[s + 'Elbow'] = [sh[0] + k * half, sh[1] + arm / 2, conf]
    j[s + 'Wrist'] = [sh[0] + k * half, sh[1] + arm, conf]
    j[s + 'Hip'] = [hip[0], hip[1], conf]
    j[s + 'Ankle'] = [0.6 - 2.4 * arm * Math.cos(r(yaw)), 0.5 + arm, conf]
  }
  return { t: 0, aspect: 1, joints: j }
}

describe('a body lying down: its yaw and its view', () => {
  it('reads the sine of the yaw from the torso against the upright arm, whatever the incline', () => {
    for (const incline of [15, 25, 35]) for (const yaw of [0, 30, 45, 60, 90]) {
      expect(flatYawSine(flat({ yaw, incline }))).toBeCloseTo(Math.sin(yaw * Math.PI / 180), 2)
    }
    expect(flatYawSine({ joints: {} })).toBe(null)
  })

  it('names the view after a few frames at the top, with hysteresis, and ignores frames mid-rep', () => {
    const d = createFlatViewDetector()
    for (let i = 0; i < 3; i++) d.push(flat({ yaw: 0 }), true)
    expect(d.view).toBe(null)
    d.push(flat({ yaw: 0 }), true)
    expect(d.view).toBe('side')
    for (let i = 0; i < 20; i++) d.push(flat({ yaw: 90 }), false)
    expect(d.view).toBe('side')
    for (let i = 0; i < 20; i++) d.push(flat({ yaw: 45 }), true)
    expect(d.view).toBe('diagonal')
    for (let i = 0; i < 20; i++) d.push(flat({ yaw: 85 }), true)
    expect(d.view).toBe('front')
  })

  it('frames a body lying down: none, partial without an arm or a hip, far when tiny', () => {
    expect(flatFraming({ joints: {} })).toBe('none')
    expect(flatFraming(flat())).toBe(null)
    const noArm = flat()
    delete noArm.joints.leftWrist; delete noArm.joints.rightWrist
    expect(flatFraming(noArm)).toBe('partial')
    const noHip = flat()
    delete noHip.joints.leftHip; delete noHip.joints.rightHip
    expect(flatFraming(noHip)).toBe('partial')
    expect(flatFraming(flat({ arm: 0.015 }))).toBe('far')
  })
})

describe('depth and lockout', () => {
  it('names the shoulder depth against the elbow, and what each standard takes', () => {
    expect([dropDepthOf(LEVEL_BAND + 0.01), dropDepthOf(0), dropDepthOf(-LEVEL_BAND - 0.01), dropDepthOf(null)]).toEqual(['below', 'level', 'above', null])
    // A wider band on the short side (the dip's): level down to it, above past it; below unchanged.
    expect([dropDepthOf(-LEVEL_BAND - 0.01, 0.3), dropDepthOf(-0.29, 0.3), dropDepthOf(-0.31, 0.3), dropDepthOf(LEVEL_BAND + 0.01, 0.3)]).toEqual(['level', 'level', 'above', 'below'])
    expect(dropMeets('level', 'level')).toBe(true)
    expect(dropMeets('above', 'level')).toBe(false)
    expect(dropMeets('level', 'below')).toBe(false)
    expect(dropMeets('above', 'any')).toBe(true)
    expect(dropMeets(null, 'below')).toBe(true)
    expect(lockMeets(false, 'lockout')).toBe(false)
    expect(lockMeets(null, 'lockout')).toBe(true)
    expect(lockMeets(false, 'any')).toBe(true)
  })

  it('shares out the judged depths, no-reps included', () => {
    const reps = ['below', 'level', 'above', null].map(depth => ({ measures: { depth } }))
    expect(dropDepthShare(reps, 'level')).toEqual({ hit: 2, of: 3, depth: 'level' })
    expect(dropDepthShare(reps, 'below')).toEqual({ hit: 1, of: 3, depth: 'below' })
    expect(dropDepthShare(undefined, 'level')).toEqual({ hit: 0, of: 0, depth: 'level' })
  })

  it('reads the more bent arm when both are seen surely, else the picked one', () => {
    const j = {
      leftShoulder: [0.4, 0.4, 0.9], leftElbow: [0.4, 0.3, 0.9], leftWrist: [0.4, 0.2, 0.9],      // straight
      rightShoulder: [0.6, 0.4, 0.9], rightElbow: [0.65, 0.3, 0.9], rightWrist: [0.65, 0.2, 0.9], // bent
    }
    const both = elbowAngle({ aspect: 1, joints: j }, 'left')
    expect(both).toBeLessThan(160)
    const unsure = { ...j, rightWrist: [0.65, 0.2, 0.3] }
    expect(elbowAngle({ aspect: 1, joints: unsure }, 'left')).toBeCloseTo(180, 5)
  })

  it('reads the elbow from shoulders moved out by a share of their width when asked', () => {
    // Shoulders marked in from the joints, which sit under the straight arms.
    const j = {
      leftShoulder: [0.45, 0.4, 0.9], leftElbow: [0.4, 0.3, 0.9], leftWrist: [0.4, 0.2, 0.9],
      rightShoulder: [0.55, 0.4, 0.9], rightElbow: [0.6, 0.3, 0.9], rightWrist: [0.6, 0.2, 0.9],
    }
    expect(elbowAngle({ aspect: 1, joints: j }, 'left')).toBeLessThan(160)
    expect(elbowAngle({ aspect: 1, joints: j }, 'left', 0.5)).toBeCloseTo(180, 5)
    // Either way round in the image, and not with one shoulder unseen.
    const mirrored = Object.fromEntries(Object.entries(j).map(([k, [x, y, c]]) => [k, [1 - x, y, c]]))
    expect(elbowAngle({ aspect: 1, joints: mirrored }, 'left', 0.5)).toBeCloseTo(180, 5)
    const { rightShoulder, ...one } = j
    expect(elbowAngle({ aspect: 1, joints: one }, 'left', 0.5)).toBeLessThan(160)
  })
})
