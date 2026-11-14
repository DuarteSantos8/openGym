import { readingsOf, readingAt } from './weigh-ins.js'
export function prefilledReading(day, mode = 'first') {
  const rs = readingsOf(day)
  if (!rs.length || (mode === 'avg' && rs.length > 1)) return null
  return mode === 'last' ? rs.at(-1) : rs[0]
}
export const measuredAt = (day, reading) => reading?.at ? readingAt(day, reading.at) : null
