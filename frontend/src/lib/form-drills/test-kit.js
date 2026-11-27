// Synthetic lifters for drill tests (README.md): a 3D stick figure posed from joint angles, turned
// by a camera yaw and filmed through a pinhole camera into the frames FormCheckPlugin.swift emits,
// { t, aspect, joints: { leftHip: [x, y, conf], ... } } in normalised image coordinates, y down.
// Test-only: no app code imports it.
//
// Body coordinates, metres: u forward (where the lifter faces), v up from the floor, w towards the
// lifter's left. The camera stands `dist` in front of the origin at `height`, looking at it, tipped
// down by `pitch` degrees. `yaw` turns the lifter about the vertical: 0 is side-on (facing image
// right, the right side nearest the camera), 90 faces the camera, 180 is side-on the other way.
const rad = d => d * Math.PI / 180

/**
 * Segment lengths and widths in metres: a lifter of about 1.75 m. `hipMark`: how far up the torso
 * from the hip joint Vision puts the hip once the hip is bent through a deep squat (at the joint
 * standing tall). Vision's hip sits on the pelvis, above the crease: filmed side-on, real squats
 * with the crease level with the knee read the hip about 0.2 thigh lengths above it (markHip).
 */
export const BODY = {
  ankleH: 0.08, shin: 0.43, thigh: 0.43, torso: 0.5, neck: 0.12, head: 0.14,
  hipHalf: 0.1, shoulderHalf: 0.19, stanceHalf: 0.15, hipMark: 0.13,
}

/**
 * Where Vision puts the hip: the joint `hipP` ([u, v]) moved up the torso (leaning `lean` radians
 * forward) by `bend` (0 standing tall, 1 deep in the hip, kept in between) of `body.hipMark`.
 */
export function markHip(hipP, lean, bend, body = BODY) {
  const d = body.hipMark * Math.max(0, Math.min(1, bend))
  return [hipP[0] + d * Math.sin(lean), hipP[1] + d * Math.cos(lean)]
}

/** The camera as the drills ask for it: at knee height, level. `fov` is the vertical field of view, `aspect` the frame's width / height (portrait). */
export const CAMERA = { dist: 2.6, height: 0.5, pitch: 0, fov: 64, aspect: 0.75 }

/** Seeded random numbers in [0, 1), so a noisy test fails the same way every time. */
export function seeded(seed = 1) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

/** Half a cosine from 0 to 1: how a rep speeds up and slows down. */
export const ease = f => (1 - Math.cos(Math.PI * f)) / 2

/**
 * A squat in body coordinates from the knee angle (180 straight). The shin tips forward a quarter
 * of the bend and the torso leans 0.4 of it, so the thigh is level (parallel) at about 60.
 * The hip is where Vision puts it (markHip), so a parallel squat reads it above the knee.
 * `cave` (0 to 1) pulls the knees in from over the feet to well inside the ankles at the bottom;
 * `shift` moves the hips sideways, metres towards the lifter's left.
 */
export function squatPose(knee, { cave = 0, shift = 0, body = BODY } = {}) {
  const b = body
  const a = rad((180 - knee) / 4)
  const kneeP = [b.shin * Math.sin(a), b.ankleH + b.shin * Math.cos(a)]
  const dir = -Math.PI / 2 - a - rad(knee)          // knee to hip: knee to ankle turned back by the knee angle
  const hipP = [kneeP[0] + b.thigh * Math.cos(dir), kneeP[1] + b.thigh * Math.sin(dir)]
  const lean = rad((180 - knee) * 0.4)
  const shP = [hipP[0] + b.torso * Math.sin(lean), hipP[1] + b.torso * Math.cos(lean)]
  const neckP = [shP[0] + b.neck * Math.sin(lean), shP[1] + b.neck * Math.cos(lean)]
  const noseP = [neckP[0] + b.head * 0.6, neckP[1] + b.head * 0.7]
  const bend = Math.min(1, (180 - knee) / 120)
  const kneeOut = b.hipHalf + (b.stanceHalf - b.hipHalf) / 2 + 0.1 * bend
  const kneeHalf = kneeOut + (0.6 * b.stanceHalf - kneeOut) * cave * bend
  const out = { nose: [noseP[0], noseP[1], shift / 2], neck: [neckP[0], neckP[1], shift / 2] }
  const pair = (name, p, half, w0 = 0) => {
    out['left' + name] = [p[0], p[1], w0 + half]
    out['right' + name] = [p[0], p[1], w0 - half]
  }
  pair('Ankle', [0, b.ankleH], b.stanceHalf)
  pair('Knee', kneeP, kneeHalf, shift * bend * 0.5)
  pair('Hip', markHip(hipP, lean, ((176 - knee) / 116) ** 2, b), b.hipHalf, shift * bend)
  pair('Shoulder', shP, b.shoulderHalf, shift * bend)
  return out
}

/**
 * Films one 3D pose: turned by `yaw`, through the camera (CAMERA, overridable). The far side is
 * seen less surely the more side-on the view, as Vision does. `noise` jitters x and y (image
 * units), `drop` loses each joint with that chance; `rnd` is the random source.
 */
export function project(pose, { yaw = 0, rnd = Math.random, noise = 0, drop = 0, ...cam } = {}) {
  const c = { ...CAMERA, ...cam }
  const y = rad(yaw), p = rad(c.pitch)
  const fwd = [Math.cos(y), 0, Math.sin(y)], left = [Math.sin(y), 0, -Math.cos(y)]
  const k = 1 / (2 * Math.tan(rad(c.fov) / 2))
  // Which side is away from the camera (+z is towards it): the left one when it points away.
  const farSide = left[2] < 0 ? 'left' : 'right'
  const farConf = 0.9 * (1 - 0.65 * Math.abs(Math.cos(y)))
  const joints = {}
  for (const [name, [u, v, w]] of Object.entries(pose)) {
    if (drop && rnd() < drop) continue
    const X = u * fwd[0] + w * left[0], Y = v, Z = u * fwd[2] + w * left[2]
    const rx = X, ry = Y - c.height, rz = Z - c.dist
    const zc = ry * -Math.sin(p) - rz * Math.cos(p)          // along the camera's view
    const yc = ry * Math.cos(p) - rz * Math.sin(p)           // camera up
    const jx = noise ? (rnd() - 0.5) * 2 * noise : 0, jy = noise ? (rnd() - 0.5) * 2 * noise : 0
    const x = 0.5 + (rx / zc) * k / c.aspect + jx
    const yy = 0.5 - (yc / zc) * k + jy
    const conf = name.startsWith(farSide) ? farConf : 0.9
    joints[name] = [x, yy, Math.round(conf * 100) / 100]
  }
  return joints
}

/**
 * Frames from a list of poses at `fps`, starting at `start` ms, filmed with `opts` (project).
 * `gap: [from, to]` empties the frames in that window of ms: the pose lost.
 */
export function film(poses, { fps = 15, start = 0, seed = 7, gap = null, ...opts } = {}) {
  const c = { ...CAMERA, ...opts }
  const rnd = seeded(seed)
  return poses.map((pose, i) => {
    const t = Math.round(start + i * 1000 / fps)
    const lost = gap && t >= gap[0] && t < gap[1]
    return { t, aspect: c.aspect, joints: lost ? {} : project(pose, { ...opts, rnd }) }
  })
}

/**
 * A set of squats: `reps` = [{ min, down, up, cave, shift }] (the bottom knee angle, seconds down
 * and up), standing `stand` seconds before, between and after. Filmed with `opts` (film).
 */
export function squatSet(reps, { stand = 1, fps = 15, top = 176, ...opts } = {}) {
  const poses = []
  const hold = (knee, n, o) => { for (let i = 0; i < n; i++) poses.push(squatPose(knee, o)) }
  hold(top, Math.round(stand * fps))
  for (const r of reps) {
    const o = { cave: r.cave || 0, shift: r.shift || 0 }
    const dn = Math.max(2, Math.round(r.down * fps)), up = Math.max(2, Math.round(r.up * fps))
    for (let i = 1; i <= dn; i++) poses.push(squatPose(top - (top - r.min) * ease(i / dn), o))
    hold(r.min, 2, o)
    for (let i = 1; i <= up; i++) poses.push(squatPose(r.min + (top - r.min) * ease(i / up), o))
    hold(top, Math.round(stand * fps))
  }
  return film(poses, { fps, ...opts })
}

/** `n` copies of one rep. */
export const same = (n, r) => Array.from({ length: n }, () => ({ ...r }))

/** The yaws every drill test runs at, side-on to facing the camera. */
export const YAWS = [0, 30, 45, 60, 90]
