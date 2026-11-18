// The phone's health store as the only source of weigh-ins (#1088): while "Weigh-ins from other
// apps" is on, and the Health module is not paused, no weigh-in is typed in; one already logged
// can still be changed or deleted. The read's switch lives in the phone's file
// (lib/health-sync.js), so a copy is kept here that a screen can read on its first render.
import { useSyncExternalStore } from 'react'
import { HEALTH_FILE, onHealthChange } from './health-sync.js'
import { readJsonFile } from './mobile.js'
import { isOn } from './modules.js'
import { platformNow } from './platform-now.js'
import { t } from './i18n.js'

let reading = false
const subs = new Set()
const set = h => {
  const next = !!h?.readWeight
  if (next === reading) return
  reading = next
  for (const cb of subs) cb()
}

// The file itself, not loadHealth: that fills health-sync's cache, and a save before its own first
// pass at launch would then sync early.
const readFile = () => readJsonFile(HEALTH_FILE)

/** Starts following the read's switch (store/useStore.js, on the phones). */
export function initWeighInSource(load = readFile, onChange = onHealthChange) {
  // A change told while the file is read is newer than what the read brings.
  let told = false
  onChange(h => { told = true; set(h) })
  return Promise.resolve().then(load).then(h => { if (!told) set(h) }).catch(() => {})
}

/** Whether weigh-ins come from the health store only, for profile `S`. */
export const weighInsFromHealth = S => reading && isOn(S, 'health')

const snap = () => reading
/** Calls `cb` whenever weigh-ins start or stop coming from the health store only. */
export const subscribe = cb => { subs.add(cb); return () => subs.delete(cb) }
export function useWeighInsFromHealth(S) {
  return useSyncExternalStore(subscribe, snap, snap) && isOn(S, 'health')
}

/** The line that says so, in the toast and under the switch. */
export const weighInSourceLine = (ios = platformNow() === 'ios') => (ios
  ? t('Weigh-ins come from Apple Health only.')
  : t('Weigh-ins come from Health Connect only.'))

/**
 * Asked by `bwSheet(opts)` first: true means the sheet is not opened. Changing a weigh-in already
 * logged still opens it; the check-in before a workout goes on without a weight, as "Start without
 * weighing in" does; any other Log says where weigh-ins come from.
 */
export function weighInBlocked(S, opts = {}, say) {
  if (opts.edit || !weighInsFromHealth(S)) return false
  if (opts.required) opts.onDone?.(null)
  else say?.()
  return true
}
