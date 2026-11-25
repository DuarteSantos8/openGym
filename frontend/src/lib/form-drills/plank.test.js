// The plank hold against synthetic lifters (test-kit.js): seconds in line, sagging, piking and
// knees down not counted and said, milestones, views, lost pose, the result.
import { describe, expect, it } from 'vitest'
import plank, { GRACE_MS, REPEAT_MS, bendText } from './plank.js'
import { checkDrill } from './index.js'
import { film, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180
const L1 = 0.86, L2 = 0.5    // ankle to hip, hip to shoulder

/**
 * A front plank in body coordinates, head towards +u: shoulders over the elbows, the line from
 * ankle to shoulder bent `bend` degrees at the hip (positive sags). `knees`: knees on the floor.
 * `hands`: on straight arms instead of the forearms.
 */
export function plankPose({ bend = 0, knees = false, hands = false } = {}) {
  const arm = hands ? 0.55 : 0.29
  const sh = [0.45, 0.05 + arm]
  const inc = Math.asin((sh[1] - 0.1) / (L1 + L2))
  const legDir = inc - rad(bend) * L2 / (L1 + L2), torsoDir = inc + rad(bend) * L1 / (L1 + L2)
  const hip = [sh[0] - L2 * Math.cos(torsoDir), sh[1] - L2 * Math.sin(torsoDir)]
  const ank = [hip[0] - L1 * Math.cos(legDir), hip[1] - L1 * Math.sin(legDir)]
  const kn = knees ? [(hip[0] + ank[0]) / 2, 0.05] : [(hip[0] + ank[0]) / 2, (hip[1] + ank[1]) / 2]
  const p = {}
  const pair = (name, [u, v], half) => { p['left' + name] = [u, v, half]; p['right' + name] = [u, v, -half] }
  pair('Shoulder', sh, 0.19)
  pair('Elbow', hands ? [sh[0], sh[1] - 0.29] : [sh[0], 0.05], 0.17)
  pair('Wrist', hands ? [sh[0], 0.05] : [sh[0] + 0.25, 0.05], 0.12)
  pair('Hip', hip, 0.1)
  pair('Knee', kn, 0.1)
  pair('Ankle', ank, 0.1)
  const neck = [sh[0] + 0.12 * Math.cos(torsoDir), sh[1] + 0.12 * Math.sin(torsoDir)]
  p.neck = [neck[0], neck[1], 0]
  p.nose = [neck[0] + 0.1, neck[1] + 0.03, 0]
  return p
}

/** Lying flat on the floor, arms by the sides: not a plank. */
function lyingPose() {
  const p = plankPose()
  for (const k of Object.keys(p)) p[k] = [p[k][0], 0.1, p[k][2]]
  p.leftElbow = [0.2, 0.1, 0.25]; p.rightElbow = [0.2, 0.1, -0.25]
  return p
}

/** A hold: [{ sec, bend, knees, hands, pose: 'plank' | 'stand' | 'lie' }] in order, filmed with `opts` (film). */
export function holdFrames(segments, { fps = 15, ...opts } = {}) {
  const poses = []
  for (const s of segments) {
    const pose = s.pose === 'stand' ? squatPose(178) : s.pose === 'lie' ? lyingPose() : plankPose(s)
    for (let i = 0; i < Math.round(s.sec * fps); i++) poses.push(pose)
  }
  return film(poses, { fps, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = plank.create(opts)
  const outs = frames.map(f => tr.push(f))
  return { outs, res: tr.result(), said: outs.filter(o => o.justCounted).map(o => o.count), missed: outs.filter(o => o.justMissed).map(o => o.reason) }
}

describe('the plank drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(plank)).toEqual([])
    expect(plank).toMatchObject({ kind: 'hold', views: ['side'], defaultStandard: 'straight' })
  })
})

describe.each([0, 10, 180, -10])('the plank filmed side-on, yaw %i°', yaw => {
  it('counts the seconds held in line, says every ten', () => {
    const { res, said, outs } = run(holdFrames([{ sec: 2, pose: 'stand' }, { sec: 25 }, { sec: 2, pose: 'stand' }], { yaw }))
    expect(res.count).toBeGreaterThanOrEqual(23)
    expect(res.count).toBeLessThanOrEqual(25)
    expect(said).toEqual([10, 20])
    expect(res.missed).toBe(0)
    expect(res.reps).toHaveLength(1)
    expect(res.reps[0]).toMatchObject({ counted: true, reason: null })
    expect(res.cueId).toBe('steady')
    expect(outs.find(o => o.reached).highlight).toHaveLength(3)
  })

  it('stops the clock while the hips sag, and says so', () => {
    const { res, missed } = run(holdFrames([{ sec: 10 }, { sec: 6, bend: 25 }, { sec: 10 }], { yaw }))
    expect(res.count).toBeGreaterThanOrEqual(19)
    expect(res.count).toBeLessThanOrEqual(21)
    expect(res.missed).toBeGreaterThanOrEqual(5)
    expect(res.missed).toBeLessThanOrEqual(6)
    // Said once when it lasted the grace, again after REPEAT_MS.
    expect(missed).toEqual(['sag', 'sag'])
    expect(res.reps.map(r => [r.counted, r.reason])).toEqual([[true, null], [false, 'sag'], [true, null]])
    expect(res.cueId).toBe('missed')
    expect(res.cue).toMatch(/^Out of line for \d s: the hips sagged/)
    expect(res.tiles.map(x => x.id)).toEqual(['longest', 'hips', 'out'])
  })

  it('stops the clock when the hips pike, or the knees go down', () => {
    expect(run(holdFrames([{ sec: 5 }, { sec: 3, bend: -25 }, { sec: 3 }], { yaw })).missed).toEqual(['pike'])
    expect(run(holdFrames([{ sec: 5 }, { sec: 3, knees: true }, { sec: 3 }], { yaw })).missed).toEqual(['knees'])
  })

  it('counts a hold on straight arms too', () => {
    expect(run(holdFrames([{ sec: 12, hands: true }], { yaw })).res.count).toBeGreaterThanOrEqual(11)
  })
})

describe('the plank, standards and edges', () => {
  it('straight (15°) and strict (8°)', () => {
    const frames = holdFrames([{ sec: 10, bend: 11 }])
    expect(run(frames).res.count).toBeGreaterThanOrEqual(9)
    expect(run(frames, { standard: 'strict' }).res.count).toBe(0)
    expect(run(frames, { standard: 'strict' }).missed[0]).toBe('sag')
    expect(run(holdFrames([{ sec: 10, bend: 18 }])).res.count).toBe(0)
    expect(run(holdFrames([{ sec: 10, bend: 5 }]), { standard: 'strict' }).res.count).toBeGreaterThanOrEqual(9)
  })

  it('reads the bend to within a couple of degrees', () => {
    const { res } = run(holdFrames([{ sec: 5, bend: 10 }]))
    expect(res.reps[0].measures.bend).toBeGreaterThanOrEqual(8)
    expect(res.reps[0].measures.bend).toBeLessThanOrEqual(12)
    expect(res.tiles.find(x => x.id === 'hips').value).toMatch(/° sag$/)
  })

  it('does not say a flicker out of line shorter than the grace', () => {
    const { res, missed } = run(holdFrames([{ sec: 5 }, { sec: GRACE_MS / 1000 / 2, bend: 25 }, { sec: 5 }]))
    expect(missed).toEqual([])
    expect(res.reps).toHaveLength(1)
    expect(res.missed).toBe(0)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    const { res, missed } = run(holdFrames([{ sec: 20 }], { noise: 0.003, drop: 0.03 }))
    expect(res.count).toBeGreaterThanOrEqual(18)
    expect(missed).toEqual([])
  })

  it('counts nothing standing, lying flat, or before getting into position', () => {
    const { res, outs } = run(holdFrames([{ sec: 3, pose: 'stand' }, { sec: 3, pose: 'lie' }]))
    expect(res).toMatchObject({ count: 0, missed: 0, cueId: 'none' })
    expect(outs.at(-1).hint).toBe('Get into position')
  })

  it('from the head or at an angle: asks to turn side-on and counts nothing', () => {
    for (const yaw of [45, 90]) {
      const { res, outs } = run(holdFrames([{ sec: 8 }], { yaw }))
      expect(res.count).toBe(0)
      expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
    }
  })

  it('a pose lost for a moment stops the clock for that moment only, and marks the stretch', () => {
    const { res } = run(holdFrames([{ sec: 12 }], { gap: [4000, 5000] }))
    expect(res.count).toBeGreaterThanOrEqual(10)
    expect(res.count).toBeLessThanOrEqual(11)
    expect(res.reps.some(r => r.lost)).toBe(true)
  })

  it('says when the hips sink as the hold goes on', () => {
    const segs = [0, 1, 2, 3, 5, 7, 9, 11, 12].map(bend => ({ sec: 3, bend }))
    expect(run(holdFrames(segs)).res.cueId).toBe('sinking')
  })

  it('repeats the miss every few seconds while it lasts, not every frame', () => {
    const { missed } = run(holdFrames([{ sec: 3 }, { sec: (GRACE_MS + 2 * REPEAT_MS) / 1000 + 0.5, bend: 30 }]))
    expect(missed).toEqual(['sag', 'sag', 'sag'])
  })

  it('names its status lines and rows', () => {
    const { outs, res } = run(holdFrames([{ sec: 3 }, { sec: 3, bend: 25 }]))
    expect(outs.at(-1).hint).toBe('Hips sagging. Time not counted.')
    expect(res.details[1]).toEqual([{ label: 'Time', value: expect.stringMatching(/ s$/) }, { label: 'Hips', value: expect.stringMatching(/° sag$/) }])
    expect(bendText(1)).toBe('In line')
    expect(bendText(-12)).toBe('12° pike')
  })
})

describe('plank.matches', () => {
  it('takes front planks held still', () => {
    for (const id of ['0463', '5159', '2135']) expect(plank.matches(EXIDX[id])).toBe(true)
  })
  it('leaves out side, reverse, kneeling and moving planks', () => {
    for (const id of ['0715', '0867', '3238', '3930', '2890', '0464', '3501', '4170', '2347']) expect(plank.matches(EXIDX[id])).toBe(false)
    expect(plank.matches(null)).toBe(false)
  })
})

describe('plank, as index.test.js will check it once registered', () => {
  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = plank.create({ standard: plank.defaultStandard })
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
