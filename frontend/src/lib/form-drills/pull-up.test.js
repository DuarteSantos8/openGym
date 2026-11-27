// The pull-up drill against synthetic lifters hanging from a bar (pull-kit.js hangPose), filmed
// through test-kit.js from side-on to facing the camera: counting, the top and the start of every
// rep under each standard, tempo, lost pose, cues, the extras each view can show, matches.
import { describe, expect, it } from 'vitest'
import pullUp, { CHIN_OVER } from './pull-up.js'
import { checkDrill } from './index.js'
import { armPoses, hangDrop, hangPose } from './pull-kit.js'
import { film, project, YAWS } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const CAM = { height: 1.6, dist: 2.8 }
const REST = hangDrop()
const FULL = { top: 0.08, up: 1, down: 1.5 }, LOW = { top: 0.22, up: 1, down: 1.5 }
const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))
const set = (reps, o = {}) => film(armPoses(hangPose, o.rest ?? REST, reps), { ...CAM, ...o })

const run = (frames, opts = {}) => {
  const tr = pullUp.create(opts)
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

// The wrists' height over the shoulders at which the nose is CHIN_OVER reaches over the wrists, as filmed.
function dForTop(yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const hang = project(hangPose(REST), { yaw, ...CAM })
  const ref = y(hang, 'Shoulder') - y(hang, 'Wrist')
  const top = d => { const j = project(hangPose(d), { yaw, ...CAM }); return (y(j, 'Wrist') - j.nose[1]) / ref }
  let lo = 0, hi = 0.3
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (top(m) > CHIN_OVER) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('the pull-up drill', () => {
  it('keeps the contract', () => {
    expect(checkDrill(pullUp)).toEqual([])
  })
})

describe.each(YAWS)('the pull-up filmed at yaw %i°', yaw => {
  const S = (reps, o = {}) => set(reps, { yaw, ...o })

  it('counts five clean reps, live and in the result', () => {
    const { counted, missed, res } = run(S(same(5, FULL)))
    expect([counted, missed]).toEqual([5, 0])
    expect(res).toMatchObject({ count: 5, missed: 0 })
    expect(res.reps.every(r => r.measures.topOk && r.measures.hangOk)).toBe(true)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(S(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a half pull or a shrug at the hang', () => {
    expect(run(S([{ top: 0.42, up: 0.6, down: 0.6 }, FULL, { top: 0.5, up: 0.4, down: 0.4 }], { noise: 0.002 })).res.reps).toHaveLength(1)
  })

  it('full (the default): no-reps a chin under the bar and a rep from bent arms', () => {
    const reps = [FULL, LOW, { ...FULL, bottom: 0.42 }, FULL, FULL]
    const { counted, missed, reasons, res } = run(S(reps))
    expect([counted, missed]).toEqual([3, 2])
    expect(reasons).toEqual(['low', 'hang'])
    expect(res.reps.map(r => r.reason)).toEqual([null, 'low', null, 'hang', null])
    expect(res).toMatchObject({ standard: 'full', cueId: 'missed' })
  })

  it('chin: a rep from bent arms counts, a chin under the bar does not', () => {
    const { res } = run(S([FULL, LOW, { ...FULL, bottom: 0.42 }, FULL]), { standard: 'chin' })
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true, true])
  })

  it('any: every real pull counts', () => {
    const { res } = run(S([FULL, LOW, { ...FULL, bottom: 0.42 }, FULL]), { standard: 'any' })
    expect([res.count, res.missed]).toEqual([4, 0])
  })

  it('takes the chin standard at its edge, as filmed from this angle', () => {
    const edge = dForTop(yaw)
    expect(run(S([{ ...FULL, top: edge - 0.02 }])).res.reps[0]).toMatchObject({ counted: true })
    expect(run(S([{ ...FULL, top: edge + 0.02 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'low' })
  })

  it('times the way up and down', () => {
    const { res } = run(S(same(3, { top: 0.08, up: 1, down: 2.5 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.upSec).toBeGreaterThan(0.6)
      expect(r.measures.upSec).toBeLessThan(1.5)
      expect(r.measures.downSec).toBeGreaterThan(1.8)
      expect(r.measures.downSec).toBeLessThan(3.2)
    }
    expect(res.tiles.map(x => x.id)).toEqual(['top', 'hang', 'tempo'])
  })

  it('says lower with control when the way down is quicker than a second', () => {
    expect(run(S(same(4, { top: 0.08, up: 1, down: 0.5 }))).res.cueId).toBe('slower')
  })

  it('stays neutral when nothing stands out', () => {
    expect(run(S(same(4, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the nose once the standard is met mid-rep, and not before', () => {
    const { outs } = run(S([FULL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['nose'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(S([LOW])).outs.some(o => o.reached)).toBe(false)
  })

  it('shows the extras of this view only', () => {
    const { res } = run(S(same(3, FULL)))
    const view = yaw === 0 ? 'side' : yaw === 90 ? 'front' : 'diagonal'
    expect(res.view).toBe(view)
    const m = res.reps[0].measures
    expect('swing' in m).toBe(view === 'side')
    expect('tilt' in m).toBe(view === 'front')
  })
})

describe('the pull-up, whatever the angle', () => {
  it('reads the other side and the far angles the same (yaw 180, 135, -45)', () => {
    for (const yaw of [180, 135, -45]) {
      expect(run(set([FULL, LOW, FULL], { yaw })).res.reps.map(r => r.counted)).toEqual([true, false, true])
    }
  })

  it('reads a wide grip with the elbows out, and a phone a little low or high', () => {
    const wide = { grip: 0.32, wide: true }
    const frames = film(armPoses(hangPose, hangDrop(0.32), [FULL, LOW, FULL].map(r => ({ ...r, ...wide }))), { ...CAM, yaw: 90 })
    expect(run(frames).res.reps.map(r => r.counted)).toEqual([true, false, true])
    for (const height of [1.2, 2.0]) expect(run(set([FULL, LOW], { yaw: 90, height })).res.reps.map(r => r.counted)).toEqual([true, false])
  })

  it('does not count stepping under the bar, letting go or arms dropped to the sides', () => {
    // Standing with the arms down: the wrists below the elbows, never a hang.
    const standing = Array.from({ length: 30 }, (_, i) => {
      const j = project(hangPose(REST), { yaw: 45, ...CAM })
      for (const s of ['left', 'right']) { j[s + 'Wrist'] = [j[s + 'Wrist'][0], j[s + 'Hip'][1], 0.9]; j[s + 'Elbow'] = [j[s + 'Elbow'][0], (j[s + 'Shoulder'][1] + j[s + 'Hip'][1]) / 2, 0.9] }
      return { t: i * 66, aspect: 0.75, joints: j }
    })
    const reps = set(same(2, FULL), { yaw: 45, start: 30 * 66 })
    const after = standing.map((f, i) => ({ ...f, t: reps.at(-1).t + 66 * (i + 1) }))
    const { res, outs } = run([...standing, ...reps, ...after])
    expect(res.count).toBe(2)
    expect(outs[5].hint).toBe('Hang with straight arms to start')
  })

  it('marks a rep where the pose was lost, and still counts it; drops one lost for good', () => {
    const lost = run(set(same(3, FULL), { yaw: 30, gap: [5500, 5950] })).res
    expect(lost.count).toBe(3)
    expect(lost.reps.map(r => r.lost)).toEqual([false, true, false])
    expect(run(set(same(2, FULL), { yaw: 30, gap: [1500, 4500] })).res.count).toBe(1)
  })

  it('without the face, judges the top from the shoulders against the nose seen at the hang', () => {
    const noNoseAtTop = set([FULL, LOW], { yaw: 90 }).map((f, i) => (i > 20 ? { ...f, joints: { ...f.joints, nose: undefined } } : f))
    expect(run(noNoseAtTop).res.reps.map(r => r.counted)).toEqual([true, false])
  })

  it('from behind (no face ever), leaves the top unjudged, says so, and counts', () => {
    const back = set([FULL, LOW, FULL], { yaw: -90 }).map(f => ({ ...f, joints: { ...f.joints, nose: undefined } }))
    const { res, outs } = run(back)
    expect(outs.some(o => o.hint === 'Film from the front or the side, with your face in view')).toBe(true)
    expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'unjudged' })
    expect(res.reps.map(r => r.measures.topOk)).toEqual([null, null, null])
    expect(res.tiles.map(x => x.id)).toEqual(['hang', 'tempo'])
  })

  it('side-on: the body swinging', () => {
    const swung = run(set(same(3, { ...FULL, swing: 0.3 }), { yaw: 0 })).res
    expect(swung.reps.every(r => r.measures.swung)).toBe(true)
    expect(swung.cueId).toBe('swing')
    expect(swung.details[0]).toContainEqual({ label: 'Swing', value: 'Swung' })
    const still = run(set(same(3, FULL), { yaw: 0 })).res
    expect(still.reps.every(r => r.measures.swung === false)).toBe(true)
  })

  it('from the front: the shoulders tilting at the top', () => {
    const tilted = run(set(same(3, { ...FULL, tilt: 0.08 }), { yaw: 90 })).res
    expect(tilted.reps.every(r => r.measures.tilted)).toBe(true)
    expect(tilted.cueId).toBe('tilt')
    expect(tilted.details[0].find(d => d.label === 'Shoulders').value).toMatch(/^Tilted \d+°$/)
    expect(run(set(same(3, FULL), { yaw: 90 })).res.details[0]).toContainEqual({ label: 'Shoulders', value: 'Level' })
  })

  it('has the lines for no reps, every rep missed and the reps by reason', () => {
    expect(run(set([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    expect(run(set(same(2, LOW))).res.cue).toBe('Reps that did not count: 2. The chin did not get over the bar.')
    expect(run(set([FULL, { ...FULL, bottom: 0.42 }, FULL])).res.cue).toBe('Reps that did not count: 1. They did not start from a full hang.')
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = pullUp.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    const outs = set(same(1, FULL), { yaw: 30, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Pull when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('the rows of every rep', () => {
    const { res } = run(set([FULL, LOW], { yaw: 45 }))
    expect(res.details[0].map(d => d.label)).toEqual(['Top', 'Start', 'Tempo'])
    expect(res.details[0][0].value).toBe('Chin over the bar')
    expect(res.details[1][0].value).toBe('Chin under the bar')
    expect(res.tiles[0]).toMatchObject({ id: 'top', value: '1 of 2', sub: 'chin over the bar' })
  })
})

describe('pullUp.matches', () => {
  it('takes chin-ups and pull-ups from a bar, weighted too', () => {
    for (const id of ['1326', '0652', '4102', '0841', '1327', '1429', '0651']) expect(pullUp.matches(EXIDX[id])).toBe(true)
    expect(pullUp.matches({ id: 'c1', n: 'Neutral grip chin up', cat: 'strength' })).toBe(true)
  })

  it('leaves out machines, one arm, negatives, rows, rings and the squat', () => {
    for (const id of ['0017', '1431', '0638', '7385', '1198', '4726', '0670', '5522', '0499', '9698', '3593', '4724', '0688']) {
      expect(pullUp.matches(EXIDX[id])).toBe(false)
    }
    expect(pullUp.matches(null)).toBe(false)
    expect(pullUp.matches({ id: 'c2', n: 'Pull-up', cat: 'cardio' })).toBe(false)
  })
})
