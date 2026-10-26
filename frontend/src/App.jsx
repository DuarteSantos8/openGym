import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hideBoot } from './lib/boot.js'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { setWeightDecimals } from './lib/format.js'
import { accentValue, applyAccent } from './lib/accent.js'
import { seasonAccent } from './lib/seasonal.js'
import { setLang, useLang, baseLang } from './lib/i18n.js'
import { effectiveLang } from './lib/default-lang.js'
import { setPlayOnSilent, setVibrate, setAlarmBuzzer, setNativeBuzzer } from './lib/sound.js'
import { buzzAsAlarm } from './lib/rest-alert.js'
import { setNav, notePath, keyBefore, navToWorkout } from './lib/nav.js'
import { onGymReminderOpen } from './lib/gym-reminder.js'
import { workoutVolume } from './lib/history.js'
import { setSystemBarsLight } from './lib/system-bars.js'
import { initBackButton } from './lib/back.js'
import { installEdgeSwipeBack, BACK_PREVIEW_EVENT } from './lib/edge-swipe-back.js'
import { pageMotion } from './lib/page-motion.js'
import { startWatchSync, bindWatchAppActions, patchSetIn } from './lib/watch-sync.js'
import { stampWorkout } from './lib/sync-merge.js'
import { logWeighIn } from './lib/bodyweight.js'
import { startWidgetSync } from './lib/widgets.js'
import { startLiveActivitySync } from './lib/live-activity.js'
import { useWakeLock } from './lib/wakelock.js'
import { installViewportGuard } from './lib/viewport-guard.js'
import { installChipDrag } from './lib/hchips.js'
import { syncPushSubscription } from './lib/push.js'
import { MOBILE, nativePlatform } from './lib/mobile.js'
import { exitWorkoutEdit, startFlow, beginWorkout } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import SyncBanner from './components/SyncBanner.jsx'
import RestTimer from './components/RestTimer.jsx'
import TimerFlash from './components/TimerFlash.jsx'
import { SeasonalLayer } from './components/Seasonal.jsx'
import { openDeviceLinkRedeem } from './components/Passkeys.jsx'
import { useAnimPacksBoot } from './components/Animations.jsx'
import Login from './views/Login.jsx'
import MobileOnboarding from './views/MobileOnboarding.jsx'
import PermissionSteps from './views/PermissionSteps.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import Workout from './views/Workout.jsx'

// Screens most sessions never open (the Coach, the admin dashboard, photos, measurements, the
// balance check) are their own chunks rather than part of the code every start parses: ~200 KB
// of the main bundle. They are fetched once the app is idle after the start (the service worker
// and the phone build hold them locally anyway), so by the time one is opened it renders at once,
// in the same frame, as before; only a tap within the first moments can see one empty frame.
const views = []
function lazyView(load) {
  let View = null
  const fetchIt = () => load().then(m => { View = m.default; return m })
  const Lazy = lazy(fetchIt)
  views.push(fetchIt)
  return function LazyView(props) {
    return View ? <View {...props} /> : <Suspense fallback={null}><Lazy {...props} /></Suspense>
  }
}
const Admin = lazyView(() => import('./views/Admin.jsx'))
const CoachChat = lazyView(() => import('./views/CoachChat.jsx'))
const Measurements = lazyView(() => import('./views/Measurements.jsx'))
const CoachIntake = lazyView(() => import('./views/CoachIntake.jsx'))
const CoachSetup = lazyView(() => import('./views/CoachSetup.jsx'))
const StructuralBalance = lazyView(() => import('./views/StructuralBalance.jsx'))
const ProgressPhotos = lazyView(() => import('./views/ProgressPhotos.jsx'))
// The tabs and screens past Home (Stats, History, the Library, Settings, ...) as well: a start
// only needs Home, and these are fetched right behind it the same way.
const CheckIn = lazyView(() => import('./views/CheckIn.jsx'))
const RoutineEdit = lazyView(() => import('./views/RoutineEdit.jsx'))
const VideoImport = lazyView(() => import('./views/VideoImport.jsx'))
const Stats = lazyView(() => import('./views/Stats.jsx'))
const History = lazyView(() => import('./views/History.jsx'))
const Library = lazyView(() => import('./views/Library.jsx'))
const Muscles = lazyView(() => import('./views/Muscles.jsx'))
const SettingsRoute = lazyView(() => import('./views/Settings.jsx').then(m => ({ default: m.SettingsRoute })))
let viewsPrefetched = false
const prefetchViews = () => {
  if (viewsPrefetched) return
  viewsPrefetched = true
  const run = () => { for (const f of views) f().catch(() => {}) }
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}

// last known scrollY per route, so back-navigation can put the page where it was
const scrollPositions = new Map()

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  applyAccent(de, accent, de.dataset.theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
  if (MOBILE) setSystemBarsLight(de.dataset.theme === 'light')
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  const { S, user, ready } = useStore()
  // iOS: whether timer sounds get past the ring/silent switch (Settings → Sounds). Page-level,
  // so it is applied here on load and on change rather than at each beep.
  useEffect(() => { setPlayOnSilent(!!S.soundOnSilent) }, [S.soundOnSilent])
  // Settings → Vibrate, the same way: one page-level switch rather than a check at each buzz.
  useEffect(() => { setVibrate(S.vibrate !== false) }, [S.vibrate])
  // Android app: "Vibrate when the phone is on silent" sends the end-of-rest buzz through the
  // native side as an alarm (#375). buzzAsAlarm answers false off Android, so iOS buzzes as before.
  useEffect(() => { setAlarmBuzzer(MOBILE && S.vibrate !== false && S.vibrateOnSilent ? buzzAsAlarm : null) }, [S.vibrate, S.vibrateOnSilent])
  // iPhone app: the page cannot buzz (no navigator.vibrate), its native side can.
  useEffect(() => { if (MOBILE) nativePlatform().then(p => { if (p === 'ios') setNativeBuzzer(buzzAsAlarm) }) }, [])
  // Store apps: which animation packs this device has, and the one the chosen quality wants for
  // the figure shown (components/Animations.jsx). Nothing on the web.
  useAnimPacksBoot()
  const isGuest = useStore(s => s.isGuest())
  const needsMobileOnboarding = useStore(s => s.needsMobileOnboarding)
  const permSteps = useStore(s => s.permSteps)
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  const lastEditPath = useRef(loc.pathname)
  // Any in-app route exit, browser back included, returns to the persisted draft and asks for a
  // save decision. Reload needs no prompt because the draft itself is already in local storage.
  useEffect(() => {
    const previous = lastEditPath.current
    lastEditPath.current = loc.pathname
    // The live store, not this render's S: a save that just closed the editor may not have
    // reached this render yet, and asking again would offer to delete the workout it saved.
    if (previous !== '/workout' || !useStore.getState().S.active?.editingWorkoutId || loc.pathname === '/workout') return
    const destination = loc.pathname + loc.search
    navigate('/workout', { replace: true })
    exitWorkoutEdit(() => navigate(destination, { replace: true }))
  }, [loc.pathname, loc.search, S.active?.editingWorkoutId, navigate])
  // A preset key, or the user's own colour as '#rrggbb' (lib/accent.js), already checked. A
  // seasonal theme's colours stand in for it while that theme shows, and only when chosen
  // (Settings → Look & Home → Seasonal themes); the saved accent itself is never touched.
  const accent = seasonAccent(S) || accentValue(S)
  useEffect(() => { applyPrefs(S.theme, accent) }, [S.theme, accent])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (S.theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(S.theme, accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [S.theme, accent])
  // A profile that never picked a language follows the instance default or the browser (#303) —
  // worked out here, on this device, and never written into the synced state (lib/default-lang.js).
  const config = useStore(s => s.config)
  const lang = effectiveLang(S, config)
  useEffect(() => { setLang(lang, S.enParens?.[baseLang(lang)] ?? true, S.enOnly?.[baseLang(lang)] === true) }, [lang, S.enParens, S.enOnly])
  // Same shape as the language: a module-level display setting, pushed when it changes (#139).
  useEffect(() => { setWeightDecimals(S.wdec) }, [S.wdec])
  useEffect(() => { document.documentElement.lang = lang }, [langV, lang])
  // Forward navigation starts at the top; going back lands where you left off.
  // The position is recorded from scroll events rather than read at route
  // change, because by then a shorter page may already have clamped it.
  const pathRef = useRef(null)
  // iOS leaves the page displaced after the keyboard goes away (see lib/viewport-guard.js).
  useEffect(() => installViewportGuard(), [])
  // Click-drag a horizontal chip strip to scroll it sideways (lib/hchips.js) — on a desktop
  // browser there's otherwise no way to reach the filters past the edge.
  useEffect(() => installChipDrag(), [])
  // Once per signed-in boot, hand the server this browser's push subscription again (see
  // lib/push.js): a subscription the instance lost is back before the next reminder is due,
  // with nobody having to visit Settings. Web only — the APK has no service worker.
  useEffect(() => {
    if (MOBILE || !user || !ready) return
    syncPushSubscription().catch(() => {})
  }, [user?.id, ready])
  // Opened from a device-link QR code (#95): once boot knows who is here, the sheet that redeems
  // it opens by itself — over the sign-in screen, or over the app for a guest or a signed-in
  // browser. Once per visit; closed, the code stays for the sign-in screen's own button.
  const linkCode = useStore(s => s.linkCode)
  const linkOffered = useRef(false)
  useEffect(() => {
    if (!ready || !linkCode || linkOffered.current) return
    linkOffered.current = true
    openDeviceLinkRedeem()
  }, [ready, linkCode])
  useEffect(() => {
    const onScroll = () => {
      // Modals pins the body while a sheet is open; scrollY is 0 then, not a position.
      if (document.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  // The edge swipe back (lib/edge-swipe-back.js) asks for the page it goes back to underneath
  // while the finger moves (`preview`), and says where it is going as it lets go (`returning`):
  // that page comes back where it was scrolled to.
  const [preview, setPreview] = useState(null)
  const returning = useRef(null)
  useEffect(() => {
    const on = e => {
      const d = e.detail || {}
      if ('commit' in d) returning.current = d.commit
      else setPreview(d.path || null)
    }
    window.addEventListener(BACK_PREVIEW_EVENT, on)
    return () => window.removeEventListener(BACK_PREVIEW_EVENT, on)
  }, [])
  // A tap on the page's own back button lands the same way. Its push used to open the page at the
  // top, so Stats scrolled down, then Structural balance and back, started over, while the swipe,
  // which presses this very button, came back to where it was. Capture phase, so this is known
  // before the button's own handler navigates.
  useEffect(() => {
    const onClick = e => {
      const to = e.target.closest?.('#app > .page:not(.under) [data-back]')?.getAttribute('data-back')
      if (to) returning.current = to
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
  // Any navigation ends a preview: promoted (it is the page now) or not needed any more.
  useEffect(() => { setPreview(null) }, [loc.pathname])
  useLayoutEffect(() => {
    const first = pathRef.current === null
    const samePath = pathRef.current === loc.pathname
    pathRef.current = loc.pathname
    notePath(loc.pathname, loc.key)
    if (returning.current && returning.current === loc.pathname && !first) {
      returning.current = null
      const y = scrollPositions.get(loc.pathname) || 0
      // Promoted from the preview it is laid out already: back at y in this same frame. A page
      // mounted fresh (no preview) needs its layout pass first, as a POP does.
      if (document.querySelector('#app > .page[data-promoted]')) { window.scrollTo(0, y); return }
      const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
      return () => window.cancelAnimationFrame(frame)
    }
    returning.current = null
    // A fresh load arrives as a POP with nothing remembered. It goes to the top like any new
    // route — now, not a frame later: that frame landed on top of a scroll a view made on mount
    // (the superset card centring its row, views/Workout.jsx), and a smooth scroll cut off by a
    // scrollTo is simply gone.
    // Remembered as the top too. When the window is at the top already no scroll event comes, and
    // a back to this page would land where an earlier visit had left it.
    if (navType !== 'POP' || first) { window.scrollTo(0, 0); scrollPositions.set(loc.pathname, 0); return }
    // A POP that stays on the route we are on is not a back-navigation: it is the history
    // entry a sheet pushed (Modals.jsx, #63) being unwound as the sheet closes. Nothing new
    // mounted, Modals puts the page back where it was itself, and a view that scrolled on
    // purpose because the sheet closed — the workout list going to the current exercise after
    // ⋯ → Layout → List (#224) — must not be dragged back to a position recorded before that
    // scroll's event had even been dispatched.
    if (samePath) return
    const y = scrollPositions.get(loc.pathname) || 0
    // the restored view needs a layout pass before it is tall enough to scroll to y
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
    return () => window.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && !S.active.editingWorkoutId && S.keepAwake !== false)
  // A running workout has the whole screen (v1.3.11): no tab bar, and the rest bar docks to the
  // bottom edge in its place. Its header's ⌄ goes back to the app, where the tab bar's Resume
  // brings it back. Finishing stays in the workout's own header and list, not in a bottom button
  // (owner, 2026-10-14: the bottom Complete / Finish button of #563 is gone again).
  const inWorkout = loc.pathname === '/workout' && !!S.active
  useEffect(() => {
    document.body.classList.toggle('no-tabbar', inWorkout)
    return () => document.body.classList.remove('no-tabbar')
  }, [inWorkout])
  // The chat owns the bottom of the screen as well: its composer sits where the tabs would be.
  // The first-launch card has no tabs either: they changed the route behind it.
  const noTabs = inWorkout || loc.pathname === '/coach' || needsMobileOnboarding || permSteps

  const authed = user || isGuest
  // The boot screen in index.html covers the start; it goes once there is something to show.
  useEffect(() => { if (ready || authed) hideBoot() }, [ready, authed])
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  const view = l => (!authed ? <Login /> : needsMobileOnboarding ? <MobileOnboarding /> : permSteps ? <PermissionSteps /> : (
    <Routes location={l}>
      <Route path="/home" element={<Home />} />
      {/* Gym check-in — switched off in Settings, the route falls through to the
          catch-all redirect below. */}
      {S.checkIn !== false && <Route path="/checkin" element={<CheckIn />} />}
      <Route path="/plan" element={<Plan />} />
      <Route path="/plan/r/:id" element={<RoutineEdit />} />
      <Route path="/plan/import-video" element={<VideoImport />} />
      <Route path="/workout" element={<Workout />} />
      <Route path="/stats" element={<Stats />} />
      <Route path="/history" element={<History />} />
      <Route path="/library" element={<Library />} />
      <Route path="/muscles" element={<Muscles />} />
      <Route path="/structural-balance" element={<StructuralBalance />} />
      <Route path="/progress-photos" element={<ProgressPhotos />} />
      <Route path="/measurements" element={<Measurements />} />
      <Route path="/settings" element={<SettingsRoute />} />
      <Route path="/settings/:page" element={<SettingsRoute />} />
      {/* The Coach screens gate themselves on the instance config; the routes exist
          unconditionally so a deep link from a notification lands somewhere sane
          rather than on the catch-all. */}
      <Route path="/coach" element={<CoachChat />} />
      <Route path="/coach/intake" element={<CoachIntake />} />
      <Route path="/coach/proposal" element={<Navigate to="/coach" replace />} />
      <Route path="/coach/setup" element={<CoachSetup />} />
      <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  ))
  const showPreview = !!preview && preview !== loc.pathname && authed && !needsMobileOnboarding && !permSteps

  return (
    <>
      {/* One page per route, keyed on it: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out. While an edge swipe back
          is under way the page it goes back to sits underneath (Page `under`), and as the swipe
          lands it simply stays: same key, same parent, so React keeps it instead of mounting
          the route again. */}
      <div id="app">
        <Page key={loc.pathname} loc={loc} render={view} motion={pageMotion(pathRef.current, loc.pathname, navType)} />
        {showPreview && <Page key={preview} loc={previewLoc(preview)} render={view} under scrollY={scrollPositions.get(preview) || 0} />}
      </div>
      {/* Outside #app: the view's fade-in animates a transform, and a fixed element inside it
          would ride along with the page for the length of it. Decides for itself when to show —
          including on the sign-in screen, when the server has just ended the session. */}
      <SyncBanner />
      {!noTabs && <TabBar onStart={startFlow} />}
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
      {/* Seasonal decoration (lib/seasonal.js): nothing, and nothing loaded, out of season. Never
          over a running workout or the first-launch screens. */}
      {authed && !needsMobileOnboarding && !permSteps && <SeasonalLayer hidden={inWorkout || loc.pathname === '/workout'} />}
    </>
  )
}

// The location the page underneath renders with: the entry it will be, when history knows it.
const previewLoc = pathname => ({ pathname, search: '', hash: '', state: null, key: keyBefore(pathname) || 'back-preview' })

/* One route's page. `under`: the page an edge swipe back is about to return to, drawn beneath
   the current one (index.css .page.under): fixed, at the scroll position it was left at, inert
   and hidden from assistive tech, so nothing in it can be tapped, focused or read out while it
   only shows. When the swipe lands it becomes the page in place (same element, same state, no
   second mount, no fade): the styles the gesture painted on it go, and App puts the window back
   at that scroll position in the same frame. */
function Page({ loc, render, under = false, scrollY = 0, motion = 'fade' }) {
  const ref = useRef(null)
  const wasUnder = useRef(under)
  const arrival = useRef(motion)
  const promoted = wasUnder.current && !under
  useLayoutEffect(() => {
    if (under || !wasUnder.current) return
    const el = ref.current
    if (el) { el.style.transform = ''; el.style.transition = ''; el.style.visibility = '' }
  }, [under])
  return <div ref={ref} className={'page' + (under ? ' under' : wasUnder.current ? '' : arrival.current === 'push' ? ' vpush' : arrival.current === 'pop' ? ' vpop' : ' vfade')}
    data-path={loc.pathname} data-promoted={promoted ? '' : undefined}
    aria-hidden={under || undefined} inert={under || undefined}>
    <div className="page-in" style={under && scrollY ? { transform: `translateY(${-scrollY}px)` } : undefined}>
      <ErrorBoundary>{render(loc)}</ErrorBoundary>
    </div>
  </div>
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  useEffect(() => { prefetchViews() }, [])
  // Android system back — sheet, then page, then press-again-to-exit (see lib/back.js)
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  // iOS: swipe from the left edge for the page's own back button (lib/edge-swipe-back.js)
  useEffect(() => installEdgeSwipeBack(), [])
  // iPhone app with an Apple Watch: the running workout goes to the watch, its ticks come back
  // (lib/watch-sync.js). Nothing at all on the web, on Android, or without a paired watch.
  useEffect(() => {
    if (!MOBILE) return
    let stop = null, gone = false
    startWatchSync({ useStore, useUI }).then(fn => { if (gone) fn(); else stop = fn })
    // A session started on the watch starts here as the phone's Start does, with the watch's id
    // and start time, and no weigh-in question (the lifter is at the watch, not here).
    const unbind = bindWatchAppActions({
      start: (ids, { bw = null, ...opts } = {}) => beginWorkout(ids, bw, opts),
      // The watch's weigh-in: logged as the phone's check-in logs one (today's replaces today's).
      weighIn: ({ w, at }) => useStore.getState().update(s => { logWeighIn(s, w, at) }),
      // The watch removed its copies of deleted workouts from Apple Health: the phone's removal
      // runs again, finds them gone and stops retrying them.
      healthDeleted: () => { import('./lib/health-sync.js').then(m => m.syncHealth(useStore.getState().S)).catch(() => {}) },
      patchSet: (where, fields, opts = {}) => useStore.getState().update(s => {
        patchSetIn(s, where, fields, stampWorkout, { ...opts, recount: w => { w.vol = workoutVolume(w) } })
      }),
      // Ticks from the watch are the workout screen's to apply: it opens, and drains the queue.
      openWorkout: () => { if (!String(window.location.hash || '').startsWith('#/workout')) navToWorkout() },
    })
    return () => { gone = true; stop?.(); unbind() }
  }, [])
  // iPhone app: the Home Screen widgets and the workout's Live Activity (lib/widgets.js,
  // lib/live-activity.js). Nothing at all on the web or on Android.
  useEffect(() => {
    if (!MOBILE) return
    const stops = [], gone = { v: false }
    const keep = fn => { if (gone.v) fn(); else stops.push(fn) }
    startWidgetSync({ useStore }).then(keep).catch(() => {})
    startLiveActivitySync({ useStore, useUI }).then(keep).catch(() => {})
    return () => { gone.v = true; stops.forEach(fn => fn()) }
  }, [])
  // Phone app: a tap on the gym reminder (lib/gym-reminder.js) opens the Start screen, or the
  // workout already running. Nothing on the web.
  useEffect(() => {
    if (!MOBILE) return
    return onGymReminderOpen(() => { if (!String(window.location.hash || '').startsWith('#/workout')) navToWorkout() })
  }, [])
  return <HashRouter><Shell /></HashRouter>
}
