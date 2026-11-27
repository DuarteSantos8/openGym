// The curl drill against synthetic lifters (test-kit.js) filmed from side-on to facing the camera:
// counting, the top and the bottom under each standard, tempo, the elbows and the swing, cues.
import { describe, expect, it } from 'vitest'
import curl, { CUE, STRAIGHT, TOP } from './curl.js'
import { checkDrill } from './index.js'
import { BODY, YAWS, ease, film, project, squatPose } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const ARM = { upper: 0.29, fore: 0.27 }
const rad = d => d * Math.PI / 180
const CHEST = { height: 1.3 }

/**
 * A lifter standing tall, curling: `a` the forearm's lift from hanging (degrees, both arms unless
 * `aRight`), `drift` the upper arm's swing forward, `lean` the torso's lean back (degrees).
 */
export function curlPose(a, { drift = 0, lean = 0, aRight = a } = {}) {
  const p = squatPose(178)
  const hip = p.leftHip
  const l = rad(-lean)
  const sh = [hip[0] + BODY.torso * Math.sin(l), hip[1] + BODY.torso * Math.cos(l)]
  const neck = [sh[0] + BODY.neck * Math.sin(l), sh[1] + BODY.neck * Math.cos(l)]
  p.neck = [neck[0], neck[1], 0]
  p.nose = [neck[0] + BODY.head * 0.6, neck[1] + BODY.head * 0.7, 0]
  for (const [side, w, ang] of [['left', BODY.shoulderHalf, a], ['right', -BODY.shoulderHalf, aRight]]) {
    const d = rad(drift + lean * 0)
    const el = [sh[0] + ARM.upper * Math.sin(d), sh[1] - ARM.upper * Math.cos(d)]
    const f = rad(ang + drift)
    p[side + 'Shoulder'] = [sh[0], sh[1], w]
    p[side + 'Elbow'] = [el[0], el[1], w]
    p[side + 'Wrist'] = [el[0] + ARM.fore * Math.sin(f), el[1] - ARM.fore * Math.cos(f), w]
  }
  return p
}

/** A set of curls: reps = [{ top, bottom, up, down, drift, lean }], hanging `stand` s before and between. */
export function curlSet(reps, { stand = 1, fps = 15, hang = 5, ...opts } = {}) {
  const poses = []
  const hold = (a, n, o) => { for (let i = 0; i < n; i++) poses.push(curlPose(a, o)) }
  hold(hang, Math.round(stand * fps), {})
  let from = hang
  for (const r of reps) {
    const bottom = r.bottom ?? hang
    const o = k => ({ drift: (r.drift || 0) * k, lean: (r.lean || 0) * k })
    const prog = a => Math.max(0, (a - hang) / Math.max(1, r.top - hang))
    const up = Math.max(2, Math.round(r.up * fps)), dn = Math.max(2, Math.round(r.down * fps))
    for (let i = 1; i <= up; i++) { const a = from + (r.top - from) * ease(i / up); poses.push(curlPose(a, o(prog(a)))) }
    hold(r.top, 2, o(1))
    for (let i = 1; i <= dn; i++) { const a = r.top + (bottom - r.top) * ease(i / dn); poses.push(curlPose(a, o(prog(a)))) }
    hold(bottom, Math.round((r.rest ?? stand) * fps), o(prog(bottom)))
    from = bottom
  }
  return film(poses, { fps, ...CHEST, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = curl.create(opts)
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
const FULL = { top: 140, up: 1, down: 1.5 }
const SHORT = { top: 90, up: 1, down: 1.5 }               // a half rep: stops with the forearm level
const HALF_BOTTOM = { top: 140, up: 1, down: 1.5, bottom: 70, rest: 0.3 }

describe('the curl drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(curl)).toEqual([])
    expect(curl.kind).toBe('reps')
  })
})

describe.each(YAWS)('the curl filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => curlSet(reps, { yaw, ...o })

  it('counts five clean curls, live and in the result', () => {
    const { counted, res } = run(set(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0 })
    expect(res.reps).toHaveLength(5)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, FULL), { noise: 0.004, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a wobble of the forearms', () => {
    expect(run(set([{ top: 40, up: 0.5, down: 0.5 }, FULL, { top: 45, up: 0.4, down: 0.4 }], { noise: 0.003 })).res.count).toBe(1)
  })

  it('full range (the default): a rep stopping short at the top is a no-rep', () => {
    const { counted, missed, missedAt, res } = run(set([FULL, SHORT, FULL]))
    expect([counted, missed]).toEqual([2, 1])
    expect(missedAt[0].reason).toBe('short')
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true])
    expect(res).toMatchObject({ standard: 'full', cueId: 'missed' })
  })

  it('full range: a rep that did not start from straight arms is a no-rep', () => {
    // The second curl starts from 70°: the first came down only that far.
    const { res, missedAt } = run(set([HALF_BOTTOM, FULL, FULL]))
    expect(res.reps.map(r => [r.counted, r.reason])).toEqual([[true, null], [false, 'bent'], [true, null]])
    expect(missedAt.map(m => m.reason)).toEqual(['bent'])
  })

  it('to the top: half reps at the bottom count, short tops do not', () => {
    const { res } = run(set([HALF_BOTTOM, FULL, SHORT]), { standard: 'top' })
    expect(res.reps.map(r => r.counted)).toEqual([true, true, false])
  })

  it('any: every real curl counts', () => {
    const { counted, missed } = run(set([FULL, SHORT, HALF_BOTTOM, FULL]), { standard: 'any' })
    expect([counted, missed]).toEqual([4, 0])
  })

  it('takes the top at its edge', () => {
    expect(run(set([{ top: TOP + 5, up: 1, down: 1.5 }])).res.reps[0].counted).toBe(true)
    expect(run(set([{ top: TOP - 6, up: 1, down: 1.5 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'short' })
  })

  // The last 20° of lowering barely moves the wrist, so a 2.4 s eased descent reads 1.4 to 1.8 s.
  it('times the way up and down to within a few tenths', () => {
    const { res } = run(set(same(3, { top: 140, up: 1, down: 2.4 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.upSec).toBeLessThan(1.4)
      expect(r.measures.downSec).toBeGreaterThan(1.3)
      expect(r.measures.downSec).toBeLessThan(2.8)
    }
    expect(res.tiles.find(x => x.id === 'tempo')).toMatchObject({ label: 'Tempo', sub: 'up / down, on average' })
  })

  it('says slow the way down when the curl drops in under a second', () => {
    expect(run(set(same(4, { top: 140, up: 0.8, down: 0.5 }))).res.cueId).toBe('slower')
  })

  it('stays neutral when nothing stands out', () => {
    expect(run(set(same(5, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('reads the elbows coming forward from any side', () => {
    const { res } = run(set(same(4, { ...FULL, drift: 40 })))
    expect(res.reps[0].measures.elbows).toBeGreaterThan(30)
    expect(res.cueId).toBe('elbows')
    expect(run(set(same(4, FULL))).res.reps[0].measures.elbows).toBeLessThan(10)
  })

  it('lights the wrists once the top is reached, not before', () => {
    const { outs } = run(set([FULL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftWrist', 'rightWrist'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHORT])).outs.some(o => o.reached)).toBe(false)
  })

  it('shows the extras of this view only', () => {
    const { res } = run(set(same(3, FULL)))
    const view = yaw === 0 ? 'side' : yaw === 90 ? 'front' : 'diagonal'
    expect(res.view).toBe(view)
    expect('sway' in res.reps[0].measures).toBe(view === 'side')
    expect(res.tiles.map(x => x.id)).toEqual(view === 'side' ? ['range', 'tempo', 'swing'] : ['range', 'tempo', 'elbows'])
  })
})

describe('the curl, whatever the angle', () => {
  it('reads a lifter facing the other way the same (yaw 180, 135, -45)', () => {
    for (const yaw of [180, 135, -45]) {
      const { res } = run(curlSet([FULL, SHORT, FULL], { yaw }))
      expect(res.reps.map(r => r.counted)).toEqual([true, false, true])
    }
  })

  it('side-on: the torso swinging back', () => {
    const { res } = run(curlSet(same(4, { ...FULL, lean: 18 }), { yaw: 0 }))
    expect(res.reps[0].measures.sway).toBeGreaterThan(13)
    expect(res.reps[0].measures.sway).toBeLessThan(23)
    expect(res.cueId).toBe('swing')
    expect(res.tiles.find(x => x.id === 'swing').value).toMatch(/°$/)
    expect(res.details[0].map(d => d.label)).toEqual(['Range', 'Tempo', 'Elbows', 'Swing'])
    expect(res.note).toBe('Filmed from the side: range, tempo, elbows and torso swing.')
    // Facing the camera the lean back is along the view: not measured, not said.
    expect(run(curlSet(same(4, { ...FULL, lean: 18 }), { yaw: 90 })).res.cueId).not.toBe('swing')
  })

  it('says the last reps stopped lower when the top falls off', () => {
    const reps = [145, 145, 142, 135, 122, 118].map(top => ({ top, up: 1, down: 1.5 }))
    expect(run(curlSet(reps, { yaw: 0 })).res.cueId).toBe('fade')
  })

  it('outside a side view, asks for the phone at chest height and leaves the top unjudged when it is not', () => {
    for (const cam of [{ height: 0.5 }, { height: 2.1 }]) {
      const { outs, res } = run(curlSet(same(3, SHORT), { yaw: 90, ...cam }))
      expect(outs.some(o => o.hint === 'Put the phone at chest height')).toBe(true)
      expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'level' })
      expect(res.reps.map(r => r.measures.top)).toEqual([null, null, null])
      expect(res.tiles.map(x => x.id)).not.toContain('range')
    }
    // Side-on the phone's height does not matter.
    const side = run(curlSet([SHORT], { yaw: 0, height: 0.5 }))
    expect(side.res.missed).toBe(1)
    expect(side.outs.some(o => o.hint === 'Put the phone at chest height')).toBe(false)
  })

  it('judges the top the same with the phone anywhere from chest to shoulder height, facing', () => {
    for (const height of [1.15, 1.3, 1.5]) {
      const { res } = run(curlSet([{ top: TOP + 8, up: 1, down: 1.5 }, { top: TOP - 8, up: 1, down: 1.5 }], { yaw: 90, height }))
      expect(res.reps.map(r => r.counted)).toEqual([true, false])
    }
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    const { res } = run(curlSet(same(3, FULL), { yaw: 30, gap: [5150, 5600] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
  })

  it('drops a rep the camera lost for good', () => {
    expect(run(curlSet(same(2, FULL), { yaw: 30, gap: [1200, 4300] })).res.count).toBe(1)
  })

  it('has a line for no reps, and the no-rep line when reps missed', () => {
    expect(run(curlSet([], { yaw: 45 })).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const none = run(curlSet(same(3, SHORT), { yaw: 45 })).res
    expect(none).toMatchObject({ count: 0, missed: 3, cueId: 'missed' })
    expect(none.cue).toBe(CUE.missed(3))
    expect(none.tiles[0]).toMatchObject({ id: 'range', value: '0 of 3', sub: 'full range' })
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = curl.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = curlSet([FULL], { yaw: 30, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('names the reps that missed in Every rep', () => {
    const { res } = run(curlSet([FULL, SHORT], { yaw: 0 }))
    expect(res.details[1][0]).toEqual({ label: 'Range', value: expect.stringMatching(/^\d+° to \d+°$/) })
    expect(res.reps[1].measures.top).toBeLessThan(TOP)
    expect(res.reps[0].measures.bottom).toBeLessThanOrEqual(STRAIGHT)
  })

  it('can be held to a view', () => {
    const { res } = run(curlSet(same(2, FULL), { yaw: 0 }), { view: 'diagonal' })
    expect(res.view).toBe('diagonal')
    expect(res.reps[0].measures.sway).toBeUndefined()
  })

  it('films a lifter the pose helper turns correctly', () => {
    const j = project(curlPose(90), { yaw: 0, ...CHEST })
    // Forearm level: the wrist at the elbow's height, forward of it (image right side-on).
    expect(Math.abs(j.rightWrist[1] - j.rightElbow[1])).toBeLessThan(0.01)
    expect(j.rightWrist[0]).toBeGreaterThan(j.rightElbow[0])
  })
})

describe('curl.matches', () => {
  it('takes two-arm standing curls by id and by name', () => {
    for (const id of ['0313', '0294', '0031', '0447', '0416', '0312', '0439']) expect(curl.matches(EXIDX[id])).toBe(true)
    expect(curl.matches({ id: 'c1', n: 'Dumbbell standing curl', cat: 'strength' })).toBe(true)
  })

  it('leaves out one-arm, alternating, seated, bench, cable, machine and leg curls', () => {
    for (const id of ['0285', '1670', '0391', '0370', '5696', '0038', '3347', '1655', '2352']) expect(curl.matches(EXIDX[id])).toBe(false)
    for (const n of ['Lying leg curl', 'Cable curl', 'Preacher curl', 'Incline dumbbell curl', 'Concentration curl', 'Wrist curl'])
      expect(curl.matches({ id: 'x', n, cat: 'strength' })).toBe(false)
    expect(curl.matches(null)).toBe(false)
  })
})

describe('curl, as index.test.js will check it once registered', () => {
  it('answers frames with nobody in them, and a result with nothing in it', () => {
    const tr = curl.create({ standard: curl.defaultStandard })
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
