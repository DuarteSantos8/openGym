// The account's Garmin data (lib/garmin.js), loaded once and shared by Home, Food and the Garmin
// screen; read again when older than five minutes. undefined while loading, null when this
// server has no Garmin (or is not reachable), else what GET /api/garmin answered.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { loadGarmin } from '../lib/garmin.js'

let cache, at = 0, pending = null
const subs = new Set()

export function setGarmin(value) {
  cache = value; at = Date.now()
  subs.forEach(fn => fn(value))
}

export function refreshGarmin() {
  pending ||= loadGarmin().then(setGarmin, () => setGarmin(cache ?? null)).finally(() => { pending = null })
  return pending
}

export function useGarmin() {
  const signedIn = !!useStore(s => s.user)
  const [g, setG] = useState(cache)
  useEffect(() => {
    subs.add(setG)
    if (signedIn && Date.now() - at > 5 * 60e3) refreshGarmin()
    return () => { subs.delete(setG) }
  }, [signedIn])
  return signedIn ? g : null
}
