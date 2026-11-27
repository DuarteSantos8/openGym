// The push-up drill against a synthetic lifter on the floor (test-kit.js's camera, propped low at
// 0.3 m as the setup line asks), filmed from
// side-on to the head end: counting, depth and the standards, tempo, the body line, cues, matches.
import { describe, expect, it } from 'vitest'
import pushUp, { hipLine, HIP_DEV } from './push-up.js'
import { checkDrill } from './index.js'
import { LEVEL_BAND, dropDepthShare } from './press-kit.js'
import { CAMERA, ease, film, project, same, YAWS } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180
const U0 = 0.5            // the body is moved this far forward so its middle is near the camera's axis

/**
 * A push-up in body coordinates (u forward = where the head points, v up, w left) from the elbow
 * angle (180 straight). The hands stay on the floor with the forearms upright; the upper arm turns
 * back, so the shoulder is at elbow height (the upper arm level) at 90. The body is a straight line
 * from the shoulders to the toes (or knees); `sag` turns the torso that many degrees down about the
 * shoulders (negative: piked), the legs following to the feet, so the hip leaves the line.
 */
export function pushUpPose(elbow, { sag = 0, knees = false } = {}) {
  const th = rad(180 - elbow)
  const wr = [0, 0.03], el = [0, 0.3]
  const S = [0.3 * Math.sin(th), el[1] + 0.3 * Math.cos(th)]
  const L = knees ? 0.93 : 1.36, ah = knees ? 0.06 : 0.08
  const phi = Math.asin((S[1] - ah) / L)
  const A = [S[0] - L * Math.cos(phi), ah]
  const tilt = phi + rad(sag)
  const hip = [S[0] - 0.5 * Math.cos(tilt), S[1] - 0.5 * Math.sin(tilt)]
  const knee = knees ? A : [(hip[0] + A[0]) / 2, (hip[1] + A[1]) / 2]
  const ankle = knees ? [A[0] - 0.43, 0.1] : A
  const neck = [S[0] + 0.12 * Math.cos(phi), S[1] + 0.12 * Math.sin(phi)]
  const nose = [neck[0] + 0.1 * Math.cos(phi), neck[1] + 0.1 * Math.sin(phi) - 0.05]
  const out = { nose: [nose[0] + U0, nose[1], 0], neck: [neck[0] + U0, neck[1], 0] }
  const pair = (name, p, half) => {
    out['left' + name] = [p[0] + U0, p[1], half]
    out['right' + name] = [p[0] + U0, p[1], -half]
  }
  pair('Wrist', wr, 0.22)
  pair('Elbow', el, 0.24)
  pair('Shoulder', S, 0.19)
  pair('Hip', hip, 0.1)
  pair('Knee', knee, 0.1)
  pair('Ankle', ankle, 0.1)
  return out
}

/** A set of push-ups: reps = [{ min, down, up, sag, knees }], `stand` seconds at the top between. */
export function pushUpSet(reps, { stand = 1, fps = 15, top = 175, knees = false, height = 0.3, ...opts } = {}) {
  const poses = []
  const hold = (e, n, o) => { for (let i = 0; i < n; i++) poses.push(pushUpPose(e, o)) }
  hold(top, Math.round(stand * fps), { knees })
  for (const r of reps) {
    const o = { sag: r.sag || 0, knees }
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) poses.push(pushUpPose(top - (top - r.min) * ease(i / dn), o))
    hold(r.min, 2, o)
    for (let i = 1; i <= up; i++) poses.push(pushUpPose(r.min + (top - r.min) * ease(i / up), o))
    hold(top, Math.round(stand * fps), { knees })
  }
  return film(poses, { fps, height, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = pushUp.create(opts)
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
const DEEP = { min: 70, down: 1.5, up: 1 }, LEVEL = { min: 90, down: 1.5, up: 1 }, SHALLOW = { min: 112, down: 1.5, up: 1 }
const depths = res => res.reps.map(r => r.measures.depth)
const viewAt = yaw => (yaw === 0 ? 'side' : yaw === 90 ? 'front' : 'diagonal')

// The elbow angle at which the shoulder sits `d` upper arms below the elbow, as filmed at `yaw`.
function elbowForDepth(d, yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const top = project(pushUpPose(175), { yaw, height: 0.3 })
  const upper = y(top, 'Elbow') - y(top, 'Shoulder')
  const at = e => { const j = project(pushUpPose(e), { yaw, height: 0.3 }); return (y(j, 'Shoulder') - y(j, 'Elbow')) / upper }
  let lo = 40, hi = 150
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) > d) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('push-up, the contract', () => {
  it('keeps the drill contract', () => {
    expect(checkDrill(pushUp)).toEqual([])
  })
})

describe.each(YAWS)('the push-up filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => pushUpSet(reps, { yaw, ...o })

  it('counts five clean push-ups, live and in the result, and names the view', () => {
    const { counted, res } = run(set(same(5, { min: 80, down: 1.5, up: 1 })))
    expect(counted).toBe(5)
    expect(res.count).toBe(5)
    expect(res.view).toBe(viewAt(yaw))
  })

  it('counts kneeling push-ups the same way', () => {
    expect(run(pushUpSet(same(4, { min: 80, down: 1.5, up: 1 }), { yaw, knees: true })).res.count).toBe(4)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, { min: 80, down: 1.2, up: 1 }), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a wobble at the top', () => {
    const frames = set([{ min: 155, down: 0.5, up: 0.5 }, DEEP, { min: 150, down: 0.4, up: 0.4 }], { noise: 0.002 })
    expect(run(frames).res.count).toBe(1)
  })

  it('names the depth: below, level and above', () => {
    expect(depths(run(set([DEEP, LEVEL, SHALLOW]), ANY).res)).toEqual(['below', 'level', 'above'])
  })

  it('level (the default): keeps shallow reps as no-reps; below and any', () => {
    const frames = set([DEEP, SHALLOW, LEVEL, DEEP, SHALLOW])
    const def = run(frames)
    expect([def.counted, def.missed]).toEqual([3, 2])
    expect(def.missedAt.map(m => m.reason)).toEqual(['shallow', 'shallow'])
    expect(def.res).toMatchObject({ count: 3, missed: 2, standard: 'level', cueId: 'missed' })
    expect(run(frames, { standard: 'below' }).res.reps.map(r => r.counted)).toEqual([true, false, false, true, false])
    expect(run(frames, ANY).res).toMatchObject({ count: 5, missed: 0 })
  })

  it('takes the level band at its edge, as filmed from this angle', () => {
    const edge = elbowForDepth(-LEVEL_BAND, yaw)
    expect(run(set([{ min: edge - 2, down: 1.5, up: 1 }])).res.reps[0]).toMatchObject({ counted: true, measures: { depth: 'level' } })
    expect(run(set([{ min: edge + 2, down: 1.5, up: 1 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'shallow', measures: { depth: 'above' } })
  })

  it('times the way down and up', () => {
    const { res } = run(set(same(3, { min: 80, down: 2, up: 1 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(1.4)
      expect(r.measures.downSec).toBeLessThan(2.4)
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.upSec).toBeLessThan(1.5)
    }
  })

  it('lights the shoulders once the standard is reached, not before', () => {
    const { outs } = run(set([LEVEL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftShoulder', 'rightShoulder'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHALLOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('measures the elbow angle and the body line side-on only', () => {
    const { res } = run(set(same(3, { min: 80, down: 1.5, up: 1, sag: 10 })))
    const m = res.reps[0].measures
    expect(m.minElbow != null).toBe(yaw === 0)
    expect(m.hips != null).toBe(yaw === 0)
    expect(res.cueId).toBe(yaw === 0 ? 'sag' : 'steady')
    expect(res.tiles.map(x => x.id)).toEqual(yaw === 0 ? ['depth', 'tempo', 'hips'] : ['depth', 'tempo'])
  })
})

describe('the push-up, whatever the angle', () => {
  it('reads a lifter facing the other way the same (yaw 180, -45)', () => {
    for (const yaw of [180, -45]) expect(depths(run(pushUpSet([DEEP, LEVEL, SHALLOW], { yaw }), ANY).res)).toEqual(['below', 'level', 'above'])
  })

  it('side-on: the bottom elbow angle and the body line, sagged, piked or in line', () => {
    const { res } = run(pushUpSet([{ min: 80, down: 1.5, up: 1 }, { min: 90, down: 1.5, up: 1 }]))
    expect(res.reps[0].measures.minElbow).toBeCloseTo(80, -1)
    expect(res.reps.map(r => r.measures.hips)).toEqual(['line', 'line'])
    expect(res.details[0].map(d => d.label)).toEqual(['Depth', 'Tempo', 'Elbow angle', 'Hips'])
    expect(res.details[0]).toContainEqual({ label: 'Hips', value: 'In line' })
    expect(res.tiles.find(x => x.id === 'hips')).toMatchObject({ label: 'Body line', value: '2 of 2', sub: 'hips in line' })
    expect(res.note).toBe('Filmed from the side: depth, tempo, elbow angle and body line.')
    const sag = run(pushUpSet(same(3, { min: 80, down: 1.5, up: 1, sag: 10 }))).res
    expect(sag.reps.every(r => r.measures.hips === 'sag' && r.measures.hipLine > HIP_DEV)).toBe(true)
    expect(sag.cue).toBe('The hips sagged on most reps. Try bracing so the body stays in one line.')
    const pike = run(pushUpSet(same(3, { min: 80, down: 1.5, up: 1, sag: -10 }))).res
    expect(pike.cueId).toBe('pike')
    expect(pike.details[0]).toContainEqual({ label: 'Hips', value: 'Piked' })
    // A slight sag stays in line.
    expect(run(pushUpSet(same(3, { min: 80, down: 1.5, up: 1, sag: 2 }))).res.cueId).toBe('steady')
  })

  it('reads the hip line with the sign of the sag', () => {
    const j = project(pushUpPose(170, { sag: 10 }), { height: 0.3 })
    expect(hipLine(j, 'right', CAMERA.aspect)).toBeGreaterThan(HIP_DEV)
    expect(hipLine(project(pushUpPose(170, { sag: -10 }), { height: 0.3 }), 'right', CAMERA.aspect)).toBeLessThan(-HIP_DEV)
    expect(hipLine({}, 'right', 1)).toBe(null)
  })

  it('outside a side view, asks for the phone at elbow height, and till it is counts the reps without judging depth', () => {
    for (const cam of [{ height: 1.0 }, { pitch: 15 }]) {
      const { outs, res } = run(pushUpSet([DEEP, SHALLOW, DEEP], { yaw: 90, ...cam }))
      const top = outs.slice(10).filter(o => o.phase === 'standing')
      expect(top.length).toBeGreaterThan(10)
      expect(top.every(o => o.hint === 'Put the phone at elbow height and level')).toBe(true)
      expect(res).toMatchObject({ count: 3, missed: 0 })
      expect(res.reps.map(r => r.measures.depth)).toEqual([null, null, null])
    }
    const side = run(pushUpSet([SHALLOW], { yaw: 0, height: 1.0 }))
    expect(side.res.missed).toBe(1)
    expect(side.outs.some(o => o.hint === 'Put the phone at elbow height and level')).toBe(false)
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(pushUpSet(same(3, DEEP), { gap: [5300, 5700] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(pushUpSet(same(2, DEEP), { gap: [1600, 4800] })).res.count).toBe(1)
  })

  it('cues: none, slower, fade, steady, deeper', () => {
    expect(run(pushUpSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    expect(run(pushUpSet(same(4, { min: 80, down: 0.6, up: 0.6 }))).res.cueId).toBe('slower')
    expect(run(pushUpSet([70, 70, 72, 78, 100, 110].map(min => ({ min, down: 1.5, up: 1 }))), ANY).res.cueId).toBe('fade')
    expect(run(pushUpSet(same(4, { min: 112, down: 1.5, up: 1 })), ANY).res.cueId).toBe('deeper')
    expect(run(pushUpSet(same(4, { min: 80, down: 1.5, up: 1 }))).res.cueId).toBe('steady')
    const miss = run(pushUpSet(same(2, SHALLOW))).res
    expect(miss.cue).toBe('Reps that did not count: 2. The shoulders stayed above the elbows.')
    expect(run(pushUpSet(same(2, SHALLOW)), { standard: 'below' }).res.cue).toBe('Reps that did not count: 2. The shoulders did not get below the elbows.')
  })

  it('reads the depth share of every judged rep, no-reps included', () => {
    const { res } = run(pushUpSet([DEEP, SHALLOW, LEVEL]))
    expect(dropDepthShare(res.reps, 'level')).toEqual({ hit: 2, of: 3, depth: 'level' })
    expect(res.tiles[0]).toMatchObject({ id: 'depth', value: '2 of 3', sub: 'shoulders to the elbows or lower' })
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = pushUp.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    expect(tr.push({ t: 66, aspect: CAMERA.aspect, joints: project(pushUpPose(90), { height: 0.3 }) }).hint).toBe('Arms straight to start')
    const outs = pushUpSet([DEEP], { start: 133 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('can be held to a view', () => {
    const { res } = run(pushUpSet(same(2, DEEP)), { view: 'diagonal' })
    expect(res.view).toBe('diagonal')
    expect(res.reps[0].measures.hips).toBeUndefined()
  })
})

describe('pushUp.matches', () => {
  it('takes the push-ups of the allow-list and plain push-ups by name', () => {
    for (const id of ['0662', '1182', '0259', '0283', '1311']) expect(pushUp.matches(EXIDX[id])).toBe(true)
    expect(pushUp.matches({ id: 'c1', n: 'Push-ups', cat: 'calisthenics' })).toBe(true)
  })

  it('leaves out incline, decline, clapping and other presses', () => {
    for (const id of ['0493', '0279', '3011', '0660', '4807', '0289', '0047', '0662x']) expect(pushUp.matches(EXIDX[id])).toBe(false)
    expect(pushUp.matches({ id: 'c2', n: 'Clap push-up', cat: 'plyometrics' })).toBe(false)
    expect(pushUp.matches(null)).toBe(false)
  })
})
