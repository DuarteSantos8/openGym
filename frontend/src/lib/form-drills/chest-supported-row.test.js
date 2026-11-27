// The chest-supported row against synthetic lifters chest-down on an incline bench (pull-kit.js
// benchRowPose): judged side-on (to about 35 degrees), counted from every other angle.
import { describe, expect, it } from 'vitest'
import chestSupportedRow, { ROW_PAST, VIEW_EDGES } from './chest-supported-row.js'
import { checkDrill } from './index.js'
import { ARM_VIEW_EDGES, armPoses, benchRowPose } from './pull-kit.js'
import { film, project, YAWS } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const CAM = { height: 0.9 }
const FULL = { top: 85, up: 1, down: 1.5 }, LOW = { top: 55, up: 1, down: 1.5 }
const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))
const set = (reps, o = {}) => film(armPoses((x, p) => benchRowPose(x, { ...p, incline: o.incline }), 0, reps), { ...CAM, ...o })

const run = (frames, opts = {}) => {
  const tr = chestSupportedRow.create(opts)
  let counted = 0, missed = 0
  const reasons = [], outs = []
  for (const f of frames) {
    const out = tr.push(f)
    outs.push(out)
    if (out.justCounted) counted++
    if (out.justMissed) { missed++; reasons.push(out.reason) }
  }
  return { counted, missed, reasons, outs, res: tr.result() }
}

// The arm angle at which the elbows are ROW_PAST over the shoulder-hip line, as filmed side-on.
function degForTop(incline) {
  const m = (j, p) => [(j['left' + p][0] + j['right' + p][0]) / 2, (j['left' + p][1] + j['right' + p][1]) / 2]
  const ref = (() => { const j = project(benchRowPose(0, { incline }), CAM); return m(j, 'Elbow')[1] - m(j, 'Shoulder')[1] })()
  const past = a => {
    const j = project(benchRowPose(a, { incline }), CAM)
    const s = m(j, 'Shoulder'), h = m(j, 'Hip'), e = m(j, 'Elbow')
    return (s[1] + (e[0] - s[0]) / (h[0] - s[0]) * (h[1] - s[1]) - e[1]) / ref
  }
  let lo = 30, hi = 100
  for (let i = 0; i < 50; i++) { const x = (lo + hi) / 2; if (past(x) > ROW_PAST) hi = x; else lo = x }
  return (lo + hi) / 2
}

describe('the chest-supported row drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(chestSupportedRow)).toEqual([])
  })
})

describe('the chest-supported row side-on', () => {
  it('counts five clean reps, through noise and drop-outs too', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0, view: 'side' })
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
    expect(run(set(same(4, FULL), { yaw: 180 })).res.count).toBe(4)
  })

  it('does not count a twitch of the arms', () => {
    expect(run(set([{ top: 20, up: 0.4, down: 0.4 }, FULL], { noise: 0.002 })).res.reps).toHaveLength(1)
  })

  it('torso (the default): no-reps the elbows short of the torso; any counts them', () => {
    const { counted, missed, reasons, res } = run(set([FULL, LOW, FULL]))
    expect([counted, missed]).toEqual([2, 1])
    expect(reasons).toEqual(['low'])
    expect(res.cue).toBe('Reps that did not count: 1. The elbows did not get past the torso.')
    expect(res.details[1][0]).toEqual({ label: 'Top', value: 'Short of the torso' })
    expect(run(set([FULL, LOW, FULL]), { standard: 'any' }).res.missed).toBe(0)
  })

  it.each([25, 35, 45])('takes the standard at its edge on a %i° bench', incline => {
    const edge = degForTop(incline)
    expect(run(set([{ ...FULL, top: edge + 3 }], { incline })).res.reps[0].counted).toBe(true)
    expect(run(set([{ ...FULL, top: edge - 3 }], { incline })).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('times the way up and down, and says lower with control when it is quick', () => {
    const { res } = run(set(same(3, { top: 85, up: 1, down: 2.5 })))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.downSec).toBeGreaterThan(1.8)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['top', 'tempo'])
    expect(run(set(same(4, { top: 85, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
    expect(run(set(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the elbows once they are past the torso, and not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(run(set([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('ends a rep at a still rest short of the first hang, the arms a little forward', () => {
    // 40 degrees forward: the reach at rest is 0.77 of the first hang, as real bench rows read it.
    const short = { ...FULL, bottom: 40 }
    const { counted, res } = run(set([short, short, short, FULL]))
    expect(counted).toBe(4)
    expect(res.reps.every(r => r.counted)).toBe(true)
    expect(run(set([short, short, FULL], { yaw: 20, noise: 0.002 })).res.count).toBe(3)
  })

  it('does not end a rep at a pause half way down', () => {
    const { res } = run(set([{ ...FULL, bottom: 60 }, { top: 60, up: 0.2, down: 1.2 }]))
    expect(res.count).toBe(1)
    expect(res.reps).toHaveLength(1)
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    const { res } = run(set(same(3, FULL), { gap: [5500, 5950] }))
    expect(res.reps.map(r => [r.lost, r.counted])).toEqual([[false, true], [true, true], [false, true]])
  })

  it('has the line for no reps, and tells the lifter what to do', () => {
    expect(run(set([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = chestSupportedRow.create()
    expect(tr.push({ t: 0, joints: {} }).hint).toBe('Step into the frame')
    const outs = set([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Row when you are.')
    expect(outs.at(-1)).toMatchObject({ hint: '', count: 1 })
  })
})

describe('the chest-supported row a little off side-on', () => {
  it('reads 20 and 30 degrees as side-on and judges the top there, as at 0', () => {
    for (const yaw of [20, 30, 160]) {
      const { counted, missed, reasons, res, outs } = run(set([FULL, LOW, FULL], { yaw }))
      expect(res.view).toBe('side')
      expect(outs.at(-1).hint).toBe('')
      expect([counted, missed]).toEqual([2, 1])
      expect(reasons).toEqual(['low'])
    }
  })

  it('takes the standard at its edge at 30 degrees too', () => {
    const edge = degForTop(35)
    expect(run(set([{ ...FULL, top: edge + 3 }], { incline: 35, yaw: 30 })).res.reps[0].counted).toBe(true)
    expect(run(set([{ ...FULL, top: edge - 3 }], { incline: 35, yaw: 30 })).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('keeps the side band at about 35 degrees, wider than the other arm drills', () => {
    expect(VIEW_EDGES.side).toBeCloseTo(Math.sin(35 * Math.PI / 180), 2)
    expect(VIEW_EDGES.side).toBeGreaterThan(ARM_VIEW_EDGES.side)
  })
})

describe.each(YAWS.filter(y => y > 35))('the chest-supported row filmed at yaw %i°', yaw => {
  it('asks to turn side-on, counts every rep, and leaves the top unjudged', () => {
    const { res, outs } = run(set([FULL, LOW, FULL], { yaw }))
    expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
    expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'unjudged' })
    expect(res.reps.every(r => r.measures.topOk === null)).toBe(true)
    expect(res.tiles.map(x => x.id)).toEqual(['tempo'])
  })
})

describe('chestSupportedRow.matches', () => {
  it('takes two-armed dumbbell rows on a bench', () => {
    for (const id of ['9698', '5661']) expect(chestSupportedRow.matches(EXIDX[id])).toBe(true)
  })

  it('leaves out one arm, machines, bent-over rows and flies', () => {
    for (const id of ['9699', '11762', '6513', '0293', '0027', '2500', '1328', '3685']) expect(chestSupportedRow.matches(EXIDX[id])).toBe(false)
    expect(chestSupportedRow.matches(null)).toBe(false)
  })
})
