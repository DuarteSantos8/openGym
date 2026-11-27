// The lateral raise drill against synthetic lifters (test-kit.js): counting, the height under each
// standard, tempo, both arms from the front, the camera's height, and side-on refused.
import { describe, expect, it } from 'vitest'
import lateral, { CUE, TOP } from './lateral-raise.js'
import { checkDrill } from './index.js'
import { BODY, ease, film, project, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const ARM = { upper: 0.29, fore: 0.27 }
const rad = d => d * Math.PI / 180
const SHOULDER = { height: 1.45 }

/**
 * A lifter standing tall with the arms raised sideways: `abd` the upper arm's angle from hanging
 * (degrees; `abdRight` for the right arm), in a plane `plane` degrees forward of the shoulders'
 * line, the forearm hanging `bend` degrees lower.
 */
export function raisePose(abd, { abdRight = abd, plane = 15, bend = 15 } = {}) {
  const p = squatPose(178)
  const sh = p.leftShoulder
  for (const [side, sign, a] of [['left', 1, abd], ['right', -1, abdRight]]) {
    const s = [sh[0], sh[1], sign * BODY.shoulderHalf]
    const dir = g => [Math.sin(rad(g)) * Math.sin(rad(plane)), -Math.cos(rad(g)), sign * Math.sin(rad(g)) * Math.cos(rad(plane))]
    const u = dir(a), f = dir(Math.max(0, a - bend))
    const el = [s[0] + ARM.upper * u[0], s[1] + ARM.upper * u[1], s[2] + ARM.upper * u[2]]
    p[side + 'Shoulder'] = s
    p[side + 'Elbow'] = el
    p[side + 'Wrist'] = [el[0] + ARM.fore * f[0], el[1] + ARM.fore * f[1], el[2] + ARM.fore * f[2]]
  }
  return p
}

/** A set of raises: reps = [{ top, up, down, right }] (right: the right arm's top when it differs). */
export function raiseSet(reps, { stand = 1, fps = 15, hang = 8, ...opts } = {}) {
  const poses = []
  const hold = (a, b, n) => { for (let i = 0; i < n; i++) poses.push(raisePose(a, { abdRight: b })) }
  hold(hang, hang, Math.round(stand * fps))
  for (const r of reps) {
    const rt = r.right ?? r.top
    const up = Math.max(2, Math.round(r.up * fps)), dn = Math.max(2, Math.round(r.down * fps))
    for (let i = 1; i <= up; i++) { const e = ease(i / up); poses.push(raisePose(hang + (r.top - hang) * e, { abdRight: hang + (rt - hang) * e })) }
    hold(r.top, rt, 2)
    for (let i = 1; i <= dn; i++) { const e = ease(i / dn); poses.push(raisePose(r.top + (hang - r.top) * e, { abdRight: rt + (hang - rt) * e })) }
    hold(hang, hang, Math.round(stand * fps))
  }
  return film(poses, { fps, ...SHOULDER, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = lateral.create(opts)
  let counted = 0, missed = 0
  const missedAt = [], outs = []
  for (const f of frames) {
    const out = tr.push(f)
    outs.push(out)
    if (out.justCounted) counted++
    if (out.justMissed) { missed++; missedAt.push({ t: f.t, reason: out.reason }) }
  }
  return { counted, missed, missedAt, outs, res: tr.result() }
}
const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))
const FULL = { top: 90, up: 1.2, down: 1.8 }
const LOW = { top: 60, up: 1.2, down: 1.8 }

describe('the lateral raise drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(lateral)).toEqual([])
    expect(lateral.views).toEqual(['front', 'diagonal'])
  })
})

describe.each([30, 45, 60, 90])('the lateral raise filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => raiseSet(reps, { yaw, ...o })

  it('counts five clean raises, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0 })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.004, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a shrug of the arms', () => {
    expect(run(set([{ top: 30, up: 0.5, down: 0.5 }, FULL, { top: 35, up: 0.4, down: 0.4 }], { noise: 0.003 })).res.count).toBe(1)
  })

  it('shoulder height (the default): a raise that stops low is a no-rep', () => {
    const { counted, missed, missedAt, res } = run(set([FULL, LOW, FULL]))
    expect([counted, missed]).toEqual([2, 1])
    expect(missedAt[0].reason).toBe('low')
    expect(res).toMatchObject({ standard: 'shoulder', cueId: 'missed' })
    expect(res.cue).toBe(CUE.missed(1))
  })

  it('any: every real raise counts', () => {
    expect(run(set([FULL, LOW, FULL]), { standard: 'any' }).res.count).toBe(3)
  })

  it('takes shoulder height at its edge', () => {
    expect(run(set([{ top: TOP + 5, up: 1.2, down: 1.8 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ top: TOP - 6, up: 1.2, down: 1.8 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('reads the height to within a few degrees', () => {
    const top = run(set([FULL])).res.reps[0].measures.top
    expect(top).toBeGreaterThan(85)
    expect(top).toBeLessThan(95)
  })

  // The last stretch of lowering barely moves the elbow, so a 2.4 s eased descent reads 1.3 to 1.8 s.
  it('times the way up and down', () => {
    const { res } = run(set(same(3, { top: 90, up: 1, down: 2.4 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.5)
      expect(r.measures.upSec).toBeLessThan(1.4)
      expect(r.measures.downSec).toBeGreaterThan(1.2)
      expect(r.measures.downSec).toBeLessThan(2.8)
    }
    expect(res.summary.avgDown).toBeGreaterThan(res.summary.avgUp)
  })

  it('says slow the way down when the arms drop in under a second', () => {
    expect(run(set(same(4, { top: 90, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
  })

  it('stays neutral when nothing stands out', () => {
    expect(run(set(same(5, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the elbows once at shoulder height, not before', () => {
    const { outs } = run(set([FULL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftElbow', 'rightElbow'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('shows the extras of this view only', () => {
    const { res } = run(set(same(3, FULL)))
    const view = yaw === 90 ? 'front' : 'diagonal'
    expect(res.view).toBe(view)
    expect('diff' in res.reps[0].measures).toBe(view === 'front')
    expect(res.tiles.map(x => x.id)).toEqual(view === 'front' ? ['height', 'tempo', 'even'] : ['height', 'tempo'])
  })
})

describe('the lateral raise, whatever the angle', () => {
  it('reads a lifter facing the other way the same (yaw 135, -90 from behind)', () => {
    for (const yaw of [135, -90]) {
      const { res } = run(raiseSet([FULL, LOW, FULL], { yaw }))
      expect(res.reps.map(r => r.counted)).toEqual([true, false, true])
    }
  })

  it('side-on: asks to face the camera and judges nothing', () => {
    const { outs, res } = run(raiseSet(same(3, LOW), { yaw: 0 }))
    expect(outs.some(o => o.hint === 'Face the camera')).toBe(true)
    expect(res.missed).toBe(0)
    expect(res.reps.every(r => r.measures.top == null)).toBe(true)
  })

  it('from the front: one arm rising higher than the other, either one', () => {
    const left = run(raiseSet(same(3, { ...FULL, right: 70 }), { yaw: 90 }), { standard: 'any' }).res
    expect(left.reps.map(r => r.measures.higher)).toEqual(['left', 'left', 'left'])
    expect(left.reps[0].measures.diff).toBeGreaterThan(15)
    expect(left.cueId).toBe('uneven')
    expect(left.details[0][2]).toEqual({ label: 'Left / right', value: expect.stringMatching(/^Left arm \d+° higher$/) })
    const right = run(raiseSet(same(3, { top: 70, right: 90, up: 1.2, down: 1.8 }), { yaw: 90 }), { standard: 'any' }).res
    expect(right.reps.map(r => r.measures.higher)).toEqual(['right', 'right', 'right'])
    const even = run(raiseSet(same(3, FULL), { yaw: 90 })).res
    expect(even.reps.map(r => r.measures.higher)).toEqual([null, null, null])
    expect(even.details[0][2]).toEqual({ label: 'Left / right', value: 'Even' })
    expect(even.note).toBe('Filmed from the front: height, tempo and both arms.')
  })

  it('says the last reps stopped lower when the height falls off', () => {
    const reps = [95, 95, 93, 88, 82, 81].map(top => ({ top, up: 1.2, down: 1.8 }))
    expect(run(raiseSet(reps, { yaw: 90 })).res.cueId).toBe('fade')
  })

  it('asks for the phone at shoulder height and leaves the height unjudged above it', () => {
    const { outs, res } = run(raiseSet(same(3, LOW), { yaw: 60, height: 2.3 }))
    expect(outs.some(o => o.hint === 'Put the phone at shoulder height')).toBe(true)
    expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'level' })
    expect(res.tiles.map(x => x.id)).not.toContain('height')
  })

  it('with the phone below, refuses a raise that still reads short, and counts the rest unjudged', () => {
    // From below an elbow that comes forward only reads higher, so a short reading is short.
    for (const yaw of [30, 60, 90]) {
      for (const height of [0, 0.5, 0.9]) {
        const { outs, res } = run(raiseSet([FULL, { top: 50, up: 1.2, down: 1.8 }, FULL], { yaw, height }))
        expect(outs.some(o => o.hint === 'Put the phone at shoulder height')).toBe(true)
        expect({ yaw, height, counted: res.reps.map(r => r.counted) }).toEqual({ yaw, height, counted: [true, false, true] })
        expect(res.reps[1].reason).toBe('low')
        expect([res.reps[0].measures.top, res.reps[2].measures.top]).toEqual([null, null])
      }
    }
    const low = run(raiseSet(same(3, LOW), { yaw: 60, height: 0.5 })).res
    expect(low).toMatchObject({ count: 0, missed: 3, cueId: 'missed' })
    expect(run(raiseSet(same(3, LOW), { yaw: 60, height: 0.5 }), { standard: 'any' }).res).toMatchObject({ count: 3, missed: 0 })
  })

  it('judges the height the same with the phone around shoulder height, from every judged angle', () => {
    for (const yaw of [30, 60, 90]) {
      for (const height of [1.3, 1.45, 1.6]) {
        const { res } = run(raiseSet([{ top: TOP + 7, up: 1.2, down: 1.8 }, { top: TOP - 7, up: 1.2, down: 1.8 }], { yaw, height }))
        expect({ yaw, height, counted: res.reps.map(r => r.counted) }).toEqual({ yaw, height, counted: [true, false] })
      }
    }
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    const { res } = run(raiseSet(same(3, FULL), { yaw: 90, gap: [5800, 6250] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
  })

  it('drops a rep the camera lost for good', () => {
    expect(run(raiseSet(same(2, FULL), { yaw: 90, gap: [1300, 4500] })).res.count).toBe(1)
  })

  it('has a line for no reps, and tells the lifter what to do', () => {
    expect(run(raiseSet([], { yaw: 90 })).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const tr = lateral.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = raiseSet([FULL], { yaw: 90, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('films the pose helper the right way up', () => {
    const j = project(raisePose(90), { yaw: 90, ...SHOULDER })
    expect(Math.abs(j.leftElbow[1] - j.leftShoulder[1])).toBeLessThan(0.01)
  })
})

describe('lateral.matches', () => {
  it('takes two-arm standing lateral raises by id and by name', () => {
    for (const id of ['0334', '2234', '5631', '3740']) expect(lateral.matches(EXIDX[id])).toBe(true)
    expect(lateral.matches({ id: 'c1', n: 'Dumbbell lateral raises', cat: 'strength' })).toBe(true)
  })

  it('leaves out one-arm, alternating, partial, rear, seated, cable and machine raises', () => {
    for (const id of ['0355', '4852', '4191', '0380', '0396', '0178', '0584', '3852', '4967', '0907']) expect(lateral.matches(EXIDX[id])).toBe(false)
    expect(lateral.matches(null)).toBe(false)
  })
})

describe('lateral-raise, as index.test.js will check it once registered', () => {
  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = lateral.create({ standard: lateral.defaultStandard })
    const out = tr.push({ t: 0, aspect: 0.75, joints: {} })
    expect(out).toMatchObject({ count: 0, inFrame: false, justCounted: false, justMissed: false, reached: false, highlight: [] })
    expect(out.hint).not.toBe('')
    const res = tr.result()
    expect(res).toMatchObject({ count: 0, missed: 0, reps: [], details: [] })
    expect(res.tiles.length).toBeLessThanOrEqual(3)
    expect(typeof res.cue).toBe('string')
    expect(typeof res.cueId).toBe('string')
  })
})
