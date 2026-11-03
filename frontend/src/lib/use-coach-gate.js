// Whether the Coach is here, once that is known. A cold start straight on #/coach or
// #/coach/intake (a reload, a bookmark) reads the store before it has the answer: /api/config is
// fetched at boot without a session, so it carries no `coach` key, and setUser asks again only
// afterwards (useStore setUser). Deciding then sent everyone home (QA v1.4.2). Here the screens
// wait for an answer made for this session, asking for one if it is missing, and decide after.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { coachAvailable } from './coach.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'

/** `{ known, ok }`: `ok` the Coach is available; `known` the answer is final for this session. */
export function useCoachGate() {
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const ready = useStore(s => s.ready)
  const ok = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const fresh = !user || !!(config && 'coach' in config)
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    if (!ready || ok || fresh || asked) return
    let gone = false
    Promise.resolve(useStore.getState().refreshConfig?.()).catch(() => {}).finally(() => { if (!gone) setAsked(true) })
    return () => { gone = true }
  }, [ready, ok, fresh, asked])
  return { known: ok || (ready && (fresh || asked)), ok }
}
