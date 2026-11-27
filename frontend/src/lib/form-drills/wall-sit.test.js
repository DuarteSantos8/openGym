// The wall sit hold against synthetic lifters (test-kit.js), side-on and at an angle: seconds held in position,
// the hips rising and leaning forward not counted and said, the standards, views, a missing knee,
// a lost pose, the result, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import wallSit, { GRACE_MS, thighText } from './wall-sit.js'
import { checkDrill } from './index.js'
import { BODY, film, project, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

/**
 * Sitting against a wall, facing +u, the shins upright: `thigh` the thigh's angle above level
 * (the hip over the knee, degrees; negative below), `lean` the torso's angle forward of upright.
 */
export function wallSitPose({ thigh = 0, lean = 0 } = {}) {
  const b = BODY
  const knee = [0, b.ankleH + b.shin]
  const hip = [knee[0] - b.thigh * Math.cos(rad(thigh)), knee[1] + b.thigh * Math.sin(rad(thigh))]
  const up = [Math.sin(rad(lean)), Math.cos(rad(lean))]
  const sh = [hip[0] + up[0] * b.torso, hip[1] + up[1] * b.torso]
  const neck = [sh[0] + up[0] * b.neck, sh[1] + up[1] * b.neck]
  const p = { nose: [neck[0] + 0.08, neck[1] + 0.1, 0], neck: [neck[0], neck[1], 0] }
  const pair = (name, [u, v], half) => { p['left' + name] = [u, v, half]; p['right' + name] = [u, v, -half] }
  pair('Ankle', [0, b.ankleH], b.stanceHalf)
  pair('Knee', knee, b.stanceHalf)
  pair('Hip', hip, b.hipHalf)
  pair('Shoulder', sh, b.shoulderHalf)
  pair('Elbow', [sh[0] + 0.05, sh[1] - 0.29], 0.22)
  pair('Wrist', [sh[0] + 0.2, sh[1] - 0.5], 0.2)
  return p
}

/** A hold: [{ sec, thigh, lean, pose: 'sit' | 'stand' }] in order, filmed with `opts` (film). */
export function wallSitFrames(segments, { fps = 15, without = null, ...opts } = {}) {
  const poses = []
  for (const s of segments) {
    const pose = s.pose === 'stand' ? squatPose(178) : wallSitPose(s)
    for (let i = 0; i < Math.round(s.sec * fps); i++) poses.push(pose)
  }
  const frames = film(poses, { fps, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = wallSit.create(opts)
  const outs = frames.map(f => tr.push(f))
  return { outs, res: tr.result(), said: outs.filter(o => o.justCounted).map(o => o.count), missed: outs.filter(o => o.justMissed).map(o => o.reason) }
}

describe('the wall sit drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(wallSit)).toEqual([])
    expect(wallSit).toMatchObject({ kind: 'hold', views: ['side', 'diagonal'], defaultStandard: 'level' })
  })

  it('films the pose helper as meant', () => {
    const j = project(wallSitPose())
    expect(Math.abs(j.rightHip[1] - j.rightKnee[1])).toBeLessThan(0.01)
  })
})

describe.each([0, 10, 180, -10, 30, 45, -45, 135])('the wall sit filmed side-on or at an angle, yaw %i°', yaw => {
  it('counts the seconds held in position, says every ten', () => {
    const { res, said, outs } = run(wallSitFrames([{ sec: 2, pose: 'stand' }, { sec: 25 }, { sec: 2, pose: 'stand' }], { yaw }))
    expect(res.count).toBeGreaterThanOrEqual(23)
    expect(res.count).toBeLessThanOrEqual(25)
    expect(said).toEqual([10, 20])
    expect(res).toMatchObject({ missed: 0, cueId: 'steady' })
    expect(res.reps).toHaveLength(1)
    expect(outs.find(o => o.reached).highlight).toHaveLength(3)
  })

  it('stops the clock while the hips rise, and says so', () => {
    const { res, missed } = run(wallSitFrames([{ sec: 10 }, { sec: 6, thigh: 25 }, { sec: 10 }], { yaw }))
    expect(res.count).toBeGreaterThanOrEqual(19)
    expect(res.count).toBeLessThanOrEqual(21)
    expect(res.missed).toBeGreaterThanOrEqual(5)
    expect(missed).toEqual(['high', 'high'])
    expect(res.reps.map(r => [r.counted, r.reason])).toEqual([[true, null], [false, 'high'], [true, null]])
    expect(res.cue).toMatch(/^Out of position for \d s: the hips rose/)
    expect(res.tiles.map(x => x.id)).toEqual(['longest', 'thighs', 'out'])
  })

  it('does not take time for a reading that wavers over the line for less than the grace', () => {
    const { res, missed } = run(wallSitFrames([{ sec: 5 }, { sec: 0.4, thigh: 25 }, { sec: 5 }, { sec: 0.4, thigh: 25 }, { sec: 5 }], { yaw }))
    expect(missed).toEqual([])
    expect(res.count).toBeGreaterThanOrEqual(15)
  })

  it('stops the clock while leaning forward off the wall', () => {
    const { missed, res } = run(wallSitFrames([{ sec: 5 }, { sec: 3, lean: 35 }, { sec: 3 }], { yaw }))
    expect(missed).toEqual(['lean'])
    expect(res.cueId).toBe('missed')
  })

  it('counts nothing with the knees out of sight', () => {
    const { res } = run(wallSitFrames([{ sec: 8 }], { yaw, without: ['leftKnee', 'rightKnee'] }))
    expect(res.count).toBe(0)
  })
})

describe('the wall sit, standards and edges', () => {
  it('thighs level (10°) and near level (20°)', () => {
    const frames = wallSitFrames([{ sec: 10, thigh: 15 }])
    expect(run(frames).res.count).toBe(0)
    expect(run(frames).missed[0]).toBe('high')
    expect(run(frames, { standard: 'near' }).res.count).toBeGreaterThanOrEqual(9)
    expect(run(wallSitFrames([{ sec: 10, thigh: 6 }])).res.count).toBeGreaterThanOrEqual(9)
    expect(run(wallSitFrames([{ sec: 10, thigh: 25 }]), { standard: 'near' }).res.count).toBe(0)
  })

  it('sitting deeper than level still counts', () => {
    expect(run(wallSitFrames([{ sec: 10, thigh: -10 }])).res.count).toBeGreaterThanOrEqual(9)
  })

  it('reads the thighs to within a couple of degrees', () => {
    const { res } = run(wallSitFrames([{ sec: 5, thigh: 7 }]))
    expect(res.reps[0].measures.thigh).toBeGreaterThanOrEqual(5)
    expect(res.reps[0].measures.thigh).toBeLessThanOrEqual(9)
    expect(res.tiles.find(x => x.id === 'thighs').value).toBe('7° above level')
    expect(thighText(1)).toBe('Level')
    expect(thighText(-12)).toBe('12° below level')
  })

  it('does not say a flicker out of position shorter than the grace', () => {
    const { res, missed } = run(wallSitFrames([{ sec: 5 }, { sec: GRACE_MS / 1000 / 2, thigh: 25 }, { sec: 5 }]))
    expect(missed).toEqual([])
    expect(res.reps).toHaveLength(1)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    const { res, missed } = run(wallSitFrames([{ sec: 20 }], { noise: 0.003, drop: 0.03 }))
    expect(res.count).toBeGreaterThanOrEqual(18)
    expect(missed).toEqual([])
  })

  it('counts nothing standing, or before getting into position', () => {
    const { res, outs } = run(wallSitFrames([{ sec: 5, pose: 'stand' }]))
    expect(res).toMatchObject({ count: 0, missed: 0, cueId: 'none' })
    expect(outs.at(-1).hint).toBe('Get into position')
  })

  it('from the front: asks to turn side-on and counts nothing', () => {
    for (const yaw of [90, -90]) {
      const { res, outs } = run(wallSitFrames([{ sec: 8 }], { yaw }))
      expect(res.count).toBe(0)
      expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
    }
  })

  it('a pose lost for a moment stops the clock for that moment only, and marks the stretch', () => {
    const { res } = run(wallSitFrames([{ sec: 12 }], { gap: [4000, 5000] }))
    expect(res.count).toBeGreaterThanOrEqual(10)
    expect(res.count).toBeLessThanOrEqual(11)
    expect(res.reps.some(r => r.lost)).toBe(true)
  })

  it('names its status lines and rows', () => {
    const { outs, res } = run(wallSitFrames([{ sec: 3 }, { sec: 3, lean: 35 }]))
    expect(outs.at(-1).hint).toBe('Leaning forward. Time not counted.')
    expect(res.details[1]).toEqual([{ label: 'Time', value: expect.stringMatching(/ s$/) }, { label: 'Hips', value: expect.any(String) }])
    expect(res.note).toBe('Each row is a stretch of the hold, in position or out of it.')
  })

  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = wallSit.create()
    expect(tr.push({ t: 0, aspect: 0.75, joints: {} })).toMatchObject({ count: 0, inFrame: false, hint: 'Step into the frame' })
    expect(tr.result()).toMatchObject({ count: 0, missed: 0, reps: [], tiles: [], cueId: 'none' })
  })
})

describe('wallSit.matches', () => {
  it('takes two-legged wall sits, bodyweight or holding a weight', () => {
    for (const id of ['0734', '7557', '7559', '6558']) expect(wallSit.matches(EXIDX[id])).toBe(true)
    expect(wallSit.matches({ id: 'c1', n: 'Wall sit', cat: 'isometric' })).toBe(true)
  })

  it('leaves out one leg, marching, toe touches, a deficit, wall squats and planks', () => {
    for (const id of ['0731', '0624', '0810', '7558', '1546', '4072', '0463', '3593']) expect(wallSit.matches(EXIDX[id])).toBe(false)
    expect(wallSit.matches(null)).toBe(false)
  })
})
