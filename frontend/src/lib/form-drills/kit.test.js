// The shared drill kit: joints, angles, side and view, framing, the rep state machine and the
// small statistics, against hand-made joints and the 3D test kit.
import { describe, expect, it } from 'vitest'
import {
  angleAt, chainConf, createPhaseMachine, createSidePicker, createViewDetector, detectView, ema, fades,
  framing, framingHint, matchExercise, mid, pickCue, pickSide, seen, spread, tempo, viewHint, widthRatio,
  GAP_MS, LOST_RESET_MS, VIEW_EDGES,
} from './kit.js'
import { squatPose, project, film, squatSet, CAMERA } from './test-kit.js'

const CHAIN = ['Hip', 'Knee', 'Ankle']
const still = (yaw, n = 20, cam = {}) => film(Array.from({ length: n }, () => squatPose(176)), { yaw, ...cam })

describe('joints and angles', () => {
  it('sees a joint only when it is there and sure enough', () => {
    expect(seen({ a: [0.1, 0.2, 0.9] }, 'a')).toEqual([0.1, 0.2, 0.9])
    expect(seen({ a: [0.1, 0.2, 0.1] }, 'a')).toBe(null)
    expect(seen({ a: [NaN, 0.2, 0.9] }, 'a')).toBe(null)
    expect(seen({ a: [0.1, 0.2] }, 'a')).toEqual([0.1, 0.2])
    expect(seen(null, 'a')).toBe(null)
  })

  it('takes the middle of a pair, or the one seen', () => {
    expect(mid({ leftHip: [0.4, 0.5, 0.9], rightHip: [0.6, 0.7, 0.5] }, 'Hip')).toEqual([0.5, 0.6, 0.5])
    expect(mid({ rightHip: [0.6, 0.7, 0.5] }, 'Hip')).toEqual([0.6, 0.7, 0.5])
    expect(mid({}, 'Hip')).toBe(null)
  })

  it('measures the angle at the middle joint, x stretched by the image shape', () => {
    expect(angleAt([0, 0], [0, 1], [1, 1])).toBeCloseTo(90)
    expect(angleAt([0, 0], [0, 1], [0, 2])).toBeCloseTo(180)
    // In a 3:4 upright image x is 0.75 of y: squeezed in x, still 90°.
    expect(angleAt([0, 0], [0, 1], [1 / 0.75, 1], 0.75)).toBeCloseTo(90)
    expect(angleAt(null, [0, 1], [1, 1])).toBe(null)
    expect(angleAt([0, 1], [0, 1], [1, 1])).toBe(null)
  })

  it('smooths towards the newest value', () => {
    expect(ema(null, 5)).toBe(5)
    expect(ema(0, 10, 0.5)).toBe(5)
  })
})

describe('the side', () => {
  it('takes the side whose whole chain is seen surest', () => {
    const side0 = project(squatPose(150), { yaw: 0 })
    expect(pickSide(side0, CHAIN)).toBe('right')
    expect(pickSide(project(squatPose(150), { yaw: 180 }), CHAIN)).toBe('left')
    expect(pickSide({}, CHAIN)).toBe(null)
    expect(chainConf({ leftHip: [0, 0, 0.9] }, 'left', CHAIN)).toBe(0)
  })

  it('does not swap sides on one bad frame', () => {
    const pick = createSidePicker(CHAIN)
    const good = project(squatPose(150), { yaw: 0 })
    for (let i = 0; i < 10; i++) pick(good)
    const flipped = Object.fromEntries(Object.entries(good).map(([k, v]) => [k, k.startsWith('right') ? [v[0], v[1], 0.3] : [v[0], v[1], 0.95]]))
    expect(pick(flipped)).toBe('right')
  })
})

describe('the view', () => {
  it('reads the width of shoulders and hips against the torso, about 0.58 sin(yaw)', () => {
    const r = yaw => widthRatio(still(yaw, 1)[0])
    expect(r(0)).toBeLessThan(0.02)
    expect(r(30)).toBeCloseTo(0.29, 1)
    expect(r(90)).toBeCloseTo(0.58, 1)
    expect(widthRatio({ joints: {} })).toBe(null)
  })

  it('names side, diagonal and front, and the back the same as the front', () => {
    expect([0, 15, 30, 45, 60, 75, 90, 135, 180].map(yaw => detectView(still(yaw)))).toEqual(
      ['side', 'side', 'diagonal', 'diagonal', 'diagonal', 'front', 'front', 'diagonal', 'side'])
    expect(detectView([])).toBe(null)
  })

  it('takes the edges a drill gives it, VIEW_EDGES by default', () => {
    const read = (yaw, edges) => { const d = createViewDetector(edges); for (const f of still(yaw)) d.push(f, true); return d.view }
    expect(read(22)).toBe('diagonal')
    expect(read(22, { side: 0.235, front: VIEW_EDGES.front })).toBe('side')
    expect(read(30, { side: 0.235, front: VIEW_EDGES.front })).toBe('diagonal')
    expect(read(90, { side: 0.235, front: VIEW_EDGES.front })).toBe('front')
  })

  it('takes a far side Vision does not see for side-on', () => {
    const frames = still(30).map(f => ({ ...f, joints: Object.fromEntries(Object.entries(f.joints).filter(([k]) => !k.startsWith('left'))) }))
    expect(detectView(frames)).toBe('side')
  })

  it('waits for a few standing frames, reads only standing ones, and keeps its view near a boundary', () => {
    const d = createViewDetector()
    const front = still(90)
    expect(d.push(front[0], true)).toBe(null)
    for (const f of front) d.push(f, true)
    expect(d.view).toBe('front')
    for (const f of still(0)) d.push(f, false)
    expect(d.view).toBe('front')
    // 70° is front of the first-guess edge but inside the hysteresis: front stays front...
    for (const f of still(66, 40)) d.push(f, true)
    expect(d.view).toBe('front')
    // ...while a fresh look at it says diagonal, and clearly diagonal changes it.
    expect(detectView(still(66, 40))).toBe('diagonal')
    for (const f of still(45, 40)) d.push(f, true)
    expect(d.view).toBe('diagonal')
  })
})

describe('framing and hints', () => {
  const frame = j => ({ aspect: CAMERA.aspect, joints: j })
  const pose = () => project(squatPose(176), { yaw: 0 })

  it('is null when the lifter can be judged, from any side', () => {
    for (const yaw of [0, 45, 90]) expect(framing(frame(project(squatPose(176), { yaw })))).toBe(null)
  })

  it('says nobody is there, part of the body is out, or too far', () => {
    expect(framing(frame({}))).toBe('none')
    expect(framing(null)).toBe('none')
    const j = pose()
    delete j.leftAnkle; delete j.rightAnkle
    expect(framing(frame(j))).toBe('partial')
    const k = pose()
    delete k.leftShoulder; delete k.rightShoulder
    expect(framing(frame(k))).toBe('partial')
    const far = Object.fromEntries(Object.entries(pose()).map(([n, [x, y, c]]) => [n, [0.5 + (x - 0.5) / 3, 0.5 + (y - 0.5) / 3, c]]))
    expect(framing(frame(far))).toBe('far')
  })

  it('has a status line for each', () => {
    expect(['none', 'partial', 'far', null].map(framingHint)).toEqual(['Step into the frame', 'Get your whole body in the frame', 'Come a little closer', ''])
    expect(viewHint('front', ['side'])).toBe('Turn side-on to the camera')
    expect(viewHint('side', ['front'])).toBe('Face the camera')
    expect(viewHint('side', ['diagonal'])).toBe('Turn halfway towards the camera')
    expect(viewHint('side', ['side', 'front'])).toBe('')
    expect(viewHint(null, ['side'])).toBe('')
  })
})

describe('the phase machine', () => {
  const T = { stand: 0.1, descent: 0.2, minRep: 0.5, bottomEps: 0.03, ascentRise: 0.1, topBand: 0.03 }
  // One rep of the signal: up to `peak` in `down` frames, back in `up`, `rest` frames at 0 around it.
  const rep = (peak, { down = 20, up = 12, rest = 10 } = {}) => [
    ...Array(rest).fill(0),
    ...Array.from({ length: down }, (_, i) => peak * (i + 1) / down),
    ...Array.from({ length: up }, (_, i) => peak * (1 - (i + 1) / up)),
    ...Array(rest).fill(0),
  ]
  const drive = (values, m = createPhaseMachine(T), t0 = 0) => values.map((s, i) => ({ t: t0 + i * 66, ...m.push(t0 + i * 66, s) }))

  it('walks waiting, standing, descending, bottom, ascending and ends a rep', () => {
    const evs = drive(rep(1))
    const phases = evs.map(e => e.phase).filter((p, i, a) => p !== a[i - 1])
    expect(phases).toEqual(['standing', 'descending', 'bottom', 'ascending', 'standing'])
    expect(evs.filter(e => e.started)).toHaveLength(1)
    const end = evs.filter(e => e.ended)
    expect(end).toHaveLength(1)
    expect(end[0].rep).toMatchObject({ lost: false })
    expect(end[0].rep.peak).toBeGreaterThan(0.9)
    const { downSec, upSec } = tempo(end[0].rep)
    expect(downSec).toBeGreaterThan(1)
    expect(upSec).toBeGreaterThan(0.5)
  })

  it('does not end a rep that never got past minRep, nor start before canStart', () => {
    expect(drive(rep(0.4)).some(e => e.ended)).toBe(false)
    const m = createPhaseMachine(T)
    expect(m.push(0, 0, { canStart: false }).phase).toBe('waiting')
    expect(m.push(66, 0).phase).toBe('standing')
  })

  it('marks a rep lost over a short gap and drops it over a long one', () => {
    const vals = rep(1)
    const short = createPhaseMachine(T)
    const evs = vals.map((s, i) => short.push(i * 66, i >= 20 && i < 23 ? null : s))
    expect(evs.find(e => e.ended).rep.lost).toBe(true)
    const long = createPhaseMachine(T)
    const gap = Math.ceil(LOST_RESET_MS / 66) + 2
    const ev2 = vals.map((s, i) => long.push(i < 20 ? i * 66 : i * 66 + gap * 66, s))
    expect(ev2.some(e => e.dropped)).toBe(true)
    expect(ev2.some(e => e.ended)).toBe(false)
    expect(GAP_MS).toBeLessThan(LOST_RESET_MS)
  })
})

describe('small statistics and cues', () => {
  it('spreads, fades and picks the first cue that holds', () => {
    expect(spread([3, null, 9, 5])).toBe(6)
    expect(spread([3])).toBe(null)
    expect(fades([1, 1, 1, 0.7, 0.6, 0.6], 0.2)).toBe(true)
    expect(fades([1, 1, 0.5], 0.2)).toBe(false)
    expect(pickCue([['a', () => false], ['b', () => true], ['c', () => true]])).toBe('b')
    expect(pickCue([['a', () => false], ['z', () => false]])).toBe('z')
  })

  it('matches catalogue exercises by id or by a guarded name', () => {
    const rule = { ids: new Set(['1']), name: /\bsquat/i, not: /jump/i, cats: new Set(['strength']) }
    expect(matchExercise({ id: '1', n: 'Anything' }, rule)).toBe(true)
    expect(matchExercise({ id: '2', n: 'Front squat', cat: 'strength' }, rule)).toBe(true)
    expect(matchExercise({ id: '3', n: 'Front squat' }, rule)).toBe(true)
    expect(matchExercise({ id: '4', n: 'Jump squat', cat: 'strength' }, rule)).toBe(false)
    expect(matchExercise({ id: '5', n: 'Front squat', cat: 'cardio' }, rule)).toBe(false)
    expect(matchExercise(null, rule)).toBe(false)
  })
})

describe('the 3D test kit', () => {
  it('films a level camera at knee height: knees on the middle row, upright, in the frame', () => {
    const [f] = squatSet([], { stand: 0.1, yaw: 90 })
    expect(f.aspect).toBe(CAMERA.aspect)
    expect((f.joints.leftKnee[1] + f.joints.rightKnee[1]) / 2).toBeCloseTo(0.5, 2)
    expect(f.joints.leftAnkle[1]).toBeGreaterThan(f.joints.leftHip[1])
    for (const [x, y] of Object.values(f.joints)) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(1) }
  })

  it('sees the far side less surely side-on, and both alike facing the camera', () => {
    const side = project(squatPose(176), { yaw: 0 }), front = project(squatPose(176), { yaw: 90 })
    expect(side.leftHip[2]).toBeLessThan(0.4)
    expect(side.rightHip[2]).toBe(0.9)
    expect(front.leftHip[2]).toBe(front.rightHip[2])
  })

  it('tips the picture with the camera: a camera tilted down shows the lifter higher', () => {
    const level = project(squatPose(176)), down = project(squatPose(176), { pitch: 15 })
    expect(down.leftKnee[1]).toBeLessThan(level.leftKnee[1] - 0.1)
  })

  it('loses the pose in a gap and joints at the drop rate', () => {
    const frames = squatSet([], { stand: 2, gap: [500, 1000] })
    expect(frames.filter(f => !Object.keys(f.joints).length).length).toBeGreaterThan(5)
    const dropped = squatSet([], { stand: 2, drop: 0.5 })
    const n = dropped.reduce((a, f) => a + Object.keys(f.joints).length, 0)
    expect(n / (dropped.length * 10)).toBeGreaterThan(0.35)
    expect(n / (dropped.length * 10)).toBeLessThan(0.65)
  })
})
