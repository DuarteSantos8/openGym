import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DEMO } from '../lib/demo.js'
import { connectionView, actionLabel, syncNowWithToast, pairAgain, connectServer, signInAgain, useOnline } from './ServerSync.jsx'
import Icon from './Icon.jsx'

// How long a change may sit unsent while the server is reachable before it is worth a word: the
// push after an edit, or the one boot owes, lands well within this, and saying "not synced" for
// every one of them would only teach people to ignore the line.
export const PENDING_GRACE_MS = 5000

/* The connection, always in view while the app is not connected to a server: offline, the server
   unreachable or answering with an error (its HTTP code, for whoever runs it), a server that no
   longer accepts this device, an answer that is not openGym's, and no server at all — a phone
   kept local, a guest in a browser. It cannot be dismissed; it goes when the condition does.
   The first ones say what is wrong and that the changes are kept here, with the one thing to do
   about it (retry, pair again, sign in); the deliberate local setup only says so, quietly.

   Pinned under the status bar, above the page and the pinned workout and chat headers, below the
   tab bar, the timer and every sheet. Its height goes into --conn on the root, which the page's
   top padding and those headers add in, so it takes its own room instead of covering a control.
   The public demo has no server by design and says so itself; it never shows there. */
export default function SyncBanner() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  const guest = useStore(s => s.isGuest())
  const onboarding = useStore(s => s.needsMobileOnboarding)
  const online = useOnline()
  const [waited, setWaited] = useState(false)
  const row = useRef(null)
  const status = sync?.status
  useEffect(() => {
    setWaited(false)
    if (status !== 'pending') return
    const tm = setTimeout(() => setWaited(true), PENDING_GRACE_MS)
    return () => clearTimeout(tm)
  }, [status])

  const view = connectionView(sync, { online })
  // Signed out on the web, the sign-in screen is the whole app: it hears only that the server
  // ended the session, and that the changes are still here.
  const show = !DEMO && !onboarding && !!view?.banner && (!!user || guest || status === 'auth') && (status !== 'pending' || waited)

  useLayoutEffect(() => {
    const root = document.documentElement
    const el = row.current
    if (!show || !el) { root.style.removeProperty('--conn'); return }
    const fit = () => root.style.setProperty('--conn', el.offsetHeight + 'px')
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--conn') }
  }, [show])

  if (!show) return null
  const act = {
    retry: () => { syncNowWithToast() },
    pair: pairAgain,
    connect: connectServer,
    // Signed in, or with a session the server ended: the passkey right here. A guest goes to
    // Settings, where signing in sits next to creating a profile.
    signin: () => (user || status === 'auth' ? signInAgain() : nav('/settings')),
  }[view.action]
  const label = actionLabel(view)
  const inner = <>
    <Icon name={view.icon} />
    <span className="conn-t">{view.banner}</span>
    {act && label && <span className="conn-a">{label}</span>}
  </>
  return <div className={'conn-bar ' + view.tone}>
    <div className="conn-row" ref={row} role="status" aria-live="polite">
      {act ? <button className="conn" onClick={act}>{inner}</button> : <div className="conn">{inner}</div>}
    </div>
  </div>
}
