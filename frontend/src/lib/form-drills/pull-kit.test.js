// The pulling drills' shared helpers (pull-kit.js): the reach, holding a bar, the view from the
// arm at rest, framing, the shares the tiles read, and the posers the drills' tests film.
import { describe, expect, it } from 'vitest'
import {
  ARM, BAR, armFraming, armReach, benchRowPose, createArmViewDetector, flyPose, forearmsUp, hangDrop,
  hangPose, hangShare, rowDrop, rowPose, topShare,
} from './pull-kit.js'
import { project } from './test-kit.js'

const frame = (pose, yaw, cam = {}) => ({ t: 0, aspect: 0.75, joints: project(pose, { yaw, ...cam }) })
const len = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]))

describe('the posers', () => {
  it('keep the arm segments their length', () => {
    for (const pose of [hangPose(hangDrop()), hangPose(0.08), hangPose(0.1, { grip: 0.32, wide: true }), rowPose(rowDrop()), rowPose(0.05), flyPose(70), benchRowPose(80)]) {
      for (const s of ['left', 'right']) {
        expect(len(pose[s + 'Shoulder'], pose[s + 'Elbow'])).toBeCloseTo(ARM.upper, 2)
        expect(len(pose[s + 'Elbow'], pose[s + 'Wrist'])).toBeCloseTo(ARM.fore, 1)
      }
    }
  })

  it('hang from the bar and keep the forearms up at the top', () => {
    const top = hangPose(0.08)
    expect(top.leftWrist[1]).toBe(BAR)
    expect(top.leftElbow[1]).toBeLessThan(top.leftShoulder[1])
    expect(forearmsUp(frame(top, 45).joints, 0.75)).toBe(true)
  })
})

describe('armReach and forearmsUp', () => {
  it('reads the wrists over the shoulders, or the elbows under them', () => {
    const j = frame(hangPose(hangDrop()), 30, { height: 1.6 }).joints
    expect(armReach(j, 'Wrist', true).r).toBeGreaterThan(0.1)
    const f = frame(flyPose(0), 30, { height: 0.9 }).joints
    expect(armReach(f, 'Elbow', false).r).toBeGreaterThan(0.05)
    expect(armReach({}, 'Wrist', true)).toBeNull()
  })

  it('says no to arms hanging at the sides and to no forearm at all', () => {
    expect(forearmsUp(frame(flyPose(0), 30).joints)).toBe(false)
    expect(forearmsUp({})).toBe(false)
  })
})

describe('createArmViewDetector', () => {
  it.each([[0, 'side'], [30, 'diagonal'], [45, 'diagonal'], [60, 'diagonal'], [90, 'front'], [180, 'side'], [-45, 'diagonal']])('names yaw %i° %s, hanging or lying', (yaw, view) => {
    for (const [pose, k, cam, distal, above] of [[hangPose(hangDrop()), 0.67, { height: 1.6 }, 'Wrist', true], [rowPose(rowDrop()), 0.67, { height: 0.8 }, 'Wrist', true], [flyPose(0), 1.27, { height: 0.9 }, 'Elbow', false]]) {
      const d = createArmViewDetector(k)
      const f = frame(pose, yaw, cam)
      const ref = armReach(f.joints, distal, above).r
      for (let i = 0; i < 6; i++) d.push(f, ref)
      expect(d.view).toBe(view)
    }
  })

  it('waits for a few frames and a reach', () => {
    const d = createArmViewDetector(1)
    expect(d.push({ joints: {} }, 0.2)).toBeNull()
    expect(d.push(frame(flyPose(0), 0), 0)).toBeNull()
  })
})

describe('armFraming', () => {
  it('says why a frame cannot be judged', () => {
    const j = frame(hangPose(hangDrop()), 45, { height: 1.6 }).joints
    expect(armFraming({}, 'Wrist', null, 0.06)).toBe('none')
    expect(armFraming({ leftHip: [0.5, 0.5, 0.9] }, 'Wrist', null, 0.06)).toBe('partial')
    expect(armFraming(j, 'Wrist', 0.03, 0.06)).toBe('far')
    expect(armFraming(j, 'Wrist', 0.15, 0.06)).toBeNull()
  })
})

describe('topShare and hangShare', () => {
  it('count the judged reps, no-reps included', () => {
    const reps = [{ measures: { topOk: true, hangOk: true } }, { measures: { topOk: false, hangOk: null } }, { measures: { topOk: null, hangOk: false } }]
    expect(topShare(reps)).toEqual({ hit: 1, of: 2 })
    expect(hangShare(reps)).toEqual({ hit: 1, of: 2 })
    expect(topShare(null)).toEqual({ hit: 0, of: 0 })
  })
})
