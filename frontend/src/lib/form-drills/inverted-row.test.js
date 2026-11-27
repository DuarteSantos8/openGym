// The inverted row against synthetic lifters under a low bar (pull-kit.js rowPose), filmed through
// test-kit.js side-on and at an angle (the views it judges), and end-on (where it only counts).
import { describe, expect, it } from 'vitest'
import invertedRow, { CHEST_S } from './inverted-row.js'
import { checkDrill } from './index.js'
import { armPoses, rowDrop, rowPose } from './pull-kit.js'
import { film, project } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const CAM = { height: 0.8 }
const REST = rowDrop()
const FULL = { top: 0.05, up: 1, down: 1.5 }, LOW = { top: 0.2, up: 1, down: 1.5 }, BENT = { ...FULL, bottom: 0.42 }
const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))
const set = (reps, o = {}) => film(armPoses(rowPose, REST, reps), { ...CAM, ...o })
const JUDGED = [0, 30, 45, 60]

const run = (frames, opts = {}) => {
  const tr = invertedRow.create(opts)
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

// The wrists' height over the shoulders at which the signal is CHEST_S, as filmed.
function dForTop(yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const reach = d => { const j = project(rowPose(d), { yaw, ...CAM }); return y(j, 'Shoulder') - y(j, 'Wrist') }
  const ref = reach(REST)
  let lo = 0, hi = 0.3
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if ((ref - reach(m)) / ref > CHEST_S) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('the inverted row drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(invertedRow)).toEqual([])
  })
})

describe.each(JUDGED)('the inverted row filmed at yaw %i°', yaw => {
  const S = (reps, o = {}) => set(reps, { yaw, ...o })

  it('counts five clean reps, live and in the result', () => {
    const { counted, res } = run(S(same(5, FULL)))
    expect(counted).toBe(5)
    expect(res).toMatchObject({ count: 5, missed: 0 })
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(S(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a half pull', () => {
    expect(run(S([{ top: 0.36, up: 0.6, down: 0.6 }, FULL], { noise: 0.002 })).res.reps).toHaveLength(1)
  })

  it('full (the default): no-reps the chest short of the bar and a rep from bent arms', () => {
    const { counted, missed, reasons, res } = run(S([FULL, LOW, BENT, FULL]))
    expect([counted, missed]).toEqual([2, 2])
    expect(reasons).toEqual(['low', 'hang'])
    expect(res.reps.map(r => r.reason)).toEqual([null, 'low', null, 'hang'])
  })

  it('full: a rep from straight arms counts though the body pivoted and the reach at rest came up short', () => {
    // From the first rep's way down the whole body moves so the straight arms lean 38 degrees
    // from the bar at rest: the reach there is under 0.88 of the first, past HANG_S, the elbows straight.
    const tilt = rad => (d, o = {}) => {
      const pose = rowPose(d, o)
      const k = 1 - (o.p || 0)              // the whole lean at rest, none at the top
      const S = rowPose(REST).leftShoulder, W = pose.leftWrist
      const L = Math.hypot(S[0] - W[0], S[1] - W[1])
      const shift = [(W[0] + L * Math.sin(rad) - S[0]) * k, (W[1] - L * Math.cos(rad) - S[1]) * k]
      const out = {}
      for (const [name, j] of Object.entries(pose)) out[name] = name.endsWith('Wrist') ? j : [j[0] + shift[0], j[1] + shift[1], j[2]]
      for (const sd of ['left', 'right']) {
        // The elbow kept on the line from the moved shoulder to the wrist, where it was on the arm.
        const s0 = pose[sd + 'Shoulder'], e0 = pose[sd + 'Elbow'], w = pose[sd + 'Wrist'], s1 = out[sd + 'Shoulder']
        const f = Math.hypot(e0[0] - s0[0], e0[1] - s0[1], e0[2] - s0[2]) / Math.hypot(w[0] - s0[0], w[1] - s0[1], w[2] - s0[2])
        if (k === 1) out[sd + 'Elbow'] = s1.map((v, i) => v + f * (w[i] - v))
      }
      return out
    }
    // Leaning from the way down of the first rep on (stand 15 frames, up 15, top 2).
    const lean = tilt(38 * Math.PI / 180)
    let i = 0
    const pose = (d, o) => (i++ >= 32 ? lean(d, o) : rowPose(d, o))
    const { res } = run(film(armPoses(pose, REST, [FULL, FULL]), { ...CAM, yaw }))
    expect(res.reps.map(r => r.reason)).toEqual([null, null])
    expect(res.reps[1].measures.hang).toBeGreaterThan(0.12)
  })

  it('chest: a rep from bent arms counts; any: every real pull counts', () => {
    expect(run(S([FULL, LOW, BENT, FULL]), { standard: 'chest' }).res.reps.map(r => r.counted)).toEqual([true, false, true, true])
    expect(run(S([FULL, LOW, BENT, FULL]), { standard: 'any' }).res.missed).toBe(0)
  })

  it('takes the chest standard at its edge, as filmed from this angle', () => {
    const edge = dForTop(yaw)
    expect(run(S([{ ...FULL, top: edge - 0.02 }])).res.reps[0].counted).toBe(true)
    expect(run(S([{ ...FULL, top: edge + 0.02 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('times the way up and down, and says lower with control when it is quick', () => {
    const { res } = run(S(same(3, { top: 0.05, up: 1, down: 2.5 })))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.upSec).toBeLessThan(1.5)
      expect(r.measures.downSec).toBeGreaterThan(1.8)
    }
    expect(run(S(same(4, { top: 0.05, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
    expect(run(S(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('reads the hips sagging, and a straight body as in line', () => {
    const sagged = run(S(same(3, { ...FULL, sag: 0.15 }))).res
    expect(sagged.reps.every(r => r.measures.sagged)).toBe(true)
    expect(sagged.cueId).toBe('sag')
    expect(sagged.details[0]).toContainEqual({ label: 'Hips', value: 'Sagged' })
    expect(run(S(same(3, FULL))).res.reps.every(r => r.measures.sagged === false)).toBe(true)
  })

  it('lights the shoulders once the standard is met, and not before', () => {
    const { outs } = run(S([FULL]))
    expect(outs.find(o => o.reached).highlight).toEqual(['leftShoulder', 'rightShoulder'])
    expect(outs.at(-1).reached).toBe(false)
    expect(run(S([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('names the view', () => {
    expect(run(S(same(2, FULL))).res.view).toBe(yaw === 0 ? 'side' : 'diagonal')
  })
})

describe('the inverted row, whatever the angle', () => {
  it('reads the other side the same (yaw 180, -30)', () => {
    for (const yaw of [180, -30]) expect(run(set([FULL, LOW, FULL], { yaw })).res.reps.map(r => r.counted)).toEqual([true, false, true])
  })

  it('end-on: asks to turn side-on, counts, and leaves the top and the hips unjudged', () => {
    const { res, outs } = run(set([FULL, LOW, FULL], { yaw: 90 }))
    expect(outs.at(-1).hint).toBe('Turn side-on to the camera')
    expect(res).toMatchObject({ count: 3, missed: 0, view: 'front', cueId: 'unjudged' })
    expect(res.reps.every(r => r.measures.topOk === null && !('sag' in r.measures))).toBe(true)
    expect(res.cue).toBe('Most reps were filmed end-on, so the top could not be judged. Film from the side.')
  })

  it('marks a rep where the pose was lost, and still counts it', () => {
    const { res } = run(set(same(3, FULL), { gap: [5500, 5950] }))
    expect(res.count).toBe(3)
    expect(res.reps.map(r => r.lost)).toEqual([false, true, false])
  })

  it('has the lines for no reps and for the reps that did not count', () => {
    expect(run(set([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    expect(run(set(same(2, LOW))).res.cue).toBe('Reps that did not count: 2. The chest did not get to the bar.')
    expect(run(set([FULL, BENT, FULL])).res.cue).toBe('Reps that did not count: 1. The arms did not straighten at the bottom.')
  })

  it('tiles and rows', () => {
    const { res } = run(set([FULL, LOW]))
    expect(res.tiles.map(x => [x.id, x.value])).toEqual([['top', '1 of 2'], ['hang', '2 of 2'], ['tempo', expect.stringMatching(/ s$/)]])
    expect(res.details[1].map(d => d.value).slice(0, 2)).toEqual(['Short of the bar', 'Straight arms'])
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = invertedRow.create()
    expect(tr.push({ t: 0, joints: {} }).hint).toBe('Step into the frame')
    const outs = set([FULL], { start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Pull when you are.')
    expect(outs.at(-1)).toMatchObject({ hint: '', count: 1 })
  })
})

describe('invertedRow.matches', () => {
  it('takes rows under a bar, bent knees and weighted too', () => {
    for (const id of ['0499', '0497', '4917', '5517', '1184', '2300']) expect(invertedRow.matches(EXIDX[id])).toBe(true)
  })

  it('leaves out furniture, straps, rings and the other pulls', () => {
    for (const id of ['3381', '3388', '0498', '1080', '4379', '11715', '1326', '9698', '0027']) expect(invertedRow.matches(EXIDX[id])).toBe(false)
    expect(invertedRow.matches(null)).toBe(false)
  })
})
