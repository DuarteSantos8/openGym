// The rear fly against synthetic lifters chest-down on an incline bench (pull-kit.js flyPose),
// filmed through test-kit.js from side-on to facing the camera.
import { describe, expect, it } from 'vitest'
import rearFly, { FLY_TOP } from './rear-fly.js'
import { checkDrill } from './index.js'
import { armPoses, flyPose } from './pull-kit.js'
import { film, project, YAWS } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const CAM = { height: 0.9 }
const FULL = { top: 90, up: 1, down: 1.5 }, LOW = { top: 65, up: 1, down: 1.5 }
const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))
const set = (reps, o = {}) => film(armPoses((x, p) => flyPose(x, { ...p, incline: o.incline }), 0, reps), { ...CAM, ...o })

const run = (frames, opts = {}) => {
  const tr = rearFly.create(opts)
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

// The arm angle at which the signal is FLY_TOP, as filmed.
function degForTop(yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const r = a => { const j = project(flyPose(a), { yaw, ...CAM }); return y(j, 'Elbow') - y(j, 'Shoulder') }
  const ref = r(0)
  let lo = 40, hi = 90
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if ((ref - r(m)) / ref > FLY_TOP) hi = m; else lo = m }
  return (lo + hi) / 2
}

describe('the rear fly drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(rearFly)).toEqual([])
  })
})

describe.each(YAWS)('the rear fly filmed at yaw %i°', yaw => {
  const S = (reps, o = {}) => set(reps, { yaw, ...o })

  it('counts five clean reps, live and in the result', () => {
    const { counted, res } = run(S(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0 })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(S(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a twitch of the arms', () => {
    expect(run(S([{ top: 30, up: 0.4, down: 0.4 }, FULL], { noise: 0.002 })).res.reps).toHaveLength(1)
  })

  it('shoulder (the default): no-reps the elbows under shoulder height; any counts them', () => {
    const { counted, missed, reasons, res } = run(S([FULL, LOW, FULL]))
    expect([counted, missed]).toEqual([2, 1])
    expect(reasons).toEqual(['low'])
    expect(res.cueId).toBe('missed')
    expect(run(S([FULL, LOW, FULL]), { standard: 'any' }).res.missed).toBe(0)
  })

  it('takes the standard at its edge, as filmed from this angle', () => {
    const edge = degForTop(yaw)
    expect(run(S([{ ...FULL, top: edge + 2 }])).res.reps[0].counted).toBe(true)
    expect(run(S([{ ...FULL, top: edge - 2 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('times the way up and down, and says lower with control when it is quick', () => {
    const { res } = run(S(same(3, { top: 90, up: 1, down: 2.5 })))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.upSec).toBeLessThan(1.5)
      expect(r.measures.downSec).toBeGreaterThan(1.8)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['top', 'tempo'])
    expect(run(S(same(4, { top: 90, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
    expect(run(S(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the elbows once they reach shoulder height', () => {
    const { outs } = run(S([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(run(S([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('compares the arms from the front only', () => {
    const { res } = run(S(same(3, { ...FULL, uneven: 0.3 }), { }), { standard: 'any' })
    const front = yaw === 90
    expect(res.view).toBe(yaw === 0 ? 'side' : front ? 'front' : 'diagonal')
    expect(res.reps.every(r => r.measures.uneven === (front ? true : undefined))).toBe(true)
    expect(res.cueId).toBe(front ? 'uneven' : 'steady')
  })
})

describe('the rear fly, whatever the bench', () => {
  it('reads the same on a steeper or flatter bench, and bent over standing', () => {
    for (const incline of [20, 50, 70]) expect(run(set([FULL, LOW, FULL], { yaw: 30, incline })).res.reps.map(r => r.counted)).toEqual([true, false, true])
  })

  it('reads the other side the same (yaw 180, -45)', () => {
    for (const yaw of [180, -45]) expect(run(set([FULL, LOW], { yaw })).res.reps.map(r => r.counted)).toEqual([true, false])
  })

  it('from the front: even arms say so in the rows', () => {
    const { res } = run(set(same(2, FULL), { yaw: 90 }))
    expect(res.details[0]).toContainEqual({ label: 'Arms', value: 'Even' })
    expect(res.details[0][0]).toEqual({ label: 'Top', value: 'Shoulder height' })
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    const { res } = run(set(same(3, FULL), { gap: [5500, 5950] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
  })

  it('has the lines for no reps and the reps that did not count', () => {
    expect(run(set([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    expect(run(set(same(2, LOW))).res.cue).toBe('Reps that did not count: 2. The elbows stayed under shoulder height.')
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = rearFly.create()
    expect(tr.push({ t: 0, joints: {} }).hint).toBe('Step into the frame')
    const outs = set([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Raise when you are.')
    expect(outs.at(-1)).toMatchObject({ hint: '', count: 1 })
  })
})

describe('rearFly.matches', () => {
  it('takes two-armed rear flies', () => {
    for (const id of ['2500', '2487', '0378', '5303', '4172']) expect(rearFly.matches(EXIDX[id])).toBe(true)
  })

  it('leaves out one arm at a time, cables, bands, machines, the floor and rows', () => {
    for (const id of ['3696', '4066', '4012', '4682', '5527', '2470', '9698', '1328', '3664']) expect(rearFly.matches(EXIDX[id])).toBe(false)
    expect(rearFly.matches(null)).toBe(false)
  })
})
