import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import './halloween.css'

/* Halloween (v1.4.3), fetched only while the theme shows (components/Seasonal.jsx). All of it is
   hand-drawn inline SVG, moved with CSS transforms and opacity only: no rAF loop, nothing that
   lays the page out again, and every animation has an end. Everything is aria-hidden and lets
   taps through, except the spider and the pumpkin, which are the point. Never on the workout
   screen: App.jsx hides the layer there, and no workout view has a spot. */

/* ---------------------------------------------------------------- art -- */

// A corner web: spokes out of the corner and sagging threads between them, drawn once.
const WEB = (() => {
  const spokes = [3, 22, 44, 66, 87].map(a => (a * Math.PI) / 180)
  const rings = [9, 19, 30, 42, 53]
  const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)].map(v => v.toFixed(1)).join(' ')
  let d = spokes.map(a => `M0 0L${pt(58, a)}`).join('')
  rings.forEach((r, i) => {
    for (let s = 0; s < spokes.length - 1; s++) {
      const a = spokes[s], b = spokes[s + 1]
      // A little unevenness, so it reads as spun rather than plotted.
      const sag = 0.78 + ((i + s) % 3) * 0.04
      d += `M${pt(r, a)}Q${pt(r * sag, (a + b) / 2)} ${pt(r, b)}`
    }
  })
  return d
})()

// A bat, drawn as its right half and mirrored, so both wings always match.
const BAT = (() => {
  const R = [['M', [16, 5.6]], ['L', [16.9, 3.5]], ['L', [17.5, 5.3]], ['Q', [21, 2.3], [25.5, 2.6]], ['Q', [29.6, 3], [31.6, 6.2]],
    ['Q', [29.2, 5.7], [27.6, 7.7]], ['Q', [25.4, 6.6], [23.8, 8.5]], ['Q', [21.6, 7.8], [20.4, 10.1]], ['Q', [18.6, 9.9], [17.5, 11.5]], ['Q', [16.8, 12.7], [16, 13.8]]]
  const m = ([x, y]) => `${(32 - x).toFixed(1)} ${y}`
  const f = ([x, y]) => `${x} ${y}`
  let d = R.map(([c, a, b]) => c + f(a) + (b ? ' ' + f(b) : '')).join('')
  for (let i = R.length - 1; i > 0; i--) {
    const [c, a, b] = R[i], from = R[i - 1][2] || R[i - 1][1]
    d += c === 'Q' ? `Q${m(a)} ${m(from)}` : `L${m(from)}`
  }
  return d + 'Z'
})()

const Bat = ({ className = '' }) => (
  <svg className={'hw-batsvg ' + className} viewBox="0 0 32 16" aria-hidden="true" focusable="false"><path d={BAT} /></svg>
)

const Web = ({ className = '' }) => (
  <svg className={'hw-web ' + className} viewBox="0 0 60 60" aria-hidden="true" focusable="false"><path d={WEB} /></svg>
)

const Spider = () => (
  <svg className="hw-spidersvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g className="hw-legs hw-legs-l">
      <path d="M9 11.6 5.6 8.2 3.4 9.6M8.4 13.6 4.4 12.2 2.4 14.2M8.6 15.6 4.8 16.8 3.4 19.2M9.4 17.4 7 20.2 6.6 22.6" />
    </g>
    <g className="hw-legs hw-legs-r">
      <path d="M15 11.6l3.4-3.4 2.2 1.4M15.6 13.6l4-1.4 2 2M15.4 15.6l3.8 1.2 1.4 2.4M14.6 17.4l2.4 2.8.4 2.4" />
    </g>
    <ellipse className="hw-body" cx="12" cy="14.6" rx="3.9" ry="4.4" />
    <circle className="hw-body" cx="12" cy="9.4" r="2.6" />
    <circle className="hw-eye" cx="11" cy="9.2" r=".75" /><circle className="hw-eye" cx="13" cy="9.2" r=".75" />
  </svg>
)

const Pumpkin = () => (
  <svg className="hw-pumpkinsvg" viewBox="0 0 48 38" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="hw-pk" cx="45%" cy="40%" r="65%">
        <stop offset="0" stopColor="#ffab4a" /><stop offset="1" stopColor="#e2600d" />
      </radialGradient>
    </defs>
    <path className="hw-stem" d="M22.2 8.6c-.3-3.6 1.1-6.2 4.2-7.4l1.2 1.9c-2 .9-2.7 2.8-2.4 5.5Z" />
    <path className="hw-vine" d="M26 6.4c2.4-1.6 5-.9 5.6 1.2-1.9-.8-3.7-.6-5.2.7" />
    <g fill="url(#hw-pk)" className="hw-lobes">
      <ellipse cx="11" cy="23" rx="8.6" ry="11.6" />
      <ellipse cx="37" cy="23" rx="8.6" ry="11.6" />
      <ellipse cx="16.5" cy="22.4" rx="9.6" ry="13.2" />
      <ellipse cx="31.5" cy="22.4" rx="9.6" ry="13.2" />
      <ellipse cx="24" cy="22" rx="9.4" ry="14" />
    </g>
    <g className="hw-face">
      <path className="hw-eyes" d="M13.4 18.2h6.4l-3.1-5.4ZM28.2 18.2h6.4l-3.3-5.4Z" />
      <path d="M22.5 22.4h3L24 19.9Z" />
      <path d="M12.6 24.6Q24 31 35.4 24.6l-1.9 4.1-2.4-1.3-2 3-2.5-1.9-2.6 3-2.6-3-2.5 1.9-2-3-2.4 1.3Z" />
    </g>
  </svg>
)

const Witch = () => (
  <svg className="hw-witchsvg" viewBox="0 -3 80 46" aria-hidden="true" focusable="false">
    <path d="M7 34.2 74 25.6l.3 2.2L7.4 36.4Z" />
    <path d="M.8 28.8c4.8.2 9 1.6 13.2 3.6l.6 3.8c-4.4 2-8.8 3.2-14 3.6 2.6-2.4 3.6-4.6 2.8-6.8-.4-1.6-1.4-3-2.6-4.2Z" />
    <path d="M14.8 31.6l1.6-.2.8 5.4-1.6.3Z" />
    <path d="M37.2 17.4c-7.8 1.2-13.4 5.6-17.2 11.2 4.6-1.8 9.4-2.2 14-1.6Z" />
    <path d="M34.4 30.2c-3.4-5.8-2-11.8 2.6-15.4 3.2-2.4 7.4-2.4 10 .4 2.8 3 2.4 7.6.8 11.2l3.8 2.4Z" />
    <path d="M46 18.4c2.6 2 4.8 4.6 6.4 7.8l-2 .9c-1.8-2.6-4-4.8-5.8-6.6Z" />
    <path d="M45.4 26.2 53.6 31h3.4l-.4 2.2h-4.4l-8.6-4.6Z" />
    <path d="M43.4 11.4c-3.4.8-5.8 3.4-7.8 7 2.8-1.6 5-2.2 7.6-2.4Z" />
    <circle cx="46.6" cy="12.6" r="3.4" />
    <path d="M49.6 12.2l3.8 1.4-3.6.8Z" />
    <path d="M37.4 10.2c3.2-1.8 13.6-2 17.8-.5.7.3.5 1.4-.3 1.4-5.2-.3-11.6 0-17 .5-.9 0-1.2-.9-.5-1.4Z" />
    <path d="M41.6 9.6h8.6C48.4 5 45.2 1.2 39.6-1.8c2.8 3.2 3.4 6.6 2 11.4Z" />
  </svg>
)

// A skeleton hanging by its hands from an edge, for the Stats page.
const Skeleton = () => (
  <svg className="hw-skelsvg" viewBox="0 0 24 42" aria-hidden="true" focusable="false">
    <path className="hw-bones" d="M7.6 1.4 8.8 13M16.4 1.4 15.2 13M8.8 13h6.4M12 13v13M9 16.4c2 .8 4 .8 6 0M9.2 19.2c1.9.7 3.7.7 5.6 0M9.6 22c1.6.6 3.2.6 4.8 0M9.4 26.4h5.2M10.4 26.6l-.8 11.6-2 1.4M13.6 26.6l.8 11.6 2 1.4" />
    <path className="hw-skull" d="M12 3.6c2.4 0 4 1.7 4 3.9 0 1.4-.7 2.4-1.6 2.9v1.4h-4.8v-1.4C8.7 9.9 8 8.9 8 7.5c0-2.2 1.6-3.9 4-3.9Z" />
    <circle className="hw-socket" cx="10.5" cy="7.6" r="1" /><circle className="hw-socket" cx="13.5" cy="7.6" r="1" />
    <path className="hw-socket" d="M11.4 9.6h1.2l-.6-1Z" />
  </svg>
)

// A crescent moon with a very small witch crossing it, for a header's quiet corner.
const MoonWitch = () => (
  <span className="hw-moon" aria-hidden="true">
    <svg className="hw-moonsvg" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M20.6 3.2A13 13 0 1 0 28.8 22 10.4 10.4 0 0 1 20.6 3.2Z" /></svg>
    <span className="hw-moonwitch"><Witch /></span>
  </span>
)

// A spider hanging still from a thread of `len` px, bobbing a little now and then.
const HangingSpider = ({ len = 28, className = '' }) => (
  <span className={'hw-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="hw-hangthread" /><Spider />
  </span>
)

/* -------------------------------------------------------- the layer -- */

// Once per session at most, decided once: the witch is rare on purpose.
let witchPlan = null
let witchFlown = false

/* The spider drops at every start of the app, and again whenever it comes back to the front after
   AWAY_MS or more in the background (closed and opened again, as far as anyone can tell). Time away
   is counted here, at module level, so it is right however long the layer itself was mounted. */
export const AWAY_MS = 30 * 60 * 1000
let startTried = false
let hiddenAt = null
const onReturn = new Set()
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return }
    const away = hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS
    hiddenAt = null
    if (away) onReturn.forEach(fn => fn())
  })
}

/** The spider at every start, and now and then the witch. Nothing while `hidden` (the workout). */
export function Layer({ hidden, fresh }) {
  const [spider, setSpider] = useState(null)   // null | 'drop' | 'still'
  const [witch, setWitch] = useState(false)
  const hiddenNow = useRef(hidden)
  hiddenNow.current = hidden
  useEffect(() => {
    if (!spider || spider === 'drop') return
    // Reduced motion: a tiny spider sits in the corner for a few seconds, and that is all.
    const tm = setTimeout(() => setSpider(null), 4000)
    return () => clearTimeout(tm)
  }, [spider])
  useEffect(() => {
    if (hidden) setSpider(null)
    const drop = () => setSpider(cur => cur || (reducedMotion() ? 'still' : 'drop'))
    // The start: once per session, and not over a start straight into a running workout.
    if (!startTried && !hidden) {
      startTried = true
      if (fresh) drop()
    }
    // Back after a while away: again, unless it came back to the workout screen.
    const back = () => { if (!hiddenNow.current) drop() }
    onReturn.add(back)
    return () => { onReturn.delete(back) }
  }, [hidden, fresh])
  useEffect(() => {
    if (hidden || witchFlown || reducedMotion()) return
    if (witchPlan === null) witchPlan = Math.random() < 0.4 ? 20000 + Math.random() * 60000 : false
    if (!witchPlan) return
    const tm = setTimeout(() => { witchFlown = true; setWitch(true) }, witchPlan)
    return () => clearTimeout(tm)
  }, [hidden])
  if (hidden) return null
  return <>
    {spider && <SpiderDrop still={spider === 'still'} onGone={() => setSpider(null)} />}
    {witch && <div className="hw-witch" aria-hidden="true" onAnimationEnd={() => setWitch(false)}><Witch /></div>}
  </>
}

function SpiderDrop({ still, onGone }) {
  const [scurry, setScurry] = useState(false)
  if (still) return <div className="hw-spider hw-still" aria-hidden="true"><Spider /></div>
  // The outer element swings on its thread (a damped pendulum), the inner one drops and climbs.
  return <div className={'hw-spider' + (scurry ? ' hw-scurry' : '')} aria-hidden="true"
    onAnimationEnd={e => { if (e.animationName === 'hw-scurry' && e.target.classList.contains('hw-spiderbtn')) onGone() }}>
    <div className="hw-drop" onAnimationEnd={e => { if (e.target === e.currentTarget) onGone() }}>
      <span className="hw-thread" />
      <button type="button" className="hw-spiderbtn" tabIndex={-1} aria-hidden="true"
        onPointerDown={e => { e.stopPropagation(); setScurry(true) }}><Spider /></button>
    </div>
  </div>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  switch (spot) {
    case 'header-bats': return <HeaderBats />
    case 'home-hero': return <Web className="hw-web-br" />
    case 'plan-card': return <Web className="hw-web-tr" />
    case 'home-streak': return <PeekPumpkin />
    // Stats: bats and the moon in the header, two spiders in the empty end of the lifetime tile,
    // a skeleton hanging off the activity card, cobwebs in two bottom corners, pumpkins peeking.
    case 'stats-hdr': return <><HeaderBats /><MoonWitch /></>
    case 'stats-tile': return <span className="hw-tilespiders" aria-hidden="true"><HangingSpider len={30} /><HangingSpider len={14} className="hw-hang-b" /></span>
    case 'stats-heatmap': return <span className="hw-skel" aria-hidden="true"><Skeleton /></span>
    case 'stats-web': return <Web className="hw-web-bl" />
    case 'stats-peek': return <span className="hw-peek hw-peek-two" aria-hidden="true"><span className="hw-pk"><Pumpkin /></span><span className="hw-pk hw-pk-s"><Pumpkin /></span></span>
    // The workout screen: nothing there can be tapped, and nothing sits on a set, a button,
    // a timer, the chip row or an exercise picture. The header's corner web and its spider sit
    // in the page's side gutter, the bats fly along the rest bar's top edge, and the pumpkins
    // flank the finish screen's trophy.
    case 'workout-hdr': return <span className="hw-wcorner" aria-hidden="true"><Web className="hw-web-tl" /><HangingSpider len={22} className="hw-hang-w" /></span>
    case 'rest-timer': return <RestBats />
    case 'finish': return <span className="hw-finish" aria-hidden="true"><span className="hw-pk"><Pumpkin /></span><span className="hw-pk hw-pk-r"><Pumpkin /></span></span>
    default: return null
  }
}

// Two small bats along the rest bar's top edge, once each time the bar appears.
function RestBats() {
  if (reducedMotion()) return null
  return <span className="hw-restbats" aria-hidden="true">
    {[0, 1].map(i => <span key={i} className={'hw-restlane hw-rl' + i}><span className="hw-flap"><Bat /></span></span>)}
  </span>
}

// Three bats cross behind the title a few times, then the sky stays quiet until the next visit.
function HeaderBats() {
  const still = reducedMotion()
  return <div className={'hw-bats' + (still ? ' hw-bats-still' : '')} aria-hidden="true">
    {[0, 1, 2].map(i => <span key={i} className={'hw-batlane hw-lane' + i}><span className="hw-flap"><Bat /></span></span>)}
  </div>
}

// Said when the pumpkin is found: one a day, the same one all day.
const BOOS = [
  'Boo! You found the pumpkin. It was watching you train.',
  'Boo! Pumpkin found. Your next PR is now officially haunted.',
  'Boo! The bats were not part of the warm-up.',
  'Boo! Found it. The spiders owe you a rep.',
]

function PeekPumpkin() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the pumpkin is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('pumpkin') && onceToday('pumpkin')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      // A "boo": two short taps and a longer one, on whatever this device can buzz.
      vibrate([25, 50, 60])
      toast(t(BOOS[new Date().getDate() % BOOS.length]))
    } else toast(t('The pumpkin is napping. Come back tomorrow.'))
  }
  return <>
    <span className="hw-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'hw-pumpkin' + (hop ? ' hw-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Pumpkin /></button>
    </span>
    {burst && <div className="hw-burst" aria-hidden="true" style={{ left: burst.x, top: burst.y }}>
      {BURST.map(([dx, dy, r], i) => <span key={i} className="hw-burstbat" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', animationDelay: i * 35 + 'ms' }}><Bat /></span>)}
    </div>}
  </>
}
// Where each bat of the burst ends up, relative to the pumpkin: mostly up and out.
const BURST = [[-120, -150, -18], [-60, -210, -8], [10, -240, 4], [80, -190, 12], [140, -120, 20], [-150, -60, -24], [160, -40, 26]]
