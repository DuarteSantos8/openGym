// The body map's regions as the muscle model draws them (1.4.5, #638): body-paths.js is the
// MuscleMap geometry as generated, with one "deltoids" and one "upper-back" per view; this splits
// them into the shoulder heads and the lats, by path, without touching the generated file.
//
//   - the lats are the two tall paths at the bottom of the back's "upper-back" (they reach down
//     to the waist); the small ones above them stay the upper back
//   - a shoulder seen from the back is the rear head; from the front, the front head, and on the
//     female front, which draws two paths a side, the outer one is the side head
//   - where a view has no path of the side head of its own, its front or rear head is shaded with
//     the side head too (`blend`): a lateral raise lights up the shoulder from both sides, a rear
//     delt fly only from the back
//
// Imported dynamically, like body-paths.js, so its ~90 KB land only where a map is drawn.
import PATHS from './body-paths.js'

// Indices into body-paths.js, checked by body-geometry.test.js against the paths' own heights.
const SPLIT = {
  male: {
    front: { deltoids: { 'front-delts': [0, 1] } },
    back: { deltoids: { 'rear-delts': [0, 1] }, 'upper-back': { lats: [1, 5], 'upper-back': [0, 2, 3, 4] } },
  },
  female: {
    front: { deltoids: { 'side-delts': [0, 2], 'front-delts': [1, 3] } },
    back: { deltoids: { 'rear-delts': [0, 1] }, 'upper-back': { lats: [1, 3], 'upper-back': [0, 2] } },
  },
}
export { SPLIT as BODY_SPLIT }

function splitView(view, rules) {
  const p = { ...view.p }
  for (const [from, to] of Object.entries(rules || {})) {
    const list = view.p[from] || []
    delete p[from]
    for (const [slug, idx] of Object.entries(to)) p[slug] = [...(p[slug] || []), ...idx.map(i => list[i]).filter(Boolean)]
  }
  const blend = {}
  if (!p['side-delts']) for (const head of ['front-delts', 'rear-delts']) if (p[head]) blend[head] = ['side-delts']
  return { ...view, p, blend }
}

export function splitBody(paths = PATHS) {
  const out = {}
  for (const [body, views] of Object.entries(paths)) {
    out[body] = {}
    for (const [side, view] of Object.entries(views)) out[body][side] = splitView(view, SPLIT[body]?.[side])
  }
  return out
}

export { regionLevel } from './body-geometry-level.js'

export default splitBody()
