// The side plank hold against synthetic lifters (test-kit.js): seconds in line facing the camera
// (or back to it), the hips dropping or hiking not counted and said, other views refused.
import { describe, expect, it } from 'vitest'
import sidePlank, { FACING } from './side-plank.js'
import { checkDrill } from './index.js'
import { film, project, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180
const L1 = 0.86, L2 = 0.5, INC = rad(15)

/**
 * A side plank on the right forearm in body coordinates: the chest faces +u, the left side is up,
 * the head towards -w, the body rising 15° from the feet. `bend` degrees at the hip, positive drops it.
 */
export function sidePlankPose({ bend = 0, onLeft = false } = {}) {
  const ax = [-Math.cos(INC), Math.sin(INC)]             // (w, v): feet to head
  const up = [Math.sin(INC), Math.cos(INC)]              // (w, v): the upper side
  const A = [0.7, 0.18]
  const h = rad(bend) * (L1 * L2 / (L1 + L2))
  const at = (k, off = 0) => [A[0] + ax[0] * k + up[0] * off, A[1] + ax[1] * k + up[1] * off]
  const p = {}
  const s = onLeft ? -1 : 1                              // which side is up: the left one, or the right
  const pair = (name, [w, v], half) => {
    p[(s > 0 ? 'left' : 'right') + name] = [0, v + up[1] * half, w + up[0] * half]
    p[(s > 0 ? 'right' : 'left') + name] = [0, v - up[1] * half, w - up[0] * half]
  }
  pair('Ankle', at(0), 0.1)
  pair('Knee', at(L1 / 2, -h / 2), 0.1)
  pair('Hip', at(L1, -h), 0.1)
  pair('Shoulder', at(L1 + L2), 0.19)
  const low = s > 0 ? 'right' : 'left', top = s > 0 ? 'left' : 'right'
  const bs = p[low + 'Shoulder'], ts = p[top + 'Shoulder']
  p[low + 'Elbow'] = [0.05, bs[1] - 0.29, bs[2]]
  p[low + 'Wrist'] = [0.3, bs[1] - 0.29, bs[2]]
  p[top + 'Elbow'] = [0.05, ts[1] - ax[1] * 0.29, ts[2] - ax[0] * 0.29]
  p[top + 'Wrist'] = [0.08, ts[1] - ax[1] * 0.5, ts[2] - ax[0] * 0.5]
  const sh = at(L1 + L2 + 0.12)
  p.neck = [0, sh[1], sh[0]]
  p.nose = [0.08, sh[1] + ax[1] * 0.1, sh[0] + ax[0] * 0.1]
  return p
}

/** A hold: [{ sec, bend, onLeft, pose: 'plank' | 'stand' }], filmed with `opts` (film). */
function holdFrames(segments, { fps = 15, ...opts } = {}) {
  const poses = []
  for (const s of segments) {
    const pose = s.pose === 'stand' ? squatPose(178) : sidePlankPose(s)
    for (let i = 0; i < Math.round(s.sec * fps); i++) poses.push(pose)
  }
  return film(poses, { fps, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = sidePlank.create(opts)
  const outs = frames.map(f => tr.push(f))
  return { outs, res: tr.result(), said: outs.filter(o => o.justCounted).map(o => o.count), missed: outs.filter(o => o.justMissed).map(o => o.reason) }
}

describe('the side plank drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(sidePlank)).toEqual([])
    expect(sidePlank).toMatchObject({ kind: 'hold', views: ['front'], defaultStandard: 'straight' })
    expect(Object.keys(sidePlank.misses)).toEqual(['sag', 'pike'])
  })

  it('films the pose helper the right way up: shoulders stacked, the lower one over its elbow', () => {
    const j = project(sidePlankPose(), { yaw: 90 })
    expect(j.leftShoulder[1]).toBeLessThan(j.rightShoulder[1])
    expect(Math.abs(j.rightElbow[0] - j.rightShoulder[0])).toBeLessThan(0.02)
    expect(j.rightElbow[1]).toBeGreaterThan(j.rightShoulder[1])
  })
})

describe.each([90, 70, -90, 110])('the side plank filmed facing, yaw %i°', yaw => {
  it('counts the seconds held in line, says every ten', () => {
    const { res, said } = run(holdFrames([{ sec: 2, pose: 'stand' }, { sec: 22 }, { sec: 2, pose: 'stand' }], { yaw }))
    expect(res.count).toBeGreaterThanOrEqual(20)
    expect(res.count).toBeLessThanOrEqual(22)
    expect(said).toEqual([10, 20])
    expect(res).toMatchObject({ missed: 0, cueId: 'steady' })
  })

  it('stops the clock while the hips drop, and says so', () => {
    const { res, missed } = run(holdFrames([{ sec: 8 }, { sec: 4, bend: 25 }, { sec: 8 }], { yaw }))
    expect(res.count).toBeGreaterThanOrEqual(14)
    expect(res.count).toBeLessThanOrEqual(16)
    expect(missed).toEqual(['sag'])
    expect(res.reps.map(r => [r.counted, r.reason])).toEqual([[true, null], [false, 'sag'], [true, null]])
    expect(res.cue).toMatch(/^Out of line for \d s: the hips dropped/)
  })

  it('and while they hike up', () => {
    expect(run(holdFrames([{ sec: 6 }, { sec: 3, bend: -25 }, { sec: 3 }], { yaw })).missed).toEqual(['pike'])
  })

  it('reads either side down the same', () => {
    expect(run(holdFrames([{ sec: 12, onLeft: true }], { yaw })).res.count).toBeGreaterThanOrEqual(10)
  })
})

describe('the side plank, standards and edges', () => {
  it('straight (15°) and strict (8°)', () => {
    const frames = holdFrames([{ sec: 10, bend: 11 }], { yaw: 90 })
    expect(run(frames).res.count).toBeGreaterThanOrEqual(8)
    expect(run(frames, { standard: 'strict' }).res.count).toBe(0)
    expect(run(holdFrames([{ sec: 10, bend: 18 }], { yaw: 90 })).res.count).toBe(0)
  })

  it('reads the bend to within a couple of degrees', () => {
    const b = run(holdFrames([{ sec: 5, bend: 10 }], { yaw: 90 })).res.reps[0].measures.bend
    expect(b).toBeGreaterThanOrEqual(8)
    expect(b).toBeLessThanOrEqual(12)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    const { res, missed } = run(holdFrames([{ sec: 20 }], { yaw: 90, noise: 0.003, drop: 0.03 }))
    expect(res.count).toBeGreaterThanOrEqual(17)
    expect(missed).toEqual([])
  })

  it('from the head, the feet or well off to one side: asks to face the camera and counts nothing', () => {
    for (const yaw of [0, 30, 45, 180]) {
      const { res, outs } = run(holdFrames([{ sec: 8 }], { yaw }))
      expect({ yaw, count: res.count }).toEqual({ yaw, count: 0 })
      expect({ yaw, hint: outs.at(-1).hint }).toEqual({ yaw, hint: 'Face the camera' })
    }
  })

  it('reads the view from the torso over the upright upper arm', () => {
    const r = yaw => {
      const j = project(sidePlankPose(), { yaw })
      const m = p => [(j['left' + p][0] + j['right' + p][0]) / 2, (j['left' + p][1] + j['right' + p][1]) / 2]
      const [s, h] = [m('Shoulder'), m('Hip')]
      return Math.hypot((s[0] - h[0]) * 0.75, s[1] - h[1]) / (j.rightElbow[1] - j.rightShoulder[1])
    }
    expect(r(90)).toBeGreaterThan(FACING)
    expect(r(65)).toBeGreaterThan(FACING)
    expect(r(50)).toBeLessThan(FACING)
  })

  it('counts nothing standing, and tells the lifter to get into position', () => {
    const { res, outs } = run(holdFrames([{ sec: 4, pose: 'stand' }], { yaw: 90 }))
    expect(res).toMatchObject({ count: 0, cueId: 'none' })
    expect(outs.at(-1).hint).toBe('Get into position')
  })
})

describe('sidePlank.matches', () => {
  it('takes straight-leg side planks held still', () => {
    for (const id of ['0715', '0714', '4811', '1470']) expect(sidePlank.matches(EXIDX[id])).toBe(true)
  })
  it('leaves out bent-knee, moving and front planks', () => {
    for (const id of ['0133', '1469', '2899', '4863', '4991', '0463', '2349', '3954']) expect(sidePlank.matches(EXIDX[id])).toBe(false)
    expect(sidePlank.matches(null)).toBe(false)
  })
})

describe('side-plank, as index.test.js will check it once registered', () => {
  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = sidePlank.create({ standard: sidePlank.defaultStandard })
    const out = tr.push({ t: 0, aspect: 0.75, joints: {} })
    expect(out).toMatchObject({ count: 0, inFrame: false, justCounted: false, justMissed: false, reached: false, highlight: [] })
    expect(out.hint).not.toBe('')
    const res = tr.result()
    expect(res).toMatchObject({ count: 0, missed: 0, reps: [], details: [] })
    expect(res.tiles.length).toBeLessThanOrEqual(3)
    expect(typeof res.cue).toBe('string')
    expect(typeof res.cueId).toBe('string')
  })
})
