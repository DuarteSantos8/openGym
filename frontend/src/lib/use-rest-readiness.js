import { useEffect, useRef } from 'react'
import { MOBILE } from './mobile.js'
import { onWatchEvent } from './watch-link.js'
import { hrReadyOf, readiness } from './hr-readiness.js'
import { vibrate } from './sound.js'
import { t } from './i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const TICK_MS = 1000
// A rest is 15 min at most; this keeps a forgotten one from growing the list without end.
const MAX_SAMPLES = 600

// A rest restored from before startedAt existed began where its full length ends.
const restStart = tm => tm.startedAt || tm.endsAt - tm.total * 1000

/**
 * Rest by heart rate (Settings, Apple Watch): while a rest runs, the watch's readings are kept
 * for that rest and judged every second (lib/hr-readiness.js). The first "ready" shows a toast,
 * buzzes, and marks the timer (useUI.setHrReady), which tells the watch. Advice only.
 */
export function useRestReadiness() {
  const { on, bpm, floorSec } = hrReadyOf({ hrReady: useStore(s => s.S?.hrReady) })
  const timer = useUI(s => s.timer)
  const open = MOBILE && on && !!timer && !timer.ready && !timer.hrReady && timer.kind !== 'switch'
  const startedAt = open ? restStart(timer) : null
  const judging = open && !timer.paused
  const samples = useRef({ startedAt: null, list: [] })

  // Collected while paused too: a pause is still the same rest.
  useEffect(() => {
    if (startedAt == null) return undefined
    if (samples.current.startedAt !== startedAt) samples.current = { startedAt, list: [] }
    return onWatchEvent((name, data) => {
      if (name !== 'heartRate' || !Number.isFinite(data?.bpm)) return
      const now = Date.now()
      // The watch's own clock may run a little ahead; a reading held back since earlier keeps its time.
      const at = Number.isFinite(data.t) ? Math.min(now, data.t) : now
      samples.current.list = [...samples.current.list, { t: at, bpm: data.bpm }].slice(-MAX_SAMPLES)
    })
  }, [startedAt])

  useEffect(() => {
    if (!judging || startedAt == null) return undefined
    const iv = setInterval(() => {
      if (samples.current.startedAt !== startedAt) return
      const r = readiness({ samples: samples.current.list, restStartedAt: startedAt, now: Date.now(), targetBpm: bpm, floorSec })
      if (!r.ready) return
      clearInterval(iv)
      const ui = useUI.getState()
      ui.toast(t('Heart rate recovered: ready for the next set'))
      if (useStore.getState().S?.vibrate !== false) vibrate([80, 60, 80])
      ui.setHrReady(true)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [judging, startedAt, bpm, floorSec])
}
