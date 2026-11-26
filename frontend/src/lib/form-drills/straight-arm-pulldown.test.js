// The straight-arm pulldown against a synthetic lifter at a high cable (test-kit.js), side-on:
// counting, the start and the finish under each standard, tempo, bent elbows, a rocking torso,
// views refused, a missing wrist, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import pulldown, { FINISH_DEG, START_DEG, shoulderAngle } from './straight-arm-pulldown.js'
import { checkDrill } from './index.js'
import { CAMERA, ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

/**
 * Standing, hinged `lean` degrees forward, both arms `ang` degrees forward of the torso (the angle
 * at the shoulder between the hip and the wrist: about 100 reaching up to the cable, 15 at the
 * thighs), the forearms bent `bend` degrees further forward at the elbow.
 */
export function pulldownPose(ang, { lean = 15, bend = 0 } = {}) {
  const p = squatPose(176)
  const hip = p.leftHip
  const fwd = rad(lean)
  for (const k of ['nose', 'neck', 'leftShoulder', 'rightShoulder']) {
    const [u, v, w] = p[k], du = u - hip[0], dv = v - hip[1]
    p[k] = [hip[0] + du * Math.cos(fwd) + dv * Math.sin(fwd), hip[1] - du * Math.sin(fwd) + dv * Math.cos(fwd), w]
  }
  const arm = rad(ang - lean), fore = rad(ang - lean + bend)
  for (const side of ['left', 'right']) {
    const s = p[side + 'Shoulder']
    const el = [s[0] + 0.29 * Math.sin(arm), s[1] - 0.29 * Math.cos(arm), s[2]]
    p[side + 'Elbow'] = el
    p[side + 'Wrist'] = [el[0] + 0.27 * Math.sin(fore), el[1] - 0.27 * Math.cos(fore), s[2]]
  }
  return p
}

/** A set: reps = [{ bottom, back, down, up, bend, rock }]: from where the last rep left the arms down to `bottom`, back up to `back` (`top` when left out), `stand` seconds there. */
export function pulldownSet(reps, { stand = 1, fps = 15, top = 105, height = 1.2, without = null, ...opts } = {}) {
  const poses = []
  const hold = (a, n, o = {}) => { for (let i = 0; i < n; i++) poses.push(pulldownPose(a, o)) }
  let from = top
  hold(top, Math.round(stand * fps))
  for (const r of reps) {
    const end = r.bottom ?? 15, back = r.back ?? top
    const o = p => ({ bend: (r.bend || 0) * p, lean: 15 - (r.rock || 0) * p })
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) { const e = ease(i / dn); poses.push(pulldownPose(from + (end - from) * e, o(e))) }
    hold(end, 3, o(1))
    for (let i = 1; i <= up; i++) { const e = ease(i / up); poses.push(pulldownPose(end + (back - end) * e, o(1 - e))) }
    hold(back, Math.round(stand * fps))
    from = back
  }
  const frames = film(poses, { fps, height, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = pulldown.create(opts)
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
const FULL = { down: 1, up: 1.5 }, SHORT = { down: 1, up: 1.5, bottom: 40 }, LOW_BACK = { down: 1, up: 1.5, back: 70 }

describe('the straight-arm pulldown drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(pulldown)).toEqual([])
    expect(pulldown).toMatchObject({ kind: 'reps', views: ['side'], defaultStandard: 'full' })
  })
})

describe.each([0, 10, 180])('the straight-arm pulldown filmed side-on, yaw %i°', yaw => {
  const set = (reps, o = {}) => pulldownSet(reps, { yaw, ...o })

  it('counts five clean reps, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0, view: 'side' })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a twitch at the top', () => {
    expect(run(set([{ down: 0.5, up: 0.5, bottom: 85 }, FULL, { down: 0.4, up: 0.4, bottom: 80 }], { noise: 0.002 }), { standard: 'any' }).res.count).toBe(1)
  })

  it('full range (the default): no-reps the hands short of the thighs and a start from arms not raised', () => {
    const { reasons, res } = run(set([FULL, SHORT, LOW_BACK, FULL, FULL]))
    expect(reasons).toEqual(['short', 'start'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true, false, true])
    expect(res).toMatchObject({ standard: 'full', cueId: 'missed' })
  })

  it('any range: every real pulldown counts', () => {
    expect(run(set([FULL, SHORT, LOW_BACK, FULL]), { standard: 'any' }).res).toMatchObject({ count: 4, missed: 0 })
  })

  it('takes the finish and the start at their edges', () => {
    expect(run(set([{ ...FULL, bottom: FINISH_DEG - 4 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ ...FULL, bottom: FINISH_DEG + 5 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'short' })
    expect(run(set([{ ...FULL, back: START_DEG + 5 }, FULL])).res.reps[1].counted).toBe(true)
    expect(run(set([{ ...FULL, back: START_DEG - 8 }, FULL])).res.reps[1]).toMatchObject({ counted: false, reason: 'start' })
  })

  it('times the way down and back up, and says so when the arms fly back up', () => {
    const { res } = run(set(same(3, { down: 1, up: 2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(0.5)
      expect(r.measures.upSec).toBeGreaterThan(1)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['range', 'tempo'])
    const fast = run(set(same(4, { down: 1, up: 0.4 }))).res
    expect(fast.cueId).toBe('slower')
    expect(fast.cue).toBe('The way back up took under a second. Try letting the arms rise with control.')
    expect(run(set(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the wrists once at the thighs, not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftWrist', 'rightWrist'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHORT])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the wrists out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftWrist', 'rightWrist'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the straight-arm pulldown faults', () => {
  it('bent elbows: measured on every rep, said when most bend', () => {
    const bent = run(pulldownSet(same(3, { ...FULL, bend: 50 })), { standard: 'any' }).res
    expect(bent.reps.every(r => r.measures.elbow < 150)).toBe(true)
    expect(bent.cueId).toBe('bent')
    expect(bent.cue).toBe('The elbows bent on most reps. Try keeping the arms nearly straight.')
    expect(run(pulldownSet(same(3, FULL))).res.reps.every(r => r.measures.elbow > 170)).toBe(true)
  })

  it('a rocking torso: measured on every rep, said when most rock', () => {
    const rocked = run(pulldownSet(same(3, { ...FULL, rock: 25 }))).res
    expect(rocked.reps.every(r => r.measures.rock >= 12)).toBe(true)
    expect(rocked.cueId).toBe('rock')
    expect(rocked.cue).toBe('The torso rocked on most reps. Try keeping the hips and chest still.')
    expect(rocked.details[0].map(d => d.label)).toEqual(['Range', 'Tempo', 'Elbow angle', 'Lean'])
    expect(run(pulldownSet(same(3, FULL))).res.reps.every(r => r.measures.rock < 4)).toBe(true)
  })

  it('reads the angle at the shoulder against the torso, not the vertical', () => {
    const j = project(pulldownPose(60, { lean: 30 }), { height: 1.2 })
    expect(Math.abs(shoulderAngle(j, 'right', CAMERA.aspect) - 60)).toBeLessThan(3)
    expect(shoulderAngle({}, 'right', 1)).toBe(null)
  })
})

describe('the straight-arm pulldown, other angles', () => {
  it('refuses a view at an angle or from the front: asks to turn side-on and counts nothing', () => {
    for (const yaw of [45, 90, -90]) {
      const { outs, res } = run(pulldownSet(same(3, FULL), { yaw }))
      expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
      expect(res.count).toBe(0)
    }
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(pulldownSet(same(3, FULL), { gap: [5500, 5900] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(pulldownSet(same(2, FULL), { gap: [1300, 4600] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(pulldownSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = pulldown.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const hang = pulldownPose(15)
    expect(tr.push({ t: 66, aspect: CAMERA.aspect, joints: project(hang, { height: 1.2 }) }).hint).toBe('Arms up to the cable to start')
    const outs = pulldownSet([FULL], { start: 200 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Pull when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })
})

describe('pulldown.matches', () => {
  it('takes standing two-armed straight-arm pulldowns and lat pushdowns', () => {
    for (const id of ['0238', '0237', '4576', '0928', '1229', '0199', '6036']) expect(pulldown.matches(EXIDX[id])).toBe(true)
    expect(pulldown.matches({ id: 'c1', n: 'Rope straight arm pulldown', cat: 'strength' })).toBe(true)
  })

  it('leaves out one arm, pullovers, triceps pushdowns and lat pulldowns', () => {
    for (const id of ['5844', '0433', '0200', '0201', '2330', '0150']) expect(pulldown.matches(EXIDX[id])).toBe(false)
    expect(pulldown.matches(null)).toBe(false)
  })
})
