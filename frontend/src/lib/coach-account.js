// A profile's own Coach account (authMode: profile) — the client side of
// api/coach/routes.js's POST/DELETE /api/coach/credential and POST /api/coach/credential/test.
//
// Kept out of coach-api.js on purpose: that module is the Coach screen's one door to the
// server, and this is a settings concern that only exists on an instance whose admin chose
// "each profile connects its own". The token is write-only from here: it goes up once and no
// call reads it back.

import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'
import { useStore } from '../store/useStore.js'

// The demo and a phone running the Coach on its own key have no server account to speak of.
const noServerAccount = () => DEMO || (MOBILE && useStore.getState().coachLocal?.mode === 'byok')

/** What GET /api/coach/account says, or null where there is no server account at all. */
export const fetchAccount = async () => noServerAccount() ? null : api('/api/coach/account')
export const connectOwn = body => api('/api/coach/credential', { method: 'POST', body: JSON.stringify(body) })
export const disconnectOwn = () => api('/api/coach/credential', { method: 'DELETE', body: '{}' })
// The server gives the provider up to 90 s for this round trip, longer than api()'s default.
export const testOwn = () => api('/api/coach/credential/test', { method: 'POST', body: '{}', timeout: 150000 })

/** Does this profile have to bring its own account? Only in profile mode. */
export const needsOwnAccount = a => !!a && a.mode === 'profile'

/**
 * The account state for the Coach screen. Errors are swallowed like the status poll's: failing
 * to read this must not interrupt anyone, it just leaves the row out.
 */
export function useCoachAccount() {
  const [account, setAccount] = useState(null)
  const refresh = useCallback(async () => {
    try { const a = await fetchAccount(); setAccount(a || null); return a || null } catch { return null }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { account, refresh }
}
