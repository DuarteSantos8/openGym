// The standing hip abduction against synthetic lifters (test-kit.js) filmed from the front:
// counting on either leg, how far out under each standard, tempo, the torso leaning away and a
// bent working knee, views refused, a missing ankle, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import hipAbduction from './hip-abduction.js'
import { checkDrill } from './index.js'
import { BODY, ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

/**
 * Standing tall on one leg, the other (`side`, the lifter's 'left' or 'right') swung `abd` degrees
 * out to the side from upright; `bend` lets the shin hang that many degrees back towards upright,
 * `lean` tips the upper body that many degrees away from the working leg.
 */
export function abductionPose(abd, { side = 'left', bend = 0, lean = 0 } = {}) {
  const p = squatPose(178)
  const k = side === 'left' ? 1 : -1
  const hip = p[side + 'Hip']
  const a = rad(-k * lean)
  for (const name of ['nose', 'neck', 'leftShoulder', 'rightShoulder']) {
    const [u, v, w] = p[name], dv = v - hip[1]
    p[name] = [u, hip[1] + dv * Math.cos(a) - w * Math.sin(a), w * Math.cos(a) + dv * Math.sin(a)]
  }
  const th = rad(abd), sh = rad(abd - bend)
  const knee = [hip[0], hip[1] - BODY.thigh * Math.cos(th), hip[2] + k * BODY.thigh * Math.sin(th)]
  p[side + 'Knee'] = knee
  p[side + 'Ankle'] = [knee[0], knee[1] - BODY.shin * Math.cos(sh), knee[2] + k * BODY.shin * Math.sin(sh)]
  for (const s of ['left', 'right']) {
    const S = p[s + 'Shoulder']
    p[s + 'Elbow'] = [S[0], S[1] - 0.29, S[2]]
    p[s + 'Wrist'] = [S[0] + 0.05, S[1] - 0.55, S[2]]
  }
  return p
}

/** A set: reps = [{ top, side, out, back, bend, lean }], `stand` seconds standing between. */
export function abductionSet(reps, { stand = 1, fps = 15, without = null, ...opts } = {}) {
  const poses = []
  const hold = (n, side) => { for (let i = 0; i < n; i++) poses.push(abductionPose(0, { side })) }
  hold(Math.round(stand * fps))
  for (const r of reps) {
    const o = e => ({ side: r.side || 'left', bend: (r.bend || 0) * e, lean: (r.lean || 0) * e })
    const n1 = Math.max(2, Math.round(r.out * fps)), n2 = Math.max(2, Math.round(r.back * fps))
    for (let i = 1; i <= n1; i++) { const e = ease(i / n1); poses.push(abductionPose(r.top * e, o(e))) }
    for (let i = 0; i < 3; i++) poses.push(abductionPose(r.top, o(1)))
    for (let i = 1; i <= n2; i++) { const e = ease(i / n2); poses.push(abductionPose(r.top * (1 - e), o(1 - e))) }
    hold(Math.round(stand * fps), r.side)
  }
  const frames = film(poses, { fps, yaw: 90, height: 0.8, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = hipAbduction.create(opts)
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
const FULL = { top: 38, out: 1, back: 1.5 }, LOW = { top: 22, out: 1, back: 1.5 }, HIGH = { top: 52, out: 1, back: 1.5 }

describe('the hip abduction drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(hipAbduction)).toEqual([])
    expect(hipAbduction).toMatchObject({ kind: 'reps', views: ['front'], defaultStandard: 'wide' })
  })

  it('films the pose helper as meant', () => {
    const j = project(abductionPose(30), { yaw: 90, height: 0.8 })
    const ang = Math.atan2(Math.abs(j.leftAnkle[0] - j.leftHip[0]) * 0.75, j.leftAnkle[1] - j.leftHip[1]) * 180 / Math.PI
    expect(Math.abs(ang - 30)).toBeLessThan(3)
  })
})

describe.each([90, 75, -90, -75])('the hip abduction filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => abductionSet(reps, { yaw, ...o })

  it('counts five raises on one leg and alternating, live and in the result', () => {
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

  it('does not count a shift of the foot', () => {
    expect(run(set([{ top: 8, out: 0.4, back: 0.4 }, FULL, { top: 10, out: 0.4, back: 0.4 }], { noise: 0.002 }), { standard: 'any' }).res.count).toBe(1)
  })

  it('30° out (the default), 45° out and any raise', () => {
    const frames = set([FULL, LOW, HIGH])
    const wide = run(frames)
    expect(wide.reasons).toEqual(['low'])
    expect(wide.res.cue).toBe('Reps that did not count: 1. The leg did not go out far enough.')
    expect(run(frames, { standard: 'high' }).res.reps.map(r => r.counted)).toEqual([false, false, true])
    expect(run(frames, { standard: 'any' }).res).toMatchObject({ count: 3, missed: 0 })
  })

  // Turned a little off the front, the sideways swing foreshortens a few degrees: never in the lifter's favour.
  it('takes 30° at its edge', () => {
    expect(run(set([{ ...FULL, top: Math.abs(yaw) === 90 ? 33 : 37 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ ...FULL, top: 26 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('reads how far out to within a few degrees, and times the way out and back', () => {
    const { res } = run(set(same(3, { top: 38, out: 1, back: 2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(Math.abs(r.measures.top - 38)).toBeLessThan(Math.abs(yaw) === 90 ? 4 : 7)
      expect(r.measures.backSec).toBeGreaterThan(1)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['range', 'tempo'])
    expect(run(set(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('the torso leaning away: measured on every rep, said when most lean', () => {
    const leaned = run(set(same(3, { ...FULL, lean: 18 }))).res
    expect(leaned.reps.every(r => r.measures.lean >= 12)).toBe(true)
    expect(leaned.cueId).toBe('lean')
    expect(leaned.cue).toBe('The torso leaned away from the leg on most reps. Try staying tall over the standing leg.')
    expect(run(set(same(3, FULL))).res.reps.every(r => r.measures.lean < 4)).toBe(true)
  })

  it('a bent working knee: measured on every rep, said when most bend', () => {
    const bent = run(set(same(3, { ...FULL, top: 45, bend: 35 })), { standard: 'any' }).res
    expect(bent.reps.every(r => r.measures.knee < 160)).toBe(true)
    expect(bent.cueId).toBe('bent')
    expect(bent.cue).toBe('The working knee bent on most reps. Try keeping the leg straight.')
    expect(bent.details[0].map(d => d.label)).toEqual(['Range', 'Tempo', 'Working leg', 'Knee angle', 'Lean'])
  })

  it('lights the working leg at the standard, not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftKnee', 'leftAnkle'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the ankles out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftAnkle', 'rightAnkle'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the hip abduction, other angles and edges', () => {
  it('counts every lift when the hips shift over the standing leg and stay there between lifts', () => {
    // As filmed with a band at the ankles: from the first lift on, the hips and everything above
    // sit `d` metres towards the standing (right) leg, the knees half that, the feet where they
    // were (the lifted foot with its leg). The working leg alone then reads about 12° out between
    // lifts, never back at its rest.
    const d = 0.18
    const shifted = (abd, o) => {
      const p = abductionPose(abd, o)
      for (const [name, j] of Object.entries(p)) {
        const f = name.endsWith('Ankle') ? (name === 'leftAnkle' ? Math.min(1, abd / 10) : 0) : name.endsWith('Knee') ? 0.5 : 1
        p[name] = [j[0], j[1], j[2] - d * f]
      }
      return p
    }
    const poses = []
    for (let i = 0; i < 15; i++) poses.push(abductionPose(0))
    for (let r = 0; r < 4; r++) {
      for (let i = 1; i <= 15; i++) poses.push(shifted(FULL.top * ease(i / 15)))
      for (let i = 1; i <= 20; i++) poses.push(shifted(FULL.top * (1 - ease(i / 20))))
      for (let i = 0; i < 12; i++) poses.push(shifted(0))
    }
    const { res } = run(film(poses, { yaw: 90, height: 0.8 }))
    expect(res).toMatchObject({ count: 4, missed: 0 })
  })

  it('side-on or at an angle: asks to face the camera and counts nothing', () => {
    for (const yaw of [0, 45]) {
      const { outs, res } = run(abductionSet(same(3, FULL), { yaw }))
      expect(outs.at(-1).hint).toBe('Face the camera')
      expect(res.count).toBe(0)
    }
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(abductionSet(same(3, FULL), { gap: [5150, 5550] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(abductionSet(same(2, FULL), { gap: [1300, 4600] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(abductionSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = hipAbduction.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = abductionSet([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })
})

describe('hipAbduction.matches', () => {
  it('takes standing straight-leg hip abductions, bodyweight, band or cable', () => {
    for (const id of ['0791', '3853', '11266', '0710', '4031', '2756', '2755', '3048', '8085']) expect(hipAbduction.matches(EXIDX[id])).toBe(true)
    expect(hipAbduction.matches({ id: 'c1', n: 'Standing hip abduction', cat: 'strength' })).toBe(true)
  })

  it('leaves out seated, lying, bent-knee, kneeling, bridge and machine abductions and adduction', () => {
    for (const id of ['0597', '3006', '0837', '0790', '6739', '4881', '1034', '7199', '1077', '10820', '2746']) expect(hipAbduction.matches(EXIDX[id])).toBe(false)
    expect(hipAbduction.matches(null)).toBe(false)
  })
})
