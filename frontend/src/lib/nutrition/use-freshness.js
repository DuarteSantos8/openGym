import { useEffect, useState } from 'react'
import { todayISO } from '../format.js'

const msToMidnight = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
}

/** Today's date, 'YYYY-MM-DD', kept right while a page stays open: it moves on at midnight and is
 *  read again when the page comes back to the front (a timer can be held back while hidden). */
export function useToday() {
  const [today, setToday] = useState(todayISO)
  useEffect(() => {
    const sync = () => setToday(todayISO())
    const timer = setTimeout(sync, msToMidnight() + 1000)
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [today])
  return today
}

/** Keeps a Progress store (useTrends, useWellness) current while the page is open: a background
 *  `load({ force: true })` when the page opens, when it comes back to the front, when the day
 *  changes and when the store has been marked stale. What is held stays on screen meanwhile. */
export function useFresh(useStoreHook, enabled, today) {
  const stale = useStoreHook(s => s.stale)
  useEffect(() => {
    if (enabled) useStoreHook.getState().load({ force: true })
  }, [useStoreHook, enabled, today])
  useEffect(() => {
    if (enabled && stale) useStoreHook.getState().load({ force: true })
  }, [useStoreHook, enabled, stale])
  useEffect(() => {
    if (!enabled) return undefined
    const back = () => { if (document.visibilityState === 'visible') useStoreHook.getState().load({ force: true }) }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [useStoreHook, enabled])
}
