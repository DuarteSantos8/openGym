// The Romanian deadlift drill against synthetic lifters (test-kit.js) filmed from side-on to
// facing the camera: counting, depth by the hands and the standards, tempo, cues, the side-on
// extras, and the catalogue.
import { describe, expect, it } from 'vitest'
import rdl, { CUE, FAST_DOWN_SEC, KNEE_LINE, SHIN_LINE, SQUAT_KNEE, depthShare } from './romanian-deadlift.js'
import { checkDrill } from './index.js'
import { BODY, CAMERA, YAWS, ease, film, project, same } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

/**
 * A Romanian deadlift in body coordinates from the torso's lean forward (degrees from vertical).
 * The knees bend `kneeBend` of the lean (soft knees: 148° at a 80° lean), the shins stay near
 * vertical, so the hips go back; the hands hang from the shoulders on arms of `arm` metres and
 * slide down the legs over the middle of the feet (`bar` metres in front of the ankles).
 */
export function rdlPose(lean, { kneeBend = 0.4, arm = 0.6, bar = 0.08, body = BODY } = {}) {
  const b = body
  const k = 180 - kneeBend * lean
  const as = rad(0.15 * (180 - k)), bs = rad(0.85 * (180 - k))
  const knee = [b.shin * Math.sin(as), b.ankleH + b.shin * Math.cos(as)]
  const hip = [knee[0] - b.thigh * Math.sin(bs), knee[1] + b.thigh * Math.cos(bs)]
  const L = rad(lean)
  const sh = [hip[0] + b.torso * Math.sin(L), hip[1] + b.torso * Math.cos(L)]
  const nk = [sh[0] + b.neck * Math.sin(L), sh[1] + b.neck * Math.cos(L)]
  const dx = Math.min(arm * 0.95, Math.abs(sh[0] - bar))
  const wr = [sh[0] - Math.sign(sh[0] - bar) * dx, sh[1] - Math.sqrt(arm * arm - dx * dx)]
  const el = [(sh[0] + wr[0]) / 2, (sh[1] + wr[1]) / 2]
  const out = { nose: [nk[0] + b.head * 0.6, nk[1] + b.head * 0.7 - lean / 900, 0], neck: [nk[0], nk[1], 0] }
  const pair = (name, p, half) => { out['left' + name] = [p[0], p[1], half]; out['right' + name] = [p[0], p[1], -half] }
  pair('Ankle', [0, b.ankleH], b.stanceHalf * 0.8)
  pair('Knee', knee, b.hipHalf + 0.02)
  pair('Hip', hip, b.hipHalf)
  pair('Shoulder', sh, b.shoulderHalf)
  pair('Elbow', el, b.shoulderHalf)
  pair('Wrist', wr, b.shoulderHalf)
  return out
}

/** A set: `reps` = [{ lean, down, up, kneeBend }], standing `stand` seconds before, between and after. */
function rdlSet(reps, { stand = 1, fps = 15, ...opts } = {}) {
  const poses = []
  const hold = (lean, n, o) => { for (let i = 0; i < n; i++) poses.push(rdlPose(lean, o)) }
  hold(0, Math.round(stand * fps))
  for (const r of reps) {
    const o = { kneeBend: r.kneeBend ?? 0.4 }
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) poses.push(rdlPose(r.lean * ease(i / dn), o))
    hold(r.lean, 2, o)
    for (let i = 1; i <= up; i++) poses.push(rdlPose(r.lean * (1 - ease(i / up)), o))
    hold(0, Math.round(stand * fps))
  }
  return film(poses, { fps, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = rdl.create(opts)
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
// Hands to mid-shin and lower, to just under the knees, and well above them.
const DEEP = { lean: 100, down: 2.5, up: 1.5 }, KNEE = { lean: 80, down: 2.5, up: 1.5 }, HIGH = { lean: 50, down: 2, up: 1 }
const depths = res => res.reps.map(r => r.measures.depth)
const viewAt = yaw => (yaw === 0 ? 'side' : yaw === 90 ? 'front' : 'diagonal')

// The lean at which the wrists sit `d` standing shin lengths below the knees, as filmed at `yaw`.
function leanForDepth(d, yaw) {
  const y = (j, p) => (j['left' + p][1] + j['right' + p][1]) / 2
  const top = project(rdlPose(0), { yaw })
  const shin = y(top, 'Ankle') - y(top, 'Knee')
  const at = l => { const j = project(rdlPose(l), { yaw }); return (y(j, 'Wrist') - y(j, 'Knee')) / shin }
  let lo = 30, hi = 110
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) < d) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('the Romanian deadlift drill definition', () => {
  it('keeps the drill contract', () => {
    expect(checkDrill(rdl)).toEqual([])
    expect(rdl.standards.map(s => s.id)).toContain(rdl.defaultStandard)
  })
})

describe.each(YAWS)('the Romanian deadlift filmed at yaw %i°', yaw => {
  const set = (reps, o = {}) => rdlSet(reps, { yaw, ...o })

  it('counts five clean reps, live and in the result', () => {
    const { counted, res } = run(set(same(5, KNEE)))
    expect(counted).toBe(5)
    expect(res.count).toBe(5)
    expect(res.reps).toHaveLength(5)
  })

  it('counts through noise and joints Vision drops now and then', () => {
    expect(run(set(same(6, KNEE), { noise: 0.004, drop: 0.03 })).res.count).toBe(6)
  })

  it('does not count a small bow at the top', () => {
    const frames = set([{ lean: 25, down: 0.6, up: 0.6 }, KNEE, { lean: 30, down: 0.5, up: 0.5 }], { noise: 0.003 })
    expect(run(frames).res.count).toBe(1)
  })

  it('names the depth by the hands: mid-shin, the knees and above', () => {
    const { res } = run(set([DEEP, KNEE, HIGH]), ANY)
    expect(depths(res)).toEqual(['shin', 'knees', 'above'])
    expect(res.summary).toMatchObject({ depthShin: 1, depthKnees: 1, depthAbove: 1 })
  })

  it('knees (the default): counts reps with the hands to the knees, keeps higher ones as no-reps', () => {
    const { counted, missed, missedAt, res } = run(set([DEEP, HIGH, KNEE, DEEP, HIGH]))
    expect([counted, missed]).toEqual([3, 2])
    expect(missedAt.map(m => m.reason)).toEqual(['knees', 'knees'])
    expect(res.reps.map(r => r.counted)).toEqual([true, false, true, true, false])
    expect(res.reps[1].reason).toBe('knees')
    expect(res).toMatchObject({ count: 3, missed: 2, standard: 'knees', cueId: 'missed' })
  })

  it('shin: only reps with the hands to mid-shin count', () => {
    const { res, missedAt } = run(set([DEEP, HIGH, KNEE, DEEP]), { standard: 'shin' })
    expect(res.reps.map(r => r.counted)).toEqual([true, false, false, true])
    expect(missedAt.map(m => m.reason)).toEqual(['shin', 'shin'])
  })

  it('any: every real descent counts', () => {
    const { counted, missed } = run(set([DEEP, HIGH, { lean: 25, down: 0.6, up: 0.6 }, KNEE]), ANY)
    expect([counted, missed]).toEqual([3, 0])
  })

  it('takes the knee line and the mid-shin line at their edges, as filmed from this angle', () => {
    const atKnee = leanForDepth(KNEE_LINE, yaw), atShin = leanForDepth(SHIN_LINE, yaw)
    expect(run(set([{ lean: atKnee + 3, down: 2.5, up: 1.5 }])).res.reps[0]).toMatchObject({ counted: true, measures: { depth: 'knees' } })
    expect(run(set([{ lean: atKnee - 3, down: 2.5, up: 1.5 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'knees', measures: { depth: 'above' } })
    expect(run(set([{ lean: atShin + 3, down: 2.5, up: 1.5 }]), { standard: 'shin' }).res.reps[0]).toMatchObject({ counted: true, measures: { depth: 'shin' } })
    expect(run(set([{ lean: atShin - 3, down: 2.5, up: 1.5 }]), { standard: 'shin' }).res.reps[0]).toMatchObject({ counted: false, reason: 'shin' })
  })

  it('times the way down and up to within a few tenths', () => {
    const { res } = run(set(same(3, { lean: 85, down: 2.5, up: 1.2 }), { noise: 0.002 }))
    // The hands barely move in the first third of a hinge (the hips go back first), so a 2.5 s
    // way down reads about 1.7 s.
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(1.5)
      expect(r.measures.downSec).toBeLessThan(2.9)
      expect(r.measures.upSec).toBeGreaterThan(0.8)
      expect(r.measures.upSec).toBeLessThan(1.6)
    }
    expect(res.summary.avgDown).toBeGreaterThan(res.summary.avgUp)
    expect(res.tiles.find(x => x.id === 'tempo')).toBeTruthy()
  })

  it('says slow the way down when the descent is quicker than a second', () => {
    const { res } = run(set(same(4, { lean: 85, down: 0.6, up: 0.8 })))
    expect(res.summary.avgDown).toBeLessThan(FAST_DOWN_SEC)
    expect(res.cueId).toBe('slower')
  })

  it('says the last reps were shallower when depth falls off', () => {
    expect(run(set([100, 100, 98, 95, 75, 70].map(lean => ({ lean, down: 2.5, up: 1.5 }))), ANY).res.cueId).toBe('fade')
  })

  it('stays neutral when nothing stands out', () => {
    expect(run(set(same(5, KNEE), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the hands once the standard is reached, and not before', () => {
    const { outs } = run(set([KNEE]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftWrist', 'rightWrist'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([HIGH])).outs.some(o => o.reached)).toBe(false)
  })

  it('shows the extras of this view only', () => {
    const { res } = run(set(same(3, KNEE)))
    const view = viewAt(yaw)
    expect(res.view).toBe(view)
    const m = res.reps[0].measures
    expect(m.view).toBe(view)
    expect(m.minKnee != null).toBe(view === 'side')
    expect(m.hinge != null).toBe(view === 'side')
    expect(res.tiles.map(x => x.id)).toEqual(view === 'side' ? ['depth', 'tempo', 'hinge'] : ['depth', 'tempo'])
  })
})

describe('the Romanian deadlift, whatever the angle', () => {
  it('reads a lifter facing the other way the same (yaw 180, 135, -45)', () => {
    for (const yaw of [180, 135, -45]) expect(depths(run(rdlSet([DEEP, KNEE, HIGH], { yaw }), ANY).res)).toEqual(['shin', 'knees', 'above'])
  })

  it('judges the hands the same with the phone high or tipped, from any angle', () => {
    for (const yaw of [0, 45, 90]) {
      for (const cam of [{ height: 1.0 }, { pitch: 12 }]) {
        expect(depths(run(rdlSet([DEEP, KNEE, HIGH], { yaw, ...cam }), ANY).res)).toEqual(['shin', 'knees', 'above'])
      }
    }
  })

  it('does not count anything before the lifter has stood tall once', () => {
    const bent = Array.from({ length: 20 }, () => rdlPose(70))
    const tr = rdl.create()
    for (const [i, p] of bent.entries()) tr.push({ t: i * 66, aspect: CAMERA.aspect, joints: project(p) })
    for (const f of rdlSet(same(2, KNEE), { start: 20 * 66 })) tr.push(f)
    expect(tr.result().count).toBe(2)
  })

  it('marks a rep where the pose was lost, and still counts it whatever depth was seen', () => {
    // Rep 2 of three starts down at 6.2 s; the hands start to drop clearly about 7.8 s, the bottom is at 8.2 s.
    const { res } = run(rdlSet([KNEE, HIGH, KNEE], { gap: [7850, 8250] }))
    expect(res.reps.map(r => [r.lost, r.counted])).toEqual([[false, true], [true, true], [false, true]])
  })

  it('drops a rep the camera lost for good', () => {
    expect(run(rdlSet(same(2, KNEE), { gap: [2000, 5000] })).res.count).toBe(1)
  })

  it('asks to keep the whole body in the frame when most reps lost the pose', () => {
    const both = rdlSet(same(2, KNEE))
    const lost = both.map(f => ((f.t > 2300 && f.t < 2600) || (f.t > 8000 && f.t < 8300) ? { ...f, joints: {} } : f))
    expect(run(lost).res.cueId).toBe('framing')
  })

  it('side-on: the knee angle and the hinge at the bottom, and a cue when the knees bend like a squat', () => {
    const { res } = run(rdlSet(same(3, KNEE)))
    // Drawn: an 80° lean with the knees at 148°.
    expect(res.reps[0].measures.hinge).toBeGreaterThan(72)
    expect(res.reps[0].measures.hinge).toBeLessThan(88)
    expect(res.reps[0].measures.minKnee).toBeGreaterThan(140)
    expect(res.reps[0].measures.minKnee).toBeLessThan(156)
    expect(res.details[0].map(d => d.label)).toEqual(['Depth', 'Tempo', 'Knee angle', 'Hinge'])
    expect(res.tiles[2]).toMatchObject({ id: 'hinge', label: 'Hinge', sub: 'torso from vertical, on average' })
    expect(res.note).toBe('Filmed from the side: depth, tempo, knee angle and hinge.')
    const squatty = run(rdlSet(same(3, { ...KNEE, kneeBend: 1 }))).res
    expect(squatty.reps.every(r => r.measures.minKnee < SQUAT_KNEE)).toBe(true)
    expect(squatty.cueId).toBe('knees')
    expect(squatty.cue).toBe(CUE.knees())
    // At an angle the same knees are not judged.
    expect(run(rdlSet(same(3, { ...KNEE, kneeBend: 1 }), { yaw: 45 })).res.cueId).not.toBe('knees')
  })

  it('has a line for no reps at all, and a no-rep line under each standard', () => {
    expect(run(rdlSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const none = run(rdlSet(same(3, HIGH))).res
    expect(none).toMatchObject({ count: 0, missed: 3, cueId: 'missed' })
    expect(none.cue).toBe('Reps that did not count: 3. The hands stayed above the knees.')
    expect(run(rdlSet(same(2, KNEE)), { standard: 'shin' }).res.cue).toBe('Reps that did not count: 2. The hands did not reach mid-shin.')
  })

  it('says justMissed on the frame the no-rep ends, the one justCounted would be on, and the count stays', () => {
    const frames = rdlSet([HIGH], { yaw: 45 })
    const missedT = run(frames).missedAt[0].t
    const anyTr = rdl.create(ANY)
    expect(frames.find(f => anyTr.push(f).justCounted).t).toBe(missedT)
    expect(run(frames).outs.every(o => o.count === 0)).toBe(true)
  })

  it('reads the depth share of every rep, no-reps included', () => {
    const { res } = run(rdlSet([DEEP, HIGH, KNEE, DEEP, HIGH]))
    expect(depthShare(res.reps, 'knees')).toEqual({ hit: 3, of: 5, depth: 'knees' })
    expect(depthShare(res.reps, 'shin')).toEqual({ hit: 2, of: 5, depth: 'shin' })
    expect(depthShare(null, 'shin')).toEqual({ hit: 0, of: 0, depth: 'shin' })
    expect(res.tiles[0]).toMatchObject({ id: 'depth', label: 'Depth', value: '3 of 5', sub: 'hands to the knees or lower' })
    expect(res.details[1]).toContainEqual({ label: 'Depth', value: 'Hands above the knees' })
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = rdl.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    expect(tr.push({ t: 33, aspect: CAMERA.aspect, joints: project(rdlPose(70), { yaw: 30 }) }).hint).toBe('Stand tall to start')
    const outs = rdlSet([KNEE], { yaw: 30, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('can be held to a view', () => {
    const { res } = run(rdlSet(same(2, KNEE), { yaw: 0 }), { view: 'diagonal' })
    expect(res.view).toBe('diagonal')
    expect(res.reps[0].measures.hinge).toBeUndefined()
  })
})

describe('romanianDeadlift.matches', () => {
  it('takes Romanian and stiff-legged deadlifts, the user\'s dumbbell one first', () => {
    for (const id of ['1459', '0085', '4861', '1543', '0432', '0116', '3733']) expect(rdl.matches(EXIDX[id])).toBe(true)
    expect(rdl.matches({ id: 'c1', n: 'Trap bar Romanian deadlift', cat: 'strength' })).toBe(true)
  })

  it('leaves out deadlifts from the floor, one-legged and staggered ones, good mornings and machines', () => {
    for (const id of ['0032', '0117', '1757', '4971', '4757', '0044', '8712', '9494', '6552', '4113', '1009', '0043']) expect(rdl.matches(EXIDX[id])).toBe(false)
    expect(rdl.matches(null)).toBe(false)
    expect(rdl.matches({ id: 'c2', n: 'Romanian deadlift', cat: 'cardio' })).toBe(false)
  })
})
