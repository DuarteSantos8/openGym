// The hanging leg raise against a synthetic lifter hanging from a bar (pull-kit.js hangPose),
// side-on: counting, the thighs' height and straight legs under each standard, tempo, swing,
// views refused, letting go of the bar, a missing knee, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import legRaise, { LEVEL_DEG } from './hanging-leg-raise.js'
import { checkDrill } from './index.js'
import { BODY, hangDrop, hangPose } from './pull-kit.js'
import { ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180
const CAM = { height: 1.2, dist: 2.8 }

/**
 * Hanging from the bar, the thighs raised `thigh` degrees forward from hanging. `straight` keeps the
 * shins in line with the thighs (a leg raise), else the shins hang straight down (a knee raise);
 * `bend` folds the shins that many degrees back from the thighs instead. `swing` tips the whole
 * body under the shoulders that many degrees back.
 */
export function legRaisePose(thigh, { straight = false, bend = null, swing = 0 } = {}) {
  const p = hangPose(hangDrop())
  const sw = rad(-swing)
  const tdir = [Math.sin(sw), -Math.cos(sw)]
  const shin = bend != null ? thigh - bend : straight ? thigh : 0
  for (const [side, k] of [['left', 1], ['right', -1]]) {
    const S = p[side + 'Shoulder']
    const hip = [S[0] + tdir[0] * BODY.torso, S[1] + tdir[1] * BODY.torso, k * BODY.hipHalf]
    const th = rad(thigh + swing * -1), sh = rad(shin + swing * -1)
    const knee = [hip[0] + Math.sin(th) * BODY.thigh, hip[1] - Math.cos(th) * BODY.thigh, hip[2]]
    p[side + 'Hip'] = hip
    p[side + 'Knee'] = knee
    p[side + 'Ankle'] = [knee[0] + Math.sin(sh) * BODY.shin, knee[1] - Math.cos(sh) * BODY.shin, hip[2]]
  }
  return p
}

/** A set: reps = [{ top, up, down, straight, bend, swing }], `stand` seconds hanging between. */
export function legRaiseSet(reps, { stand = 1, fps = 15, hang = 3, without = null, ...opts } = {}) {
  const poses = []
  const hold = (a, n, o = {}) => { for (let i = 0; i < n; i++) poses.push(legRaisePose(a, o)) }
  hold(hang, Math.round(stand * fps), { straight: reps[0]?.straight })
  for (const r of reps) {
    const o = e => ({ straight: r.straight, bend: r.bend == null ? null : r.bend * e, swing: (r.swing || 0) * e })
    const up = Math.max(2, Math.round(r.up * fps)), dn = Math.max(2, Math.round(r.down * fps))
    for (let i = 1; i <= up; i++) { const e = ease(i / up); poses.push(legRaisePose(hang + (r.top - hang) * e, o(e))) }
    hold(r.top, 2, o(1))
    for (let i = 1; i <= dn; i++) { const e = ease(i / dn); poses.push(legRaisePose(r.top + (hang - r.top) * e, o(1 - e))) }
    hold(hang, Math.round(stand * fps), { straight: r.straight })
  }
  const frames = film(poses, { fps, ...CAM, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = legRaise.create(opts)
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
const FULL = { top: 95, up: 1, down: 1.5 }, LOW = { top: 60, up: 1, down: 1.5 }
const STRAIGHT = { ...FULL, straight: true }

describe('the hanging leg raise drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(legRaise)).toEqual([])
    expect(legRaise).toMatchObject({ kind: 'reps', views: ['side', 'diagonal'], defaultStandard: 'level' })
  })
})

describe.each([0, 10, 180])('the hanging leg raise filmed side-on, yaw %i°', yaw => {
  const set = (reps, o = {}) => legRaiseSet(reps, { yaw, ...o })

  it('counts five knee raises and five leg raises, live and in the result', () => {
    const knees = run(set(same(5, FULL)))
    expect(knees.counted).toBe(5)
    expect(knees.res).toMatchObject({ count: 5, missed: 0, view: 'side' })
    const legs = run(set(same(5, STRAIGHT))).res
    expect(legs.count).toBe(5)
    // The feet come up to the hips at the top: the lifter is still in the frame.
    expect(legs.reps.some(r => r.lost)).toBe(false)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a twitch of the legs', () => {
    expect(run(set([{ top: 25, up: 0.4, down: 0.4 }, FULL, { top: 30, up: 0.4, down: 0.4 }], { noise: 0.002 }), { standard: 'any' }).res.count).toBe(1)
  })

  it('thighs to level (the default): a raise that stops low is a no-rep', () => {
    const { reasons, res } = run(set([FULL, LOW, FULL]))
    expect(reasons).toEqual(['low'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true])
    expect(res.cue).toBe('Reps that did not count: 1. The thighs did not get up to level.')
  })

  it('straight legs: bent knees are a no-rep, straight legs count', () => {
    const { reasons, res } = run(set([STRAIGHT, { ...FULL, straight: true, bend: 60 }, STRAIGHT]), { standard: 'straight' })
    expect(reasons).toEqual(['bent'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true])
    expect(res.cue).toBe('Reps that did not count: 1. The knees bent.')
    expect(run(set([FULL]), { standard: 'straight' }).res.reps[0]).toMatchObject({ counted: false, reason: 'bent' })
    // Under the default the bend is measured, not judged.
    expect(run(set([{ ...FULL, straight: true, bend: 60 }])).res.reps[0].counted).toBe(true)
  })

  it('any: every real raise counts', () => {
    expect(run(set([FULL, LOW, { top: 58, up: 1, down: 1.5 }]), { standard: 'any' }).res).toMatchObject({ count: 3, missed: 0 })
  })

  it('takes level at its edge', () => {
    expect(run(set([{ ...FULL, top: LEVEL_DEG + 4 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ ...FULL, top: LEVEL_DEG - 5 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('times the way up and down, says lower with control when the legs drop', () => {
    const { res } = run(set(same(3, { top: 95, up: 1, down: 2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.5)
      expect(r.measures.downSec).toBeGreaterThan(1)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['height', 'tempo'])
    expect(run(set(same(4, { top: 95, up: 1, down: 0.4 }))).res.cueId).toBe('slower')
    expect(run(set(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the knees once the thighs are level, not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftKnee', 'rightKnee'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the knees out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftKnee', 'rightKnee'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the hanging leg raise, swing and other angles', () => {
  it('measures the swing, and says so when most reps swing', () => {
    const swung = run(legRaiseSet(same(3, { ...FULL, swing: 25 }))).res
    expect(swung.reps.every(r => r.measures.swung)).toBe(true)
    expect(swung.cueId).toBe('swing')
    expect(swung.cue).toBe('The body swung in most reps. Try keeping the hips still under the bar.')
    expect(swung.details[0].map(d => d.label)).toEqual(['Height', 'Tempo', 'Knee angle', 'Swing'])
    expect(run(legRaiseSet(same(3, FULL))).res.reps.every(r => r.measures.swung === false)).toBe(true)
  })

  it('refuses a view from the front: asks to turn side-on and counts nothing', () => {
    const { outs, res } = run(legRaiseSet(same(3, FULL), { yaw: 90 }))
    expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
    expect(res.count).toBe(0)
  })

  it.each([45, -45, 135])('counts at an angle (yaw %i°), judges level, leaves the swing out', yaw => {
    // 70 degrees up reads about 63 at 45 degrees: still a raise, below level.
    const { res } = run(legRaiseSet([FULL, { ...LOW, top: 70 }, STRAIGHT], { yaw, noise: 0.002 }))
    expect(res).toMatchObject({ count: 2, missed: 1, view: 'diagonal' })
    expect(res.reps.map(r => r.reason)).toEqual([null, 'low', null])
    expect(res.reps.every(r => r.measures.swing === null && r.measures.swung === null)).toBe(true)
    // A swinging body reads low at an angle (about 70 for this level raise at 45 degrees): its
    // height is measured, not judged, and the rep counts.
    expect(run(legRaiseSet(same(2, { ...FULL, swing: 25 }), { yaw })).res).toMatchObject({ count: 2, missed: 0 })
  })

  it('reads the other side when the surer knee drops out at the hang', () => {
    const frames = legRaiseSet(same(3, FULL), { yaw: 10 })
    // The near (left) knee is lost whenever the thighs are back near the hang.
    for (const f of frames) {
      const k = f.joints.leftKnee, h = f.joints.leftHip
      if (k && h && k[1] - h[1] > 0.08) delete f.joints.leftKnee
    }
    expect(run(frames).res.count).toBe(3)
  })

  it('counts nothing standing on the floor with the knees coming up (not hanging)', () => {
    const poses = []
    for (let i = 0; i < 90; i++) {
      const p = squatPose(178)
      const th = rad(90 * ease(Math.min(1, (i % 45) / 20)))
      p.leftKnee = [p.leftHip[0] + Math.sin(th) * 0.43, p.leftHip[1] - Math.cos(th) * 0.43, 0.1]
      p.rightKnee = [p.rightHip[0] + Math.sin(th) * 0.43, p.rightHip[1] - Math.cos(th) * 0.43, -0.1]
      poses.push(p)
    }
    const { res, outs } = run(film(poses, { ...CAM }))
    expect(res.count).toBe(0)
    expect(outs.at(-1).hint).toBe('Hang with straight arms to start')
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(legRaiseSet(same(3, FULL), { gap: [5300, 5700] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(legRaiseSet(same(2, FULL), { gap: [1300, 4500] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(legRaiseSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = legRaise.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = legRaiseSet([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Raise when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('films the pose helper the right way up', () => {
    const j = project(legRaisePose(90), CAM)
    expect(Math.abs(j.rightKnee[1] - j.rightHip[1])).toBeLessThan(0.01)
    expect(j.rightWrist[1]).toBeLessThan(j.rightShoulder[1])
  })
})

describe('legRaise.matches', () => {
  it('takes hanging knee and leg raises', () => {
    for (const id of ['9819', '0472', '0475', '1764', '0474', '0866', '11878']) expect(legRaise.matches(EXIDX[id])).toBe(true)
    expect(legRaise.matches({ id: 'c1', n: 'Hanging knee raises', cat: 'calisthenics' })).toBe(true)
  })

  it('leaves out captain’s chair, assisted, oblique, alternating, toes to bar and holds, and pull-ups', () => {
    for (const id of ['0011', '1761', '10735', '0476', '3891', '3890', '0826', '9045', '4766', '2887', '1326']) expect(legRaise.matches(EXIDX[id])).toBe(false)
    expect(legRaise.matches(null)).toBe(false)
  })
})
