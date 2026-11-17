// Numbers per gym and per machine brand (#988, idea by RobinRHL, the brand-as-label design from
// lodepav's write-up in that issue, rebuilt here).
//
// The same cable row is 15 kg in one gym and 10 in the other: different pulleys, different
// brands. With one history for both, "last time" and the next weight are wrong in one of the two
// gyms every single time. An exercise can therefore be split (Exercise → Per gym):
//
//   S.exGym = { [exId]: { split: true, brands: { [gymId]: 'Life Fitness' }, _ts } }
//
// a stamped map (lib/sync-merge.js STAMPED_MAPS, mirrored in api/sync-stamps.js), so each
// exercise's choice syncs on its own. A gym is an equipment profile (lib/equipment.js), the one
// a session runs at is `active.gym` and every saved workout keeps it (`w.gym`, #808). A split
// exercise also keeps the brand it was done on with each logged entry (`entry.brand`).
//
// Reading back, for a split exercise, only the sessions that match where you are now count, so
// "last time", the rows a session opens with and the progression all follow the gym:
//   - an entry with a brand matches the same brand, at any gym (same brand, same machine);
//   - an entry without one matches the same gym;
//   - an entry with a brand but none set now matches the same gym (the brand went, the gym stayed).
// When nothing matches yet, the sessions with no gym at all (logged before any gym existed) stand
// in, so a split does not throw away the history from before it. Another gym's or another brand's
// sessions never do: a first visit starts from the plan, as a new exercise would.
//
// An exercise that is not split reads everything, exactly as before; nothing here runs for it.

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
export const BRAND_MAX = 40

/** The brand as typed, tidied: trimmed, inner spaces folded, at most BRAND_MAX characters. */
export const cleanBrand = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, BRAND_MAX) : '')
// Compared without case: "life fitness" and "Life Fitness" are one machine.
const sameBrand = (a, b) => cleanBrand(a).toLocaleLowerCase() === cleanBrand(b).toLocaleLowerCase()

const entryOf = (S, exId) => (isMap(S?.exGym) && isMap(S.exGym[exId]) ? S.exGym[exId] : null)

/** Whether this exercise keeps its numbers per gym. */
export const isGymSplit = (S, exId) => entryOf(S, exId)?.split === true

/** The brand this exercise is done on at gym `gymId`, or ''. */
export const brandAt = (S, exId, gymId) => {
  const b = entryOf(S, exId)?.brands
  return gymId != null && isMap(b) ? cleanBrand(b[gymId]) : ''
}

/** The gym the numbers are read for: the running session's, else the active profile. */
export const currentGymId = S => (isMap(S?.active) && isMap(S.active.gym) && S.active.gym.id != null ? S.active.gym.id : S?.activeEquipId ?? null)

/** Where a split exercise is being done now: `{ gym, brand }`. */
export const contextOf = (S, exId) => {
  const gym = currentGymId(S)
  return { gym, brand: brandAt(S, exId, gym) }
}

/**
 * S.exGym with `patch` ({ split?, brand?, gymId? }) applied to one exercise, stamped. A brand is
 * set for `gymId`; an empty one is removed. Never mutates `map`.
 */
export function withExGym(map, exId, { split, brand, gymId } = {}, now = Date.now()) {
  const all = isMap(map) ? map : {}
  const cur = isMap(all[exId]) ? all[exId] : {}
  const brands = { ...(isMap(cur.brands) ? cur.brands : {}) }
  if (brand !== undefined && gymId != null) {
    const b = cleanBrand(brand)
    if (b) brands[gymId] = b
    else delete brands[gymId]
  }
  const next = { split: split !== undefined ? split === true : cur.split === true, _ts: now }
  if (Object.keys(brands).length) next.brands = brands
  return { ...all, [exId]: next }
}

/** Where a saved entry was done: `{ gym, brand }`, either may be null/''. */
export const entryContext = (w, en) => ({ gym: isMap(w?.gym) && w.gym.id != null ? w.gym.id : null, brand: cleanBrand(en?.brand) })

/** Whether a saved entry counts for a split exercise done at `ctx` (see the rules above). */
export function matchesContext(entryCtx, ctx) {
  if (entryCtx.brand && ctx.brand) return sameBrand(entryCtx.brand, ctx.brand)
  return entryCtx.gym != null && entryCtx.gym === ctx.gym
}
const unlabelled = c => c.gym == null && !c.brand

// One view per (workouts list, exercise, place): the readers ask many times per render.
const cache = new WeakMap()

/**
 * S as a split exercise sees it from where it is done now: the workouts with that exercise's
 * entries from other gyms or brands taken out (the workouts themselves and every other exercise
 * left as they are). S itself for an exercise that is not split, or when there are no workouts.
 */
export function gymSplitView(S, exId) {
  if (!isGymSplit(S, exId) || !Array.isArray(S?.workouts) || !S.workouts.length) return S
  const ctx = contextOf(S, exId)
  const key = `${exId}\u0000${ctx.gym}\u0000${ctx.brand.toLocaleLowerCase()}`
  let byKey = cache.get(S.workouts)
  if (!byKey) { byKey = new Map(); cache.set(S.workouts, byKey) }
  let workouts = byKey.get(key)
  if (!workouts) {
    const has = w => (w?.entries || []).some(e => e && e.id === exId)
    const anyMatch = S.workouts.some(w => has(w) && w.entries.some(e => e && e.id === exId && matchesContext(entryContext(w, e), ctx)))
    const keep = (w, e) => {
      const c = entryContext(w, e)
      return anyMatch ? matchesContext(c, ctx) : unlabelled(c)
    }
    workouts = S.workouts.map(w => {
      if (!has(w)) return w
      const entries = w.entries.filter(e => !(e && e.id === exId) || keep(w, e))
      return entries.length === w.entries.length ? w : { ...w, entries }
    })
    byKey.set(key, workouts)
  }
  return { ...S, workouts }
}

/** The line a split exercise shows in a workout: "Big gym · Life Fitness", or '' when not split. */
export function splitLabel(S, exId, gymName) {
  if (!isGymSplit(S, exId)) return ''
  const { brand } = contextOf(S, exId)
  return [gymName || '', brand].filter(Boolean).join(' · ')
}

/** The key a saved entry's place goes by in a chooser: its brand, else its gym, else null. */
export const placeKey = (w, en) => {
  const c = entryContext(w, en)
  return c.brand ? 'b:' + c.brand.toLocaleLowerCase() : c.gym != null ? 'g:' + c.gym : null
}

/**
 * Every place an exercise was done at, newest first: `[{ key, label, n }]`, a brand by its name
 * and a gym by the name the workout saved. For the "All gyms" chooser of an exercise's history.
 */
export function placesOf(S, exId) {
  const out = new Map()
  const ws = Array.isArray(S?.workouts) ? S.workouts : []
  for (let i = ws.length - 1; i >= 0; i--) {
    const w = ws[i]
    for (const en of w?.entries || []) {
      if (!en || en.id !== exId) continue
      const key = placeKey(w, en)
      if (!key) continue
      const got = out.get(key)
      if (got) { got.n++; continue }
      out.set(key, { key, label: cleanBrand(en.brand) || String(w.gym?.name || '').trim(), n: 1 })
    }
  }
  return [...out.values()]
}

/** S with only the entries of `exId` done at place `key` (placesOf); S itself for no key. */
export function onlyPlace(S, exId, key) {
  if (!key || !Array.isArray(S?.workouts)) return S
  return { ...S, workouts: S.workouts.map(w => {
    if (!(w?.entries || []).some(e => e && e.id === exId)) return w
    return { ...w, entries: w.entries.filter(e => !(e && e.id === exId) || placeKey(w, e) === key) }
  }) }
}
