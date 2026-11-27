// The triceps pushdown drill against a synthetic lifter at a cable (test-kit.js, the phone at chest
// height), filmed from side-on to facing the camera: counting, lockout and the standards, tempo,
// elbow drift, the views refused, cues, matches.
import { describe, expect, it } from 'vitest'
import tricepsPushdown, { DRIFT_DEG, LOCK_DEG_SIDE, elbowDrift } from './triceps-pushdown.js'
import { checkDrill } from './index.js'
import { CAMERA, ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

/**
 * A pushdown in body coordinates from how far down it is, `p` 0 (forearms about level, the elbow
 * at 90) to 1 (the elbow at `lock`, 180 straight). The torso leans `lean` degrees forward, the
 * upper arms hang along it and swing `drift` degrees forward of it by the bottom; the arm bends in
 * the body's forward plane.
 */
export function pushdownPose(p, { lock = 180, drift = 0, lean = 10 } = {}) {
  const out = squatPose(176)
  const hip = out.leftHip
  const fwd = rad(lean)
  for (const k of ['nose', 'neck', 'leftShoulder', 'rightShoulder']) {
    const [u, v, w] = out[k], du = u - hip[0], dv = v - hip[1]
    out[k] = [hip[0] + du * Math.cos(fwd) + dv * Math.sin(fwd), hip[1] - du * Math.sin(fwd) + dv * Math.cos(fwd), w]
  }
  const d = rad(drift * p - lean), e = 90 + (lock - 90) * p, g = d + rad(180 - e)
  for (const side of ['left', 'right']) {
    const S = out[side + 'Shoulder']
    const el = [S[0] + 0.3 * Math.sin(d), S[1] - 0.3 * Math.cos(d), S[2]]
    out[side + 'Elbow'] = el
    out[side + 'Wrist'] = [el[0] + 0.27 * Math.sin(g), el[1] - 0.27 * Math.cos(g), el[2]]
  }
  return out
}

/** A set of pushdowns: reps = [{ down, up, lock, drift }], `stand` seconds at the start position between. */
export function pushdownSet(reps, { stand = 1, fps = 15, height = 1.2, ...opts } = {}) {
  const poses = []
  const hold = (p, n, o) => { for (let i = 0; i < n; i++) poses.push(pushdownPose(p, o)) }
  hold(0, Math.round(stand * fps), {})
  for (const r of reps) {
    const o = { lock: r.lock ?? 180, drift: r.drift || 0 }
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) poses.push(pushdownPose(ease(i / dn), o))
    hold(1, 3, o)
    for (let i = 1; i <= up; i++) poses.push(pushdownPose(1 - ease(i / up), o))
    hold(0, Math.round(stand * fps), o)
  }
  return film(poses, { fps, height, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = tricepsPushdown.create(opts)
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
const FULL = { down: 1, up: 1.5 }, SOFT = { down: 1, up: 1.5, lock: 145 }, NEAR = { down: 1, up: 1.5, lock: 172 }
const locks = res => res.reps.map(r => r.measures.locked)

describe('triceps pushdown, the contract', () => {
  it('keeps the drill contract', () => {
    expect(checkDrill(tricepsPushdown)).toEqual([])
  })
})

describe.each([0, 30, 45, 60])('the pushdown filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => pushdownSet(reps, { yaw, ...o })
  const side = yaw === 0

  it('counts five pushdowns, live and in the result, and names the view', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, view: side ? 'side' : 'diagonal' })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a twitch that stops well short', () => {
    expect(run(set([{ down: 0.5, up: 0.5, lock: 105 }, FULL, { down: 0.4, up: 0.4, lock: 100 }], { noise: 0.002 }), ANY).res.count).toBe(1)
  })

  it('judges the lockout side-on only; at an angle counts and times', () => {
    const frames = set([FULL, SOFT, NEAR, SOFT])
    const { res, missedAt } = run(frames)
    if (side) {
      expect(locks(res)).toEqual([true, false, true, false])
      expect(missedAt.map(m => m.reason)).toEqual(['soft', 'soft'])
      expect(res).toMatchObject({ count: 2, missed: 2, cueId: 'missed' })
      expect(res.tiles.map(x => x.id)).toEqual(['lockout', 'tempo', 'drift'])
      expect(res.tiles[0]).toMatchObject({ value: '2 of 4', sub: 'elbows straight at the bottom' })
    } else {
      expect(locks(res)).toEqual([null, null, null, null])
      expect(res).toMatchObject({ count: 4, missed: 0, cueId: 'unjudged' })
      expect(res.cue).toBe('Lockout could not be judged from this angle. Film from the side.')
      expect(res.tiles.map(x => x.id)).toEqual(['tempo'])
    }
    expect(run(frames, ANY).res).toMatchObject({ count: 4, missed: 0 })
  })

  it('times the way down and back up', () => {
    const { res } = run(set(same(3, { down: 1, up: 2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(0.5)
      expect(r.measures.downSec).toBeLessThan(1.9)
      expect(r.measures.upSec).toBeGreaterThan(0.9)
      expect(r.measures.upSec).toBeLessThan(2.6)
    }
    expect(res.details[0][1].value).toMatch(/^Down .* s · up .* s$/)
  })
})

describe('the pushdown, whatever the angle', () => {
  it('side-on: takes a lockout at its edge (Vision reads straight arms at 155 to 166)', () => {
    expect(run(pushdownSet([{ ...FULL, lock: 156 }])).res.reps[0]).toMatchObject({ counted: true, measures: { locked: true } })
    expect(run(pushdownSet([{ ...FULL, lock: LOCK_DEG_SIDE + 5 }])).res.reps[0].counted).toBe(true)
    expect(run(pushdownSet([{ ...FULL, lock: LOCK_DEG_SIDE - 8 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'soft' })
  })

  it('refuses a view from the front or behind: asks to turn side-on and counts nothing', () => {
    for (const yaw of [90, -90]) {
      const { outs, res } = run(pushdownSet(same(3, FULL), { yaw }))
      expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
      expect(res.count).toBe(0)
    }
  })

  it('side-on: lights the elbows once locked out, not on a soft rep', () => {
    const { outs } = run(pushdownSet([FULL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(pushdownSet([SOFT])).outs.some(o => o.reached)).toBe(false)
  })

  it('side-on: the elbows drifting forward, the most of each rep, the cue and its tile', () => {
    const drifted = run(pushdownSet(same(3, { ...FULL, drift: 35 }))).res
    expect(drifted.reps.every(r => r.measures.drift > DRIFT_DEG)).toBe(true)
    expect(drifted.cueId).toBe('elbows')
    expect(drifted.cue).toBe('The elbows drifted forward on most reps. Try keeping them pinned to your sides.')
    expect(drifted.tiles.find(x => x.id === 'drift')).toMatchObject({ label: 'Elbow drift', sub: 'forward at most' })
    expect(drifted.details[0].map(d => d.label)).toEqual(['Lockout', 'Tempo', 'Elbow angle', 'Elbow drift'])
    const pinned = run(pushdownSet(same(3, FULL))).res
    expect(pinned.reps.every(r => r.measures.drift < 8)).toBe(true)
    expect(pinned).toMatchObject({ cueId: 'steady', note: 'Filmed from the side: lockout, tempo and elbow drift.' })
    // At an angle the drift is not read.
    expect(run(pushdownSet(same(3, { ...FULL, drift: 35 }), { yaw: 45 })).res.reps[0].measures.drift).toBeUndefined()
  })

  it('reads the drift against the torso, not the vertical', () => {
    const lean = project(pushdownPose(1, { lean: 25 }), { height: 1.2 })
    expect(elbowDrift(lean, 'right', CAMERA.aspect)).toBeLessThan(5)
    expect(elbowDrift({}, 'right', 1)).toBe(null)
  })

  it('does not start with the arms hanging, only from the start position', () => {
    const tr = tricepsPushdown.create()
    const hang = pushdownPose(1)
    expect(tr.push({ t: 0, aspect: CAMERA.aspect, joints: project(hang, { height: 1.2 }) }).hint).toBe('Forearms level to start')
    for (let i = 1; i < 15; i++) tr.push({ t: i * 66, aspect: CAMERA.aspect, joints: project(hang, { height: 1.2 }) })
    const outs = pushdownSet(same(2, FULL), { start: 1000 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Push when you are.')
    expect(tr.result().count).toBe(2)
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(pushdownSet(same(3, FULL), { gap: [5200, 5600] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(pushdownSet(same(2, FULL), { gap: [1300, 4600] })).res.count).toBe(1)
  })

  it('cues: none, soft under any range, steady', () => {
    expect(run(pushdownSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    expect(run(pushdownSet(same(3, SOFT)), ANY).res).toMatchObject({ count: 3, cueId: 'soft' })
    expect(run(pushdownSet(same(3, FULL))).res.cueId).toBe('steady')
  })
})

describe('tricepsPushdown.matches', () => {
  it('takes two-handed bar, rope and band pushdowns', () => {
    for (const id of ['0200', '0201', '0241', '2249', '1605', '0207', '1502', '4688']) expect(tricepsPushdown.matches(EXIDX[id])).toBe(true)
    expect(tricepsPushdown.matches({ id: 'c1', n: 'Rope pushdown', cat: 'strength' })).toBe(true)
  })

  it('leaves out one-arm, straight-arm, lat, incline and floor pushdowns, and other triceps work', () => {
    for (const id of ['1723', '5033', '1227', '1609', '0199', '1229', '0172', '3920', '0814']) expect(tricepsPushdown.matches(EXIDX[id])).toBe(false)
    expect(tricepsPushdown.matches(null)).toBe(false)
  })
})
