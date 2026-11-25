// The arm and hold helpers (arms-kit.js) on hand-made joints and signals.
import { describe, expect, it } from 'vitest'
import {
  UNSEEN, bothArms, cameraBelowShoulders, createCycleMachine, createHangRef, createHoldClock, cycleTempo,
  lineBend, liftDeg, liftFromHang, liftOf, tilt,
} from './arms-kit.js'
import { GAP_MS, LOST_RESET_MS } from './kit.js'

const arm = (dy, dx = 0, c = 0.9) => ({ leftElbow: [0.5, 0.5, c], leftWrist: [0.5 + dx, 0.5 + dy, c] })

describe('createHangRef', () => {
  it('keeps the hanging length, not a forearm foreshortened towards the camera', () => {
    const r = createHangRef('Elbow', 'Wrist')
    r.push(arm(0.1), 'left')
    expect(r.push(arm(0.06), 'left')).toBeCloseTo(0.1)
    expect(r.push(arm(0.1, 0.1), 'left')).toBeCloseTo(0.1)          // 45° off vertical: not hanging, not read
    expect(r.push(arm(0.12), 'left')).toBeCloseTo(0.12)             // came closer: taken at once
  })

  it('takes a shorter length that lasts (the lifter stepped back)', () => {
    const r = createHangRef('Elbow', 'Wrist', { resetFrames: 5 })
    r.push(arm(0.1), 'left')
    for (let i = 0; i < 6; i++) r.push(arm(0.07), 'left')
    expect(r.get('left')).toBeCloseTo(0.07)
  })
})

describe('the lift', () => {
  it('is 0 hanging, 90 level, 180 straight up, and turns into degrees', () => {
    expect(liftFromHang(arm(0.1), 'left', 'Elbow', 'Wrist', 0.1)).toBeCloseTo(0)
    expect(liftFromHang(arm(0), 'left', 'Elbow', 'Wrist', 0.1)).toBeCloseTo(90)
    expect(liftFromHang(arm(-0.1), 'left', 'Elbow', 'Wrist', 0.1)).toBeCloseTo(180)
    expect(liftFromHang(arm(0.1), 'left', 'Elbow', 'Wrist', null)).toBeNull()
    for (const a of [0, 30, 60, 90, 140]) expect(liftDeg(liftOf(a))).toBeCloseTo(a)
    expect(liftDeg(null)).toBeNull()
  })

  it('averages both arms when both are seen surely, else takes the surer one', () => {
    const j = { ...arm(0.05), rightElbow: [0.6, 0.5, 0.9], rightWrist: [0.6, 0.6, 0.9] }
    const refs = createHangRef('Elbow', 'Wrist')
    refs.push({ ...arm(0.1), rightElbow: [0.6, 0.5, 0.9], rightWrist: [0.6, 0.6, 0.9] }, 'left')
    refs.push({ rightElbow: [0.6, 0.5, 0.9], rightWrist: [0.6, 0.6, 0.9] }, 'right')
    const both = bothArms(j, refs, 'Elbow', 'Wrist', 1)
    expect(both.value).toBeCloseTo(22.5)
    expect(both.sides).toEqual(['left', 'right'])
    const far = { ...j, rightElbow: [0.6, 0.5, 0.3], rightWrist: [0.6, 0.6, 0.3] }
    const one = bothArms(far, refs, 'Elbow', 'Wrist', 1)
    expect(one.value).toBeCloseTo(45)
    expect(one.sides).toEqual(['left'])
    expect(bothArms({}, refs, 'Elbow', 'Wrist', 1)).toBeNull()
  })
})

describe('cameraBelowShoulders', () => {
  it('reads where the shoulders sit over the middle row, in torso lengths', () => {
    const f = row => ({ aspect: 1, joints: { leftShoulder: [0.5, row, 0.9], leftHip: [0.5, row + 0.2, 0.9] } })
    expect(cameraBelowShoulders(f(0.5))).toBeCloseTo(0)
    expect(cameraBelowShoulders(f(0.3))).toBeCloseTo(1)
    expect(cameraBelowShoulders({ joints: {} })).toBeNull()
  })
})

describe('createCycleMachine', () => {
  const opts = { rise: 10, minAmp: 40, low: 10, settleMs: 500 }
  const drive = (m, values, dt = 66) => values.map((v, i) => ({ t: i * dt, ...m.push(i * dt, v) }))
  const rep = (from, to, back, n = 10) => [
    ...Array.from({ length: n }, (_, i) => from + (to - from) * (i + 1) / n),
    ...Array.from({ length: n }, (_, i) => to + (back - to) * (i + 1) / n),
  ]

  it('counts a rise and fall, with where it started and peaked', () => {
    const ev = drive(createCycleMachine(opts), [0, 0, 0, ...rep(0, 100, 0), 0, 0])
    const ended = ev.filter(e => e.ended)
    expect(ended).toHaveLength(1)
    expect(ended[0].rep).toMatchObject({ startLow: 0, lost: false })
    expect(ended[0].rep.peak).toBeGreaterThan(90)
    expect(ev.some(e => e.started)).toBe(true)
  })

  it('ends a rep that stops short of the bottom once it settles, and starts the next from there', () => {
    const vals = [0, 0, ...rep(0, 100, 50), ...Array(12).fill(50), ...rep(50, 100, 0), 0, 0]
    const ended = drive(createCycleMachine(opts), vals).filter(e => e.ended).map(e => e.rep)
    expect(ended).toHaveLength(2)
    expect(ended[0].endLow).toBeGreaterThan(45)
    expect(ended[1].startLow).toBeGreaterThan(45)
  })

  it('is not fooled by a wobble', () => {
    expect(drive(createCycleMachine(opts), [0, 0, ...rep(0, 25, 0), 0, 0]).some(e => e.ended)).toBe(false)
  })

  it('marks a rep lost for a moment and drops one lost for good', () => {
    const m = createCycleMachine(opts)
    let t = 0
    const push = v => m.push((t += 66), v)
    for (const v of [0, 0, 20, 40, 60]) push(v)
    push(null); t += GAP_MS; push(80)
    let ended = null
    for (const v of [100, 80, 50, 20, 0, 0, 0, 0, 0]) { const e = push(v); if (e.ended) ended = e.rep }
    expect(ended).toMatchObject({ lost: true })
    for (const v of [0, 30, 60]) push(v)
    t += LOST_RESET_MS + 100
    expect(push(60).dropped).toBe(true)
  })

  it('times the way up and down, leaving out a pause at the top', () => {
    expect(cycleTempo({ startT: 1000, peakT: 2000, topEndT: 3000, endT: 4500 })).toEqual({ upSec: 1, downSec: 1.5 })
    expect(cycleTempo({ startT: 0, peakT: 1200, endT: null })).toEqual({ upSec: 1.2, downSec: 0 })
  })
})

describe('lineBend and tilt', () => {
  it('is positive with the hip under the shoulder-to-ankle line, negative over it, 0 straight', () => {
    expect(lineBend([0.8, 0.5], [0.5, 0.5], [0.2, 0.5])).toBeCloseTo(0)
    expect(lineBend([0.8, 0.5], [0.5, 0.55], [0.2, 0.5])).toBeGreaterThan(15)
    expect(lineBend([0.8, 0.5], [0.5, 0.45], [0.2, 0.5])).toBeLessThan(-15)
    // Facing the other way, the same.
    expect(lineBend([0.2, 0.5], [0.5, 0.55], [0.8, 0.5])).toBeGreaterThan(15)
    expect(lineBend(null, [0.5, 0.5], [0.2, 0.5])).toBeNull()
  })

  it('tilt is 0 level and 90 upright', () => {
    expect(tilt([0, 0.5], [1, 0.5])).toBeCloseTo(0)
    expect(tilt([0.5, 0], [0.5, 1])).toBeCloseTo(90)
  })
})

describe('createHoldClock', () => {
  const drive = (c, states, dt = 100, t0 = 0) => states.map((s, i) => ({ t: t0 + i * dt, ...c.push(t0 + i * dt, s) }))

  it('counts only time in good position, in whole seconds', () => {
    const c = createHoldClock()
    // Each frame's time runs to the next one: 31 good frames 100 ms apart, then not in position.
    drive(c, [...Array(31).fill('good'), ...Array(10).fill(null)])
    expect(c.goodMs).toBe(3100)
    expect(c.push(5000, null).count).toBe(3)
  })

  it('says a stretch out of line after the grace, again every repeat, and folds a flicker back', () => {
    const c = createHoldClock({ graceMs: 500, repeatMs: 2000 })
    const ev = drive(c, [...Array(10).fill('good'), ...Array(3).fill('sag'), ...Array(10).fill('good'), ...Array(40).fill('sag'), 'good'])
    expect(ev.filter(e => e.missed).map(e => e.t)).toEqual([2800, 4800])
    const st = c.stretches()
    expect(st.map(s => [s.good, s.reason])).toEqual([[true, null], [false, 'sag'], [true, null]])
  })

  it('says milestones as they pass', () => {
    const c = createHoldClock({ milestone: 10 })
    expect(c.milestonePassed(9, 10)).toBe(true)
    expect(c.milestonePassed(10, 10)).toBe(false)
    expect(c.milestonePassed(19, 21)).toBe(true)
  })

  it('goes on through an unseen moment, marking it lost, and ends the stretch when it lasts', () => {
    const c = createHoldClock()
    drive(c, Array(10).fill('good'))
    c.push(1000, UNSEEN); c.push(1300, UNSEEN)
    c.push(1500, 'good'); c.push(1600, 'good')
    expect(c.stretches()).toHaveLength(1)
    expect(c.stretches()[0].lost).toBe(true)
    expect(c.goodMs).toBe(1000)                          // 0-900, then 1500-1600: the gap adds nothing
    c.push(1600 + LOST_RESET_MS + 1, UNSEEN)
    c.push(5000, 'good'); c.push(5100, 'good')
    expect(c.stretches()).toHaveLength(2)
  })
})
