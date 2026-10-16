// Programme state can predate the current namespace object. Keep legacy entries opaque until a
// schema-specific migration is accepted; normalizing them into definitions would risk changing
// identity, lifecycle, or scheduling data that an older/live writer still understands.
export function normalizeProgrammeNamespace(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const definitions = Array.isArray(source.definitions) ? source.definitions : []
  const cycles = (Array.isArray(source.cycles) ? source.cycles : []).map(cycle => {
    if (!cycle || typeof cycle !== 'object' || Array.isArray(cycle)) return cycle
    const definition = definitions.find(item => item?.id != null && item.id === cycle.programmeId)
    let normalized = cycle
    // Older cycles kept their display metadata only in the frozen Programme snapshot.
    // Recover that before consulting a definition which may have changed since the cycle.
    for (const key of ['name', 'emoji', 'colour', 'progression']) {
      if (cycle[key] != null) continue
      const fallback = cycle.programmeSnapshot?.[key] ?? cycle.snapshot?.[key] ?? definition?.[key]
      if (fallback != null) normalized = { ...normalized, [key]: fallback }
    }
    return normalized
  })
  return {
    ...source,
    version: 1,
    definitions,
    cycles,
    ...(Array.isArray(value) ? { legacyEntries: value } : {}),
  }
}
