// The front raise drill against synthetic lifters (test-kit.js): counting, the height and the
// return to the hang under each standard, tempo, leaning back and bent elbows side-on, the camera's
// height at an angle, a missing wrist, and the exercises it is offered for.
import { describe, expect, it } from 'vitest'
import frontRaise, { TOP } from './front-raise.js'
import { checkDrill } from './index.js'
import { ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const ARM = { upper: 0.29, fore: 0.27 }
const rad = d => d * Math.PI / 180
const SHOULDER = { height: 1.45 }

/**
 * Standing tall, both arms raised straight ahead: `flex` the arm's angle from hanging (degrees),
 * the forearm bent `bend` degrees further up at the elbow, the upper body leaned back `lean`
 * degrees about the hips.
 */
export function frontRaisePose(flex, { bend = 0, lean = 0 } = {}) {
  const p = squatPose(178)
  const hip = p.leftHip
  const back = rad(-lean)
  for (const k of ['nose', 'neck', 'leftShoulder', 'rightShoulder']) {
    const [u, v, w] = p[k], du = u - hip[0], dv = v - hip[1]
    p[k] = [hip[0] + du * Math.cos(back) + dv * Math.sin(back), hip[1] - du * Math.sin(back) + dv * Math.cos(back), w]
  }
  for (const side of ['left', 'right']) {
    const s = p[side + 'Shoulder']
    const el = [s[0] + ARM.upper * Math.sin(rad(flex)), s[1] - ARM.upper * Math.cos(rad(flex)), s[2]]
    const g = rad(flex + bend)
    p[side + 'Elbow'] = el
    p[side + 'Wrist'] = [el[0] + ARM.fore * Math.sin(g), el[1] - ARM.fore * Math.cos(g), s[2]]
  }
  return p
}

/** A set of raises: reps = [{ top, up, down, bottom, bend, lean }], `stand` seconds at the hang between. */
export function frontRaiseSet(reps, { stand = 1, fps = 15, hang = 4, drop = 0, without = null, ...opts } = {}) {
  const poses = []
  const hold = (a, n, o) => { for (let i = 0; i < n; i++) poses.push(frontRaisePose(a, o)) }
  let from = hang
  hold(hang, Math.round(stand * fps), {})
  for (const r of reps) {
    const bottom = r.bottom ?? hang
    const o = p => ({ bend: (r.bend || 0) * p, lean: (r.lean || 0) * p })
    const up = Math.max(2, Math.round(r.up * fps)), dn = Math.max(2, Math.round(r.down * fps))
    for (let i = 1; i <= up; i++) { const e = ease(i / up); poses.push(frontRaisePose(from + (r.top - from) * e, o(e))) }
    hold(r.top, 2, o(1))
    for (let i = 1; i <= dn; i++) { const e = ease(i / dn); poses.push(frontRaisePose(r.top + (bottom - r.top) * e, o(1 - e))) }
    hold(bottom, Math.round(stand * fps), {})
    from = bottom
  }
  const frames = film(poses, { fps, ...SHOULDER, drop, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = frontRaise.create(opts)
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
const FULL = { top: 92, up: 1.2, down: 1.8 }
const LOW = { top: 60, up: 1.2, down: 1.8 }

describe('the front raise drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(frontRaise)).toEqual([])
    expect(frontRaise).toMatchObject({ kind: 'reps', views: ['side', 'diagonal'], defaultStandard: 'shoulder' })
  })
})

describe.each([0, 30, 45, 60, 180])('the front raise filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => frontRaiseSet(reps, { yaw, ...o })

  it('counts five clean raises, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0 })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.004, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a swing of the hands', () => {
    expect(run(set([{ top: 30, up: 0.5, down: 0.5 }, FULL, { top: 35, up: 0.4, down: 0.4 }], { noise: 0.003 })).res.count).toBe(1)
  })

  it('shoulder height (the default): a raise that stops low is a no-rep', () => {
    const { counted, missed, reasons, res } = run(set([FULL, LOW, FULL]))
    expect([counted, missed]).toEqual([2, 1])
    expect(reasons).toEqual(['low'])
    expect(res).toMatchObject({ standard: 'shoulder', cueId: 'missed' })
    expect(res.cue).toBe('Reps that did not count: 1. The wrists stayed below shoulder height.')
  })

  it('shoulder height: arms not lowered to the hang before the next rep is a no-rep', () => {
    const { reasons, res } = run(set([{ ...FULL, bottom: 50 }, FULL]))
    expect(reasons).toEqual(['hang'])
    expect(res.reps.map(r => r.counted)).toEqual([false, true])
    expect(res.cue).toBe('Reps that did not count: 1. The arms did not go back down to the hang.')
  })

  it('any: every real raise counts', () => {
    expect(run(set([FULL, LOW, { ...FULL, bottom: 50 }, FULL]), { standard: 'any' }).res).toMatchObject({ count: 4, missed: 0 })
  })

  it('takes shoulder height at its edge', () => {
    expect(run(set([{ top: TOP + 5, up: 1.2, down: 1.8 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ top: TOP - 6, up: 1.2, down: 1.8 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('times the way up and down, says slow the way down when it is quick, stays neutral otherwise', () => {
    const { res } = run(set(same(3, { top: 90, up: 1, down: 2.4 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.5)
      expect(r.measures.upSec).toBeLessThan(1.4)
      expect(r.measures.downSec).toBeGreaterThan(1)
    }
    expect(run(set(same(4, { top: 90, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
    expect(run(set(same(5, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the wrists once at shoulder height, not before', () => {
    const { outs } = run(set([FULL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftWrist', 'rightWrist'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the wrists out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftWrist', 'rightWrist'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the front raise side-on', () => {
  it('measures the lean back, and says so when most reps lean', () => {
    const leaned = run(frontRaiseSet(same(3, { ...FULL, lean: 18 }))).res
    expect(leaned.reps.every(r => r.measures.lean >= 12)).toBe(true)
    expect(leaned.cueId).toBe('lean')
    expect(leaned.cue).toBe('You leaned back on most reps. Try keeping the torso still and lifting with the shoulders.')
    expect(leaned.tiles.map(x => x.id)).toEqual(['height', 'tempo', 'lean'])
    const still = run(frontRaiseSet(same(3, FULL))).res
    expect(still.reps.every(r => r.measures.lean < 4)).toBe(true)
    expect(still.note).toBe('Filmed from the side: height, tempo, elbows and lean.')
    // Facing the other way, leaning back is still leaning back.
    expect(run(frontRaiseSet(same(3, { ...FULL, lean: 18 }), { yaw: 180 })).res.cueId).toBe('lean')
  })

  it('measures the elbows at the top, and says so when most reps bend them', () => {
    const bent = run(frontRaiseSet(same(3, { ...FULL, bend: 50 }))).res
    expect(bent.reps.every(r => r.measures.elbow < 150)).toBe(true)
    expect(bent.cueId).toBe('bent')
    expect(bent.cue).toBe('The elbows bent on most reps. Try keeping the arms nearly straight.')
    expect(bent.details[0].map(d => d.label)).toEqual(['Height', 'Tempo', 'Elbow angle', 'Lean'])
    expect(run(frontRaiseSet(same(3, FULL))).res.reps.every(r => r.measures.elbow > 165)).toBe(true)
  })

  it('reads the height to within a few degrees', () => {
    const top = run(frontRaiseSet([FULL])).res.reps[0].measures.top
    expect(top).toBeGreaterThan(87)
    expect(top).toBeLessThan(97)
  })
})

describe('the front raise, whatever the angle', () => {
  it('at an angle: lean and elbows are not read', () => {
    const { res } = run(frontRaiseSet(same(3, { ...FULL, lean: 18 }), { yaw: 45 }))
    expect(res.reps[0].measures.lean).toBeUndefined()
    expect(res.tiles.map(x => x.id)).toEqual(['height', 'tempo'])
    expect(res.note).toBe('Filmed at an angle: height and tempo only.')
  })

  it('from the front: asks to turn side-on and judges no height', () => {
    const { outs, res } = run(frontRaiseSet(same(3, LOW), { yaw: 90 }))
    expect(outs.some(o => o.hint === 'Turn side-on to the camera')).toBe(true)
    expect(res.missed).toBe(0)
    expect(res.reps.every(r => r.measures.top == null)).toBe(true)
  })

  it('at an angle with the phone far from shoulder height: asks for it and leaves the height unjudged', () => {
    const { outs, res } = run(frontRaiseSet(same(3, LOW), { yaw: 45, height: 0.5 }))
    expect(outs.some(o => o.hint === 'Put the phone at shoulder height')).toBe(true)
    expect(res).toMatchObject({ missed: 0, cueId: 'level' })
    expect(res.cue).toBe('The height of the raise could not be judged. Put the phone at shoulder height, or film from the side.')
  })

  it('side-on the phone may sit anywhere: the arm and the shoulder are the same distance away', () => {
    const { res } = run(frontRaiseSet([FULL, LOW], { height: 0.6 }))
    expect(res.reps.map(r => r.counted)).toEqual([true, false])
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const { res } = run(frontRaiseSet(same(3, FULL), { gap: [5800, 6250] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(frontRaiseSet(same(2, FULL), { gap: [1300, 4500] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(frontRaiseSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = frontRaise.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = frontRaiseSet([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('films the pose helper the right way up', () => {
    const j = project(frontRaisePose(90), SHOULDER)
    expect(Math.abs(j.rightWrist[1] - j.rightShoulder[1])).toBeLessThan(0.01)
  })
})

describe('frontRaise.matches', () => {
  it('takes two-arm standing front raises by id and by name', () => {
    for (const id of ['0310', '0309', '0978', '0041', '0834', '5859', '6543']) expect(frontRaise.matches(EXIDX[id])).toBe(true)
    expect(frontRaise.matches({ id: 'c1', n: 'Plate front raise', cat: 'strength' })).toBe(true)
  })

  it('leaves out seated, lying, incline, alternating, one-arm, overhead, hold and combined raises', () => {
    for (const id of ['0392', '10588', '1176', '4341', '3913', '2515', '0107', '0419', '7588', '0335', '0040', '4161', '10559', '4847']) expect(frontRaise.matches(EXIDX[id])).toBe(false)
    expect(frontRaise.matches(null)).toBe(false)
  })
})
