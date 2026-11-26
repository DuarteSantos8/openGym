// The upright row drill against synthetic lifters (test-kit.js) filmed from the front and at an
// angle: counting, the elbows' height and the return to the hang, tempo, uneven elbows and a
// tilting torso from the front, the camera's height, a missing elbow, and the exercises it takes.
import { describe, expect, it } from 'vitest'
import uprightRow, { TOP } from './upright-row.js'
import { checkDrill } from './index.js'
import { ease, film, project, same, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const ARM = { upper: 0.29, fore: 0.27 }
const rad = d => d * Math.PI / 180
const SHOULDER = { height: 1.45 }

/**
 * Standing tall, hands together in front, the elbows raised out and a little forward: `lift` each
 * upper arm's angle from hanging (`liftRight` for the right one), the forearms reaching down and
 * in to the hands. `tilt` leans the upper body that many degrees to the lifter's left.
 */
export function uprightPose(lift, { liftRight = lift, tilt = 0 } = {}) {
  const p = squatPose(178)
  const hip = p.leftHip
  const a = rad(tilt)
  for (const k of ['nose', 'neck', 'leftShoulder', 'rightShoulder']) {
    const [u, v, w] = p[k], dv = v - hip[1]
    p[k] = [u, hip[1] + dv * Math.cos(a) - w * Math.sin(a), w * Math.cos(a) + dv * Math.sin(a)]
  }
  for (const [side, k, g] of [['left', 1, lift], ['right', -1, liftRight]]) {
    const s = p[side + 'Shoulder']
    const dir = [Math.sin(rad(g)) * Math.sin(rad(25)), -Math.cos(rad(g)), k * Math.sin(rad(g)) * Math.cos(rad(25))]
    const el = s.map((x, i) => x + ARM.upper * dir[i])
    const hand = [el[0] + 0.12, 0, s[2] - k * 0.1]
    const du = hand[0] - el[0], dw = hand[2] - el[2]
    const dv = -Math.sqrt(Math.max(0.001, ARM.fore ** 2 - du * du - dw * dw))
    p[side + 'Elbow'] = el
    p[side + 'Wrist'] = [hand[0], el[1] + dv, hand[2]]
  }
  return p
}

/** A set: reps = [{ top, right, up, down, bottom, tilt }], `stand` seconds hanging between. */
export function uprightSet(reps, { stand = 1, fps = 15, hang = 6, without = null, ...opts } = {}) {
  const poses = []
  const hold = (a, b, n, o = {}) => { for (let i = 0; i < n; i++) poses.push(uprightPose(a, { liftRight: b, ...o })) }
  let from = hang
  hold(hang, hang, Math.round(stand * fps))
  for (const r of reps) {
    const rt = r.right ?? r.top, bottom = r.bottom ?? hang
    const up = Math.max(2, Math.round(r.up * fps)), dn = Math.max(2, Math.round(r.down * fps))
    for (let i = 1; i <= up; i++) { const e = ease(i / up); poses.push(uprightPose(from + (r.top - from) * e, { liftRight: from + (rt - from) * e, tilt: (r.tilt || 0) * e })) }
    hold(r.top, rt, 2, { tilt: r.tilt || 0 })
    for (let i = 1; i <= dn; i++) { const e = ease(i / dn); poses.push(uprightPose(r.top + (bottom - r.top) * e, { liftRight: rt + (bottom - rt) * e, tilt: (r.tilt || 0) * (1 - e) })) }
    hold(bottom, bottom, Math.round(stand * fps))
    from = bottom
  }
  const frames = film(poses, { fps, ...SHOULDER, ...opts })
  if (without) for (const f of frames) for (const k of without) delete f.joints[k]
  return frames
}

const run = (frames, opts = {}) => {
  const tr = uprightRow.create(opts)
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

describe('the upright row drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(uprightRow)).toEqual([])
    expect(uprightRow).toMatchObject({ kind: 'reps', views: ['front', 'diagonal'], defaultStandard: 'shoulder' })
  })
})

describe.each([30, 45, 60, 90, -90])('the upright row filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => uprightSet(reps, { yaw, ...o })

  it('counts five clean rows, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0 })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.004, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a shrug', () => {
    expect(run(set([{ top: 30, up: 0.5, down: 0.5 }, FULL, { top: 35, up: 0.4, down: 0.4 }], { noise: 0.003 })).res.count).toBe(1)
  })

  it('shoulder height (the default): elbows that stop low, or arms not lowered, are no-reps', () => {
    const { reasons, res } = run(set([FULL, LOW, { ...FULL, bottom: 50 }, FULL]))
    expect(reasons).toEqual(['low', 'hang'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, false, true])
    expect(res).toMatchObject({ standard: 'shoulder', cueId: 'missed' })
  })

  it('any: every real row counts', () => {
    expect(run(set([FULL, LOW, { ...FULL, bottom: 50 }, FULL]), { standard: 'any' }).res).toMatchObject({ count: 4, missed: 0 })
  })

  it('takes shoulder height at its edge', () => {
    expect(run(set([{ top: TOP + 5, up: 1.2, down: 1.8 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ top: TOP - 6, up: 1.2, down: 1.8 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('says slow the way down when it is quick, stays neutral otherwise', () => {
    expect(run(set(same(4, { top: 92, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
    expect(run(set(same(5, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the elbows once at shoulder height, not before', () => {
    const { outs } = run(set([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('counts nothing with the elbows out of sight', () => {
    const { res, outs } = run(set(same(3, FULL), { without: ['leftElbow', 'rightElbow'] }))
    expect(res).toMatchObject({ count: 0, missed: 0 })
    expect(outs.at(-1).inFrame).toBe(false)
  })
})

describe('the upright row from the front', () => {
  it('names the elbow that rose higher, and says so when most reps do', () => {
    const left = run(uprightSet(same(3, { ...FULL, right: 70 }), { yaw: 90 }), { standard: 'any' }).res
    expect(left.reps.map(r => r.measures.higher)).toEqual(['left', 'left', 'left'])
    expect(left.cueId).toBe('uneven')
    expect(left.tiles.map(x => x.id)).toEqual(['height', 'tempo', 'even'])
    const even = run(uprightSet(same(3, FULL), { yaw: 90 })).res
    expect(even.reps.map(r => r.measures.higher)).toEqual([null, null, null])
    expect(even.note).toBe('Filmed from the front: height, tempo, both arms and the torso.')
  })

  it('measures the torso tilting to one side, and says so when most reps tilt', () => {
    const tilted = run(uprightSet(same(3, { ...FULL, tilt: 15 }), { yaw: 90 })).res
    expect(tilted.reps.every(r => r.measures.tilt >= 10)).toBe(true)
    expect(tilted.cueId).toBe('tilt')
    expect(tilted.cue).toBe('The torso tilted to one side on most reps. Try keeping it upright and pulling evenly.')
    expect(tilted.details[0].map(d => d.label)).toEqual(['Height', 'Tempo', 'Left / right', 'Lean'])
    expect(run(uprightSet(same(3, FULL), { yaw: 90 })).res.reps.every(r => r.measures.tilt < 3)).toBe(true)
  })
})

describe('the upright row, whatever the angle', () => {
  it('side-on: asks to face the camera and judges no height', () => {
    const { outs, res } = run(uprightSet(same(3, LOW), { yaw: 0 }))
    expect(outs.some(o => o.hint === 'Face the camera')).toBe(true)
    expect(res.missed).toBe(0)
    expect(res.reps.every(r => r.measures.top == null)).toBe(true)
  })

  it('asks for the phone at shoulder height and leaves the height unjudged when it is not', () => {
    const { outs, res } = run(uprightSet(same(3, LOW), { yaw: 90, height: 0.5 }))
    expect(outs.some(o => o.hint === 'Put the phone at shoulder height')).toBe(true)
    expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'level' })
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const { res } = run(uprightSet(same(3, FULL), { yaw: 90, gap: [5800, 6250] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(uprightSet(same(2, FULL), { yaw: 90, gap: [1300, 4500] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(uprightSet([], { yaw: 90 })).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = uprightRow.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = uprightSet([FULL], { yaw: 90, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Row when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('films the pose helper the right way up', () => {
    const j = project(uprightPose(90), { yaw: 90, ...SHOULDER })
    expect(Math.abs(j.leftElbow[1] - j.leftShoulder[1])).toBeLessThan(0.01)
    expect(j.leftWrist[1]).toBeGreaterThan(j.leftElbow[1])
  })
})

describe('uprightRow.matches', () => {
  it('takes two-handed standing upright rows by id and by name', () => {
    for (const id of ['0120', '0437', '0246', '0934', '1500', '4408', '7114']) expect(uprightRow.matches(EXIDX[id])).toBe(true)
    expect(uprightRow.matches({ id: 'c1', n: 'Plate upright row', cat: 'strength' })).toBe(true)
  })

  it('leaves out the Smith machine, lying, one-arm and combined rows', () => {
    for (const id of ['0775', '4225', '9492', '0363', '4695', '1541', '0935', '0864', '2500', '0334']) expect(uprightRow.matches(EXIDX[id])).toBe(false)
    expect(uprightRow.matches(null)).toBe(false)
  })
})
