// The seated cable row against a synthetic lifter sitting at a low pulley (test-kit.js), side-on:
// counting, the reach and the finish under each standard, tempo, a rocking torso, views refused, a
// missing wrist, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import seatedRow, { elbowPast } from './seated-cable-row.js'
import { checkDrill } from './index.js'
import { CAMERA, ease, film, project, same } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180
const ARM = { upper: 0.29, fore: 0.27 }

// The elbow between shoulder S and wrist W (u, v), bent downwards; straight when out of reach.
function elbowAt(S, W) {
  const du = W[0] - S[0], dv = W[1] - S[1], L = Math.hypot(du, dv)
  const ux = du / L, uy = dv / L
  if (L >= ARM.upper + ARM.fore) return [S[0] + ux * ARM.upper, S[1] + uy * ARM.upper]
  const x = (ARM.upper ** 2 - ARM.fore ** 2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, ARM.upper ** 2 - x * x))
  const a = [S[0] + ux * x - uy * h, S[1] + uy * x + ux * h], b = [S[0] + ux * x + uy * h, S[1] + uy * x - ux * h]
  return a[1] < b[1] ? a : b
}

/**
 * Sitting on the floor or a bench, legs forward, facing +u: `p` 0 with the arms reaching straight
 * to the handle, 1 with the wrists at the lower ribs. `lean` tips the torso that many degrees back
 * (negative: forward); `reach` (0 to 1) bends the arms at the start (0 straight).
 */
export function seatedRowPose(p, { lean = 0, reach = 0 } = {}) {
  const hip = [0, 0.45]
  const a = rad(-lean)
  const up = [Math.sin(a), Math.cos(a)], fwd = [Math.cos(a), -Math.sin(a)]
  const at = (k, f = 0) => [hip[0] + up[0] * k + fwd[0] * f, hip[1] + up[1] * k + fwd[1] * f]
  const S = at(0.5), neck = at(0.62), nose = at(0.69, 0.08)
  const handV = S[1] - 0.22
  const far = S[0] + Math.sqrt((ARM.upper + ARM.fore) ** 2 - 0.22 ** 2) - 0.002 - reach * 0.2
  const W = [far + (S[0] + 0.12 - far) * p, handV]
  const E = elbowAt(S, W)
  const out = { neck: [neck[0], neck[1], 0], nose: [nose[0], nose[1], 0] }
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    out[side + 'Shoulder'] = [S[0], S[1], k * 0.19]
    out[side + 'Elbow'] = [E[0], E[1], k * 0.2]
    out[side + 'Wrist'] = [W[0], W[1], k * 0.1]
    out[side + 'Hip'] = [hip[0], hip[1], k * 0.1]
    out[side + 'Knee'] = [0.4, 0.6, k * 0.1]
    out[side + 'Ankle'] = [0.8, 0.45, k * 0.1]
  }
  return out
}

/** A set: reps = [{ to, pull, back, rock, reach }], `stand` seconds reaching between; `reach` bends the arms before that rep. */
export function seatedRowSet(reps, { stand = 1, fps = 15, without = null, ...opts } = {}) {
  const poses = []
  const hold = (x, n, o = {}) => { for (let i = 0; i < n; i++) poses.push(seatedRowPose(x, o)) }
  hold(0, Math.round(stand * fps), { reach: reps[0]?.reach || 0 })
  reps.forEach((r, k) => {
    const to = r.to ?? 1, reach = r.reach || 0, next = reps[k + 1]?.reach || 0
    const n1 = Math.max(2, Math.round(r.pull * fps)), n2 = Math.max(2, Math.round(r.back * fps))
    for (let i = 1; i <= n1; i++) { const e = ease(i / n1); poses.push(seatedRowPose(to * e, { lean: (r.rock || 0) * e, reach })) }
    hold(to, 3, { lean: r.rock || 0, reach })
    for (let i = 1; i <= n2; i++) { const e = ease(i / n2); poses.push(seatedRowPose(to * (1 - e), { lean: (r.rock || 0) * (1 - e), reach: reach + (next - reach) * e })) }
    hold(0, Math.round(stand * fps), { reach: next })
  })
  const frames = film(poses, { fps, height: 0.7, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = seatedRow.create(opts)
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
const FULL = { pull: 1, back: 1.5 }, SHORT = { pull: 1, back: 1.5, to: 0.6 }, BENT = { pull: 1, back: 1.5, reach: 0.4 }

describe('the seated cable row drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(seatedRow)).toEqual([])
    expect(seatedRow).toMatchObject({ kind: 'reps', views: ['side'], defaultStandard: 'full' })
  })

  it('films the pose helper as meant: straight arms at the start, elbows behind the torso at the finish', () => {
    const start = project(seatedRowPose(0), { height: 0.7 }), end = project(seatedRowPose(1), { height: 0.7 }), half = project(seatedRowPose(0.6), { height: 0.7 })
    expect(elbowPast(start, 'right', CAMERA.aspect, 1)).toBeLessThan(-0.3)
    expect(elbowPast(end, 'right', CAMERA.aspect, 1)).toBeGreaterThan(0.05)
    expect(elbowPast(half, 'right', CAMERA.aspect, 1)).toBeLessThan(0)
    expect(elbowPast({}, 'right', 1, 1)).toBe(null)
  })
})

describe.each([0, 10, 180])('the seated cable row filmed side-on, yaw %i°', yaw => {
  const set = (reps, o = {}) => seatedRowSet(reps, { yaw, ...o })

  it('counts five clean rows, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0, view: 'side' })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a twitch of the arms', () => {
    expect(run(set([{ pull: 0.4, back: 0.4, to: 0.15 }, FULL, { pull: 0.4, back: 0.4, to: 0.2 }], { noise: 0.002 }), { standard: 'any' }).res.count).toBe(1)
  })

  it('full range (the default): no-reps a short pull and a start from bent arms', () => {
    const { reasons, res } = run(set([FULL, SHORT, FULL, BENT, FULL]))
    expect(reasons).toEqual(['short', 'reach'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true, false, true])
    expect(res).toMatchObject({ standard: 'full', cueId: 'missed' })
    expect(res.details[1][1]).toEqual({ label: 'Top', value: 'Short of the torso' })
    expect(res.details[3][0]).toEqual({ label: 'Start', value: 'Bent arms' })
  })

  it('reads the reach on the straighter arm: Vision bends one of two straight arms', () => {
    // Side-on, Vision reads one elbow 8 to 20 degrees more bent than the other on straight arms (form lab).
    for (const side of ['left', 'right']) {
      const frames = set(same(3, FULL))
      for (const f of frames) if (f.joints[side + 'Elbow']) f.joints[side + 'Elbow'] = [f.joints[side + 'Elbow'][0], f.joints[side + 'Elbow'][1] + 0.04, f.joints[side + 'Elbow'][2]]
      expect(run(frames).res).toMatchObject({ count: 3, missed: 0 })
    }
  })

  it('any range: every real row counts', () => {
    expect(run(set([FULL, SHORT, BENT]), { standard: 'any' }).res).toMatchObject({ count: 3, missed: 0 })
  })

  it('times the pull and the return, and says so when the return is quick', () => {
    const { res } = run(set(same(3, { pull: 1, back: 2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.pullSec).toBeGreaterThan(0.5)
      expect(r.measures.backSec).toBeGreaterThan(1)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['range', 'tempo'])
    const fast = run(set(same(4, { pull: 1, back: 0.4 }))).res
    expect(fast.cueId).toBe('slower')
    expect(fast.cue).toBe('The return took under a second. Try letting the arms go forward with control.')
    expect(run(set(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the elbows once they reach the torso, not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHORT])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the wrists out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftWrist', 'rightWrist'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the seated cable row, rocking and other angles', () => {
  it('measures the torso rocking back, and says so when most reps rock', () => {
    const rocked = run(seatedRowSet(same(3, { ...FULL, rock: 20 }))).res
    expect(rocked.reps.every(r => r.measures.rock >= 14)).toBe(true)
    expect(rocked.cueId).toBe('rock')
    expect(rocked.cue).toBe('The torso rocked on most reps. Try keeping the hips and chest still.')
    expect(rocked.details[0].map(d => d.label)).toEqual(['Start', 'Top', 'Tempo', 'Lean'])
    expect(run(seatedRowSet(same(3, FULL))).res.reps.every(r => r.measures.rock < 3)).toBe(true)
  })

  it('a torso leaning back does not pull the arms: no rep without the wrists coming in', () => {
    const poses = []
    for (let i = 0; i < 120; i++) poses.push(seatedRowPose(0, { lean: 25 * ease(Math.abs(((i % 40) / 20) - 1)) }))
    expect(run(film(poses, { height: 0.7 })).res.count).toBe(0)
  })

  it('refuses a view at an angle or from the front: asks to turn side-on and counts nothing', () => {
    for (const yaw of [45, 90]) {
      const { outs, res } = run(seatedRowSet(same(3, FULL), { yaw }))
      expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
      expect(res.count).toBe(0)
    }
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(seatedRowSet(same(3, FULL), { gap: [5450, 5850] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(seatedRowSet(same(2, FULL), { gap: [1300, 4600] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(seatedRowSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = seatedRow.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    expect(tr.push({ t: 66, aspect: CAMERA.aspect, joints: project(seatedRowPose(1), { height: 0.7 }) }).hint).toBe('Reach forward with straight arms to start')
    const outs = seatedRowSet([FULL], { start: 200 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Row when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })
})

describe('seatedRow.matches', () => {
  it('takes two-armed seated cable and band rows', () => {
    for (const id of ['0861', '0180', '6032', '1323', '3896', '2661', '0239', '3845', '4391']) expect(seatedRow.matches(EXIDX[id])).toBe(true)
    expect(seatedRow.matches({ id: 'c1', n: 'Seated cable row', cat: 'strength' })).toBe(true)
  })

  it('leaves out one arm, machines, high, wide, twisting, floor and chest-supported rows', () => {
    for (const id of ['0214', '10112', '1350', '0213', '0218', '1205', '0160', '3357', '1320', '9698', '4235', '0499']) expect(seatedRow.matches(EXIDX[id])).toBe(false)
    expect(seatedRow.matches(null)).toBe(false)
  })
})
