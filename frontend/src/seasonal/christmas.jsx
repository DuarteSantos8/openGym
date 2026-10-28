import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import { DOORS, LAYOUT, inAdvent, adventOf, doorState, openDoor, markDone, nextDoor } from '../lib/advent.js'
import { MOBILE } from '../lib/mobile.js'
import { appIconState, setAppIcon } from '../lib/app-icon.js'
import { yearStats, workoutsOfYear } from '../lib/wrapped.js'
import { bestWeightForEntry, defaultConfig } from '../lib/history.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText, fmtNum, fmtVol, uid } from '../lib/format.js'
import { shownWeight, exUnitOf } from '../lib/ex-unit.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { doorFor, STRETCH } from './advent-doors.js'
import './christmas.css'

/* Christmas (v1.4.4), fetched only while the theme shows (components/Seasonal.jsx), with the
   advent calendar (lib/advent.js, seasonal/advent-doors.js). Like Halloween: hand-drawn inline
   SVG, moved with transforms and opacity only, every animation with an end, and everything
   aria-hidden and letting taps through except the present and the calendar. The snow and the
   sleigh go behind the page (z-index -1), so they can never sit on a button. */

/* ---------------------------------------------------------------- art -- */

const Flake = () => (
  <svg className="xm-flakesvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M12 5.5 9.8 3.6M12 5.5l2.2-1.9M12 18.5l-2.2 1.9M12 18.5l2.2 1.9M5.6 8.3 5 5.5M5.6 8.3 2.8 9.2M18.4 15.7l.6 2.8M18.4 15.7l2.8-.9M5.6 15.7l-2.8-.9M5.6 15.7 5 18.5M18.4 8.3l2.8.9M18.4 8.3l.6-2.8" />
  </svg>
)

// Two leaves and three berries, for a card's empty corner.
const Holly = ({ className = '' }) => (
  <svg className={'xm-holly ' + className} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path className="xm-leaf" d="M20 20 17 16.6l-2.2 4-3.9-2-1 4.8-4-1.2L4 31.4l5-2.7 1 2.4 3-3.9 2.3 1.9 1.6-4 2.2.8Z" />
    <path className="xm-leaf xm-leaf-b" d="m20 20 3.3-4-4-1.2 2-3.9-4.8-.4.8-4.1L9.2 5l2.8 4.8-2.4.9 3.9 3-1.9 2.2 4 1.7-.8 2.2Z" />
    <circle className="xm-berry" cx="21.2" cy="21.4" r="2.7" /><circle className="xm-berry" cx="25" cy="19.2" r="2.4" /><circle className="xm-berry" cx="23.4" cy="25" r="2.3" />
    <circle className="xm-shine" cx="20.4" cy="20.5" r=".8" /><circle className="xm-shine" cx="24.3" cy="18.4" r=".7" />
  </svg>
)

const Hat = () => (
  <svg className="xm-hatsvg" viewBox="0 0 28 22" aria-hidden="true" focusable="false">
    <path className="xm-red" d="M4.5 16.5C6 9 10.5 3.6 17 3.2c3.4-.2 6 1.6 7.4 4.4-2.4-1-4.6-.9-6.2.4 1.6 2.6 2.4 5.4 2.4 8.5Z" />
    <circle className="xm-white" cx="24.6" cy="8.6" r="2.9" />
    <rect className="xm-white" x="2.2" y="14.6" width="21.4" height="5.4" rx="2.7" />
  </svg>
)

// A present with a ribbon and a bow; `hue` 0 to 2 picks its paper.
const Present = ({ hue = 0 }) => (
  <svg className={'xm-presentsvg xm-p' + hue} viewBox="0 0 32 30" aria-hidden="true" focusable="false">
    <rect className="xm-box" x="3" y="11" width="26" height="18" rx="2.4" />
    <rect className="xm-lid" x="1.6" y="8" width="28.8" height="6" rx="2" />
    <path className="xm-ribbon" d="M14 8h4v21h-4Z" />
    <path className="xm-bow" d="M16 8c-2.4-4.6-8-6.4-8.8-3.4C6.5 7.3 10.6 8.2 16 8Zm0 0c2.4-4.6 8-6.4 8.8-3.4.7 2.7-3.4 3.6-8.8 3.4Z" />
  </svg>
)

const Snowman = () => (
  <svg className="xm-snowmansvg" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <circle className="xm-snow" cx="20" cy="33" r="11" />
    <circle className="xm-snow" cx="20" cy="15.5" r="8" />
    <rect className="xm-hatblk" x="13.5" y="2" width="13" height="6.6" rx="1.2" />
    <rect className="xm-hatblk" x="10.5" y="7.6" width="19" height="2.3" rx="1.1" />
    <rect className="xm-red" x="13.5" y="6.2" width="13" height="1.6" />
    <circle className="xm-coal" cx="17.2" cy="14" r="1.1" /><circle className="xm-coal" cx="22.8" cy="14" r="1.1" />
    <path className="xm-carrot" d="M20 16.2 27.6 18 20 19.2Z" />
    <path className="xm-red" d="M12.6 21.6c4.6 2 10.2 2 14.8 0l.4 2.6c-5 2.2-10.6 2.2-15.6 0Z" />
  </svg>
)

// A gingerbread person, arms up, hanging by both hands from an edge.
const Gingerbread = () => (
  <svg className="xm-gingersvg" viewBox="0 0 24 34" aria-hidden="true" focusable="false">
    <path className="xm-ginger-limb" d="M9.4 14 5.4 2.2M14.6 14l4-11.8M10.4 23.4l-2.2 8.4M13.6 23.4l2.2 8.4" />
    <circle className="xm-ginger" cx="12" cy="9" r="4.8" />
    <rect className="xm-ginger" x="7.6" y="12.6" width="8.8" height="12" rx="3.8" />
    <circle className="xm-icing-dot" cx="10.3" cy="8.2" r=".8" /><circle className="xm-icing-dot" cx="13.7" cy="8.2" r=".8" />
    <path className="xm-icing" d="M10.2 10.6q1.8 1.4 3.6 0M6.4 4.4l1.6-.6M16 3.8l1.6.6M8.4 29.6l1.6.3M14 29.9l1.6-.3" />
    <circle className="xm-gumdrop" cx="12" cy="16" r="1" /><circle className="xm-gumdrop xm-g2" cx="12" cy="19.6" r="1" />
  </svg>
)

const Bauble = ({ gold = false }) => (
  <svg className={'xm-baublesvg' + (gold ? ' xm-gold' : '')} viewBox="0 0 16 20" aria-hidden="true" focusable="false">
    <rect className="xm-cap" x="5.6" y="1" width="4.8" height="3.4" rx=".8" />
    <circle className="xm-ball" cx="8" cy="11.6" r="7" />
    <path className="xm-band" d="M1.4 10.4q6.6 2.8 13.2 0" />
    <circle className="xm-gleam" cx="5.2" cy="8.6" r="1.6" />
  </svg>
)

// Santa's sleigh and two reindeer, the front one with the famous nose, as one silhouette.
const Sleigh = () => (
  <svg className="xm-sleighsvg" viewBox="0 0 120 40" aria-hidden="true" focusable="false">
    <path className="xm-ink" d="M5 24h30c3.2 0 5.6-2 6.6-5.2l1.8-6.4h-5.6l-1.8 4.2H13c-3.4 0-6.6 2.6-8 7.4Z" />
    <path className="xm-line" d="M1.6 31.6h35.6c4.2 0 6.6-2 7.4-5M12 25v6.4M32 25v6.4" />
    <path className="xm-ink" d="M16.4 16.6c0-5.4 3-8.8 7-8.8s7 3.4 7 8.8Z" />
    <circle className="xm-ink" cx="23.4" cy="6.4" r="3.2" />
    <path className="xm-ink" d="M20.2 4.8c.8-3 3.6-4.6 6.8-3.4l2.6 2.8-2.8.4Z" />
    <path className="xm-line xm-reins" d="M42 13.6 63 16.8M66 15.4 89 16.8" />
    <path className="xm-ink" d="M61.6 15.4c2.6-2.4 10-2.6 15-1l4-5.8 2.4.8-2.6 7.4c-.6 2.6-3.8 4-9.4 4.2-6 .2-9.8-1.2-9.4-5.6Z" />
    <path className="xm-line" d="M64.6 19.6 61 26.4M68 20.4l-1.2 6.6M75.4 20.4l2.6 6.2M78.6 19.4l3.8 5.2M81.6 8.4l-1.4-4M80.8 6l-2.4-1M83.6 8.8l1.4-4.2M84.6 6.2l2.4-1" />
    <path className="xm-ink" d="M87.6 15.4c2.6-2.4 10-2.6 15-1l4-5.8 2.4.8-2.6 7.4c-.6 2.6-3.8 4-9.4 4.2-6 .2-9.8-1.2-9.4-5.6Z" />
    <path className="xm-line" d="M90.6 19.6 87 26.4M94 20.4l-1.2 6.6M101.4 20.4l2.6 6.2M104.6 19.4l3.8 5.2M107.6 8.4l-1.4-4M106.8 6l-2.4-1M109.6 8.8l1.4-4.2M110.6 6.2l2.4-1" />
    <circle className="xm-nose" cx="109.4" cy="10.4" r="1.7" />
  </svg>
)

/* -------------------------------------------------------- the layer -- */

/* Snow at every start of the app, and again when it comes back after AWAY_MS or more away, as
   the Halloween spider does. Time away is counted at module level. */
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
let sleighPlan = null

/**
 * The snow and, once a day, the sleigh. On the workout screen (`hidden`) only the snow, and only
 * with "Also during workouts" on (`workout`); with reduced motion, neither.
 */
export function Layer({ hidden, fresh, workout }) {
  const [snow, setSnow] = useState(0)        // 0: no snow; each new number is a new fall
  const [sleigh, setSleigh] = useState(false)
  const show = !hidden || !!workout
  useEffect(() => {
    const fall = () => { if (!reducedMotion()) setSnow(n => n + 1) }
    if (!startTried) {
      startTried = true
      if (fresh) fall()
    }
    onReturn.add(fall)
    return () => { onReturn.delete(fall) }
  }, [fresh])
  useEffect(() => {
    if (hidden || reducedMotion() || doneToday('sleigh')) return
    if (sleighPlan === null) sleighPlan = 12000 + Math.random() * 30000
    const tm = setTimeout(() => { if (onceToday('sleigh')) setSleigh(true) }, sleighPlan)
    return () => clearTimeout(tm)
  }, [hidden])
  return <>
    {snow > 0 && show && !reducedMotion() && <Snow key={snow} few={hidden} onGone={() => setSnow(0)} />}
    {sleigh && !hidden && <div className="xm-sleigh" aria-hidden="true" onAnimationEnd={() => setSleigh(false)}><Sleigh /></div>}
  </>
}

/* A few flakes, each falling a few times at its own pace, then gone: about a minute in all. The
   places and speeds come from a small fixed table, so the snow looks the same on every start. */
const FLAKES = [
  [6, 7, 13, 0, 18], [17, 5, 16, 4.5, -14], [29, 9, 12, 1.5, 22], [41, 6, 15, 7, -10], [52, 8, 14, 2.5, 16],
  [63, 5, 17, 5.5, -20], [74, 10, 13, 0.8, 12], [85, 6, 16, 3.4, -16], [94, 7, 14, 6.2, 10], [35, 4, 18, 9, 14],
  [70, 4, 19, 10.5, -12], [12, 5, 17, 11.5, 20],
]
function Snow({ few, onGone }) {
  const flakes = few ? FLAKES.filter((_, i) => i % 2 === 0) : FLAKES
  const left = useRef(flakes.length)
  return <div className="xm-snowfall" aria-hidden="true">
    {flakes.map(([x, size, dur, delay, drift], i) => (
      <span key={i} className={'xm-flake' + (i % 3 === 0 ? ' xm-star' : '')}
        style={{ left: x + '%', '--s': size + 'px', '--d': dur + 's', '--delay': delay + 's', '--drift': drift + 'px' }}
        onAnimationEnd={e => { if (e.target === e.currentTarget && --left.current === 0) onGone() }}>
        {i % 3 === 0 ? <Flake /> : null}
      </span>
    ))}
  </div>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  switch (spot) {
    case 'header-bats': return <Lights />
    case 'home-hero': return <Holly className="xm-holly-br" />
    case 'home-streak': return <PeekPresent />
    case 'streak-flame': return <span className="xm-hat" aria-hidden="true"><Hat /></span>
    case 'home-advent': return <><IconSuggest /><AdventCard /></>
    // Stats: lights along the header, two baubles in the lifetime tile, a gingerbread person
    // hanging off the activity card, holly in a corner and a snowman peeking over a card.
    case 'stats-hdr': return <Lights />
    case 'stats-tile': return <span className="xm-baubles" aria-hidden="true"><HangingBauble len={26} /><HangingBauble len={12} gold className="xm-hang-b" /></span>
    case 'stats-heatmap': return <span className="xm-ginger-hang" aria-hidden="true"><Gingerbread /></span>
    case 'stats-web': return <Holly className="xm-holly-bl" />
    case 'stats-peek': return <span className="xm-peek xm-peek-snowman" aria-hidden="true"><span className="xm-pk"><Snowman /></span></span>
    // The workout screen: a bauble in the side gutter, two flakes along the rest bar's top edge,
    // presents beside the finish screen's trophy. Nothing on a set, a button or a timer.
    case 'workout-hdr': return <span className="xm-wcorner" aria-hidden="true"><HangingBauble len={20} className="xm-hang-w" /></span>
    case 'rest-timer': return <RestFlakes />
    case 'streak-party':
    case 'finish': return <span className="xm-finish" aria-hidden="true"><span className="xm-pk"><Present hue={0} /></span><span className="xm-pk xm-pk-r"><Present hue={1} /></span></span>
    default: return null
  }
}

/* A string of fairy lights along the top of a header: the wire sags between three hooks, the
   bulbs hang off it and twinkle a while, then simply stay lit. */
const SAG = [[0, 3], [100, 5], [200, 3], [300, 5]]
const BULBS = (() => {
  const out = []
  for (let k = 0; k < 3; k++) {
    const [x0, y0] = SAG[k], [x1, y1] = SAG[k + 1], cx = (x0 + x1) / 2, cy = 17
    for (const tt of [0.2, 0.5, 0.8]) {
      const u = 1 - tt
      out.push([(u * u * x0 + 2 * u * tt * cx + tt * tt * x1) / 3, u * u * y0 + 2 * u * tt * cy + tt * tt * y1])
    }
  }
  return out
})()
const WIRE = 'M' + SAG.map(([x, y], i) => (i ? `Q${(SAG[i - 1][0] + x) / 2} 17 ${x} ${y}` : `${x} ${y}`)).join('')
function Lights() {
  const still = reducedMotion()
  return <div className={'xm-lights' + (still ? ' xm-still' : '')} aria-hidden="true">
    <svg className="xm-wire" viewBox="0 0 300 22" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={WIRE} /></svg>
    {BULBS.map(([x, y], i) => <span key={i} className={'xm-bulb xm-b' + (i % 4)} style={{ left: x + '%', top: y + 'px', animationDelay: (i % 3) * 0.45 + (i % 2) * 0.2 + 's' }} />)}
  </div>
}

const HangingBauble = ({ len = 20, gold = false, className = '' }) => (
  <span className={'xm-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="xm-hangthread" /><Bauble gold={gold} />
  </span>
)

function RestFlakes() {
  if (reducedMotion()) return null
  return <span className="xm-restflakes" aria-hidden="true">
    {[0, 1].map(i => <span key={i} className={'xm-restlane xm-rl' + i}><span className="xm-restflake"><Flake /></span></span>)}
  </span>
}

// Said when the present is unwrapped: one a day, the same one all day.
const GIFTS = [
  'You found a present! Inside: one extra rep of good vibes.',
  'Unwrapped! It is a voucher for one guilt-free rest day.',
  'A present! It contains confidence. Heavy, so lift with your legs.',
  'Surprise! A tiny trophy, just for showing up.',
]
const CONFETTI = [[-110, -150, -30], [-60, -200, 20], [0, -230, -12], [60, -190, 34], [120, -140, -24], [-140, -70, 40], [150, -60, -40], [-30, -120, 60], [36, -110, -50]]

function PeekPresent() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1500)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the present is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('present') && onceToday('present')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      vibrate([20, 40, 20])
      toast(t(GIFTS[new Date().getDate() % GIFTS.length]))
    } else toast(t('That one is unwrapped. A new present turns up tomorrow.'))
  }
  return <>
    <span className="xm-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'xm-present' + (hop ? ' xm-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Present hue={2} /></button>
    </span>
    {burst && <Confetti at={burst} />}
  </>
}

const Confetti = ({ at }) => (
  <div className="xm-burst" aria-hidden="true" style={{ left: at.x, top: at.y }}>
    {CONFETTI.map(([dx, dy, r], i) => <span key={i} className={'xm-bit xm-c' + (i % 4)} style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r * 6 + 'deg', animationDelay: i * 30 + 'ms' }} />)}
  </div>
)

/* ------------------------------------------------ the festive icon -- */

// Asked once per phone: the icon is the phone's own (lib/app-icon.js), so is the answer.
export const ICON_ASKED = 'og_season_xmas_icon'
const asked = () => { try { return !!localStorage.getItem(ICON_ASKED) } catch (e) { return true } }
const markAsked = () => { try { localStorage.setItem(ICON_ASKED, '1') } catch (e) { /* no storage: it simply asks again */ } }

async function wearFestiveIcon() {
  const toast = useUI.getState().toast
  try {
    const r = await setAppIcon('christmas')
    toast(r.later ? t('New icon on its way. It shows up once you leave the app.') : t('Festive icon on. Very fetching.'))
    return true
  } catch (e) {
    toast(t('The icon could not be changed.'))
    return false
  }
}

/** Home, on a phone that can switch icons, from 1 December: one gentle question, once. */
function IconSuggest() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!MOBILE || asked()) return
    let live = true
    appIconState().then(s => { if (live && s && s.name !== 'christmas') setShow(true) })
    return () => { live = false }
  }, [])
  if (!show) return null
  const done = () => { markAsked(); setShow(false) }
  return <div className="card xm-ask" data-xmas-icon>
    <button type="button" className="iconbtn wr-x" aria-label={t('Not now')} onClick={done}><Icon name="xmark" /></button>
    <div className="row" style={{ gap: 12, alignItems: 'center', paddingInlineEnd: 34 }}>
      <img src="app-icons/christmas.png" alt="" width="48" height="48" className="xm-ask-img" draggable="false" />
      <div style={{ minWidth: 0 }}>
        <div className="ttl">{t('Fancy a festive icon?')}</div>
        <div className="muted small">{t('The barbell has put on its Santa hat. Just for this phone, and you can switch back in Settings any time.')}</div>
      </div>
    </div>
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button size="sm" variant="primary" icon="gift" onClick={async () => { done(); await wearFestiveIcon() }}>{t('Try it')}</Button>
      <Button size="sm" variant="ghost" onClick={done}>{t('No thanks')}</Button>
    </div>
  </div>
}

/* -------------------------------------------------- the calendar -- */

/** Opens something from outside the chunk (components/Seasonal.jsx openSeasonal). */
export function open(what) {
  if (what !== 'advent') return false
  openAdvent()
  return true
}

const openAdvent = day => useUI.getState().openSheet(close => <AdventCalendar close={close} initial={day} />)

/** Home, 1 to 24 December: today's door, one tap away. */
function AdventCard() {
  const S = useStore(s => s.S)
  const now = new Date()
  if (!inAdvent(now)) return null
  const a = adventOf(S, now)
  const next = nextDoor(S, now)
  const today = now.getDate()
  const title = next === today ? t('Door {0} is waiting for you', today)
    : next ? t('Door {0} is still waiting', next)
    : a.opened.length >= DOORS ? t('All 24 doors open. Merry everything!')
    : t('All caught up. See you tomorrow!')
  return <div className="card tappable xm-advent" data-advent-home style={{ cursor: 'pointer' }} {...tappable(() => openAdvent())}>
    <div className="row between">
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i xm-advent-i" aria-hidden="true">🎄</span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Advent calendar')}</div>
          <div className="ttl">{title}</div>
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
    <div className="xm-dots" aria-label={t('{0} of 24 doors open', a.opened.length)} role="img">
      {Array.from({ length: DOORS }, (_, i) => <i key={i} className={a.opened.includes(i + 1) ? 'on' : i + 1 === today ? 'now' : i + 1 > today ? 'later' : ''} />)}
    </div>
  </div>
}

const KIND = {
  fact: ['💡', 'Fun fact'],
  joke: ['😄', 'A little joke'],
  tip: ['🏋️', 'Training tip'],
  challenge: ['💪', 'Mini challenge'],
  stretch: ['🧘', 'Cosy stretch'],
  stat: ['📊', 'Stat of the day'],
  special: ['⭐', 'Merry everything!'],
}

function AdventCalendar({ close, initial }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const now = new Date()
  const year = now.getFullYear()
  const [shown, setShown] = useState(initial || null)
  const [opening, setOpening] = useState(null)
  const [shake, setShake] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const a = adventOf(S, now)
  const tap = day => {
    const st = doorState(S, day, now)
    if (st === 'locked') {
      setShake(day)
      useUI.getState().toast(t('No peeking 👀'))
      return
    }
    if (st === 'open') { setShown(day); return }
    update(s => { openDoor(s, day, now) })
    vibrate(15)
    if (reducedMotion()) { setShown(day); return }
    setOpening(day)
    timer.current = setTimeout(() => { setOpening(null); setShown(day) }, 700)
  }
  if (shown) return <DoorView day={shown} year={year} back={() => setShown(null)} close={close} />
  return <div className="xm-cal">
    <h3>🎄 {t('Advent calendar')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('One door a day until the 24th. Missed one? It waits for you.')}</div>
    <div className="xm-grid">
      {LAYOUT.map(day => {
        const st = opening === day ? 'opening' : doorState(S, day, now)
        const kind = doorFor(day, year).kind
        const label = st === 'locked' ? t('Door {0}, locked', day) : st === 'open' ? t('Door {0}, open', day) : t('Door {0}', day)
        return <button key={day} type="button" data-door={day} aria-label={label}
          className={'xm-door xm-' + st + ' xm-paper' + (day % 3) + (shake === day ? ' xm-shake' : '')}
          onClick={() => tap(day)} onAnimationEnd={e => { if (e.animationName === 'xm-shake') setShake(null) }}>
          <span className="xm-door-in" aria-hidden="true">{KIND[kind][0]}</span>
          <span className="xm-flap" aria-hidden="true"><span className="xm-num">{day}</span></span>
          {a.done.includes(day) && <span className="xm-done" aria-hidden="true">🏅</span>}
        </button>
      })}
    </div>
    <div className="muted small xm-tally">
      {t('{0} of 24 doors open', a.opened.length)}{a.done.length ? ' · ' + t('Challenges done: {0}', a.done.length) : ''}
    </div>
  </div>
}

function DoorView({ day, year, back, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const door = doorFor(day, year)
  const [icon, title] = KIND[door.kind]
  const date = new Date(year, 11, day).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' })
  const done = adventOf(S).done.includes(day)
  const [burst, setBurst] = useState(null)
  const btn = useRef(null)
  const tick = () => {
    update(s => { markDone(s, day) })
    vibrate([15, 30, 15])
    const r = btn.current?.getBoundingClientRect()
    if (r && !reducedMotion()) { setBurst({ x: r.left + r.width / 2, y: r.top }); setTimeout(() => setBurst(null), 1500) }
  }
  return <div className="xm-reveal-wrap">
    <button type="button" className="btn ghost sm xm-back" onClick={back}><Icon name="chevronLeft" /><span>{t('Back to the calendar')}</span></button>
    <div className={'xm-reveal xm-k-' + door.kind} data-door-open={day}>
      <div className="xm-reveal-top"><span className="xm-reveal-day">{date}</span><span className="xm-reveal-kind">{t(title)}</span></div>
      <div className="xm-reveal-icon" aria-hidden="true">{icon}</div>
      {door.text && <p className="xm-reveal-text">{t(door.text)}</p>}
      {door.kind === 'stat' && <StatDoor S={S} stat={door.stat} year={year} />}
      {door.kind === 'stretch' && <StretchDoor close={close} />}
      {door.kind === 'special' && <SpecialDoor />}
      {door.kind === 'challenge' && (done
        ? <div className="xm-badge">🏅 {t('Done! Badge earned.')}</div>
        : <span ref={btn} style={{ display: 'inline-block' }}><Button variant="primary" icon="check" onClick={tick}>{t('I did it')}</Button></span>)}
    </div>
    {burst && <Confetti at={burst} />}
  </div>
}

/** A number from the user's own year: the best set of their most-done lift, or the year so far. */
export function statOf(S, stat, year) {
  const st = yearStats(S, year)
  if (!st) return null
  if (stat === 'best' && st.topExercise) {
    const id = st.topExercise.id
    let best = 0
    for (const w of workoutsOfYear(S, year)) for (const e of Array.isArray(w.entries) ? w.entries : []) if (e?.id === id) best = Math.max(best, bestWeightForEntry(e) || 0)
    if (best > 0) {
      const name = EXIDX[id] ? exerciseNameText(EXIDX[id]) : st.topExercise.name || id
      return { line: t('Your {0} best on {1}', String(year), name), big: fmtNum(shownWeight(S, id, best)) + ' ' + exUnitOf(S, id), sub: t('Santa checked it twice. Still a very good number.') }
    }
  }
  return { line: t('Workouts in {0} so far', String(year)), big: fmtNum(st.workouts), sub: t('Lifted in total: {0}', fmtVol(Math.round(st.volume), st.unit)) }
}

function StatDoor({ S, stat, year }) {
  const s = statOf(S, stat, year)
  if (!s) return <p className="xm-reveal-text">{t('Your numbers turn up behind this door once you log a workout. No rush, it is the season of naps.')}</p>
  return <div className="xm-stat">
    <div className="muted small">{s.line}</div>
    <div className="xm-stat-big">{s.big}</div>
    <div className="muted small">{s.sub}</div>
  </div>
}

function StretchDoor({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const name = t('Cosy stretch')
  const ids = STRETCH.map(([id]) => id).filter(id => EXIDX[id])
  const have = S.routines.some(r => r.name === name && r.ex?.length === ids.length && r.ex.every((e, i) => e.id === ids[i]))
  const add = () => {
    update(s => {
      s.routines.push({ id: uid(), name, emoji: 'stretch', ex: STRETCH.filter(([id]) => EXIDX[id]).map(([id, sets, sec]) => ({ ...defaultConfig(id, 'time'), id, sets, sec })) })
    })
    useUI.getState().toast(t('Added to your routines. Socks optional.'))
    close()
  }
  return <>
    <p className="xm-reveal-text">{t('Six gentle holds for a cold evening, about ten minutes. Best done in your comfiest socks.')}</p>
    <ul className="xm-stretch">{ids.map(id => <li key={id}>{exerciseNameText(EXIDX[id])}</li>)}</ul>
    {have ? <div className="xm-badge">✓ {t('Already in your routines.')}</div>
      : <Button variant="primary" icon="plus" onClick={add}>{t('Add to my routines')}</Button>}
  </>
}

function SpecialDoor() {
  const [canIcon, setCanIcon] = useState(false)
  useEffect(() => {
    if (!MOBILE) return
    let live = true
    appIconState().then(s => { if (live && s && s.name !== 'christmas') setCanIcon(true) })
    return () => { live = false }
  }, [])
  return <>
    <p className="xm-reveal-text">{t('Whatever you celebrate, even if it is mostly a day on the sofa: thank you for training with openGym this year. Rest well, eat well, see you in the new year.')}</p>
    {canIcon && <>
      <p className="xm-reveal-text muted small">{t('One more surprise: the barbell has a festive outfit for your home screen.')}</p>
      <Button variant="primary" icon="gift" onClick={async () => { markAsked(); if (await wearFestiveIcon()) setCanIcon(false) }}>{t('Try the Christmas icon')}</Button>
    </>}
  </>
}
