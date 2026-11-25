// The overhead press drill against a synthetic lifter (test-kit.js), filmed from side-on to facing
// the camera: the side refused, counting, lockout and the standards, tempo, cues, matches.
import { describe, expect, it } from 'vitest'
import overheadPress from './overhead-press.js'
import { checkDrill } from './index.js'
import { LOCK_DEG } from './press-kit.js'
import { CAMERA, ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

/**
 * A standing press in body coordinates from how far up it is, `p` 0 (the weight at the shoulders,
 * wrists a little above them) to 1 (overhead). The forearms stay upright and the upper arms rise
 * from 60° to `lock` degrees off hanging, so the elbow angle at the top is `lock` (180 straight).
 * The arms rise in a plane `flare` degrees out from straight ahead (0: elbows forward, 90: out to
 * the sides); `lean` degrees tips the torso back at the top.
 */
export function pressPose(p, { lock = 180, flare = 45, lean = 0 } = {}) {
  const out = squatPose(176)
  const hip = out.leftHip
  const back = rad(lean * p)
  for (const k of ['nose', 'neck', 'leftShoulder', 'rightShoulder']) {
    const [u, v, w] = out[k], du = u - hip[0], dv = v - hip[1]
    out[k] = [hip[0] + du * Math.cos(back) - dv * Math.sin(back), hip[1] + du * Math.sin(back) + dv * Math.cos(back), w]
  }
  const a = rad(60 + (lock - 60) * p), f = rad(flare)
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const S = out[side + 'Shoulder']
    const el = [S[0] + 0.3 * Math.sin(a) * Math.cos(f), S[1] - 0.3 * Math.cos(a), S[2] + sign * 0.3 * Math.sin(a) * Math.sin(f)]
    out[side + 'Elbow'] = el
    out[side + 'Wrist'] = [el[0], el[1] + 0.27, el[2]]
  }
  return out
}

/** A set of presses: reps = [{ up, down, lock, flare, lean }], `stand` seconds at the shoulders between. */
export function pressSet(reps, { stand = 1, fps = 15, height = 1.2, ...opts } = {}) {
  const poses = []
  const hold = (p, n, o) => { for (let i = 0; i < n; i++) poses.push(pressPose(p, o)) }
  hold(0, Math.round(stand * fps), {})
  for (const r of reps) {
    const o = { lock: r.lock ?? 180, flare: r.flare ?? 45, lean: r.lean || 0 }
    const up = Math.max(2, Math.round(r.up * fps)), dn = Math.max(2, Math.round(r.down * fps))
    for (let i = 1; i <= up; i++) poses.push(pressPose(ease(i / up), o))
    hold(1, 3, o)
    for (let i = 1; i <= dn; i++) poses.push(pressPose(1 - ease(i / dn), o))
    hold(0, Math.round(stand * fps), o)
  }
  return film(poses, { fps, height, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = overheadPress.create(opts)
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
const FULL = { up: 1.2, down: 1.5 }, SOFT = { up: 1.2, down: 1.5, lock: 150 }, NEAR = { up: 1.2, down: 1.5, lock: 172 }
const locks = res => res.reps.map(r => r.measures.locked)

describe('overhead press, the contract', () => {
  it('keeps the drill contract', () => {
    expect(checkDrill(overheadPress)).toEqual([])
  })
})

describe.each([30, 45, 60, 90])('the overhead press filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => pressSet(reps, { yaw, ...o })
  const front = yaw === 90

  it('counts five presses, live and in the result, and names the view', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, view: front ? 'front' : 'diagonal' })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a press that stops at the face, or a shrug', () => {
    const frames = set([{ up: 0.5, down: 0.5, lock: 85 }, FULL, { up: 0.4, down: 0.4, lock: 70 }], { noise: 0.002 })
    expect(run(frames, ANY).res.count).toBe(1)
  })

  it('judges the lockout from the front only; at an angle counts and times', () => {
    const frames = set([FULL, SOFT, NEAR, SOFT])
    const { res, missedAt } = run(frames)
    if (front) {
      expect(locks(res)).toEqual([true, false, true, false])
      expect(missedAt.map(m => m.reason)).toEqual(['soft', 'soft'])
      expect(res).toMatchObject({ count: 2, missed: 2, cueId: 'missed' })
      expect(res.cue).toBe('Reps that did not count: 2. The elbows did not lock out.')
      expect(res.tiles.map(x => x.id)).toEqual(['lockout', 'tempo'])
      expect(res.tiles[0]).toMatchObject({ label: 'Lockout', value: '2 of 4', sub: 'elbows straight at the top' })
    } else {
      expect(locks(res)).toEqual([null, null, null, null])
      expect(res).toMatchObject({ count: 4, missed: 0, cueId: 'unjudged' })
      expect(res.cue).toBe('Lockout could not be judged from this angle. Face the camera.')
      expect(res.tiles.map(x => x.id)).toEqual(['tempo'])
    }
    expect(run(frames, ANY).res).toMatchObject({ count: 4, missed: 0 })
  })

  it('times the press up and the way down', () => {
    const { res } = run(set(same(3, { up: 1, down: 2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(0.5)
      expect(r.measures.downSec).toBeLessThan(1.7)
      expect(r.measures.upSec).toBeGreaterThan(1.1)
      expect(r.measures.upSec).toBeLessThan(2.6)
    }
    expect(res.tiles.find(x => x.id === 'tempo')).toMatchObject({ sub: 'up / down, on average' })
    expect(res.details[0][1].label).toBe('Tempo')
    expect(res.details[0][1].value).toMatch(/^Up .* s · down .* s$/)
  })
})

describe('the overhead press, whatever the angle', () => {
  it('refuses a side view: asks to face the camera and counts nothing', () => {
    for (const yaw of [0, 180]) {
      const { outs, res } = run(pressSet(same(3, FULL), { yaw }))
      expect(outs.at(-1).hint).toBe('Face the camera')
      expect(res.count).toBe(0)
    }
  })

  it('from the front, lights the elbows once locked out, not before, and not on a soft rep', () => {
    const { outs } = run(pressSet([FULL], { yaw: 90 }))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(pressSet([SOFT], { yaw: 90 })).outs.some(o => o.reached)).toBe(false)
  })

  it('reads the straightest elbow of the rep, smoothed, against the lockout line', () => {
    const { res } = run(pressSet([FULL, SOFT], { yaw: 90 }))
    expect(res.reps[0].measures.elbow).toBeGreaterThanOrEqual(LOCK_DEG + 10)
    expect(res.reps[1].measures.elbow).toBeLessThan(LOCK_DEG)
    expect(res.details[1][0]).toEqual({ label: 'Lockout', value: 'Not locked out' })
    expect(res.details[0]).toContainEqual({ label: 'Elbow angle', value: res.reps[0].measures.elbow + '°' })
    expect(res.note).toBe('Filmed from the front: lockout and tempo.')
  })

  it('cannot see a soft lockout whose bend points at the camera (elbows forward, from the front)', () => {
    expect(run(pressSet([{ ...SOFT, flare: 0 }], { yaw: 90 })).res.reps[0].measures.locked).toBe(true)
    // Out to the sides it is plain.
    expect(run(pressSet([{ ...SOFT, flare: 80 }], { yaw: 90 })).res.reps[0].measures.locked).toBe(false)
  })

  it('counts a set started from the hips, and through a back lean', () => {
    const tr = overheadPress.create()
    const hang = squatPose(176)
    for (let i = 0; i < 15; i++) {
      const p = { ...hang }
      for (const s of ['left', 'right']) {
        const S = hang[s + 'Shoulder']
        p[s + 'Elbow'] = [S[0], S[1] - 0.3, S[2]]
        p[s + 'Wrist'] = [S[0], S[1] - 0.57, S[2]]
      }
      tr.push({ t: i * 66, aspect: CAMERA.aspect, joints: project(p, { yaw: 90, height: 1.2 }) })
    }
    for (const f of pressSet(same(3, { ...FULL, lean: 12 }), { yaw: 90, start: 1000 })) tr.push(f)
    expect(tr.result().count).toBe(3)
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(pressSet(same(3, FULL), { yaw: 90, gap: [5600, 6000] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(pressSet(same(2, FULL), { yaw: 90, gap: [1300, 4600] })).res.count).toBe(1)
  })

  it('cues: none, soft under any range, steady', () => {
    expect(run(pressSet([], { yaw: 90 })).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const soft = run(pressSet(same(3, SOFT), { yaw: 90 }), ANY).res
    expect(soft).toMatchObject({ count: 3, cueId: 'soft' })
    expect(soft.cue).toBe('Most reps stopped short of lockout. Try straightening the elbows fully.')
    expect(run(pressSet(same(3, FULL), { yaw: 90 })).res).toMatchObject({ cueId: 'steady', cue: 'Lockout and tempo held steady across the set.' })
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = overheadPress.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = pressSet([FULL], { yaw: 90, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Press when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
    const waiting = overheadPress.create()
    const over = project(pressPose(1), { yaw: 90, height: 1.2 })
    expect(waiting.push({ t: 0, aspect: CAMERA.aspect, joints: over }).hint).toBe('Weight at your shoulders to start')
  })

  it('can be held to a view', () => {
    const { res } = run(pressSet([SOFT], { yaw: 45 }), { view: 'front' })
    expect(res.view).toBe('front')
    expect(res.reps[0].measures.locked).not.toBe(null)
  })
})

describe('overheadPress.matches', () => {
  it('takes two-armed barbell and dumbbell presses, standing or seated', () => {
    for (const id of ['1162', '1165', '1456', '1457', '0426', '1226', '0091', '0405', '0404']) expect(overheadPress.matches(EXIDX[id])).toBe(true)
    expect(overheadPress.matches({ id: 'c1', n: 'Overhead press', cat: 'strength' })).toBe(true)
  })

  it('leaves out machines, one arm at a time, behind the head, push presses and bench presses', () => {
    for (const id of ['0414', '0772', '0774', '1224', '4686', '3736', '0289', '0047', '0025']) expect(overheadPress.matches(EXIDX[id])).toBe(false)
    expect(overheadPress.matches({ id: 'c2', n: 'Push press', cat: 'strength' })).toBe(false)
    expect(overheadPress.matches(null)).toBe(false)
  })
})
