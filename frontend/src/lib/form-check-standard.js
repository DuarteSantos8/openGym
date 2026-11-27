// The standard Form check counts a rep from (lib/form-drills/, each drill's `standards`), the
// lifter's own choice, remembered per drill id on this phone. Not synced: it is a setting of the
// camera view, like the voice.
import { drillById, standardFor } from './form-drills/index.js'

export const STANDARD_KEY = 'og_formcheck_standard'

const readAll = () => {
  try {
    const v = JSON.parse(localStorage.getItem(STANDARD_KEY))
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

/** The drill's stored standard, its default when none (or a stale one) is stored; null for no drill. */
export function storedStandard(drillId) {
  return standardFor(drillId, readAll()[drillId])
}

/** Remembers `standard` for the drill; anything not one of its standards is ignored. */
export function storeStandard(drillId, standard) {
  const drill = drillById(drillId)
  if (!drill || !drill.standards.some(s => s.id === standard)) return
  try { localStorage.setItem(STANDARD_KEY, JSON.stringify({ ...readAll(), [drillId]: standard })) } catch { /* private mode: the default next time */ }
}
