import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { REST_MAX } from '../lib/duration.js'
import { isSwitching } from '../lib/use-tab-nav.js'
import { Button } from './ui.jsx'
import Elapsed from './Elapsed.jsx'

const clock = sec => Math.floor(Math.max(0, sec) / 60) + ':' + String(Math.max(0, sec) % 60).padStart(2, '0')

// The one dock above the bar while a workout runs and you are somewhere else: the rest bar and
// the session's mini-bar in one. The dot, the routine and how long it has run; during a rest its
// countdown with +30 and Skip. Anywhere on it but those two opens the workout. On the workout
// screen itself the full rest bar (RestTimer) is there instead.
export default function LiveDock() {
  const nav = useNavigate()
  const active = useStore(s => s.S.active)
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest } = useUI()
  // The page keeps room at its bottom for the dock, as it does for the rest bar (index.css).
  useEffect(() => {
    document.body.classList.add('live-docked')
    return () => document.body.classList.remove('live-docked')
  }, [])
  const counting = work || timer
  const share = counting ? Math.max(0, Math.min(1, counting.left / counting.total)) : 0
  const open = () => { if (!isSwitching()) nav('/train/workout') }

  return (
    <div id="timer" className={'dock' + (timer ? ' rest' : '') + (timer?.ready ? ' ready' : '') + (work ? ' working' : '')}>
      {/* transform, not width: the bar moves every second and should not lay the dock out again */}
      {counting && <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${share})` }} /></div>}
      {/* Its name is what it shows (the routine, how long, the countdown) after "Open workout". */}
      <button type="button" className="dock-main" onClick={open}>
        <span className="vh">{t('Open workout')}</span>
        <span className="live-dot" aria-hidden="true" />
        <span className="dock-text">
          <span className="dock-name">{active.name || t('Workout')}</span>
          <span className="dock-sub"><Elapsed start={active.start} /></span>
        </span>
        {counting && <span className="t">{timer?.ready ? t('Ready') : clock(counting.left)}</span>}
      </button>
      {/* Always there, so a screen reader hears "Ready" the moment it is written into it. */}
      <span className="vh" role="status">{timer?.ready ? t('Ready') : ''}</span>
      {timer && <div className="acts">
        {!timer.ready && <Button size="sm" className="adj" icon="plus" disabled={timer.left >= REST_MAX} onClick={() => addRest(30)}
          aria-label={t('Add 30 seconds')}>30s</Button>}
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{timer.ready ? t('Dismiss') : t('Skip')}</Button>
      </div>}
    </div>
  )
}
