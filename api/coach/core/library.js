/* The exercise catalogue the Coach reasons over, in the five fields it needs.
 *
 * `library-data.js` is generated from the frontend dataset and committed (see
 * scripts/build-coach-assets.mjs) — the same arrangement the translated instruction packs use.
 * It is an ES module rather than JSON on purpose: bare node needs createRequire for JSON, Vite
 * needs an import attribute, and this file has to load under both without either knowing.
 */
import { EXERCISES, TIER_STARTS } from './library-data.js';

export const LIBRARY = EXERCISES;
export const LIB_BY_ID = new Map(LIBRARY.map(e => [e.id, e]));
// The catalogue's order in tiers (scripts/build-coach-assets.mjs): the classic exercises, then
// the newer lifts, then stretches, mobility, yoga and the like. 0 / 1 / 2.
const TIER_OF = new Map(LIBRARY.map((e, i) => [e.id, i < (TIER_STARTS?.[0] ?? Infinity) ? 0 : i < (TIER_STARTS?.[1] ?? Infinity) ? 1 : 2]));

export const libraryHas = id => LIB_BY_ID.has(id);
export const libraryName = id => LIB_BY_ID.get(id)?.n || null;

/* Whether the person's equipment covers a catalogue exercise. Body weight is never gated, the
   same rule the app's own equipment profiles follow (frontend lib/equipment.js), and an id the
   catalogue does not hold (one of their own exercises) is theirs to judge, not ours. No
   equipment stated means the whole catalogue. */
const ALWAYS_AVAILABLE = 'body weight';
export function equipmentAllows(equipment, id) {
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  if (!wanted.length) return true;
  const eq = (LIB_BY_ID.get(id)?.eq || '').toLowerCase();
  return !eq || eq === ALWAYS_AVAILABLE || wanted.includes(eq);
}

/* "I own no dumbbells", the app's switch under Settings → Equipment → Dumbbells (frontend
   lib/dumbbells.js ownsNoDumbbells): kept in the synced dumbbell map under `none`. It holds
   whatever the Coach's own equipment answer says, the switch being the more direct statement. */
export const ownsNoDumbbells = S => S?.dumbbells?.none?.on === true;
export const isDumbbellLift = id => (LIB_BY_ID.get(id)?.eq || '').toLowerCase() === 'dumbbell';

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

/* ---------- what the person asked about (#829) ----------
   "Add more core work" used to change nothing about the candidates: the waist lane got its
   usual share, so a review could pick from four ab exercises, always the same four. A body part
   or muscle named in the note, the question or the profile's goal and likes now gets a lane worth
   FOCUS_WEIGHT, and a named muscle (biceps, glutes) goes first inside its lane. Words in the
   languages the app speaks most, matched as whole words with accents dropped; a word that is
   also common in another language ("dos", "po") is left out on purpose. */
export const FOCUS_WEIGHT = 8;
const FOCUS_WORDS = [
  ['waist', null, 'core abs abdominal abdominals abdomen sixpack midsection trunk plank planks bauch bauchmuskeln rumpf abdos abdominaux gainage abdominales abdominali addominali abdominais buik buikspieren brzuch'],
  ['waist', 'obliques', 'oblique obliques oblicuos obliqui obliquos'],
  ['back', null, 'back rucken espalda schiena costas dorsais rug plecy'],
  ['back', 'lats', 'lat lats latissimus'],
  ['back', 'traps', 'trap traps trapezius trapez'],
  ['chest', null, 'chest pec pecs pectoral pectorals brust brustmuskel pectoraux pecho pectorales petto pettorali peito peitoral borst klatka'],
  ['upper legs', null, 'leg legs thigh thighs beine bein oberschenkel jambes cuisses piernas gambe pernas benen nogi'],
  ['upper legs', 'quads', 'quad quads quadriceps quadrizeps'],
  ['upper legs', 'hamstrings', 'hamstring hamstrings beinbeuger ischios isquiotibiales femorais'],
  ['upper legs', 'glutes', 'glute glutes butt booty gesass glutaeus fessiers gluteos glutei gluteo billen'],
  ['lower legs', null, 'calf calves wade waden mollets gemelos polpacci panturrilha panturrilhas kuiten łydki'],
  ['upper arms', null, 'arm arms arme bras brazos braccia bracos armen ramiona'],
  ['upper arms', 'biceps', 'bicep biceps bizeps'],
  ['upper arms', 'triceps', 'tricep triceps trizeps'],
  ['shoulders', null, 'shoulder shoulders delt delts deltoid deltoids schulter schultern epaules hombros spalle ombros schouders barki'],
  ['lower arms', 'forearms', 'forearm forearms grip unterarm unterarme antebrazo antebrazos avambracci antebraco antebracos onderarm onderarmen przedramiona'],
  ['cardio', null, 'cardio conditioning endurance ausdauer kondition resistencia'],
  ['neck', null, 'neck nacken cuello collo pescoco nek szyja']
];
const FOCUS_BY_WORD = new Map();
for (const [bp, tg, words] of FOCUS_WORDS) for (const w of words.split(' ')) FOCUS_BY_WORD.set(w, { bp, tg });

/* The body parts and muscles a piece of text names: { parts: Set<bp>, muscles: Set<tg> }. */
export function focusOf(...texts) {
  const parts = new Set();
  const muscles = new Set();
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    const words = t.slice(0, 4000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/six[\s-]pack/g, 'sixpack').match(/\p{L}+/gu) || [];
    for (const w of words) {
      const hit = FOCUS_BY_WORD.get(w);
      if (!hit) continue;
      parts.add(hit.bp);
      if (hit.tg) muscles.add(hit.tg);
    }
  }
  return { parts, muscles };
}

/* A lane's entries in the order the slice takes them. A plain catalogue prefix always gave the
   same handful (the waist lane: 3/4 sit-up, 45° side bend, air bike, alternate heel touchers),
   so each tier of the lane is walked with a stride of about 0.618 of its length instead, which
   spreads a short share over the whole tier and is still the same order every time. Within a
   tier, the muscles the person named come first. */
function strided(list) {
  const L = list.length;
  if (L < 3) return list;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let step = Math.max(1, Math.round(L * 0.618));
  while (gcd(step, L) !== 1) step++;
  return list.map((_, j) => list[(j * step) % L]);
}
function laneOrder(entries, muscles) {
  const tiers = [[], [], []];
  for (const e of entries) tiers[TIER_OF.get(e.id) ?? 0].push(e);
  return tiers.flatMap(tier => {
    if (!muscles.size) return strided(tier);
    return [...strided(tier.filter(e => muscles.has(e.tg))), ...strided(tier.filter(e => !muscles.has(e.tg)))];
  });
}

/* `focus` is the free text the person gave (note, question, goal, likes); `fresh` is how many
   slots stay for exercises outside `keep` however much the plan and history pin, so a review has
   something to swap in (#829). It can take the slice past `max`, never past MAX_LIBRARY unless
   `keep` alone does. */
export function librarySlice(S, equipment, { keep = [], max = MAX_LIBRARY, focus = [], fresh = 0 } = {}) {
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  // A custom exercise's name and body part are whatever the person typed, and its id is
  // whatever the client wrote; all three ride into every prompt. Cut to the bounds payload.js
  // gives every other name (NAME_MAX, 80) and id (ID_MAX, 64); a non-string reads as absent.
  const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const customs = (Array.isArray(S.customEx) ? S.customEx : [])
    .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
    .map(c => ({ id: cut(c.id, 64), n: cut(c.n, 80), bp: cut(c.bp, 40), tg: null, eq: 'custom', custom: true }));
  // No equipment stated (or "everything") ⇒ the whole catalogue. Filtering to nothing would
  // leave the Coach unable to propose anything at all, which is a worse failure than a
  // slightly larger payload.
  const noDumbbells = ownsNoDumbbells(S);
  const filtered = (wanted.length ? LIBRARY.filter(e => equipmentAllows(wanted, e.id)) : LIBRARY)
    .filter(e => !noDumbbells || !isDumbbellLift(e.id));
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
  const limit = Math.max(max, Math.min(out.length + Math.max(0, fresh | 0), MAX_LIBRARY));
  const named = focusOf(...(Array.isArray(focus) ? focus : [focus]));
  if (base.length + out.length <= limit) {
    base.forEach(add);
  } else {
    // Weighted round-robin across body parts, so a 292-row "upper arms" cannot crowd out a
    // 37-row "lower arms" and a 37-row "lower arms" cannot claim as much room as "chest";
    // a body part the person named weighs FOCUS_WEIGHT, and each lane is walked in laneOrder.
    // Lanes are visited in sorted key order (named ones first) and each takes its weight per
    // pass, so the slice stays deterministic.
    const groups = new Map();
    for (const e of base) { if (!groups.has(e.bp)) groups.set(e.bp, []); groups.get(e.bp).push(e); }
    // The lanes the person named go first in each pass, so a short budget is not spent before
    // the round reaches them ("waist" sorts last).
    const keys = [...groups.keys()].sort((a, b) => (named.parts.has(b) - named.parts.has(a)) || (a < b ? -1 : a > b ? 1 : 0));
    const lanes = keys.map(k => laneOrder(groups.get(k), named.muscles));
    const weights = keys.map(k => (named.parts.has(k) ? Math.max(FOCUS_WEIGHT, laneWeight(k)) : laneWeight(k)));
    const cursor = lanes.map(() => 0);
    let progressed = true;
    while (out.length < limit && progressed) {
      progressed = false;
      for (let i = 0; i < lanes.length && out.length < limit; i++) {
        for (let n = 0; n < weights[i] && out.length < limit; n++) {
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

/* ---------- candidates for a swap in the middle of a workout (the `adapt` job) ----------
   A sore shoulder on the barbell bench wants another chest press, not a row. So the slice is
   built around the exercise asked about: the same target muscle first, then the same body
   part, each walked in the deterministic stride above and across every kind of equipment the
   person has, then the exercises already in the session (`keep`, so a change can name them).
   Small on purpose: a swap picks one of a few dozen, and the answer has to arrive mid-set. */
export function swapSlice(S, equipment, exId, { keep = [], max = 36 } = {}) {
  const focus = LIB_BY_ID.get(exId);
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  const noDumbbells = ownsNoDumbbells(S);
  const fits = e => equipmentAllows(wanted, e.id) && !(noDumbbells && isDumbbellLift(e.id)) && !isStretch(e) && e.id !== exId;
  const out = [];
  const taken = new Set();
  const add = e => { if (e && !taken.has(e.id) && out.length < max) { taken.add(e.id); out.push(e); } };
  for (const id of keep) add(LIB_BY_ID.get(id));
  if (focus) {
    const same = LIBRARY.filter(e => e.tg === focus.tg && fits(e));
    // Spread over the kinds of equipment, so the slice is not twelve cable variations of one press.
    const byEq = new Map();
    for (const e of laneOrder(same, new Set())) { if (!byEq.has(e.eq)) byEq.set(e.eq, []); byEq.get(e.eq).push(e); }
    const lanes = [...byEq.keys()].sort().map(k => byEq.get(k));
    const room = Math.max(0, Math.floor(max * 0.7) - out.length);
    for (let i = 0, added = 0; added < room && lanes.some(l => l.length > i); i++) {
      for (const lane of lanes) { if (lane[i] && added < room) { const before = out.length; add(lane[i]); added += out.length - before; } }
    }
    for (const e of laneOrder(LIBRARY.filter(x => x.bp === focus.bp && x.tg !== focus.tg && fits(x)), new Set())) add(e);
  }
  const customs = (Array.isArray(S?.customEx) ? S.customEx : [])
    .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
    .slice(0, 10)
    .map(c => ({ id: c.id.slice(0, 64), n: typeof c.n === 'string' ? c.n.slice(0, 80) : undefined, bp: typeof c.bp === 'string' ? c.bp.slice(0, 40) : undefined, custom: true }));
  return [...customs, ...out.map(slim)];
}
