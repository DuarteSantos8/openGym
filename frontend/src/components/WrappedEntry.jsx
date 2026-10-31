// The ways into Your year (components/Wrapped.jsx), kept small because they sit in the main bundle:
// Home's card in December and January, the row in Stats for any year with workouts, the December
// notification on the phones, and #/stats?wrapped=2026. The stories themselves load on first open.
import { Suspense, lazy, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useWrappedUI, openWrapped } from '../lib/wrapped-ui.js'
import { homeCardYear, wrappedYears, wrappedNow, withYear, notifyOn } from '../lib/wrapped.js'
import { syncWrappedNotification, onWrappedNotificationOpen } from '../lib/wrapped-notify.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import CardHead from './CardHead.jsx'

const Wrapped = lazy(() => import('./Wrapped.jsx'))

/** Home, from Dec 1 to Jan 31: "Your 2026 in openGym is ready", until it is opened or put away. */
export function WrappedHomeCard({ S }) {
  const update = useStore(s => s.update)
  const year = homeCardYear(S, wrappedNow())
  if (!year) return null
  return <div className="card wr-home" data-wrapped-home>
    <CardHead icon="sparkles" eyebrow={t('Your year in openGym')} title={t('Your {0} in openGym is ready 🎉', String(year))}
      sub={t('Workouts, records and one very honest personality test. Tap to see your year.')}
      action={<button type="button" className="iconbtn wr-x" aria-label={t('Not now')} onClick={() => update(s => { s.wrapped = withYear(s, 'dismissed', year) })}><Icon name="xmark" /></button>} />
    <Button variant="primary" icon="sparkles" onClick={() => openWrapped(year)}>{t('Show me my year')}</Button>
  </div>
}

/** Stats: any year with workouts, any day of the year; the year in progress reads "so far". */
export function WrappedStatsCard({ S }) {
  const years = wrappedYears(S).slice(0, 4)
  if (!years.length) return null
  const now = new Date().getFullYear()
  return <div className="card" data-wrapped-stats>
    <div className="row between" style={{ alignItems: 'center', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0 }}>{t('Your year')}</h2>
        <div className="muted small" style={{ marginTop: 4 }}>{t('Your year in openGym as stories, every card ready to share.')}</div>
      </div>
      <Button size="sm" variant="tinted" icon="sparkles" style={{ flexShrink: 0 }} onClick={() => openWrapped(years[0])}>{years[0] === now ? t('So far') : String(years[0])}</Button>
    </div>
    {years.length > 1 && <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      {years.slice(1).map(y => <button key={y} type="button" className="chip" onClick={() => openWrapped(y)}>{y}</button>)}
    </div>}
  </div>
}

/**
 * Lives in App: shows the stories when a year is open, opens them from the December notification
 * or a #/…?wrapped=2026 link, and keeps the phone's one notification planned (lib/wrapped-notify.js).
 */
export function WrappedLayer({ ready }) {
  const year = useWrappedUI(s => s.year)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const loc = useLocation()
  const nav = useNavigate()
  const wants = notifyOn(S)
  useEffect(() => {
    if (!ready) return
    syncWrappedNotification(useStore.getState().S, update).catch(() => {})
  }, [ready, wants]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onWrappedNotificationOpen(y => openWrapped(y || homeCardYear(useStore.getState().S, wrappedNow()) || wrappedYears(useStore.getState().S)[0])), [])
  useEffect(() => {
    if (!ready) return
    const m = /[?&]wrapped=(\d{4})\b/.exec(loc.search || '')
    if (!m) return
    openWrapped(Number(m[1]))
    nav(loc.pathname, { replace: true })
  }, [ready, loc.search]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!year) return null
  return <Suspense fallback={null}><Wrapped /></Suspense>
}
