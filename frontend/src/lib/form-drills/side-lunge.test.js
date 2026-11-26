// The side lunge drill against synthetic lifters (test-kit.js) filmed from the front: counting on
// either leg, depth under each standard, tempo, the trailing leg bending, the camera's height,
// views refused, a missing knee, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import sideLunge, { PARALLEL_BAND } from './side-lunge.js'
import { checkDrill } from './index.js'
import { BODY, ease, film, project, same } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const W = 0.45                        // the feet's half-width, metres
const LEG = BODY.thigh + BODY.shin
const H0 = BODY.ankleH + Math.sqrt(LEG ** 2 - (W - BODY.hipHalf) ** 2)

// The knee between hip H and ankle A (3D), bent forward and up; straight when out of reach.
function kneeAt(H, A) {
  const d = [A[0] - H[0], A[1] - H[1], A[2] - H[2]], L = Math.hypot(...d)
  const u = d.map(x => x / L)
  if (L >= LEG - 1e-9) return H.map((x, i) => x + u[i] * BODY.thigh)
  const x = L / 2, h = Math.sqrt(BODY.thigh ** 2 - x * x)
  const tw = [1, 0.8, 0], dot = tw[0] * u[0] + tw[1] * u[1]
  const n = [tw[0] - dot * u[0], tw[1] - dot * u[1], -dot * u[2]], nl = Math.hypot(...n)
  return H.map((v, i) => v + u[i] * x + n[i] / nl * h)
}

/**
 * Feet wide, the hips dropped `drop` metres and pushed back, shifted over the working leg (`side`,
 * the lifter's 'left' or 'right'); the other leg straight, or `trail` metres shorter (bent).
 */
export function sideLungePose(drop, { side = 'left', trail = 0 } = {}) {
  const k = side === 'left' ? 1 : -1
  const vh = H0 - drop, uh = -0.6 * drop
  const Lt = LEG - trail
  const dw = Math.sqrt(Math.max(0, Lt ** 2 - uh ** 2 - (vh - BODY.ankleH) ** 2))
  const wh = -k * W + k * dw + k * BODY.hipHalf
  const Aw = [0, BODY.ankleH, k * W], At = [0, BODY.ankleH, -k * W]
  const Hw = [uh, vh, wh + k * BODY.hipHalf], Ht = [uh, vh, wh - k * BODY.hipHalf]
  const lean = 1.2 * drop
  const sh = [uh + BODY.torso * Math.sin(lean), vh + BODY.torso * Math.cos(lean)]
  const neck = [sh[0] + BODY.neck * Math.sin(lean), sh[1] + BODY.neck * Math.cos(lean)]
  const p = { nose: [neck[0] + 0.08, neck[1] + 0.1, wh], neck: [neck[0], neck[1], wh] }
  const named = side === 'left' ? { w: 'left', t: 'right' } : { w: 'right', t: 'left' }
  p[named.w + 'Ankle'] = Aw; p[named.t + 'Ankle'] = At
  p[named.w + 'Hip'] = Hw; p[named.t + 'Hip'] = Ht
  p[named.w + 'Knee'] = kneeAt(Hw, Aw); p[named.t + 'Knee'] = kneeAt(Ht, At)
  for (const [s, kk] of [['left', 1], ['right', -1]]) {
    p[s + 'Shoulder'] = [sh[0], sh[1], wh + kk * BODY.shoulderHalf]
    p[s + 'Elbow'] = [sh[0] + 0.05, sh[1] - 0.29, wh + kk * 0.2]
    p[s + 'Wrist'] = [sh[0] + 0.12, sh[1] - 0.54, wh + kk * 0.18]
  }
  return p
}

/** A set: reps = [{ drop, side, down, up, trail }], `stand` seconds standing between. */
export function sideLungeSet(reps, { stand = 1, fps = 15, without = null, ...opts } = {}) {
  const poses = []
  const hold = (d, n, o) => { for (let i = 0; i < n; i++) poses.push(sideLungePose(d, o)) }
  hold(0, Math.round(stand * fps), {})
  for (const r of reps) {
    const o = e => ({ side: r.side || 'left', trail: (r.trail || 0) * e })
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) { const e = ease(i / dn); poses.push(sideLungePose(r.drop * e, o(e))) }
    hold(r.drop, 3, o(1))
    for (let i = 1; i <= up; i++) { const e = ease(i / up); poses.push(sideLungePose(r.drop * (1 - e), o(1 - e))) }
    hold(0, Math.round(stand * fps), {})
  }
  const frames = film(poses, { fps, yaw: 90, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

// The hip's drop at which the hip sits `d` standing thigh heights below the working knee, filmed from the front.
function dropForDepth(d, yaw = 90) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const top = project(sideLungePose(0), { yaw })
  const thigh = y(top, 'Knee') - y(top, 'Hip')
  const at = x => { const j = project(sideLungePose(x), { yaw }); return (y(j, 'Hip') - j.leftKnee[1]) / thigh }
  let lo = 0.05, hi = 0.6
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) > d) hi = m; else lo = m }
  return (lo + hi) / 2
}

const run = (frames, opts = {}) => {
  const tr = sideLunge.create(opts)
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
export const PAR = dropForDepth(0.05)
const FULL = { drop: PAR, down: 1.5, up: 1 }, HALF = { drop: dropForDepth(-0.3), down: 1.5, up: 1 }, SHALLOW = { drop: 0.15, down: 1.5, up: 1 }

describe('the side lunge drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(sideLunge)).toEqual([])
    expect(sideLunge).toMatchObject({ kind: 'reps', views: ['front'], defaultStandard: 'parallel' })
  })

  it('films the pose helper as meant: one knee bent, the other leg straight', () => {
    const j = project(sideLungePose(PAR), { yaw: 90 })
    expect(Math.abs(j.leftKnee[1] - (j.leftHip[1] + j.rightHip[1]) / 2)).toBeLessThan(0.03)
    expect(j.rightKnee[1]).toBeLessThan(j.rightAnkle[1])
  })
})

describe.each([90, 75, -90, -75])('the side lunge filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => sideLungeSet(reps, { yaw, ...o })

  it('counts five lunges to one side and alternating, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0, view: 'front' })
    const alt = run(set([FULL, { ...FULL, side: 'right' }, FULL, { ...FULL, side: 'right' }])).res
    expect(alt.count).toBe(4)
    expect(alt.reps.map(r => r.measures.leg)).toEqual(['left', 'right', 'left', 'right'])
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a dip at the top', () => {
    expect(run(set([{ drop: 0.03, down: 0.4, up: 0.4 }, FULL, { drop: 0.04, down: 0.4, up: 0.4 }], { noise: 0.002 }), { standard: 'any' }).res.count).toBe(1)
  })

  it('parallel (the default), halfway and any depth', () => {
    const frames = set([{ ...FULL, drop: dropForDepth(0.05, yaw) }, { ...HALF, drop: dropForDepth(-0.3, yaw) }, SHALLOW])
    const par = run(frames)
    expect(par.reasons).toEqual(['shallow', 'shallow'])
    expect(par.res.reps.map(r => r.measures.depth)).toEqual(['parallel', 'half', 'above'])
    expect(par.res.cue).toBe('Reps that did not count: 2. The hip did not get down to the knee.')
    expect(run(frames, { standard: 'half' }).res.reps.map(r => r.counted)).toEqual([true, true, false])
    expect(run(frames, { standard: 'any' }).res).toMatchObject({ count: 3, missed: 0 })
  })

  it('takes parallel at its edge', () => {
    expect(run(set([{ ...FULL, drop: dropForDepth(-PARALLEL_BAND + 0.05, yaw) }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ ...FULL, drop: dropForDepth(-PARALLEL_BAND - 0.06, yaw) }])).res.reps[0]).toMatchObject({ counted: false, reason: 'shallow' })
  })

  it('times the way down and up, says slow the descent when it is quick, stays neutral otherwise', () => {
    const { res } = run(set(same(3, { drop: PAR, down: 2, up: 1 }), { noise: 0.002 }))
    for (const r of res.reps) expect(r.measures.downSec).toBeGreaterThan(1.2)
    expect(res.tiles.map(x => x.id)).toEqual(['depth', 'tempo'])
    expect(run(set(same(4, { drop: PAR, down: 0.5, up: 1 }))).res.cueId).toBe('slower')
    expect(run(set(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('the trailing leg bending: measured on every rep, said when most bend', () => {
    const bent = run(set(same(3, { ...FULL, trail: 0.12 }))).res
    expect(bent.reps.every(r => r.measures.trail < 160)).toBe(true)
    expect(bent.cueId).toBe('trail')
    expect(bent.cue).toBe('The other leg bent on most reps. Try keeping it straight as you sit into the side.')
    expect(bent.details[0].map(d => d.label)).toEqual(['Depth', 'Tempo', 'Working leg', 'Other knee'])
    expect(run(set(same(3, FULL))).res.reps.every(r => r.measures.trail > 170)).toBe(true)
  })

  it('lights the working knee and the hips at depth, not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftKnee', 'leftHip', 'rightHip'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHALLOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the knees out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftKnee', 'rightKnee'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the side lunge, whatever the angle', () => {
  it('side-on or at an angle: asks to face the camera and counts nothing', () => {
    for (const yaw of [0, 45]) {
      const { outs, res } = run(sideLungeSet(same(3, FULL), { yaw }))
      expect(outs.at(-1).hint).toBe('Face the camera')
      expect(res.count).toBe(0)
    }
  })

  it('asks for the phone at knee height and leaves the depth unjudged when it is not', () => {
    const { outs, res } = run(sideLungeSet([FULL, HALF, FULL], { height: 1.5 }))
    expect(outs.some(o => o.hint === 'Put the phone at knee height and level')).toBe(true)
    expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'level' })
    expect(res.reps.every(r => r.measures.depth == null)).toBe(true)
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(sideLungeSet(same(3, FULL), { gap: [5400, 5800] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(sideLungeSet(same(2, FULL), { gap: [1300, 4600] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(sideLungeSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = sideLunge.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = sideLungeSet([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })
})

describe('sideLunge.matches', () => {
  it('takes side and lateral lunges, side squats and Cossack squats, bodyweight or hand-held', () => {
    for (const id of ['2972', '4789', '2569', '1215', '4853', '4098', '4754', '4562', '6193', '1410']) expect(sideLunge.matches(EXIDX[id])).toBe(true)
    expect(sideLunge.matches({ id: 'c1', n: 'Goblet side lunge', cat: 'strength' })).toBe(true)
  })

  it('leaves out jumping, elevated, cable, band, landmine, overhead and combined lunges, stretches, squats and split squats', () => {
    for (const id of ['3350', '7202', '10052', '1694', '1553', '4753', '5310', '0711', '4675', '4524', '3593', '2290', '1132']) expect(sideLunge.matches(EXIDX[id])).toBe(false)
    expect(sideLunge.matches(null)).toBe(false)
  })
})
