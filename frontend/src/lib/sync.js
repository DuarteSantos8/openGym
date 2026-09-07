// Small, JSON-only sync helpers. The last server snapshot is kept separately from the editable
// local state so a 412 can merge pending phone work instead of replacing it with a remote copy.
const META_KEY = 'gym_sync_meta_v1'
const BASE_KEY = 'gym_sync_base_v1'
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)

export function loadSyncMeta(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(META_KEY)) || { revision: '"0"' } }
  catch { return { revision: '"0"' } }
}

export function saveSyncMeta(meta, storage = globalThis.localStorage) {
  storage.setItem(META_KEY, JSON.stringify(meta || { revision: '"0"' }))
}

export function loadSyncBase(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(BASE_KEY)) }
  catch { return null }
}

export function saveSyncBase(state, storage = globalThis.localStorage) {
  if (state == null) storage.removeItem(BASE_KEY)
  else storage.setItem(BASE_KEY, JSON.stringify(state))
}

function keyFor(item) {
  if (!plain(item)) return null
  if (item.id != null) return `id:${item.id}`
  if (item.d != null && item.start != null) return `session:${item.d}:${item.start}`
  if (item.d != null && item.w != null) return `date:${item.d}:${item.w}`
  return null
}

function mergeArray(base, local, remote) {
  const all = [...local, ...remote, ...base]
  const keyed = all.length > 0 && all.every(item => keyFor(item) !== null)
  if (!keyed) return clone(local)
  const baseMap = new Map(base.map(item => [keyFor(item), item]))
  const localMap = new Map(local.map(item => [keyFor(item), item]))
  const remoteMap = new Map(remote.map(item => [keyFor(item), item]))
  // A deletion is authoritative when the other side left the array untouched. If both
  // sides changed different members, retain the unchanged member as a visible conflict
  // instead of silently dropping one side's work.
  const arrayChanged = side => {
    const keys = new Set([...baseMap.keys(), ...side.keys()])
    for (const key of keys) {
      if (!side.has(key) || !baseMap.has(key) || !equal(side.get(key), baseMap.get(key))) return true
    }
    return false
  }
  const localChanged = arrayChanged(localMap)
  const remoteChanged = arrayChanged(remoteMap)
  const order = [...remote, ...local].map(keyFor).filter((key, i, a) => key && a.indexOf(key) === i)
  const merged = []
  for (const key of order) {
    const b = baseMap.get(key); const l = localMap.get(key); const r = remoteMap.get(key)
    const hasBase = baseMap.has(key); const hasLocal = localMap.has(key); const hasRemote = remoteMap.has(key)
    if (!hasLocal && !hasRemote) continue
    if (!hasLocal) {
      // A local deletion wins over an unchanged server item. If the server changed the item
      // concurrently, retain that edit instead of emitting an undefined array member. When
      // another remote member changed too, keep this unchanged member as a deletion conflict.
      if (!hasBase) { merged.push(clone(r)); continue }
      if (equal(r, b) && !remoteChanged) continue
      merged.push(clone(r)); continue
    }
    if (!hasRemote) {
      // Symmetric remote deletion: only drop a local item when the phone did not edit it.
      if (!hasBase) { merged.push(clone(l)); continue }
      if (equal(l, b) && !localChanged) continue
      merged.push(clone(l)); continue
    }
    const value = mergeValue(b, l, r)
    if (value !== undefined && value !== null) merged.push(value)
  }
  return merged
}

function mergeValue(base, local, remote) {
  if (equal(local, base)) return clone(remote)
  if (equal(remote, base)) return clone(local)
  if (Array.isArray(local) && Array.isArray(remote)) return mergeArray(Array.isArray(base) ? base : [], local, remote)
  if (plain(local) && plain(remote)) {
    const out = {}
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])
    for (const key of keys) {
      const b = base?.[key]
      const l = Object.prototype.hasOwnProperty.call(local, key) ? local[key] : undefined
      const r = Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : undefined
      if (l === undefined && r !== undefined && b !== undefined && equal(r, b)) continue
      if (l === undefined && r !== undefined) { out[key] = clone(r); continue }
      if (r === undefined && l !== undefined) { out[key] = clone(l); continue }
      out[key] = mergeValue(b, l, r)
    }
    return out
  }
  // Same scalar changed in both copies: preserve the device edit and leave the conflict visible
  // through the ordinary dirty/retry path rather than silently discarding local work.
  return clone(local)
}

export function mergePendingState(base, local, remote) {
  const merged = mergeValue(base || {}, local || {}, remote || {})
  if (local?.active) merged.active = clone(local.active)
  return merged
}

export const generationChanged = (before, after) => before !== after

export function syncKeys() { return { meta: META_KEY, base: BASE_KEY } }
