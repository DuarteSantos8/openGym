/* The exercise catalogue the Coach reasons over, in the five fields it needs.
 *
 * `library-data.js` is generated from the frontend dataset and committed (see
 * scripts/build-coach-assets.mjs) — the same arrangement the translated instruction packs use.
 * It is an ES module rather than JSON on purpose: bare node needs createRequire for JSON, Vite
 * needs an import attribute, and this file has to load under both without either knowing.
 */
import { EXERCISES } from './library-data.js';

export const LIBRARY = EXERCISES;
export const LIB_BY_ID = new Map(LIBRARY.map(e => [e.id, e]));

export const libraryHas = id => LIB_BY_ID.has(id);
export const libraryName = id => LIB_BY_ID.get(id)?.n || null;

/* ---------- the library slice the model gets to choose from ----------
   Bounded. The whole catalogue is 1,324 rows — 10k+ tokens on every job, which costs real money
   against a cloud API and does not fit a small local model's context at all; and a model does
   not choose better from 1,324 options than from 160. So the slice is capped and balanced: a
   weighted share of every body part, in catalogue order (deterministic, so repeated jobs keep
   the same prefix), with the exercises already in the user's plan or history always included —
   a review has to be able to name what it is talking about. */
export const MAX_LIBRARY = 160;

// What one library entry tells the model: enough to pick it, nothing more. The taxonomy
// fields beyond body part never appear in a rationale and cost ~30 tokens an entry.
const slim = e => ({ id: e.id, n: e.n, bp: e.bp, ...(e.custom ? { custom: true } : {}) });

/* Mobility work is not what a plan is built from, and at an even share per body part the
   catalogue's 57 stretches crowded out the lifts that are: a first plan for someone who
   stated no equipment arrived with "upper legs" as five stretches, a balance board and some
   band work — no squat, no hinge, no lunge anywhere in the lane.

   Dropped from the candidate pool, never from the catalogue. One already in someone's plan or
   history is pinned by `keep` below and still travels, because a review has to be able to name
   what it is talking about, and the validator still accepts every id the catalogue holds.

   The word boundary is what stops this being a silent data bug: "single leg bridge with
   outstretched leg" is a glute exercise, not a stretch. */
export const isStretch = e => /\bstretch(es|ing)?\b/i.test((e && e.n) || '');

/* ---------- what each body part is worth in candidates ----------
   An equal lane per body part reads fair and is not: it spent as many of the 160 slots on
   "lower arms" (37 rows, wrist curls to a one) as on "chest", and gave "neck" (two rows, both
   stretches) a lane of its own. A plan is not drawn from an even spread of the catalogue's
   taxonomy, so the lanes are weighted by how much programming actually draws on them.

   These are shares, not quotas — a lane that runs out hands its remainder to the others, which
   is what keeps a narrow equipment filter from returning a short slice. Anything not listed
   gets 1, so a body part added to the catalogue later still appears rather than vanishing. */
const LANE_WEIGHT = {
  'back': 4, 'chest': 4, 'upper legs': 4,
  'shoulders': 3,
  'upper arms': 2, 'waist': 2,
  'cardio': 1, 'lower arms': 1, 'lower legs': 1, 'neck': 1
};
const laneWeight = bp => LANE_WEIGHT[bp] ?? 1;

export function librarySlice(S, equipment, { keep = [], max = MAX_LIBRARY } = {}) {
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  const customs = (S.customEx || []).map(c => ({ id: c.id, n: c.n, bp: c.bp, tg: null, eq: 'custom', custom: true }));
  // No equipment stated (or "everything") ⇒ the whole catalogue. Filtering to nothing would
  // leave the Coach unable to propose anything at all, which is a worse failure than a
  // slightly larger payload.
  const filtered = wanted.length ? LIBRARY.filter(e => wanted.includes((e.eq || '').toLowerCase())) : LIBRARY;
  const equipped = filtered.length ? filtered : LIBRARY;
  // Same reasoning as the equipment fallback: a filter that removed everything is not a filter
  // worth honouring. Someone whose only kit reaches nothing but stretches gets the stretches.
  const lifts = equipped.filter(e => !isStretch(e));
  const base = lifts.length ? lifts : equipped;

  const pinned = new Set(keep.filter(id => LIB_BY_ID.has(id)));
  const out = [];
  const taken = new Set();
  const add = e => { if (!taken.has(e.id)) { taken.add(e.id); out.push(e); } };
  // What the user already trains comes first, filter or no filter.
  for (const id of pinned) add(LIB_BY_ID.get(id));
  if (base.length + out.length <= max) {
    base.forEach(add);
  } else {
    // Weighted round-robin across body parts, so a 292-row "upper arms" cannot crowd out a
    // 37-row "lower arms" and a 37-row "lower arms" cannot claim as much room as "chest";
    // order within a body part is the catalogue's own. Lanes are visited in sorted key order
    // and each takes its weight per pass, so the slice stays deterministic.
    const groups = new Map();
    for (const e of base) { if (!groups.has(e.bp)) groups.set(e.bp, []); groups.get(e.bp).push(e); }
    const keys = [...groups.keys()].sort();
    const lanes = keys.map(k => groups.get(k));
    const weights = keys.map(laneWeight);
    const cursor = lanes.map(() => 0);
    let progressed = true;
    while (out.length < max && progressed) {
      progressed = false;
      for (let i = 0; i < lanes.length && out.length < max; i++) {
        for (let n = 0; n < weights[i] && out.length < max; n++) {
          while (cursor[i] < lanes[i].length && taken.has(lanes[i][cursor[i]].id)) cursor[i]++;
          if (cursor[i] >= lanes[i].length) break;   // lane spent; its share flows to the rest
          add(lanes[i][cursor[i]++]);
          progressed = true;
        }
      }
    }
  }
  return [...customs, ...out].map(slim);
}
