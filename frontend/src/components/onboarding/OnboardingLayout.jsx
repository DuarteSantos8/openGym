import { useEffect, useLayoutEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import { OnboardingContext } from '../../lib/onboarding/contexts.js'
import { PRE_AUTH, progressMax } from '../../lib/onboarding/flow.js'
import { useOnboardingStore } from '../../lib/onboarding/use-onboarding-store.js'
import { reducedMotion } from '../../lib/reduced-motion.js'
import { useStore } from '../../store/useStore.js'
import Icon from '../Icon.jsx'
import { Button } from '../ui.jsx'
import OnboardingNav from './OnboardingNav.jsx'
import ThreadLayer from './ThreadLayer.jsx'
import ThreadProvider from './ThreadProvider.jsx'

// The onboarding's layout, for every screen of the flow (motion-onboarding-thread.md §4, adapted
// from Next's route-group layout to this app's hash routes): the answers and the flow's navigation
// (OnboardingContext), the thread (ThreadProvider, ThreadLayer: nowhere else), the nav row, and
// the screen. It outlives every screen, so the line one rests on is where the next one's thread
// starts. Width and gutters are the shell's (#app).
//
// Who may see what: before there is an account only the invite landing and the name step; without
// a hub to save to, or once complete, the flow steps aside to Home.
const EASE = 'cubic-bezier(.32,.72,0,1)'

export default function OnboardingLayout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const navType = useNavigationType()
  const user = useStore(s => s.user)
  const store = useOnboardingStore({ user, navigate, location, navType })
  const { screen, state, hub, act, refresh } = store
  const navRef = useRef(null)
  const host = useRef(null)

  useEffect(() => {
    if (!screen) return
    const next = progressMax(state.progress, screen)
    if (next.some((v, i) => v !== state.progress[i])) act({ type: 'progress', progress: next })
  }, [screen, state.progress, act])

  // The screen comes in after its anchor has been measured at rest (a child's layout effect runs
  // before this one): in from 24px and a fade over 320ms, back the other way; reduced motion keeps
  // a 120ms fade. The thread carries the continuity, so the old screen simply goes.
  useLayoutEffect(() => {
    const el = host.current?.firstElementChild
    if (!el?.animate) return
    if (reducedMotion()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }); return }
    const back = navType === 'POP' || !!location.state?.back
    const rtl = getComputedStyle(el).direction === 'rtl'
    const dx = (back ? -24 : 24) * (rtl ? -1 : 1)
    el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: 60, easing: EASE, fill: 'backwards' })
  }, [location.key])

  let content = children
  if (screen && !user && !PRE_AUTH.includes(screen)) content = <Navigate to="/" replace />
  else if (screen && user && !PRE_AUTH.includes(screen) && (hub === 'unavailable' || hub === 'complete')) content = <Navigate to="/home" replace />
  const offline = (hub === 'offline' || hub === 'busy') && !!user && !PRE_AUTH.includes(screen)

  return (
    <OnboardingContext.Provider value={store}>
      <ThreadProvider navRef={navRef}>
        <div className="ob">
          <OnboardingNav ref={navRef} />
          {offline && <div className="ob-pk-err" role="status">
            <Icon name="info" /><span>{hub === 'busy'
              ? t('Gains is busy right now. Try again in a moment. Nothing you answered is lost.')
              : t('Check your connection and try again. Nothing you answered is lost.')}</span>
            <Button size="sm" variant="plain" onClick={() => { refresh() }}>{t('Try again')}</Button>
          </div>}
          <ThreadLayer />
          <div className="ob-host" ref={host}>{content}</div>
        </div>
      </ThreadProvider>
    </OnboardingContext.Provider>
  )
}
