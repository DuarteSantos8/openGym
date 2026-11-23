import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { liveBarShows, liveBarState } from '../lib/live-bar.js'
import { useDeviceLink } from './useDeviceLink.js'
import { vibrate } from '../lib/sound.js'
import Elapsed from './Elapsed.jsx'
import Icon from './Icon.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')
const WATCH_WORDS = { linked: 'Watch connected', relinking: 'Watch reconnecting', none: 'No watch linked' }

// The watch outline with a badge: a check (linked), two turning arrows (re-linking), a slash (no link).
// Outline only while the first look is still under way.
function DeviceMark ({ device }) {
  return (
    <span className={'livebar-dev ' + device} aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 28 28">
        <g className="w"><rect x="7.5" y="7.2" width="12" height="13.6" rx="3.6" /><path d="M10.4 7.2l.7-3.6h5.8l.7 3.6M10.4 20.8l.7 3.6h5.8l.7-3.6" /></g>
        {device !== 'checking' && <>
          <circle className="bd" cx="21.5" cy="21.5" r="6.3" />
          <g className="gl">
            {device === 'linked' && <path d="M18.5 21.6l2.1 2.1 3.9-4.3" />}
            {device === 'none' && <path d="M19 24l5-5" />}
            {device === 'relinking' && <g className="sp"><path d="M19.3 20.8a2.4 2.4 0 0 1 4.2-1M23.6 18.6v1.6H22M23.7 22.2a2.4 2.4 0 0 1-4.2 1M19.4 24.4v-1.6H21" /></g>}
          </g>
        </>}
      </svg>
    </span>
  )
}

// The running workout above the tab bar on every tab: one button back to it (lib/live-bar.js decides
// what it says). No actions on it by design. The listeners, the refresh and the measuring only run
// while it shows (LiveBarOn); this outer part just watches for it.
export default function LiveBar () {
  const loc = useLocation()
  const show = useStore(s => liveBarShows(s.S, loc.pathname))
  return show ? <LiveBarOn /> : null
}

function LiveBarOn () {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const timer = useUI(s => s.timer)
  // live: it looks at the links itself, as the workout's link sign does (that sign is off this screen)
  const link = useDeviceLink({ live: true })
  useEffect(() => {
    document.body.classList.add('has-livebar')
    return () => document.body.classList.remove('has-livebar')
  }, [])
  // The tab bar grows with the text size (rem icons and words, px padding): the bar and the page's
  // room follow its measured top edge (index.css --lb-grow), as SyncBanner does with --conn.
  useLayoutEffect(() => {
    const tabbar = document.getElementById('tabbar')
    const root = document.documentElement.style
    if (!tabbar) return undefined
    const fit = () => {
      const r = tabbar.getBoundingClientRect()
      if (r.height > 0) root.setProperty('--tabbar-top', Math.round(window.innerHeight - r.top) + 'px')
      else root.removeProperty('--tabbar-top')
    }
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(tabbar)
    window.addEventListener('resize', fit)
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); root.removeProperty('--tabbar-top') }
  }, [])

  // "Set 2 of 4" gives way to "2/4", then to nothing, before the exercise name is cut. Measured:
  // the name's box is clipped (scrollWidth > clientWidth) at this step, so take the next one.
  const [step, setStep] = useState(0)
  const [width, setWidth] = useState(0)
  const btn = useRef(null)
  const ex = useRef(null)
  const b = liveBarState(S, { timer, rows: link.rows, checking: link.checking })
  const setKey = b?.set ? b.set.n + '/' + b.set.of : ''
  // A different exercise, set or rest starts again at the long label (set during render, so the measure below sees step 0).
  const key = (b?.exercise || '') + '|' + setKey + '|' + !!b?.rest
  const [seen, setSeen] = useState(key)
  if (seen !== key) { setSeen(key); setStep(0) }
  useLayoutEffect(() => {
    if (ex.current && step < 2 && ex.current.scrollWidth > ex.current.clientWidth) setStep(step + 1)
  }, [step, width, b?.exercise, setKey, !!b?.rest])
  useEffect(() => {
    if (!btn.current || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { setStep(0); setWidth(btn.current.clientWidth) })
    ro.observe(btn.current)
    return () => ro.disconnect()
  }, [])

  if (!b) return null
  // One buzz as the rise starts (the app's own helper: the native pulse on the phones).
  const rise = () => {
    vibrate(10)
    nav('/workout', { state: { rise: 'rise' } }) // the page's entrance, App.jsx
  }
  const routine = b.routine || t('Workout')
  const exercise = b.allDone ? t('All sets done') : b.exercise
  const restWord = b.rest?.switch ? t('Switch sides') : t('Rest')
  const label = [
    t('Workout in progress'), routine,
    // The time left too: the rest timer that used to say it is not on the screens the bar is on.
    b.rest ? restWord + ' ' + clock(b.rest.left) : exercise,
    b.rest ? (b.next ? t('Next: {0}', b.next) : '') : b.set ? t('Set {0} of {1}', b.set.n, b.set.of) : '',
    b.total ? t('{0} of {1} sets done', b.done, b.total) : '',
    WATCH_WORDS[b.device] ? t(WATCH_WORDS[b.device]) : '',
  ].filter(Boolean).join(', ') + '. ' + t('Opens the workout')

  return (
    // The running time as the description: read when a screen reader reaches the bar, never announced by itself.
    <button ref={btn} id="livebar" className="livebar" type="button" aria-label={label} aria-describedby="livebar-tl livebar-time" onClick={rise}>
      <span className="livebar-hl" aria-hidden="true">{b.parts.map((p, i) => <span key={i} style={{ flexGrow: p.sets }}><i style={{ transform: `scaleX(${p.done / p.sets})` }} /></span>)}</span>
      {/* Says a tap opens the workout upward; the mirror of the workout page's Minimize chevron,
          and in the same order as that page's top bar: arrow first, the watch at the end. */}
      <Icon name="chevronUp" size={18} className="livebar-up" />
      <span className="livebar-txt" aria-hidden="true">
        <span id="livebar-tl" hidden>{t('Duration')}</span>
        <span className="livebar-l1">
          <span className="livebar-nm">{routine}</span>
          {/* A recording light by the clock: the workout is running. Still while paused. */}
          <span id="livebar-time" className="livebar-el livebar-num"><i className={'livebar-on' + (b.pausedAt ? ' paused' : '')} /><Elapsed start={b.start} pausedAt={b.pausedAt} /></span>
        </span>
        {b.rest
          ? <span className="livebar-l2">
            <span className="livebar-rl">{restWord}</span>
            <span className="livebar-cd livebar-num">{clock(b.rest.left)}</span>
            {b.next && <span className="livebar-nx">{t('Next: {0}', b.next)}</span>}
          </span>
          : exercise && <span className="livebar-l2">
            <span className="livebar-ex" ref={ex}>{exercise}</span>
            {b.set && step < 2 && <span className="livebar-st">{step ? setKey : t('Set {0} of {1}', b.set.n, b.set.of)}</span>}
          </span>}
      </span>
      {b.device && <DeviceMark device={b.device} />}
    </button>
  )
}
