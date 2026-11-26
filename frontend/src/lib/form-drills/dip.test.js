// The dip drill against a synthetic lifter on parallel bars (test-kit.js's camera, raised to the
// elbows' height at the top as the setup asks outside a side view), filmed from side-on to facing
// the camera: counting, depth and the standards, tempo, the elbow angle, cues, matches.
import { describe, expect, it } from 'vitest'
import dip from './dip.js'
import { checkDrill } from './index.js'
import { LEVEL_BAND } from './press-kit.js'
import { CAMERA, ease, film, project, same, YAWS } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180
const ELBOW_TOP = 1.27     // the elbows' height at the top: where the phone goes

/**
 * A dip in body coordinates (u forward, v up, w left) from the elbow angle (180 straight). The
 * hands stay on bars 1 m high with the forearms upright; the upper arm turns back, so the
 * shoulder is at elbow height at 90. The torso leans forward a little more the deeper the dip;
 * the knees are bent, the feet behind.
 */
export function dipPose(elbow) {
  const thDeg = 180 - elbow, th = rad(thDeg)
  const wr = [0, 1.0], el = [0, ELBOW_TOP]
  const S = [0.3 * Math.sin(th), el[1] + 0.3 * Math.cos(th)]
  const lean = rad(5 + 0.15 * thDeg)
  const hip = [S[0] - 0.5 * Math.sin(lean), S[1] - 0.5 * Math.cos(lean)]
  const knee = [hip[0] + 0.43 * Math.sin(rad(10)), hip[1] - 0.43 * Math.cos(rad(10))]
  const ankle = [knee[0] - 0.43 * Math.sin(rad(60)), knee[1] - 0.43 * Math.cos(rad(60))]
  const neck = [S[0] + 0.12 * Math.sin(lean), S[1] + 0.12 * Math.cos(lean)]
  const out = { nose: [neck[0] + 0.08, neck[1] + 0.1, 0], neck: [neck[0], neck[1], 0] }
  const pair = (name, p, half) => {
    out['left' + name] = [p[0], p[1], half]
    out['right' + name] = [p[0], p[1], -half]
  }
  pair('Wrist', wr, 0.25)
  pair('Elbow', el, 0.24)
  pair('Shoulder', S, 0.19)
  pair('Hip', hip, 0.1)
  pair('Knee', knee, 0.08)
  pair('Ankle', ankle, 0.06)
  return out
}

/** A set of dips: reps = [{ min, down, up }], `stand` seconds at the top between. */
export function dipSet(reps, { stand = 1, fps = 15, top = 175, height = ELBOW_TOP, ...opts } = {}) {
  const poses = []
  const hold = (e, n) => { for (let i = 0; i < n; i++) poses.push(dipPose(e)) }
  hold(top, Math.round(stand * fps))
  for (const r of reps) {
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) poses.push(dipPose(top - (top - r.min) * ease(i / dn)))
    hold(r.min, 2)
    for (let i = 1; i <= up; i++) poses.push(dipPose(r.min + (top - r.min) * ease(i / up)))
    hold(top, Math.round(stand * fps))
  }
  return film(poses, { fps, height, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = dip.create(opts)
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

function elbowForDepth(d, yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const cam = { yaw, height: ELBOW_TOP }
  const top = project(dipPose(175), cam)
  const upper = y(top, 'Elbow') - y(top, 'Shoulder')
  const at = e => { const j = project(dipPose(e), cam); return (y(j, 'Shoulder') - y(j, 'Elbow')) / upper }
  let lo = 40, hi = 150
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) > d) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('dip, the contract', () => {
  it('keeps the drill contract', () => {
    expect(checkDrill(dip)).toEqual([])
  })
})

describe.each(YAWS)('the dip filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => dipSet(reps, { yaw, ...o })

  it('counts five clean dips, live and in the result, and names the view', () => {
    const { counted, res } = run(set(same(5, { min: 80, down: 1.5, up: 1 })))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, view: viewAt(yaw) })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, { min: 80, down: 1.2, up: 1 }), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a wobble at the top', () => {
    expect(run(set([{ min: 155, down: 0.5, up: 0.5 }, DEEP, { min: 150, down: 0.4, up: 0.4 }], { noise: 0.002 })).res.count).toBe(1)
  })

  it('names the depth and keeps shallow reps as no-reps under each standard', () => {
    expect(depths(run(set([DEEP, LEVEL, SHALLOW]), ANY).res)).toEqual(['below', 'level', 'above'])
    const frames = set([DEEP, SHALLOW, LEVEL, DEEP, SHALLOW])
    const def = run(frames)
    expect([def.counted, def.missed]).toEqual([3, 2])
    expect(def.missedAt.map(m => m.reason)).toEqual(['shallow', 'shallow'])
    expect(run(frames, { standard: 'below' }).res.reps.map(r => r.counted)).toEqual([true, false, false, true, false])
    expect(run(frames, ANY).res).toMatchObject({ count: 5, missed: 0 })
  })

  it('takes the level band at its edge, as filmed from this angle', () => {
    const edge = elbowForDepth(-LEVEL_BAND, yaw)
    expect(run(set([{ min: edge - 2, down: 1.5, up: 1 }])).res.reps[0]).toMatchObject({ counted: true, measures: { depth: 'level' } })
    expect(run(set([{ min: edge + 2, down: 1.5, up: 1 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'shallow', measures: { depth: 'above' } })
  })

  it('times the way down and up', () => {
    for (const r of run(set(same(3, { min: 80, down: 2, up: 1 }), { noise: 0.002 })).res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(1.4)
      expect(r.measures.downSec).toBeLessThan(2.4)
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.upSec).toBeLessThan(1.5)
    }
  })

  it('measures the elbow angle side-on only', () => {
    const { res } = run(set(same(3, { min: 80, down: 1.5, up: 1 })))
    expect(res.reps[0].measures.minElbow != null).toBe(yaw === 0)
    expect(res.tiles.map(x => x.id)).toEqual(yaw === 0 ? ['depth', 'tempo', 'consistency'] : ['depth', 'tempo'])
  })
})

describe('the dip, whatever the angle', () => {
  it('side-on: the bottom elbow angle, its spread across the set, and the note', () => {
    const { res } = run(dipSet([{ min: 80, down: 1.5, up: 1 }, { min: 90, down: 1.5, up: 1 }, { min: 85, down: 1.5, up: 1 }]))
    expect(res.reps[0].measures.minElbow).toBeCloseTo(80, -1)
    expect(res.summary.consistency).toBeGreaterThan(6)
    expect(res.summary.consistency).toBeLessThan(14)
    expect(res.details[0].map(d => d.label)).toEqual(['Depth', 'Tempo', 'Elbow angle'])
    expect(res.note).toBe('Filmed from the side: depth, tempo and elbow angle.')
  })

  it('outside a side view, asks for the phone at elbow height, and till it is counts the reps without judging depth', () => {
    for (const yaw of [45, 90]) {
      const { outs, res } = run(dipSet([DEEP, LEVEL, DEEP], { yaw, height: 0.5 }))
      const top = outs.slice(10).filter(o => o.phase === 'standing')
      expect(top.length).toBeGreaterThan(10)
      expect(top.every(o => o.hint === 'Put the phone at elbow height and level')).toBe(true)
      expect(res).toMatchObject({ count: 3, missed: 0 })
      expect(res.reps.map(r => r.measures.depth)).toEqual([null, null, null])
    }
    const side = run(dipSet([SHALLOW], { yaw: 0, height: 0.5 }))
    expect(side.res.missed).toBe(1)
  })

  it('marks a rep where the pose was lost and still counts it; drops one lost for good', () => {
    const lost = run(dipSet(same(3, DEEP), { gap: [5300, 5700] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(dipSet(same(2, DEEP), { gap: [1600, 4800] })).res.count).toBe(1)
  })

  it('cues: none, missed, deeper, slower, steady', () => {
    expect(run(dipSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    expect(run(dipSet(same(2, SHALLOW))).res.cue).toBe('Reps that did not count: 2. The shoulders stayed above the elbows.')
    expect(run(dipSet(same(4, SHALLOW)), ANY).res.cueId).toBe('deeper')
    expect(run(dipSet(same(4, { min: 80, down: 0.6, up: 0.6 }))).res.cueId).toBe('slower')
    expect(run(dipSet(same(4, { min: 80, down: 1.5, up: 1 }))).res.cueId).toBe('steady')
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = dip.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    expect(tr.push({ t: 66, aspect: CAMERA.aspect, joints: project(dipPose(90), { height: ELBOW_TOP }) }).hint).toBe('Arms straight to start')
    const outs = dipSet([DEEP], { start: 133 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })
})

describe('dip.matches', () => {
  it('takes bar, ring, straight-bar and bench dips of the allow-list, and plain dips by name', () => {
    for (const id of ['0251', '0814', '0677', '1755', '3313', '0129', '0830']) expect(dip.matches(EXIDX[id])).toBe(true)
    expect(dip.matches({ id: 'c1', n: 'Weighted dips', cat: 'strength' })).toBe(true)
  })

  it('leaves out machines, floor dips, holds and other dips', () => {
    for (const id of ['0009', '0019', '1451', '1871', '1399', '1442', '3288', '3289', '0639', '3012', '1525']) expect(dip.matches(EXIDX[id])).toBe(false)
    expect(dip.matches(null)).toBe(false)
  })
})
