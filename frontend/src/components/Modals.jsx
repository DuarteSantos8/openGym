import { useEffect, useLayoutEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'
import { keyboardOpen } from '../lib/viewport-guard.js'
import { dismissesOnRelease, scrolledAboveTop } from '../lib/sheet-dismiss.js'
import { pull, releaseDetent } from '../lib/sheet-detent.js'
import { isIOS } from '../lib/platform-now.js'
import { holdInert } from '../lib/inert.js'
import { t } from '../lib/i18n.js'

// Putting the page back after a sheet closes takes up to three goes (see the un-pin below): now,
// next frame, and once the keyboard's dismiss animation is over. Anything else that wants to
// scroll in that same commit is overwritten. Rating a set closes the effort picker AND ticks the
// set in one tap, and the superset card's "bring the partner's row into view" was undone about
// 3 ms after it was asked for, every time. afterScrollRestore runs fn once the sequence is done,
// or straight away when none is running, and returns a canceller for the caller's effect cleanup.
//
// It does not get a timer of its own. Two ~350 ms timers armed a few milliseconds apart run in
// whichever order the browser likes, and on a phone the re-assert can come second and undo the
// scroll. So the last re-assert runs these itself, in its own timer callback, right after its own
// scrollTo: there is no ordering left to get wrong.
const RESTORE_MS = 350
let restoreUntil = 0
// Real closes, counted, so the last re-assert can tell whether it belongs to the latest one. That,
// not the clock, ends the sequence: with Date.now() coarsened or jittered (privacy.resistFingerprinting
// rounds it to 100 ms) a deadline read in that callback can still look a few ms away, and a waiter
// would then sit in the queue with nothing left to run it.
let closes = 0
let waiting = []
export function afterScrollRestore(fn) {
  if (!(restoreUntil - Date.now() > 0)) { fn(); return () => {} }
  waiting.push(fn)
  return () => { waiting = waiting.filter(x => x !== fn) }
}
// Whether that sequence is still running, for a scroll that would rather not happen at all than
// come after it: the superset card's scroll when the marker did not move (views/Workout.jsx) used
// to be undone by the restore on the spot, and skipping it keeps that exactly.
export const scrollRestorePending = () => restoreUntil - Date.now() > 0
// Called by the last re-assert of close number `close`, once it has had its say. Two reasons to
// leave the queue alone and let a later re-assert take it: a second sheet closed inside this window
// (its own last re-assert drains it), or the page is pinned again behind a newly opened sheet,
// where a scroll would be meaningless; that sheet's own un-pin comes with a fresh sequence.
const drainScrollRestore = close => {
  if (!close || close !== closes || document.body.style.position === 'fixed') return
  restoreUntil = 0
  const queue = waiting
  waiting = []
  for (const fn of queue) {
    try { fn() } catch (e) { /* one caller must not keep the others waiting */ }
  }
}

// iPhone sheets (Liquid Glass G4). A sheet that holds edited text is not closed by a swipe, a tap
// on the dim or Esc: only its own Cancel throws the edit away. `seen` has each field's value from
// when it was first touched; search boxes and sliders are not edits.
const FIELD = 'input:not([type=range]):not([type=search]):not([type=checkbox]):not([type=radio]):not([type=file]),textarea'
// only a sheet with its own Cancel can hold an edit: without one, the dim, Esc and a swipe are its only ways out
const edited = (el, seen) => [...el.querySelectorAll('button.dim')].some(b => b.textContent.trim() === t('Cancel')) && [...el.querySelectorAll(FIELD)].some(f => !f.closest('.picker-search') && seen.has(f) && seen.get(f) !== f.value)
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const LARGE_GAP = 58   // the large detent stops this far under the top of the screen (the status bar and a sliver of the page)
// The tab bar's box as the sheet that grows out of it (the Start picker) starts and ends: the glass
// is the bar's ::before, --rh taller while a rest runs.
function barBox() {
  const bar = document.getElementById('tabbar')
  if (!bar) return null
  const r = bar.getBoundingClientRect(), rh = parseFloat(getComputedStyle(bar).getPropertyValue('--rh')) || 0
  return { bar, css: `inset-inline-start:${r.left}px;inset-inline-end:${innerWidth - r.right}px;bottom:${innerHeight - r.bottom}px;height:${r.height + rh}px;--rt:${(r.height + rh) / 2}px;--rb:${r.height / 2}px` }
}

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const closeSheet = useUI(s => s.closeSheet)   // not the whole store: an open sheet re-rendered on every rest tick
  const ref = useRef(null)
  // startY null = no gesture. axis stays null until the finger has travelled far enough to
  // tell a vertical pull from a sideways scroll; 'x' hands the gesture to whatever scrolls
  // horizontally under it (chip strips, heatmap) and the sheet stays put.
  const idle = () => ({ startX: null, startY: null, axis: null, delta: 0, vy: 0, lastY: 0, lastT: 0 })
  const drag = useRef(idle())
  const ios = isIOS()
  const asMenu = ios && sheet.kind === 'menu' && !!sheet.anchor?.isConnected
  const born = ios && !!sheet.born && !reduced() && !!document.getElementById('tabbar')
  const seen = useRef(new Map())
  // iPhone: the surface is a named dialog, focus goes into it and back to what opened it, a
  // tap on the dim or Esc close it unless it holds an edit, a born sheet goes back into the bar.
  const stuck = () => sheet.locked || (ios && edited(ref.current, seen.current))
  const dismiss = () => {
    if (stuck()) return
    const el = ref.current, box = born && el && barBox()
    if (!box) { closeSheet(sheet.id); return }
    el.classList.add('fb'); el.style.cssText = box.css
    setTimeout(() => closeSheet(sheet.id), 460)
  }
  useEffect(() => {
    const el = ref.current
    if (!ios || !el) return undefined
    const h = el.querySelector('h3'), d = el.querySelector('[data-desc]')
    if (h) { h.id ||= 'st' + sheet.id; el.setAttribute('aria-labelledby', h.id) }
    if (d) { d.id ||= 'sd' + sheet.id; el.setAttribute('aria-describedby', d.id) }
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true')
    if (!h && sheet.kind === 'menu') el.setAttribute('aria-label', t('Workout options'))   // the one untitled surface is the workout's menu   // an untitled surface still has a name
    if (!el.contains(document.activeElement)) { const f = el.querySelector('[data-focus]') || h || el; f.tabIndex = -1; f.focus({ preventScroll: true }) }
    const note = e => { if (e.target.matches?.(FIELD) && !seen.current.has(e.target)) seen.current.set(e.target, e.target.value) }
    el.addEventListener('focusin', note); el.addEventListener('beforeinput', note, true)
    return () => { el.removeEventListener('focusin', note); el.removeEventListener('beforeinput', note, true); const o = sheet.opener; queueMicrotask(() => { if (o?.isConnected && !o.closest('[inert]')) o.focus?.({ preventScroll: true }) }) }   // after the page is un-inert (Modals' cleanup runs in this same flush)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current, box = born && el && barBox()
    if (!box) return undefined
    // start as the bar (no transition), hand the bar's glass over, then let the class pose take over and transition
    el.classList.add('fb'); el.style.cssText = 'animation:none;transition:none;' + box.css
    box.bar.classList.add('abs'); void el.offsetWidth
    el.style.cssText = ''; el.classList.remove('fb')
    return () => box.bar.classList.remove('abs')
  }, [])
  // a menu grows out of its button: below it, right-aligned to it, as wide as 272 (the screen's width at Larger Text)
  useLayoutEffect(() => {
    const el = ref.current
    if (!asMenu || !el) return
    const a = sheet.anchor.getBoundingClientRect(), W = innerWidth
    const w = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 20 ? W - 32 : Math.min(272, W - 32)
    const left = Math.max(16, Math.min(a.right - w, W - 16 - w)), top = a.bottom + 8
    el.style.cssText = `left:${left}px;top:${top}px;width:${w}px;max-height:${innerHeight - top - 34}px;--ox:${a.left + a.width / 2 - left}px;--oy:${a.top + a.height / 2 - top}px`
  }, [])

  // a gesture that begins on a slider (or opted-out control) belongs to that control, not to
  // the sheet's swipe-to-dismiss — so it keeps working while you drag. Horizontal strips are
  // opted out too: a sideways scroll must never wobble or pull down the sheet.
  const NODRAG = 'input[type=range], [data-nodrag], .chips, .hm-wrap'
  const begin = (target, x, y) => {
    const el = ref.current
    if (target.closest && target.closest(NODRAG)) { drag.current = idle(); return }
    // Only from the very top: the sheet, and anything scrollable inside it, at rest (#897).
    if (scrolledAboveTop(target, el)) { drag.current = idle(); return }
    drag.current = { ...idle(), startX: x, startY: y, lastY: y, lastT: performance.now() }
    if (ios) {
      // small = the sheet as it opened, large = nearly the whole screen; a sheet with nothing to scroll has one size
      const large = el.classList.contains('lg'), h0 = el.getBoundingClientRect().height
      if (!large) el.dataset.a = h0
      Object.assign(drag.current, { h0, a: Math.min(+el.dataset.a || h0, h0), z: innerHeight - LARGE_GAP, single: el.scrollHeight <= el.clientHeight + 1 && !large })
    }
  }
  const move = (e, x, y) => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    // synthetic events (tests) may carry no x at all: treat that as straight down
    const dx = Number.isFinite(x) ? x - d.startX : 0, dy = y - d.startY
    if (d.axis === null) {
      // axis lock after ~10px: clearly-more-vertical wins the sheet, anything else is a scroll.
      // A first move up is a scroll of the content, and the rest of that touch stays one.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      // iPhone: a pull up at the top of a sheet that has more to show grows it instead of scrolling
      const up = ios && dy < 0 && !d.single && !el.classList.contains('lg') && el.scrollTop <= 0
      d.axis = Math.abs(dy) > Math.abs(dx) * 1.2 && (dy > 0 || up) ? 'y' : 'x'
      if (d.axis === 'x') return
    }
    if (d.axis === 'x') return
    const now = performance.now()
    // velocity from the last move, so a fast short flick can still be told from a slow drag
    if (now > d.lastT) { d.vy = (y - d.lastY) / (now - d.lastT); d.lastY = y; d.lastT = now }
    if (ios) {
      if (dy < 0 && (d.single || el.scrollTop > 0)) return
      e.preventDefault()
      d.delta = dy
      d.raw = d.h0 - dy
      const { h, ty } = pull(d.raw, d.a, Math.max(d.z, d.a))
      const p = d.z > d.a ? Math.min(Math.max((h - d.a) / (d.z - d.a), 0), 1) : 0
      const inset = 8 * (1 - p), st = el.style, dr = parseFloat(getComputedStyle(el).getPropertyValue('--dr')) || 48
      st.transition = 'none'; st.maxHeight = 'none'; st.height = h + 'px'; st.transform = ty ? `translateY(${ty}px)` : ''
      st.setProperty('--in', inset + 'px'); st.setProperty('--bt', inset + 'px')
      st.setProperty('--rt', dr - 8 + (34 - (dr - 8)) * p + 'px'); st.setProperty('--rb', dr - inset + 'px')
    } else if (dy > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      d.delta = dy
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
    } else if (d.delta > 0) {
      // the pull reversed above the start: snap back before the sheet is allowed to scroll,
      // otherwise it scrolls while still hanging below its resting place
      e.preventDefault()
      d.delta = 0
      el.style.transform = 'translateY(0px)'
    }
  }
  const onTouchStart = e => begin(e.target, e.touches[0].clientX, e.touches[0].clientY)
  const onTouchMove = e => move(e, e.touches[0].clientX, e.touches[0].clientY)
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    if (ios) {
      if (d.raw == null) { drag.current = idle(); return }   // a tap, not a drag
      // medium or large: the class pose takes over from the finger's numbers and transitions; shut: slide away
      const vy = performance.now() - d.lastT > 80 ? 0 : d.vy
      const to = d.raw == null ? 'm' : releaseDetent({ raw: d.raw, v: vy, a: d.a, z: d.z, single: d.single, dirty: stuck() })
      drag.current = idle()
      if (to === 'close') { el.style.transition = ''; el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180); return }
      const st = el.style
      st.transition = ''; st.transform = ''
      ;['--in', '--bt', '--rt', '--rb'].forEach(k => st.removeProperty(k))
      el.classList.toggle('lg', to === 'l')
      if (to === 'l') { st.removeProperty('height'); st.removeProperty('max-height') } else {
        st.height = d.a + 'px'   // glide to the small height, then hand back to the content's own (no timer needed for the look, only for the cleanup)
        setTimeout(() => { st.removeProperty('height'); st.removeProperty('max-height') }, 500)
      }
      return
    }
    el.style.transition = 'transform .2s'
    // Where the pull was going decides, not where it was let go (lib/sheet-dismiss.js, #897).
    // A release that has not moved for a moment carries no speed.
    const vy = performance.now() - d.lastT > 80 ? 0 : d.vy
    if (dismissesOnRelease({ delta: d.delta, vy, height: el.offsetHeight }) && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180) }
    else el.style.transform = ''
    drag.current = idle()
  }
  // Mouse drag (desktop testing / trackpads): same swipe-to-dismiss behaviour.
  const onMouseDown = e => { if (e.button === 0) begin(e.target, e.clientX, e.clientY) }
  const onMouseMove = e => move(e, e.clientX, e.clientY)
  const onMouseUp = () => onTouchEnd()

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const close = () => closeSheet(sheet.id)
  // Full screen, on black: a photo or video opened from a workout (WorkoutMedia.jsx). No
  // backdrop to tap, no drag to dismiss — the viewer has its own close button, and back closes
  // it like any sheet.
  if (sheet.kind === 'viewer') return <div>{sheet.render(close)}</div>
  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={dismiss} />
        <div className={'center' + (sheet.wide ? ' wide' : '')} ref={ref}>{sheet.render(close)}</div>
      </div>
    )
  }
  if (asMenu) {
    return (
      <div>
        <div className="mback clear" onClick={dismiss} />
        <div className="menu" ref={ref}>{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={dismiss} />
      <div className={'sheet' + (born ? ' born' : '')} ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)
  const closeSheet = useUI(s => s.closeSheet)
  const prevLen = useRef(0)
  const suppressPop = useRef(false)
  const pushedEntries = useRef(0)
  const sheetEntries = useRef([])

  // Every opened sheet gets a history entry so Android back dismisses it instead of
  // leaving the page (issue #63). Keep the pushed-entry count and each active sheet's
  // live-entry status explicit: sheet count cannot tell whether popstate already spent
  // an entry (especially for a locked sheet) or whether several sheets opened at once.
  useEffect(() => {
    const prev = prevLen.current
    prevLen.current = sheets.length
    if (sheets.length > prev) {
      for (let i = prev; i < sheets.length; i++) {
        sheetEntries.current.push({ openedAt: location.href, live: true })
        // Numbered one past the page's, as the router numbers a push: a page that takes this
        // entry over (closeThenNav) or is pushed after it gets its index from it, and Settings'
        // back reads that index to tell whether there is a page to go back to.
        const idx = history.state?.idx
        history.pushState(typeof idx === 'number' ? { openGymSheet: true, idx: idx + 1 } : { openGymSheet: true }, '')
        pushedEntries.current++
      }
    } else if (sheets.length < prev) {
      const closedEntries = sheetEntries.current.splice(sheets.length, prev - sheets.length)
      const rewind = closedEntries.filter(entry =>
        entry.live && !(typeof entry.openedAt === 'string' && location.href !== entry.openedAt)).length
      if (rewind > 0) {
        pushedEntries.current = Math.max(0, pushedEntries.current - rewind)
        suppressPop.current = true
        history.go(-rewind)
      }
      // Entries skipped because the app moved on remain in pushedEntries as deliberate
      // leaks until a later popstate consumes them with no corresponding active sheet.
    }
  }, [sheets.length])

  useEffect(() => {
    const onPop = () => {
      if (suppressPop.current) { suppressPop.current = false; return }
      if (pushedEntries.current <= 0) return
      pushedEntries.current--
      // The browser has already spent one pushed entry. Mark the latest live active
      // sheet entry spent even when the sheet is locked; with no active entry this is a
      // moved-on leak, which is still accounted for by the counter decrement above.
      for (let i = sheetEntries.current.length - 1; i >= 0; i--) {
        if (sheetEntries.current[i].live) {
          sheetEntries.current[i].live = false
          break
        }
      }
      const top = sheets[sheets.length - 1]
      if (top && !top.locked) closeSheet(top.id)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [sheets, closeSheet])

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const onKey = e => {
      const top = useUI.getState().sheets[useUI.getState().sheets.length - 1]
      if (!isIOS()) { if (e.key === 'Escape' && top && !top.locked) useUI.getState().closeSheet(top.id); return }
      if (e.key === 'Escape') {
        // iPhone: the same road as a tap on the dim (a locked sheet, or one holding an edit, stays); a full-screen viewer has no dim
        const back = top && top.kind !== 'viewer' && [...document.querySelectorAll('#modal-root .mback')].pop()
        if (back) back.click(); else if (top && !top.locked) useUI.getState().closeSheet(top.id)
      } else if (e.key === 'Tab') {
        // Tab stays inside the open surface
        const box = [...document.querySelectorAll('#modal-root > div')].pop()
        const f = box ? [...box.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled) : []
        const i = f.indexOf(document.activeElement)
        if (f.length && (e.shiftKey ? i <= 0 : i < 0 || i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheets.length])
  // iPhone: nothing behind an open sheet can be reached by touch, Tab or VoiceOver (the toast and its
  // announcer stay: a message may arrive while a sheet is up)
  useEffect(() => {
    if (!sheets.length || !isIOS()) return undefined
    const done = []
    for (let n = document.getElementById('modal-root'); n && n !== document.body; n = n.parentElement) {
      for (const x of n.parentElement.children) {
        if (x !== n && !x.matches('#toast,.toast-live,script,style,link')) done.push(x)
      }
    }
    return holdInert(done)   // counted: the full rest view holds some of the same elements
  }, [sheets.length > 0])
  // one sheet at a time reachable: a sheet under another (a confirm over a form) is inert too
  useEffect(() => {
    if (!isIOS()) return undefined
    const low = [...document.querySelectorAll('#modal-root > div')].slice(0, -1)
    low.forEach(x => { x.inert = true })
    return () => low.forEach(x => { x.inert = false })
  }, [sheets.length])
  // A layout effect, not a passive one: the pin and, above all, the un-pin plus the scroll
  // restore have to land in the same frame as the sheet's own mount/unmount. Run after paint,
  // iOS showed a frame with the body un-pinned at scroll 0 — the page "jumped down and back" on
  // every RIR pick, which closes the sheet and starts a rest in one tap (2026-09-18).
  useLayoutEffect(() => {
    if (!sheets.length) return
    // A text field on the page behind (a set's weight, the Library search) keeps focus when a
    // button opens a sheet — WebKit does not blur on button taps — and its keyboard then
    // stays up under the sheet, or leaves the viewport displaced when it finally goes. The
    // sheet owns the screen now; a field inside the sheet (the picker search) is left alone.
    const a = document.activeElement
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && !a.closest?.('#modal-root')) a.blur?.()
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      // A workout layout change can move the anchor while this sheet is open.
      const restoreY = -(parseFloat(b.top) || 0)
      b.position = b.top = b.left = b.right = b.width = ''
      // Tell anything that scrolls for its own reasons how long this will go on (afterScrollRestore),
      // but only when a sheet really did close. React StrictMode runs this cleanup immediately after
      // the effect when Modals mounts with a sheet already up, and arming the window there would make
      // anything waiting on the restore wait RESTORE_MS for a page nobody is putting back: late in
      // dev, on time in production. In production this cleanup runs on the close path alone.
      const close = useUI.getState().sheets.length ? 0 : ++closes
      if (close) restoreUntil = Date.now() + RESTORE_MS
      window.scrollTo(0, restoreY)
      // iOS scrolls asynchronously; a restore issued in the same task as the un-pin can be applied
      // a frame late or against the still-short layout. Say it once more on the next frame.
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => { if (document.body.style.position !== 'fixed') window.scrollTo(0, restoreY) })
      // If the sheet closed with the keyboard still up (tap "+" in the picker, then finish),
      // iOS scrolls the page again while the keyboard dismisses — after the line above ran.
      // Ask once more when that animation is over. The window-level guard in
      // lib/viewport-guard.js covers the keyboard closing while a sheet stays open.
      // This last one also hands the page over to anything that has been waiting for the sequence
      // to finish (afterScrollRestore), in this same callback, right after its own scrollTo, so a
      // scroll of someone else's cannot be undone by a re-assert still to come.
      //
      // The re-assert itself is for the keyboard case only: without one there is nothing to undo,
      // and a late restore would overwrite a scroll the page behind made on purpose because the
      // sheet closed — the workout list going to the current exercise after ⋯ → Layout → List
      // (issue #224). At this point the sheet's field is already out of the DOM but the keyboard
      // has not started to go, so the visual viewport still tells the truth. The timer is armed
      // either way, because the hand-over is the only thing that drains the queue.
      //
      // A workout list that collapsed a finished exercise while the sheet was up has already put
      // its own anchor back (WorkoutScrollAnchor); it says so, and the re-assert stands down.
      const hadKeyboard = keyboardOpen()
      let anchored = false
      const onAnchor = () => { anchored = true }
      window.addEventListener('workout-scroll-anchor', onAnchor, { once: true })
      window.setTimeout(() => {
        window.removeEventListener('workout-scroll-anchor', onAnchor)
        if (hadKeyboard && !anchored && document.body.style.position !== 'fixed') window.scrollTo(0, restoreY)
        drainScrollRestore(close)
      }, RESTORE_MS)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
