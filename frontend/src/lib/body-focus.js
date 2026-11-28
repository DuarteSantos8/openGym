// Today's body picker (Ironvane): tap where you want to get stronger, see the exercises for it.
//
// The picker works on areas people point at ("shoulders", "back of thighs"), each one a handful of
// the muscles the body map draws (lib/muscles.js MUSCLES). Every muscle sits in exactly one area,
// so a tap on the drawn map and a tap on a photo pick the same thing, and the explorer is opened
// on the areas' muscles with "any of them" (views/Muscles.jsx ?m=).
//
// On a photo the areas are drawn from the pose model's landmarks (MediaPipe's 33 points, the same
// model the Movement Lab ships): circles on the shoulders, capsules along the limbs, polygons on
// the torso. Sizes follow the body (shoulder width), never the frame, so a wide photo keeps round
// circles. Pure: no DOM, no model, no storage beyond the one Storage-like argument.
import { MUSCLES } from './muscles.js'
import { MUSCLE_GROUPS, groupTerm } from './muscle-filter.js'

/** Head to toe. `name` is an i18n key; most are the map's own muscle names. */
export const AREAS = [
  { id: 'traps', name: 'Traps', muscles: ['trapezius'] },
  { id: 'shoulders', name: 'Shoulders', muscles: ['front-delts', 'side-delts', 'rear-delts'] },
  { id: 'chest', name: 'Chest', muscles: ['chest', 'serratus'] },
  { id: 'upper-back', name: 'Upper back', muscles: ['lats', 'upper-back'] },
  { id: 'biceps', name: 'Biceps', muscles: ['biceps'] },
  { id: 'triceps', name: 'Triceps', muscles: ['triceps'] },
  { id: 'forearms', name: 'Forearms', muscles: ['forearm'] },
  { id: 'core', name: 'Core', muscles: ['abs', 'obliques'] },
  { id: 'lower-back', name: 'Lower back', muscles: ['lower-back'] },
  { id: 'glutes', name: 'Glutes', muscles: ['gluteal'] },
  { id: 'quads', name: 'Front of thighs', muscles: ['quadriceps', 'adductors', 'hip-flexors'] },
  { id: 'hamstrings', name: 'Back of thighs', muscles: ['hamstring'] },
  { id: 'calves', name: 'Calves', muscles: ['calves', 'tibialis'] },
]
export const AREA = Object.fromEntries(AREAS.map(a => [a.id, a]))
const ORDER = AREAS.map(a => a.id)
const BY_MUSCLE = Object.fromEntries(AREAS.flatMap(a => a.muscles.map(m => [m, a.id])))

/** The areas each photo shows, head to toe. */
export const VIEW_AREAS = Object.freeze({
  front: ['shoulders', 'chest', 'biceps', 'forearms', 'core', 'quads', 'calves'],
  back: ['traps', 'shoulders', 'upper-back', 'triceps', 'forearms', 'lower-back', 'glutes', 'hamstrings', 'calves'],
})
export const VIEWS = ['front', 'back']

/** The area a map muscle belongs to, or null (the head, the hands). */
export const areaOfMuscle = slug => BY_MUSCLE[slug] || null

const inOrder = ids => ORDER.filter(id => ids.includes(id))

/** The picked areas with `id` tapped: added or taken off. Unknown ids change nothing. */
export function toggleArea(areas, id) {
  const cur = Array.isArray(areas) ? areas : []
  if (!AREA[id]) return inOrder(cur)
  return inOrder(cur.includes(id) ? cur.filter(a => a !== id) : [...cur, id])
}

/** Every muscle of the picked areas, in the map's head-to-toe order (the explorer's filter). */
export const focusMuscles = areas => MUSCLES.filter(m => (areas || []).some(id => AREA[id]?.muscles.includes(m)))

/**
 * The session builder's terms: an area that is exactly one of the explorer's groups goes as that
 * group ("Shoulders", not three delts), the others as their muscles. Same muscles either way.
 */
export function builderTerms(areas) {
  const out = []
  for (const id of inOrder(Array.isArray(areas) ? areas : [])) {
    const ms = AREA[id].muscles
    const g = MUSCLE_GROUPS.find(gr => gr.muscles.length === ms.length && gr.muscles.every(m => ms.includes(m)))
    if (g) out.push(groupTerm(g.id)); else out.push(...ms)
  }
  return out
}

/** The explorer opened on the picked areas (views/Muscles.jsx reads ?m= as "any of these"). */
export const exploreHref = areas => '/muscles?m=' + focusMuscles(areas).join(',')

// ---- Remembered on this device -------------------------------------------------------------
// Device-local on purpose: the picks are a starting point on this screen, not training data, so
// they stay out of the synced profile (and its merge rules) entirely.
export const FOCUS_KEY = 'iv_body_focus'
const clean = v => ({
  areas: inOrder(Array.isArray(v?.areas) ? v.areas.filter(id => typeof id === 'string' && AREA[id]) : []),
  view: VIEWS.includes(v?.view) ? v.view : 'front',
})
export function loadFocus(storage) {
  try { return clean(JSON.parse(storage?.getItem(FOCUS_KEY) || 'null')) } catch { return clean(null) }
}
export function saveFocus(storage, focus) {
  try { storage?.setItem(FOCUS_KEY, JSON.stringify(clean(focus))) } catch { /* private window, full storage */ }
}

// ---- Photo geometry -------------------------------------------------------------------------
// MediaPipe pose indices. In a front photo the person's left is on the image's right; the shapes
// are symmetric, so a mirrored or back-facing labelling draws the same picture.
const L_SHOULDER = 11, R_SHOULDER = 12, L_ELBOW = 13, R_ELBOW = 14, L_WRIST = 15, R_WRIST = 16
const L_HIP = 23, R_HIP = 24, L_KNEE = 25, R_KNEE = 26, L_ANKLE = 27, R_ANKLE = 28, L_EAR = 7, R_EAR = 8
const NEEDED = [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST, L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE]
const MIN_VISIBILITY = 0.5
const MIN_SHOULDER_PX = 24

const usable = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && (p.visibility == null || p.visibility >= MIN_VISIBILITY)
  && p.x >= -0.02 && p.x <= 1.02 && p.y >= -0.02 && p.y <= 1.02

/**
 * Why a photo's landmarks cannot carry the picker, or null when they can:
 * 'none' (no body found), 'partial' (a joint the areas hang on is hidden or out of the frame),
 * 'small' (the body is too small in the picture to tap). `w`, `h`: the photo in pixels.
 */
export function poseProblem(landmarks, w, h) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) return 'none'
  if (NEEDED.some(i => !usable(landmarks[i]))) return 'partial'
  const a = landmarks[L_SHOULDER], b = landmarks[R_SHOULDER]
  if (Math.hypot((a.x - b.x) * w, (a.y - b.y) * h) < MIN_SHOULDER_PX) return 'small'
  return null
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const towards = (p, q, d) => {
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
  return { x: p.x + (q.x - p.x) / len * d, y: p.y + (q.y - p.y) / len * d }
}
const xy = p => [p.x, p.y]

/**
 * The areas of one view as shapes in the photo's pixels, topmost first: the order a tap is
 * resolved in (a renderer paints them in reverse). Each is { area, kind, … }:
 *   circle  { cx, cy, r }   capsule { x1, y1, x2, y2, r }   poly { pts: [[x, y], …] }
 * Call only when poseProblem() is null.
 */
export function areasFromPose(landmarks, w, h, view = 'front') {
  const P = i => ({ x: landmarks[i].x * w, y: landmarks[i].y * h })
  const ls = P(L_SHOULDER), rs = P(R_SHOULDER), lh = P(L_HIP), rh = P(R_HIP)
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const back = view === 'back'
  // A band across the torso between t0 and t1 (0 = shoulder line, 1 = hip line), pulled in
  // from the body's outline by `inset` shoulder widths so the arms keep their own taps.
  const band = (t0, t1, inset) => {
    const at = t => {
      const l = lerp(ls, lh, t), r = lerp(rs, rh, t), mid = lerp(l, r, 0.5)
      return [towards(l, mid, inset * sw), towards(r, mid, inset * sw)]
    }
    const [l0, r0] = at(t0), [l1, r1] = at(t1)
    return [xy(l0), xy(r0), xy(r1), xy(l1)]
  }
  const shapes = []
  const pair = (area, make) => { shapes.push({ area, ...make('l') }, { area, ...make('r') }) }
  const limb = (a, b, r) => side => {
    const p = P(side === 'l' ? a[0] : a[1]), q = P(side === 'l' ? b[0] : b[1])
    return { kind: 'capsule', x1: p.x, y1: p.y, x2: q.x, y2: q.y, r: r * sw }
  }
  pair('shoulders', side => { const p = side === 'l' ? ls : rs; return { kind: 'circle', cx: p.x, cy: p.y, r: 0.28 * sw } })
  pair('forearms', limb([L_ELBOW, R_ELBOW], [L_WRIST, R_WRIST], 0.12))
  pair(back ? 'triceps' : 'biceps', limb([L_SHOULDER, R_SHOULDER], [L_ELBOW, R_ELBOW], 0.15))
  pair('calves', limb([L_KNEE, R_KNEE], [L_ANKLE, R_ANKLE], 0.13))
  if (back) {
    // The seat: from low on the back to a quarter of the way down the thighs, a little wider than the hips.
    const lk = P(L_KNEE), rk = P(R_KNEE)
    const [l85, r85] = [lerp(ls, lh, 0.85), lerp(rs, rh, 0.85)]
    const ll = lerp(lh, lk, 0.28), rl = lerp(rh, rk, 0.28)
    const out = (p, from) => towards(p, { x: 2 * p.x - from.x, y: p.y }, 0.2 * sw)
    shapes.push({ area: 'glutes', kind: 'poly', pts: [xy(l85), xy(r85), xy(out(rl, ll)), xy(out(ll, rl))] })
  }
  pair(back ? 'hamstrings' : 'quads', limb([L_HIP, R_HIP], [L_KNEE, R_KNEE], 0.2))
  if (back) {
    // Traps: from the shoulder line halfway up to the ears (or a guess at the neck without them).
    const sm = lerp(ls, rs, 0.5)
    const ears = usable(landmarks[L_EAR]) && usable(landmarks[R_EAR]) ? lerp(P(L_EAR), P(R_EAR), 0.5) : { x: sm.x, y: sm.y - 0.9 * sw }
    const top = lerp(sm, ears, 0.45)
    const across = towards(ls, rs, 0.1 * sw), d = { x: across.x - ls.x, y: across.y - ls.y }
    // Round the trapezoid: bottom left, bottom right, top right, top left (any other order crosses itself).
    shapes.push({ area: 'traps', kind: 'poly', pts: [xy(lerp(ls, rs, 0.18)), xy(lerp(rs, ls, 0.18)), [top.x + d.x, top.y + d.y], [top.x - d.x, top.y - d.y]] })
    shapes.push({ area: 'upper-back', kind: 'poly', pts: band(0, 0.55, 0.08) })
    shapes.push({ area: 'lower-back', kind: 'poly', pts: band(0.55, 0.85, 0.15) })
  } else {
    shapes.push({ area: 'chest', kind: 'poly', pts: band(0, 0.38, 0.1) })
    shapes.push({ area: 'core', kind: 'poly', pts: band(0.38, 0.98, 0.1) })
  }
  return shapes
}

function inPoly(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function segDist(s, x, y) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1
  const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy))
}
const hits = (s, x, y) => s.kind === 'circle' ? Math.hypot(x - s.cx, y - s.cy) <= s.r
  : s.kind === 'capsule' ? segDist(s, x, y) <= s.r
    : inPoly(s.pts, x, y)

/** The area under a tap at (x, y) in the photo's pixels, or null. */
export function hitArea(shapes, x, y) {
  for (const s of shapes || []) if (hits(s, x, y)) return s.area
  return null
}

/**
 * A tap at (cx, cy) on screen, in the photo's own pixels. The picture (w × h) is drawn into `rect`
 * the way SVG's default xMidYMid meet and object-fit: contain draw it: scaled to fit, centred, so a
 * box of another shape shows bars. Null on a bar or for a box with no size.
 */
export function toPhoto(rect, w, h, cx, cy) {
  if (!rect?.width || !rect?.height || !w || !h) return null
  const s = Math.min(rect.width / w, rect.height / h)
  const x = (cx - rect.left - (rect.width - w * s) / 2) / s
  const y = (cy - rect.top - (rect.height - h * s) / 2) / s
  return x < 0 || y < 0 || x > w || y > h ? null : { x, y }
}
