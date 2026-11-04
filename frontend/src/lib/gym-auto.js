// The gym that switches itself (#808): a place of the gym reminder linked to an equipment profile
// ("Equipment here", views/GymReminder.jsx) makes that profile the active gym when you arrive and
// tap the reminder, tap a check-in sticker, or start a workout inside its radius. Phone app only,
// since the places live on the phone; and only with location allowed already: nothing here ever
// asks for it. A toast says what happened, so a switch is never silent.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from './i18n-core.js'
import { MOBILE } from './mobile.js'
import { hasCompletedWork } from './workout-model.js'
import { loadGymConfig, gymPermissions, currentPosition, equipAt } from './gym-reminder.js'
import { gymsOf, gymLabel, switchGym, reRoundOpenSets } from './gym-inventory.js'

/**
 * Makes gym `id` active because the phone is there. A running session with a set done already is
 * left alone: switching that one is the workout header's, with a question first. The sets not done
 * yet of a session just started move onto the new gym's plates. True when it switched.
 */
export function applyAutoGym(id, { store = useStore, toast = m => useUI.getState().toast(m) } = {}) {
  const S = store.getState().S
  const g = gymsOf(S).find(p => p.id === id)
  if (!g || S.activeEquipId === id) return false
  const a = S.active
  if (a && !a.editingWorkoutId && !a.backfill && (a.entries || []).some(e => (e?.sets || []).some(hasCompletedWork))) return false
  store.getState().update(s => {
    switchGym(s, id)
    if (s.active && !s.active.editingWorkoutId && !s.active.backfill) reRoundOpenSets(s)
  })
  toast(t('Using {0} equipment', gymLabel(g)))
  return true
}

/**
 * Where the phone is, if it may say so without asking, and the gym linked to the place there.
 * `deps` are for tests. Resolves true when it switched.
 */
export async function autoGymHere(deps = {}) {
  const {
    mobile = MOBILE, store = useStore, load = loadGymConfig, permissions = gymPermissions, locate = currentPosition, toast,
  } = deps
  try {
    if (!mobile || !gymsOf(store.getState().S).length) return false
    const { config } = await load()
    if (!(config?.gyms || []).some(g => g && g.equip)) return false
    const p = await permissions()
    if (p?.location !== 'granted') return false
    const pos = await locate()
    const id = pos ? equipAt(config, pos, store.getState().S) : null
    return id ? applyAutoGym(id, { store, ...(toast ? { toast } : {}) }) : false
  } catch {
    return false
  }
}
