// The squat drill against synthetic lifters (test-kit.js) filmed from side-on to facing the
// camera: counting, depth and the standards, tempo, cues, and the extras each view can show.
import { describe, expect, it } from 'vitest'
import squat, { CUE, FAST_DOWN_SEC, PARALLEL_BAND, depthShare } from './squat.js'
import { squatSet, squatPose, project, same, YAWS, CAMERA } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const run = (frames, opts = {}) => {
  const tr = squat.create(opts)
  let counted = 0, missed = 0
  const missedAt = [], outs = []
  for (const f of frames) {
    const out = tr.push(f)
    outs.push(out)
    if (out.justCounted) counted++
    if (out.justMissed) { missed++; missedAt.push({ t: f.t, reason: out.reason }) }
  }
  return { tr, counted, missed, missedAt, outs, res: tr.result() }
}
const ANY = { standard: 'any' }
const FULL = { min: 45, down: 2, up: 1 }, PAR = { min: 60, down: 2, up: 1 }, SHALLOW = { min: 95, down: 2, up: 1 }
const depths = res => res.reps.map(r => r.measures.depth)

// The knee angle at which the hip sits `d` standing thigh lengths below the knee, as filmed at
// `yaw` (bisection: the hip drops as the knee bends).
function kneeForDepth(d, yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const top = project(squatPose(176), { yaw })
  const thigh = y(top, 'Knee') - y(top, 'Hip')
  const at = k => { const j = project(squatPose(k), { yaw }); return (y(j, 'Hip') - y(j, 'Knee')) / thigh }
  let lo = 30, hi = 120
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) > d) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe.each(YAWS)('the squat filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => squatSet(reps, { yaw, ...o })

  it('counts five clean squats, live and in the result', () => {
    const { counted, res } = run(set(same(5, { min: 50, down: 2, up: 1.2 })))
    expect(counted).toBe(5)
    expect(res.count).toBe(5)
    expect(res.reps).toHaveLength(5)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, { min: 55, down: 1.8, up: 1 }), { noise: 0.004, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a wobble at the top', () => {
    const frames = set([{ min: 150, down: 0.5, up: 0.5 }, { min: 50, down: 2, up: 1 }, { min: 145, down: 0.4, up: 0.4 }], { noise: 0.003 })
    expect(run(frames).res.count).toBe(1)
  })

  it('names the depth: below, parallel and above', () => {
    const { res } = run(set([FULL, PAR, SHALLOW]), ANY)
    expect(depths(res)).toEqual(['below', 'parallel', 'above'])
    expect(res.summary).toMatchObject({ depthBelow: 1, depthParallel: 1, depthAbove: 1 })
  })

  it('parallel (the default): counts full and parallel reps, keeps shallow ones as no-reps', () => {
    const { counted, missed, missedAt, res } = run(set([FULL, SHALLOW, PAR, FULL, SHALLOW]))
    expect([counted, missed]).toEqual([3, 2])
    expect(missedAt.map(m => m.reason)).toEqual(['shallow', 'shallow'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true, true, false])
    expect(res).toMatchObject({ count: 3, missed: 2, standard: 'parallel', cueId: 'missed' })
  })

  it('below: only reps with the hip clearly under the knee count', () => {
    const { res } = run(set([FULL, SHALLOW, PAR, FULL, SHALLOW]), { standard: 'below' })
    expect(res.reps.map(r => r.counted)).toEqual([true, false, false, true, false])
  })

  it('any: every real descent counts', () => {
    const { counted, missed } = run(set([FULL, SHALLOW, { min: 150, down: 0.5, up: 0.5 }, PAR]), ANY)
    expect([counted, missed]).toEqual([3, 0])
  })

  it('takes the parallel band at its edge, as filmed from this angle', () => {
    const edge = kneeForDepth(-PARALLEL_BAND, yaw)
    expect(run(set([{ min: edge - 2, down: 2, up: 1 }])).res.reps[0]).toMatchObject({ counted: true, measures: { depth: 'parallel' } })
    expect(run(set([{ min: edge + 2, down: 2, up: 1 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'shallow', measures: { depth: 'above' } })
  })

  it('times the way down and up to within a few tenths', () => {
    const { res } = run(set(same(3, { min: 50, down: 2.5, up: 1.2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(1.9)
      expect(r.measures.downSec).toBeLessThan(2.9)
      expect(r.measures.upSec).toBeGreaterThan(0.8)
      expect(r.measures.upSec).toBeLessThan(1.6)
    }
    expect(res.summary.avgDown).toBeGreaterThan(res.summary.avgUp)
    expect(res.tiles.find(x => x.id === 'tempo')).toBeTruthy()
  })

  it('says slow the way down when the descent is quicker than a second', () => {
    const { res } = run(set(same(4, { min: 50, down: 0.6, up: 0.8 })))
    expect(res.summary.avgDown).toBeLessThan(FAST_DOWN_SEC)
    expect(res.cueId).toBe('slower')
  })

  it('says the last reps were shallower when depth falls off', () => {
    expect(run(set([50, 50, 52, 55, 70, 78].map(min => ({ min, down: 2, up: 1 }))), ANY).res.cueId).toBe('fade')
  })

  it('stays neutral when nothing stands out', () => {
    expect(run(set(same(5, { min: 50, down: 2, up: 1 }), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('says mid-rep once the standard is reached, lighting the hips, and not before', () => {
    const { outs } = run(set([PAR]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftHip', 'rightHip'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHALLOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('shows the extras of this view only', () => {
    const { res } = run(set(same(3, { min: 50, down: 2, up: 1 })))
    const view = yaw === 0 ? 'side' : yaw === 90 ? 'front' : 'diagonal'
    expect(res.view).toBe(view)
    const m = res.reps[0].measures
    expect(m.view).toBe(view)
    expect(m.lean != null).toBe(view === 'side')
    expect(m.minKnee != null).toBe(view === 'side')
    expect(m.knees != null).toBe(view === 'front')
    expect('shift' in m).toBe(view === 'front')
    const ids = res.tiles.map(x => x.id)
    expect(ids).toEqual(view === 'side' ? ['depth', 'tempo', 'consistency'] : view === 'front' ? ['depth', 'tempo', 'knees'] : ['depth', 'tempo'])
  })
})

describe('the squat, whatever the angle', () => {
  it('reads a lifter facing the other way the same (yaw 180, 135, -45)', () => {
    for (const yaw of [180, 135, -45]) {
      const { res } = run(squatSet([FULL, PAR, SHALLOW], { yaw }), ANY)
      expect(depths(res)).toEqual(['below', 'parallel', 'above'])
    }
  })

  it('does not count anything before the lifter has stood up once', () => {
    const crouch = Array.from({ length: 20 }, () => squatPose(70))
    const tr = squat.create()
    for (const [i, p] of crouch.entries()) tr.push({ t: i * 66, aspect: CAMERA.aspect, joints: project(p) })
    for (const f of squatSet(same(2, { min: 50, down: 2, up: 1 }), { start: 20 * 66 })) tr.push(f)
    expect(tr.result().count).toBe(2)
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    const { res } = run(squatSet(same(3, { min: 50, down: 2, up: 1 }), { gap: [5900, 6400] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
  })

  it('counts a rep lost for a moment whatever depth was seen', () => {
    const { res } = run(squatSet([FULL, SHALLOW, FULL], { gap: [6300, 6800] }))
    expect(res.reps.map(r => [r.lost, r.counted])).toEqual([[false, true], [true, true], [false, true]])
  })

  it('drops a rep the camera lost for good', () => {
    expect(run(squatSet(same(2, { min: 50, down: 2, up: 1 }), { gap: [2000, 5000] })).res.count).toBe(1)
  })

  it('asks for a better view when most reps lost the pose', () => {
    const both = squatSet(same(2, { min: 50, down: 2, up: 1 }))
    const lost = both.map(f => ((f.t > 2100 && f.t < 2400) || (f.t > 5900 && f.t < 6200) ? { ...f, joints: {} } : f))
    expect(run(lost).res.cueId).toBe('framing')
    expect(run(squatSet(same(3, { min: 50, down: 2, up: 1 }), { gap: [1700, 2100] })).res.cueId).not.toBe('framing')
  })

  it('says go deeper when most reps stop above parallel', () => {
    const { res } = run(squatSet(same(5, { min: 100, down: 2, up: 1 }), { yaw: 90 }), ANY)
    expect(res.cueId).toBe('deeper')
    expect(res.cue).toBe(CUE.deeper())
  })

  it('has a line for no reps at all, and a no-rep line when every rep missed', () => {
    expect(run(squatSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const none = run(squatSet(same(3, SHALLOW))).res
    expect(none).toMatchObject({ count: 0, missed: 3, cueId: 'missed' })
    expect(none.cue).toBe('Reps that did not count: 3. The hip stayed above the knee.')
    expect(run(squatSet(same(3, SHALLOW)), { standard: 'below' }).res.cue).toBe('Reps that did not count: 3. The hip did not get below the knee.')
  })

  it('says justMissed on the frame the no-rep ends, the one justCounted would be on, and the count stays', () => {
    const frames = squatSet([SHALLOW], { yaw: 45 })
    const missedT = run(frames).missedAt[0].t
    const anyTr = squat.create(ANY)
    expect(frames.find(f => anyTr.push(f).justCounted).t).toBe(missedT)
    expect(run(frames).outs.every(o => o.count === 0)).toBe(true)
  })

  it('times and measures the set over the counted reps only', () => {
    const { res } = run(squatSet([FULL, { min: 95, down: 0.6, up: 0.6 }, FULL]))
    expect(res.count).toBe(2)
    // Hip travel barely moves in the first fifth of a slow start, so a 2 s descent reads about 1.7.
    expect(res.summary.avgDown).toBeGreaterThan(1.5)
    expect(res.summary.consistency).toBeLessThan(5)
  })

  it('reads the depth share of every judged rep, no-reps included', () => {
    const { res } = run(squatSet([FULL, SHALLOW, PAR, FULL, SHALLOW]))
    expect(depthShare(res.reps, 'parallel')).toEqual({ hit: 3, of: 5, depth: 'parallel' })
    expect(depthShare(res.reps, 'below')).toEqual({ hit: 2, of: 5, depth: 'below' })
    expect(depthShare(null, 'below')).toEqual({ hit: 0, of: 0, depth: 'below' })
    expect(res.tiles[0]).toMatchObject({ id: 'depth', label: 'Depth', value: '3 of 5', sub: 'at parallel or deeper' })
  })

  it('side-on: the torso lean at its most and the spread of the bottom knee angle', () => {
    const { res } = run(squatSet([{ min: 50, down: 2, up: 1 }, { min: 60, down: 2, up: 1 }, { min: 55, down: 2, up: 1 }]))
    // The drawn lean is 0.4 of the bend: 52° at the bottom of a 50° squat.
    expect(res.reps[0].measures.lean).toBeGreaterThan(45)
    expect(res.reps[0].measures.lean).toBeLessThan(58)
    expect(res.reps[0].measures.minKnee).toBeCloseTo(50, -1)
    expect(res.summary.consistency).toBeGreaterThan(7)
    expect(res.summary.consistency).toBeLessThan(13)
    expect(res.details[0].map(d => d.label)).toEqual(['Depth', 'Tempo', 'Knee angle', 'Lean'])
    expect(res.note).toBe('Filmed from the side: depth, tempo, knee angle and torso lean.')
  })

  it('from the front: knees caving in at the bottom', () => {
    const { res } = run(squatSet(same(4, { min: 50, down: 2, up: 1, cave: 1 }), { yaw: 90 }))
    expect(res.reps.every(r => r.measures.knees === 'in')).toBe(true)
    expect(res.cueId).toBe('knees')
    expect(res.tiles.find(x => x.id === 'knees')).toMatchObject({ value: '4 of 4' })
    expect(res.details[0]).toContainEqual({ label: 'Knees', value: 'Inside the ankles' })
    const clean = run(squatSet(same(4, { min: 50, down: 2, up: 1 }), { yaw: 90 })).res
    expect(clean.reps.every(r => r.measures.knees === 'out')).toBe(true)
    expect(clean.tiles.find(x => x.id === 'knees')).toMatchObject({ value: '0 of 4' })
    // Side-on the same knees cannot be seen coming in.
    const side = run(squatSet(same(4, { min: 50, down: 2, up: 1, cave: 1 }), { yaw: 0 })).res
    expect(side.reps.some(r => r.measures.knees)).toBe(false)
    expect(side.cueId).not.toBe('knees')
  })

  it('from the front: the hips shifting to one side, either way, front or back camera', () => {
    const left = run(squatSet(same(3, { min: 50, down: 2, up: 1, shift: 0.1 }), { yaw: 90 })).res
    expect(left.reps.map(r => r.measures.shift)).toEqual(['left', 'left', 'left'])
    expect(left.cueId).toBe('shiftLeft')
    expect(left.details[0]).toContainEqual({ label: 'Hips', value: 'Shifted to your left' })
    const right = run(squatSet(same(3, { min: 50, down: 2, up: 1, shift: -0.1 }), { yaw: 90 })).res
    expect(right.cueId).toBe('shiftRight')
    // Mirrored like the front camera: the joints keep their names, so the side is still the lifter's.
    const mirrored = squatSet(same(3, { min: 50, down: 2, up: 1, shift: 0.1 }), { yaw: 90 })
      .map(f => ({ ...f, joints: Object.fromEntries(Object.entries(f.joints).map(([k, [x, y, c]]) => [k, [1 - x, y, c]])) }))
    expect(run(mirrored).res.cueId).toBe('shiftLeft')
    const centred = run(squatSet(same(3, { min: 50, down: 2, up: 1 }), { yaw: 90 })).res
    expect(centred.reps.map(r => r.measures.shift)).toEqual([null, null, null])
    expect(centred.details[0]).toContainEqual({ label: 'Hips', value: 'Centred over the feet' })
    // At 45° neither is judged.
    expect(run(squatSet(same(3, { min: 50, down: 2, up: 1, shift: 0.1, cave: 1 }), { yaw: 45 })).res.cueId).toBe('steady')
  })

  it('outside a side view, asks for the phone at knee height and leaves depth unjudged when it is not', () => {
    for (const cam of [{ height: 0.95 }, { pitch: 15 }]) {
      const frames = squatSet(same(3, SHALLOW), { yaw: 90, ...cam })
      const { outs, res } = run(frames)
      expect(outs.some(o => o.hint === 'Put the phone at knee height and level')).toBe(true)
      // Not judged: a shallow rep counts, said so.
      expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'level' })
      expect(depths(res)).toEqual([null, null, null])
      expect(res.tiles.map(x => x.id)).not.toContain('depth')
    }
    // Side-on the camera's height does not matter.
    const side = run(squatSet([SHALLOW], { yaw: 0, height: 0.95 }))
    expect(side.res.missed).toBe(1)
    expect(side.outs.some(o => o.hint === 'Put the phone at knee height and level')).toBe(false)
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = squat.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    expect(tr.push({ t: 33, aspect: CAMERA.aspect, joints: project(squatPose(90), { yaw: 30 }) }).hint).toBe('Stand tall to start')
    const frames = squatSet(same(1, FULL), { yaw: 30, start: 66 })
    const outs = frames.map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Squat when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('can be held to a view', () => {
    const { res } = run(squatSet(same(2, FULL), { yaw: 0 }), { view: 'diagonal' })
    expect(res.view).toBe('diagonal')
    expect(res.reps[0].measures.lean).toBeUndefined()
  })
})

describe('squat.matches', () => {
  it('takes the squats of the allow-list and two-legged squats by name', () => {
    for (const id of ['3593', '2966', '0043', '1760']) expect(squat.matches(EXIDX[id])).toBe(true)
    expect(squat.matches({ id: 'c1', n: 'Safety bar squat', cat: 'strength' })).toBe(true)
  })

  it('leaves out the rest and squats that are not one bend of both knees', () => {
    for (const id of ['9698', '0289', '2290', '0053', '4362', '1003', '4754', '3747', '1540']) expect(squat.matches(EXIDX[id])).toBe(false)
    expect(squat.matches(null)).toBe(false)
    expect(squat.matches({ id: 'c2', n: 'Squat', cat: 'cardio' })).toBe(false)
  })
})
