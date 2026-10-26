const validPair = next => next?.entry?.exposureId && next.entry.exposureId === next.exposure?.exposureId

const synchronized = active => {
  if (!Array.isArray(active?.entries) || !Array.isArray(active?.exposures)) return null
  const byId = new Map(active.exposures.map(x => [x.exposureId, x]))
  if (byId.size !== active.exposures.length) return null
  const seen = new Set()
  const exposures = []
  for (const entry of active.entries) {
    if (!entry.exposureId || seen.has(entry.exposureId) || !byId.has(entry.exposureId)) return null
    seen.add(entry.exposureId)
    const { sg, ...exposure } = byId.get(entry.exposureId)
    exposures.push(entry.sg ? { ...exposure, sg: entry.sg } : exposure)
  }
  return exposures
}

export function syncActiveExposures(active) {
  const exposures = synchronized(active)
  if (!exposures) return false
  active.exposures.splice(0, active.exposures.length, ...exposures)
  return true
}

export function replaceActiveOccurrence(active, index, next) {
  if (!validPair(next) || !Array.isArray(active?.entries) || !Array.isArray(active?.exposures)) return false
  const current = active.entries[index]
  const exposureIndex = current && active.exposures.findIndex(x => x.exposureId === current.exposureId)
  if (!current || exposureIndex < 0) return false
  const candidate = { entries: active.entries.slice(), exposures: active.exposures.slice() }
  candidate.entries[index] = next.entry
  candidate.exposures[exposureIndex] = next.exposure
  if (!syncActiveExposures(candidate)) return false
  active.entries.splice(0, active.entries.length, ...candidate.entries)
  active.exposures.splice(0, active.exposures.length, ...candidate.exposures)
  return true
}

export function insertActiveOccurrence(active, index, next) {
  if (!validPair(next) || !Array.isArray(active?.entries) || !Array.isArray(active?.exposures)) return false
  const at = Math.max(0, Math.min(index, active.entries.length))
  const candidate = { entries: active.entries.slice(), exposures: [...active.exposures, next.exposure] }
  candidate.entries.splice(at, 0, next.entry)
  if (!syncActiveExposures(candidate)) return false
  active.entries.splice(0, active.entries.length, ...candidate.entries)
  active.exposures.splice(0, active.exposures.length, ...candidate.exposures)
  return true
}
