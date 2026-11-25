// The split squat drill against synthetic lifters (test-kit.js) filmed from side-on to facing the
// camera: split squats, Bulgarian split squats with the back foot on a bench, and reverse lunges
// stepping out and back; counting, depth and the standards, tempo, cues, the side-on extras, and
// the catalogue.
import { describe, expect, it } from 'vitest'
import split, { CUE, FAST_DOWN_SEC, PARALLEL_R, depthShare, frontLeg } from './split-squat.js'
import { checkDrill } from './index.js'
import { BODY, CAMERA, YAWS, ease, film, project, same } from './test-kit.js'
import { EXIDX } from '../exercises.js'

const rad = d => d * Math.PI / 180

// The knee of a two-link leg from hip `h` to ankle `a`, the one `pick` prefers of the two.
function kneeOf(h, a, l1, l2, pick) {
  const dx = a[0] - h[0], dy = a[1] - h[1], n = Math.hypot(dx, dy)
  const d = Math.min(n, l1 + l2 - 1e-6)
  const ux = dx / n, uy = dy / n
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), off = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const c1 = [h[0] + ux * along - uy * off, h[1] + uy * along + ux * off]
  const c2 = [h[0] + ux * along + uy * off, h[1] + uy * along - ux * off]
  return pick(c1, c2)
}

/**
 * A split stance in body coordinates: the hips at height `H` (metres), `hipU` forward; the front
 * ankle `front` metres ahead on the floor, the back ankle at `rear` [u, v] (on the toes, up on a
 * bench, or in the air mid-step). The front knee bends forward, the back knee down. The torso
 * leans `lean` degrees; `frontSide` names the front leg.
 */
export function splitPose(H, { front = 0.4, rear = [-0.45, 0.12], hipU = 0, lean = 8, frontSide = 'left', body = BODY } = {}) {
  const b = body
  const hip = [hipU, H], fa = [front, b.ankleH]
  const fk = kneeOf(hip, fa, b.thigh, b.shin, (p, q) => (p[0] > q[0] ? p : q))
  const rk = kneeOf(hip, rear, b.thigh, b.shin, (p, q) => (p[1] < q[1] ? p : q))
  const L = rad(lean)
  const sh = [hip[0] + b.torso * Math.sin(L), hip[1] + b.torso * Math.cos(L)]
  const nk = [sh[0] + b.neck * Math.sin(L), sh[1] + b.neck * Math.cos(L)]
  const backSide = frontSide === 'left' ? 'right' : 'left'
  const w = s => (s === 'left' ? 1 : -1)
  const out = { nose: [nk[0] + b.head * 0.6, nk[1] + b.head * 0.7, 0], neck: [nk[0], nk[1], 0] }
  out[frontSide + 'Ankle'] = [fa[0], fa[1], w(frontSide) * 0.1]
  out[backSide + 'Ankle'] = [rear[0], rear[1], w(backSide) * 0.1]
  out[frontSide + 'Knee'] = [fk[0], fk[1], w(frontSide) * 0.1]
  out[backSide + 'Knee'] = [rk[0], rk[1], w(backSide) * 0.1]
  for (const s of ['left', 'right']) {
    out[s + 'Hip'] = [hip[0], hip[1], w(s) * b.hipHalf]
    out[s + 'Shoulder'] = [sh[0], sh[1], w(s) * b.shoulderHalf]
    out[s + 'Elbow'] = [sh[0], sh[1] - 0.3, w(s) * (b.shoulderHalf + 0.02)]
    out[s + 'Wrist'] = [sh[0], sh[1] - 0.58, w(s) * (b.shoulderHalf + 0.03)]
  }
  return out
}

// The stances: a split squat, and a Bulgarian split squat with the back foot on a bench.
const STANCE = {
  split: { top: 0.84, o: {} },
  bulgarian: { top: 0.86, o: { front: 0.3, rear: [-0.6, 0.5], lean: 12 } },
}

/** A set in one stance: `reps` = [{ bottom, down, up }] (the hips' lowest height, seconds down and up). */
function splitSet(reps, { stance = 'split', stand = 1, fps = 15, frontSide = 'left', ...opts } = {}) {
  const { top, o } = STANCE[stance]
  const oo = { ...o, frontSide }
  const poses = []
  const hold = (H, n) => { for (let i = 0; i < n; i++) poses.push(splitPose(H, oo)) }
  hold(top, Math.round(stand * fps))
  for (const r of reps) {
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) poses.push(splitPose(top - (top - r.bottom) * ease(i / dn), oo))
    hold(r.bottom, 2)
    for (let i = 1; i <= up; i++) poses.push(splitPose(r.bottom + (top - r.bottom) * ease(i / up), oo))
    hold(top, Math.round(stand * fps))
  }
  return film(poses, { fps, ...opts })
}

// A reverse lunge, alternating legs: from standing with the feet together, the back foot steps
// back through the air as the hips go back and down, the hips drop to `bottom`, and all of it
// back. Part `f` of the step (0 to 1).
function lungePose(f, H, frontSide) {
  const stepH = 0.94 - (0.94 - 0.86) * f
  const hipU = -0.4 * f
  const rear = [-0.85 * f, 0.08 + 0.04 * f + 0.15 * Math.sin(Math.PI * Math.min(1, f))]
  return splitPose(Math.min(stepH, H), { front: 0, rear, hipU, lean: 6, frontSide })
}
function lungeSet(reps, { stand = 1, fps = 15, ...opts } = {}) {
  const poses = []
  const hold = n => { for (let i = 0; i < n; i++) poses.push(lungePose(0, 0.94, 'left')) }
  hold(Math.round(stand * fps))
  reps.forEach((r, k) => {
    const side = k % 2 ? 'right' : 'left'
    const st = Math.round(0.6 * fps), dn = Math.round(r.down * fps), up = Math.round(r.up * fps)
    for (let i = 1; i <= st; i++) poses.push(lungePose(i / st, 0.94, side))
    for (let i = 1; i <= dn; i++) poses.push(lungePose(1, 0.86 - (0.86 - r.bottom) * ease(i / dn), side))
    for (let i = 0; i < 2; i++) poses.push(lungePose(1, r.bottom, side))
    for (let i = 1; i <= up; i++) poses.push(lungePose(1, r.bottom + (0.86 - r.bottom) * ease(i / up), side))
    for (let i = 1; i <= st; i++) poses.push(lungePose(1 - i / st, 0.94, side))
    hold(Math.round(stand * fps))
  })
  return film(poses, { fps, ...opts })
}

const run = (frames, opts = {}) => {
  const tr = split.create(opts)
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
const FULL = { bottom: 0.48, down: 2, up: 1 }, SHALLOW = { bottom: 0.66, down: 2, up: 1 }
const depths = res => res.reps.map(r => r.measures.depth)
const viewAt = yaw => (yaw === 0 ? 'side' : yaw === 90 ? 'front' : 'diagonal')

// The hips' height at which r (hip over front knee, in front-shin heights) is `d`, filmed at `yaw`.
function hipForR(d, yaw, stance = 'split') {
  const { o } = STANCE[stance]
  const at = H => frontLeg(project(splitPose(H, o), { yaw }), CAMERA.aspect).r
  let lo = 0.4, hi = 0.8
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m) < d) lo = m; else hi = m }
  return (lo + hi) / 2
}

describe('the split squat drill definition', () => {
  it('keeps the drill contract', () => {
    expect(checkDrill(split)).toEqual([])
  })
})

describe.each(YAWS)('the split squat filmed at yaw %i°', yaw => {
  describe.each(['split', 'bulgarian'])('%s stance', stance => {
    const set = (reps, o = {}) => splitSet(reps, { yaw, stance, ...o })

    it('counts five clean reps, live and in the result', () => {
      const { counted, res } = run(set(same(5, FULL)))
      expect(counted).toBe(5)
      expect(res.count).toBe(5)
    })

    it('counts through noise and joints Vision drops now and then', () => {
      expect(run(set(same(6, FULL), { noise: 0.003, drop: 0.03 })).res.count).toBe(6)
    })

    it('does not count a dip at the top', () => {
      const frames = set([{ bottom: 0.79, down: 0.5, up: 0.5 }, FULL, { bottom: 0.8, down: 0.4, up: 0.4 }], { noise: 0.002 })
      expect(run(frames).res.count).toBe(1)
    })

    it('parallel (the default): counts reps down to parallel, keeps shallow ones as no-reps', () => {
      const { counted, missed, missedAt, res } = run(set([FULL, SHALLOW, FULL, SHALLOW]))
      expect([counted, missed]).toEqual([2, 2])
      expect(missedAt.map(m => m.reason)).toEqual(['shallow', 'shallow'])
      expect(depths(res)).toEqual(['parallel', 'above', 'parallel', 'above'])
      expect(res).toMatchObject({ count: 2, missed: 2, standard: 'parallel', cueId: 'missed' })
    })

    it('any: every real descent counts', () => {
      expect(run(set([FULL, SHALLOW, FULL]), ANY).res).toMatchObject({ count: 3, missed: 0 })
    })

    it('takes the parallel band at its edge, as filmed from this angle', () => {
      const edge = hipForR(PARALLEL_R, yaw, stance)
      expect(run(set([{ bottom: edge - 0.015, down: 2, up: 1 }])).res.reps[0]).toMatchObject({ counted: true, measures: { depth: 'parallel' } })
      expect(run(set([{ bottom: edge + 0.015, down: 2, up: 1 }])).res.reps[0]).toMatchObject({ counted: false, reason: 'shallow', measures: { depth: 'above' } })
    })

    it('shows the extras of this view only', () => {
      const { res } = run(set(same(3, FULL)))
      const view = viewAt(yaw)
      expect(res.view).toBe(view)
      const m = res.reps[0].measures
      expect(m.view).toBe(view)
      expect(m.minKnee != null).toBe(view === 'side')
      expect(m.lean != null).toBe(view === 'side')
      expect(res.tiles.map(x => x.id)).toEqual(view === 'side' ? ['depth', 'tempo', 'consistency'] : ['depth', 'tempo'])
    })
  })

  const set = (reps, o = {}) => splitSet(reps, { yaw, ...o })

  it('counts with either leg in front', () => {
    expect(run(set(same(3, FULL), { frontSide: 'right' })).res.count).toBe(3)
  })

  it('counts alternating reverse lunges and judges each', () => {
    const { res } = run(lungeSet([FULL, FULL, SHALLOW, FULL], { yaw }))
    expect(res.reps.map(r => r.counted)).toEqual([true, true, false, true])
  })

  it('times the way down and up to within a few tenths', () => {
    const { res } = run(set(same(3, { bottom: 0.48, down: 2.5, up: 1.2 }), { noise: 0.002 }))
    for (const r of res.reps) {
      expect(r.measures.downSec).toBeGreaterThan(1.8)
      expect(r.measures.downSec).toBeLessThan(2.9)
      expect(r.measures.upSec).toBeGreaterThan(0.7)
      expect(r.measures.upSec).toBeLessThan(1.6)
    }
  })

  it('says slow the way down when the descent is quicker than a second', () => {
    const { res } = run(set(same(4, { bottom: 0.48, down: 0.6, up: 0.8 })))
    expect(res.summary.avgDown).toBeLessThan(FAST_DOWN_SEC)
    expect(res.cueId).toBe('slower')
  })

  it('says the last reps were shallower when depth falls off', () => {
    expect(run(set([0.46, 0.46, 0.47, 0.5, 0.58, 0.62].map(bottom => ({ bottom, down: 2, up: 1 }))), ANY).res.cueId).toBe('fade')
  })

  it('stays neutral when nothing stands out', () => {
    expect(run(set(same(5, FULL), { noise: 0.002 })).res.cueId).toBe('steady')
  })

  it('lights the front knee and the hips once parallel is reached, and not before', () => {
    const { outs } = run(set([FULL]))
    const first = outs.findIndex(o => o.reached)
    expect(first).toBeGreaterThan(0)
    expect(outs[first].highlight).toEqual(['leftKnee', 'leftHip', 'rightHip'])
    expect(outs.at(-1)).toMatchObject({ reached: false, highlight: [] })
    expect(run(set([SHALLOW])).outs.some(o => o.reached)).toBe(false)
  })
})

describe('the split squat, whatever the angle', () => {
  it('reads a lifter facing the other way the same (yaw 180, 135, -45)', () => {
    for (const yaw of [180, 135, -45]) expect(depths(run(splitSet([FULL, SHALLOW], { yaw }), ANY).res)).toEqual(['parallel', 'above'])
  })

  it('does not count stepping into the split stance', () => {
    // Feet together, then the back foot steps back and stays: no descent of the front leg.
    const poses = []
    for (let i = 0; i < 15; i++) poses.push(lungePose(0, 0.94, 'left'))
    for (let i = 1; i <= 9; i++) poses.push(lungePose(i / 9, 0.94, 'left'))
    for (let i = 0; i < 15; i++) poses.push(lungePose(1, 0.94, 'left'))
    for (const yaw of [0, 45]) {
      const frames = film(poses, { yaw })
      const tr = split.create()
      for (const f of frames) tr.push(f)
      for (const f of splitSet(same(2, FULL), { yaw, start: frames.at(-1).t + 66, stance: 'split' })) tr.push(f)
      expect(tr.result()).toMatchObject({ count: 2, missed: 0 })
    }
  })

  it('picks the front leg: not the foot on the bench, not the back knee, not a foot in the air', () => {
    const bul = frontLeg(project(splitPose(0.5, STANCE.bulgarian.o)), CAMERA.aspect)
    expect(bul.side).toBe('left')
    const low = frontLeg(project(splitPose(0.48)), CAMERA.aspect)
    expect(low.side).toBe('left')
    expect(low.r).toBeLessThan(PARALLEL_R)
    const mid = frontLeg(project(lungePose(0.5, 0.94, 'right')), CAMERA.aspect)
    expect(mid.side).toBe('right')
    expect(frontLeg({}, 1)).toBeNull()
    // With the front ankle missed, the back leg is not taken for the front one.
    const { leftAnkle, ...noFront } = project(splitPose(0.48))
    expect(frontLeg(noFront, CAMERA.aspect, 'left')).toBeNull()
    // and alone the back leg cannot be read: its knee is under its own ankle.
    expect(frontLeg(noFront, CAMERA.aspect)).toBeNull()
  })

  it('keeps counting when the front ankle is missed for a few frames at the bottom', () => {
    for (const yaw of [0, 45, 90]) {
      const frames = splitSet([FULL, FULL], { yaw }).map((f, i) => {
        if (i % 3) return f
        const { leftAnkle, ...rest } = f.joints
        return { ...f, joints: rest }
      })
      const { res } = run(frames)
      expect(res.count).toBe(2)
      expect(depths(res)).toEqual(['parallel', 'parallel'])
    }
  })

  it('does not count anything before the lifter has stood tall once', () => {
    const tr = split.create()
    for (let i = 0; i < 20; i++) tr.push({ t: i * 66, aspect: CAMERA.aspect, joints: project(splitPose(0.5)) })
    for (const f of splitSet(same(2, FULL), { start: 20 * 66 })) tr.push(f)
    expect(tr.result().count).toBe(2)
  })

  it('marks a rep where the pose was lost, and still counts it whatever depth was seen', () => {
    // Rep 2 starts down at 5.2 s, the bottom at 7.2 s.
    const { res } = run(splitSet([FULL, SHALLOW, FULL], { gap: [6200, 6700] }))
    expect(res.reps.map(r => [r.lost, r.counted])).toEqual([[false, true], [true, true], [false, true]])
  })

  it('drops a rep the camera lost for good', () => {
    expect(run(splitSet(same(2, FULL), { gap: [1800, 4800] })).res.count).toBe(1)
  })

  it('asks to keep the whole body in the frame when most reps lost the pose', () => {
    const lost = splitSet(same(2, FULL)).map(f => ((f.t > 2000 && f.t < 2300) || (f.t > 6200 && f.t < 6500) ? { ...f, joints: {} } : f))
    expect(run(lost).res.cueId).toBe('framing')
  })

  it('says go deeper when most reps stop above parallel', () => {
    const { res } = run(splitSet(same(4, SHALLOW), { yaw: 45 }), ANY)
    expect(res.cueId).toBe('deeper')
    expect(res.cue).toBe(CUE.deeper())
  })

  it('side-on: the front knee at the bottom, the torso lean and the spread', () => {
    const { res } = run(splitSet([{ bottom: 0.48, down: 2, up: 1 }, { bottom: 0.53, down: 2, up: 1 }, FULL]))
    expect(res.reps[0].measures.minKnee).toBeGreaterThan(70)
    expect(res.reps[0].measures.minKnee).toBeLessThan(95)
    expect(res.reps[0].measures.lean).toBeGreaterThan(4)
    expect(res.reps[0].measures.lean).toBeLessThan(14)
    expect(res.summary.consistency).toBeGreaterThan(3)
    expect(res.details[0].map(d => d.label)).toEqual(['Depth', 'Tempo', 'Front knee', 'Lean'])
    expect(res.note).toBe('Filmed from the side: depth, tempo, front knee angle and torso lean.')
    expect(run(splitSet([FULL])).res.tiles.map(x => x.id)).toEqual(['depth', 'tempo', 'lean'])
  })

  it('outside a side view, asks for the phone at knee height and leaves depth unjudged when it is not', () => {
    for (const cam of [{ height: 0.95 }, { pitch: 15 }]) {
      const { outs, res } = run(splitSet(same(3, SHALLOW), { yaw: 90, ...cam }))
      expect(outs.some(o => o.hint === 'Put the phone at knee height and level')).toBe(true)
      expect(res).toMatchObject({ count: 3, missed: 0, cueId: 'level' })
      expect(depths(res)).toEqual([null, null, null])
    }
    const side = run(splitSet([SHALLOW], { yaw: 0, height: 0.95 }))
    expect(side.res.missed).toBe(1)
  })

  it('has a line for no reps at all, and a no-rep line when every rep missed', () => {
    expect(run(splitSet([])).res).toMatchObject({ count: 0, cueId: 'none', tiles: [] })
    const none = run(splitSet(same(3, SHALLOW))).res
    expect(none).toMatchObject({ count: 0, missed: 3, cueId: 'missed' })
    expect(none.cue).toBe('Reps that did not count: 3. The front thigh did not get to parallel.')
  })

  it('says justMissed on the frame the no-rep ends, the one justCounted would be on', () => {
    const frames = splitSet([SHALLOW], { yaw: 45 })
    const missedT = run(frames).missedAt[0].t
    const anyTr = split.create(ANY)
    expect(frames.find(f => anyTr.push(f).justCounted).t).toBe(missedT)
  })

  it('reads the depth share of every judged rep, no-reps included', () => {
    const { res } = run(splitSet([FULL, SHALLOW, FULL]))
    expect(depthShare(res.reps)).toEqual({ hit: 2, of: 3 })
    expect(depthShare(null)).toEqual({ hit: 0, of: 0 })
    expect(res.tiles[0]).toMatchObject({ id: 'depth', label: 'Depth', value: '2 of 3', sub: 'front thigh to parallel' })
  })

  it('tells the lifter what to do on the status line', () => {
    const tr = split.create()
    expect(tr.push({ t: 0, joints: {} })).toMatchObject({ inFrame: false, hint: 'Step into the frame' })
    expect(tr.push({ t: 33, aspect: CAMERA.aspect, joints: project(splitPose(0.5), { yaw: 30 }) }).hint).toBe('Stand tall to start')
    const outs = splitSet([FULL], { yaw: 30, start: 66 }).map(f => tr.push(f))
    expect(outs[10].hint).toBe('Ready. Go when you are.')
    expect(outs.at(-1)).toMatchObject({ inFrame: true, hint: '', count: 1 })
  })

  it('can be held to a view', () => {
    const { res } = run(splitSet(same(2, FULL), { yaw: 0 }), { view: 'diagonal' })
    expect(res.view).toBe('diagonal')
    expect(res.reps[0].measures.minKnee).toBeUndefined()
  })
})

describe('splitSquat.matches', () => {
  it('takes split squats, Bulgarian split squats and lunges in place, the user\'s Bulgarian first', () => {
    for (const id of ['2290', '0781', '2960', '3691', '7549', '0612', '0336', '1581', '0078', '4000']) expect(split.matches(EXIDX[id])).toBe(true)
    expect(split.matches({ id: 'c1', n: 'Goblet reverse lunge', cat: 'strength' })).toBe(true)
  })

  it('leaves out walking, jumping, sideways and crossing lunges, holds, machines and the squat', () => {
    for (const id of ['1460', '4295', '3582', '1410', '0881', '10906', '9042', '10328', '3356', '0043', '1459']) expect(split.matches(EXIDX[id])).toBe(false)
    expect(split.matches(null)).toBe(false)
    expect(split.matches({ id: 'c2', n: 'Lunge', cat: 'cardio' })).toBe(false)
  })
})
