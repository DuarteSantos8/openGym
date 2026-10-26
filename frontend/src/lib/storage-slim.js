// The copy a device keeps in localStorage when the whole profile does not fit there. Safari gives a
// page about 5 MB and counts every character twice; a profile with two years of Apple Health and a
// scale's history is past it (3.2 MB of health readings out of 3.9 MB, October 2026), and then no
// change was saved on the device at all. The copy kept instead is the whole profile with the health
// readings of the last `days` days only, or none: everything that is not a reading still saves. The
// rest stays where it is, on the server and in the phone's own file (nativePersist): health records
// sync as a union by id (lib/sync-merge.js), so a reading missing from this copy is one this copy
// does not hold, never one deleted, and the next pull brings it back.
import { isoOf } from './format.js'

// Tried in this order once the whole copy is refused: 90 days, then 30, then no readings at all.
export const SLIM_DAYS = [90, 30, 0]

/** `S` with only the health readings of its last `days` days (`today` local, YYYY-MM-DD). */
export function slimForStorage(S, days, today = isoOf(new Date())) {
  if (!Array.isArray(S?.health) || !S.health.length) return S
  if (!days) return { ...S, health: [] }
  const from = new Date(today + 'T12:00:00')
  from.setDate(from.getDate() - (days - 1))
  const cut = isoOf(from)
  return { ...S, health: S.health.filter(r => r && typeof r.d === 'string' && r.d >= cut) }
}

/**
 * Writes the copy with `write(text)`: whole if it fits, otherwise the slimmer copies of SLIM_DAYS
 * in turn. Answers the days kept (null for the whole copy); throws what the last attempt threw
 * when not even a copy without readings fits.
 */
export function writeFitting(S, write, today) {
  try { write(JSON.stringify(S)); return null } catch (e) { if (!Array.isArray(S?.health) || !S.health.length) throw e }
  let last
  for (const days of SLIM_DAYS) {
    try { write(JSON.stringify(slimForStorage(S, days, today))); return days } catch (e) { last = e }
  }
  throw last
}
