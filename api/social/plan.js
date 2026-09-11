const scalars = (value, fields) => Object.fromEntries(fields
  .filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key]))
  .map(key => [key, typeof value[key] === 'string' ? value[key].slice(0, 4096) : value[key]]))
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 160
  && !['__proto__', 'prototype', 'constructor'].includes(id)

// Keep the plan-file contract, without accepting account state in a shared snapshot
export function sharedPlan(value) {
  if (value?.opengym_plan !== 1 || !Array.isArray(value.routines) || !value.routines.length
    || value.routines.length > 100 || new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024) {
    throw new Error('Choose a non-empty plan smaller than 256 KB')
  }
  const routines = value.routines.map(r => {
    if (!validId(r?.id) || typeof r.name !== 'string' || !Array.isArray(r.ex) || r.ex.length > 100) {
      throw new Error('Invalid routine in the shared plan')
    }
    return { ...scalars(r, ['id', 'name', 'emoji', 'prog', 'excludeFromProgression']), ex: r.ex.map(e => {
      if (!validId(e?.id)) throw new Error('Invalid exercise in the shared plan')
      const out = scalars(e, ['id', 'sets', 'min', 'speed', 'mode', 'sec', 'weight', 'reps', 'bodyweight',
        'side', 'prog', 'inc', 'deloadFactor', 'repsMin', 'repsMax', 'restSec', 'sg', 'note', 'warmupSets'])
      if (['dropset', 'restpause'].includes(e.intensifier?.type)) {
        out.intensifier = scalars(e.intensifier, ['type', 'count', 'pct', 'totalReps', 'restSec'])
      }
      return out
    }) }
  })
  if (!routines.some(r => r.ex.length)) throw new Error('Add an exercise to your plan before sharing it')
  const ids = new Set(routines.map(r => r.id))
  const week = {}
  for (let day = 0; day < 7; day++) {
    const selected = [].concat(value.week?.[day] || []).filter(id => typeof id === 'string' && ids.has(id)).slice(0, 100)
    if (selected.length) week[day] = selected
  }
  const used = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (Array.isArray(value.customEx) ? value.customEx : [])
    .filter(e => used.has(e?.id) && typeof e.n === 'string').slice(0, 1000)
    .map(e => scalars(e, ['id', 'n', 'bp', 'desc']))
  return { opengym_plan: 1, name: typeof value.name === 'string' ? value.name.slice(0, 160) : '', ...scalars(value, ['exported']),
    ...(value.unit === 'kg' || value.unit === 'lb' ? { unit: value.unit } : {}), routines, week, customEx }
}
