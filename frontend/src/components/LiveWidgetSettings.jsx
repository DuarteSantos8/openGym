import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Section, Row, Switch, Segmented, Button } from './ui.jsx'
import { GlanceLock, GlanceIsland, GlanceNotification, GlanceStrip, buttonWords } from './LiveGlance.jsx'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE } from '../lib/mobile.js'
import { platformNow } from '../lib/platform-now.js'
import { ACTIONS } from '../lib/live-layout.js'
import { liveStatus, tryLive, endTryLive, TRY_SECONDS, liveOff, setLiveOff, askLiveNotifications } from '../lib/live-activity.js'
import { openAppSettings } from '../lib/gym-reminder.js'
import { recordHintsOn } from '../lib/set-records.js'
import { glanceOf, glanceView, shortOf, isDefaultGlance, normalizeGlance, KINDS, KIND_DETAILS, KIND_BUTTONS, detailsFor, workButtons } from '../lib/live-glance.js'
import { sampleLive, sampleIds, sampleLabel, sampleBase } from '../lib/live-samples.js'
import { optionNotes, jumpFor, kindButtonNotes, kindRecordNote, rowPlatform, KIND_SAMPLE } from '../lib/live-notes.js'
import { EFFORT, effortOf } from '../lib/history.js'

// Undo puts `before` back only while the widget is still what the reset wrote (the iPhone toast stays).
function undoReset(before, after) {
  const { S, update } = useStore.getState()
  if (JSON.stringify(S.liveWidget) !== JSON.stringify(after)) return useUI.getState().toast(t('Nothing to undo'))
  update(s => { if (before == null) delete s.liveWidget; else s.liveWidget = before })
}

// Settings > Workout > Live widget. Three parts, top to bottom: a status card that says whether
// the widget works on this phone (and a switch to turn it off here), the real Lock Screen, Dynamic
// Island or notification for a moment you pick, pinned while you scroll, and switches grouped by
// the moment they belong to. A switch either changes the preview at once (the preview goes to a
// moment that shows it) or says in its own subtitle why not (lib/live-notes.js); a row that can do
// nothing on this phone or profile is not there at all. Per exercise type control lives one level
// down (LiveWidgetCustomise), for the people who want it.

// Words as literal t() calls, so scripts/check-source-strings.mjs sees every one of them.
const SURFACES = [
  { id: 'lock', label: () => t('Lock Screen'), os: 'ios' },
  { id: 'island', label: () => t('Dynamic Island'), os: 'ios' },
  { id: 'android', label: () => t('Notification'), os: 'android' },
  { id: 'app', label: () => t('In the app') },
]
const surfaceName = id => SURFACES.find(x => x.id === id)?.label() || ''
export const kindName = k => ({ lift: t('Strength'), band: t('Bands'), hold: t('Holds'), cardio: t('Cardio'), carry: t('Carries') })[k]
const detailName = k => ({ effort: t('Effort'), record: t('Record hint'), partner: t('Superset partner'), equip: t('Equipment'), notes: t('Notes') })[k]
// The three moments of the main page. The kinds (a hold, cardio, a carry, a band, a superset) are
// previewed where they are set up, on Per exercise type.
const MOMENTS = ['strength', 'rest', 'done']

function useNow (on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    const iv = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1000)
    return () => clearInterval(iv)
  }, [on])
  return now
}

/**
 * One surface's preview of `sample` with the setting `G` (the stored one, or Customise's).
 * `off`: the widget is switched off on this phone, so the drawing steps back behind the word.
 */
export function GlancePreview ({ S, surface, sample, G, off = false }) {
  const timer = useUI(s => s.timer)
  // The samples keep their own clocks, counting down from when the preview opened and starting
  // again just before 0: a rest that ran out drew the set it rests before (TestFlight 67).
  const [base] = useState(() => Date.now())
  const now = useNow(true)
  const at = sampleBase(sample, base, now)
  const live = useMemo(() => {
    try { return sampleLive(S, sample, { glance: G, timer, now: at }) } catch { return null }
  }, [S, sample, G, timer, at])
  // The stage keeps the tallest card it drew for this surface during the visit, so a switch that
  // takes a line away (or a moment with less on it) never moves the list under the preview.
  const fit = useRef(null)
  const tallest = useRef({})
  const [minH, setMinH] = useState(0)
  useLayoutEffect(() => {
    const h = fit.current?.firstElementChild?.offsetHeight || 0
    const best = Math.max(tallest.current[surface] || 0, h)
    tallest.current[surface] = best
    if (best !== minH) setMinH(best)
  })
  // Parts that join the card later fade in; a card drawn fresh (another moment, another surface)
  // fades as a whole instead, so its parts must not each do their own entrance on top.
  const cardKey = surface + '/' + sample
  const [settled, setSettled] = useState(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(cardKey))
    return () => cancelAnimationFrame(id)
  }, [cardKey])
  if (!live) return null
  const view = glanceView(live.attributes, live.state, surface === 'app' ? 'lock' : surface, now)
  const still = view.still || null
  // What the preview shows, for a screen reader: one image with the words on it and its buttons.
  // No clock: it ticks.
  const words = [view.heading, view.next, view.title, view.big, view.sub, ...view.chips.map(c => c.t), view.note].filter(Boolean).join(', ')
  const btns = surface === 'app' ? [] : buttonWords(view, live, surface)
  const said = `${surfaceName(surface)}, ${sampleLabel(sample)}: ${words}.` + (btns.length ? ` ${t('Buttons')}: ${btns.join(', ')}.` : '')
  return <div className={'gl-stage gl-stage-' + surface + (off ? ' off' : '')} role="img" aria-label={off ? `${said} ${t('Off')}.` : said}>
    {surface === 'lock' && <div className="gl-wall-time" aria-hidden="true">9:41</div>}
    <div ref={fit} key={cardKey} className={'gl-fit' + (settled === cardKey ? ' gl-settled' : '')} style={minH ? { minHeight: minH } : null}>
      {surface === 'lock' && <GlanceLock view={view} live={live} now={now} stillSrc={still} />}
      {surface === 'island' && <GlanceIsland view={view} live={live} now={now} stillSrc={still} pill={shortOf(live.state.cur) || view.count} />}
      {surface === 'android' && <GlanceNotification view={view} live={live} now={now} stillSrc={still} />}
      {surface === 'app' && <div className="card gl-card gl-card-preview"><GlanceStrip live={live} /></div>}
    </div>
    {off && <span className="gl-off" aria-hidden="true">{t('Off')}</span>}
  </div>
}

/**
 * What the phone says about itself (lib/live-activity.js liveStatus): null until it answered.
 * Asked again whenever the app comes back to the front, since the way to fix a "no" leads out to
 * the system's settings and back.
 */
function useLiveStatusFresh () {
  const [st, setSt] = useState(null)
  const alive = useRef(true)
  const ask = useRef(() => {})
  ask.current = () => liveStatus().then(x => { if (alive.current) setSt(x) }).catch(() => { if (alive.current) setSt({ native: false, supported: false, island: false, allowed: true, tooOld: false }) })
  useEffect(() => {
    alive.current = true
    ask.current()
    const onVisible = () => { if (document.visibilityState === 'visible') ask.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive.current = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return [st, () => ask.current()]
}
export function useLiveStatus () { return useLiveStatusFresh()[0] }

/**
 * The surfaces to preview: on a phone only its own, and the Dynamic Island only on an iPhone that
 * has one (the plugin says so; not known yet or not known at all: no island). On the web, all of
 * them, to show what the phone apps do. `card` adds the strip of the workout screen (the page
 * itself draws that one inline, under its switch).
 */
export function surfacesFor (os, status, card) {
  return SURFACES.filter(x => !os || !x.os || x.os === os)
    .filter(x => x.id !== 'island' || !os || status?.island === true)
    .filter(x => x.id !== 'app' || card)
}

/**
 * The preview stays in view while the switches scroll under it (owner: flip a switch, watch the
 * widget change). Pinned under the status bar; once pinned it drops the wallpaper's clock and
 * tightens, so it does not eat a small phone's screen. Its height goes to --gl-stuck, so a row
 * scrolled into view by the keyboard never lands under it.
 */
function StickyPreview ({ children }) {
  const mark = useRef(null)
  const box = useRef(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = mark.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const top = parseFloat(getComputedStyle(box.current).top) || 0
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < top + 1), { rootMargin: `-${Math.ceil(top) + 1}px 0px 0px 0px`, threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { el.parentElement?.style.setProperty('--gl-stuck', Math.round(el.offsetHeight + (parseFloat(getComputedStyle(el).top) || 0)) + 'px') })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <>
    <div ref={mark} className="gl-sticky-mark" aria-hidden="true" />
    <div ref={box} className={'gl-sticky' + (stuck ? ' stuck' : '')}>{children}</div>
  </>
}

/**
 * "Try it": the real Live Activity (iOS) or notification (Android) with the moment previewed and
 * the settings as they are. iOS shows an app's own activity in the Dynamic Island only once the
 * app is no longer in front, so the row says to swipe home or lock the phone. Marked a preview,
 * so its buttons log nothing (WorkoutActivity.swift enqueue, WorkoutCardReceiver). Never over a
 * running workout. Ends after TRY_SECONDS, on Stop, or when the page closes; follows the moment
 * and the switches while it runs. When the phone answers that it showed nothing, the row says so
 * and the status is asked again.
 */
function TryIt ({ S, G, sample, os, status, recheck }) {
  const timer = useUI(s => s.timer)
  const [on, setOn] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = !!S.active
  const ready = !!status
  const build = () => { try { return sampleLive(S, sample === 'live' ? 'strength' : sample, { glance: G, timer, now: Date.now() }) } catch { return null } }
  const start = () => { setFailed(false); return tryLive(build(), S).then(ok => { setOn(!!ok); if (!ok) { setFailed(true); recheck?.() } }) }
  const stop = () => { setOn(false); endTryLive() }
  // Follows the moment and the switches while it runs.
  useEffect(() => { if (on && !busy) tryLive(build(), S) }, [sample, G]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) return undefined
    const tm = setTimeout(() => setOn(false), TRY_SECONDS * 1000)
    return () => clearTimeout(tm)
  }, [on])
  // A workout that starts takes the card over (its own update replaces the preview).
  useEffect(() => { if (busy && on) { setOn(false); endTryLive() } }, [busy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { endTryLive() }, [])
  const where = os === 'android' ? t('Pull down from the top to see it with your notifications.')
    : status?.island ? t('Swipe home to see it in the Dynamic Island, or lock your phone for the Lock Screen.')
      : t('Lock your phone to see it on the Lock Screen.')
  const hint = busy ? t('Not while a workout is running. It shows your workout already.')
    : failed && !on ? t('Your phone did not show it. “Not showing up?” at the bottom has the usual reasons.')
      : on ? <>{where} {t('Ends by itself after 2 minutes.')}</> : where
  return <Row className="gl-try" icon={on ? 'stop' : 'play'} iconTint="var(--green)" title={on && !busy ? t('Stop') : t('Try it on this phone')}
    subtitle={<span className="gl-try-hint">{hint}</span>} onClick={busy || !ready ? undefined : on ? stop : start} />
}

/** The kinds whose picks come from Per exercise type, so the main page's switches leave them alone. */
const ownKinds = G => KINDS.filter(k => G.kinds[k])

const NOTE = {
  ios: () => t('Needs iOS 17 or later. On a locked phone, iOS may ask for Face ID or your passcode first. Finish opens the app.'),
  android: () => t('A Live Update by the clock on Android 16, a regular notification before that. While a rest runs, it shows the rest’s own buttons.'),
  web: () => t('The Lock Screen and the notification come with the phone apps. This is how they look there.'),
}

// Android's own question first (it can still be answered in place); a "no" that stays a no can
// only be changed in the system's settings.
const allowNotifications = async recheck => {
  const ok = await askLiveNotifications()
  if (!ok) await openAppSettings()
  recheck?.()
}

/**
 * "Not showing up?": the few reasons the widget stays away that the app can name for certain, the
 * first with the phone's own answer beside it and a way to the setting. (Low Power Mode, Focus and
 * silenced channels are left out: not verified.)
 */
function LiveHelpSheet ({ close, os }) {
  const [status] = useLiveStatusFresh()
  const word = v => (status ? (v ? t('On') : t('Off')) : null)
  return <>
    <h3>{t('Not showing up?')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('It shows up when a workout starts and leaves when you finish.')}</div>
    {os === 'android'
      ? <Section footer={NOTE.android()}>
        <Row icon="bell" iconTint="var(--red)" title={t('Allow notifications')} subtitle={t('Android Settings, Apps, openGym, Notifications.')}
          value={word(status?.allowed)} accessory="chevron" onClick={() => openAppSettings()} />
      </Section>
      : <Section>
        <Row icon="layout" iconTint="var(--green)" title={t('Allow Live Activities')} subtitle={t('iPhone Settings, openGym, Live Activities.')}
          value={word(status?.supported)} accessory="chevron" onClick={() => openAppSettings()} />
        <Row icon="lock" iconTint="var(--grey)" title={t('Allow it on a locked phone')} subtitle={t('iPhone Settings, the passcode page, then Live Activities under Allow Access When Locked.')} />
        {status?.island && <Row icon="phoneScreen" iconTint="var(--blue)" title={t('Leave the app')} subtitle={t('The Dynamic Island only shows it while openGym is not on screen.')} />}
        <Row icon="stopwatch" iconTint="var(--orange)" title={t('Gone after a swipe or a very long session')} subtitle={t('iOS ends it after 8 hours, and a swipe removes it. It comes back with your next set.')} />
      </Section>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const openLiveHelp = os => useUI.getState().openSheet(close => <LiveHelpSheet close={close} os={os} />)

/**
 * One switch of the page. Its subtitle is what it does, or, while it is on and the widget cannot
 * show it, why not (`note`); the switch is described by that line, so a screen reader hears it too.
 */
function Opt ({ id, icon, tint, title, name = title, sub, note, checked, onChange }) {
  const sid = 'gl-o-' + id
  return <Row icon={icon} iconTint={tint} title={title} subtitle={<span id={sid} className={note ? 'gl-why' : undefined}>{note || sub}</span>}>
    <Switch aria-label={name} aria-describedby={sid} checked={checked} onChange={onChange} />
  </Row>
}

export default function LiveWidgetSettings () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const G = useMemo(() => glanceOf(S), [S.liveWidget, S.liveLayout])
  const [status, recheck] = useLiveStatusFresh()
  const os = MOBILE ? platformNow() : null
  const phone = os === 'ios' || os === 'android'
  const surfaces = useMemo(() => surfacesFor(os, status, false), [os, status])
  const [surface, setSurface] = useState(surfaces[0].id)
  const shown = surfaces.some(x => x.id === surface) ? surface : surfaces[0].id
  const running = sampleIds(S)[0] === 'live'
  const moments = running ? ['live', ...MOMENTS] : MOMENTS
  const [picked, setSample] = useState(running ? 'live' : 'strength')
  const sample = moments.includes(picked) ? picked : 'strength'
  const [off, setOff] = useState(() => phone && liveOff())
  const [said, setSaid] = useState('')
  const ids = { on: useId(), moment: useId() }
  // The rows describe the phone in hand; on the web, the platform of the tab in view.
  const plat = rowPlatform(os, shown)
  const android = plat === 'android'
  const set = fn => update(s => { const next = normalizeGlance(glanceOf(s)); fn(next); s.liveWidget = next })
  // Flip, then take the preview to a moment that shows the change (never away from "Your workout").
  const jump = k => { const to = jumpFor(k, sample); if (to) { setSample(to); setSaid(sampleLabel(to)) } }
  const sw = (group, k) => v => { set(g => { g[group][k] = v }); jump(k) }
  const effortWord = EFFORT[effortOf(S)]?.hd
  const nav = useNavigate()
  const open = id => nav('/settings/' + id)
  const reset = () => {
    const before = S.liveWidget ?? null
    const after = normalizeGlance(null)
    update(s => { s.liveWidget = after })
    useUI.getState().toast(t('Back to the defaults.'), { action: t('Undo'), onAction: () => undoReset(before, after) })
  }
  const own = ownKinds(G)
  const ownNote = own.length ? t('{0} use their own picks from Per exercise type, so these switches leave them alone.', own.map(kindName).join(', ')) : null
  const effortOn = effortOf(S) !== 'none'
  const island = status?.island === true
  const notes = useMemo(() => optionNotes(S, G, { os, island, surface: shown }), [S, G, os, island, shown])
  // The strip of the workout screen, drawn under its own switch from the strength moment (which
  // always has an exercise after it, so the strip never comes up empty here).
  const stripLive = useMemo(() => { if (!G.card) return null; try { return sampleLive(S, 'strength', { glance: G }) } catch { return null } }, [S, G])

  // What stands between the phone and the widget, first match wins (the status card's second row).
  const tooOld = phone && !!status?.tooOld
  const blocked = !phone || !status ? null
    : tooOld ? 'old'
      : os === 'ios' && !status.supported ? 'ios'
        : os === 'android' && status.allowed === false ? 'android' : null
  const healthy = phone && !blocked && !off
  const master = v => { setLiveOff(!v); setOff(!v); if (!v) endTryLive() }
  const offFooter = phone && !blocked && off
    ? <>{t('Off on this phone. Your choices below still apply to your other devices and the Home Screen widget.')}{os === 'android' && <> {t('The rest timer keeps its own notification.')}</>}</>
    : null

  return <div className="gl-settings">
    {phone && <Section className="gl-status" footer={offFooter}>
      {!tooOld && <Row icon="layout" iconTint="var(--green)" title={t('Live widget')}>
        <Switch aria-label={t('Live widget')} checked={!off} disabled={!status} onChange={master} />
      </Row>}
      {blocked === 'old' && <Row className="gl-warn" icon="warning" iconTint="var(--orange)" title={t('This needs iOS 17 or later. This iPhone is on an older version.')} />}
      {blocked === 'ios' && <Row className="gl-warn" icon="warning" iconTint="var(--orange)" title={t('Live Activities are off for openGym. Turn them on in the iPhone’s Settings.')}
        accessory="chevron" onClick={() => openAppSettings()} />}
      {blocked === 'android' && <Row className="gl-warn" icon="warning" iconTint="var(--orange)" title={t('Notifications are off for openGym, so Android has nowhere to show this.')}
        accessory="chevron" onClick={() => allowNotifications(recheck)} />}
      {!off && (healthy || !status) && <TryIt S={S} G={G} sample={sample} os={os} status={status} recheck={recheck} />}
    </Section>}
    {!phone && <p className="gl-lede">{NOTE.web()}</p>}

    {surfaces.length > 1 && <div className="gl-preview-head">
      <span id={ids.on} className="vh">{t('Preview on')}</span>
      <Segmented className="gl-surface" value={shown} onChange={setSurface} ariaLabelledby={ids.on}
        options={surfaces.map(x => ({ value: x.id, label: x.label() }))} />
    </div>}
    <StickyPreview>
      <GlancePreview S={S} surface={shown} sample={sample} G={G} off={phone && off} />
      <span id={ids.moment} className="vh">{t('Preview a moment')}</span>
      <Segmented className="gl-moments" value={sample} onChange={setSample} ariaLabelledby={ids.moment}
        options={moments.map(id => ({ value: id, label: sampleLabel(id) }))} />
    </StickyPreview>
    <p className="vh" aria-live="polite">{said}</p>

    <Section title={t('Look')} footer={G.look === 'clean' ? t('The set, the clock and the buttons, with up to two extras.')
      : android ? t('Adds a progress bar and up to four extras.') : t('Adds a progress bar, the record hint and up to four extras.')}>
      <div className="gl-look">
        <Segmented value={G.look} onChange={v => { set(g => { g.look = v }); jump('look') }}
          options={[{ value: 'clean', label: t('Clean') }, { value: 'detailed', label: t('Detailed') }]} />
      </div>
    </Section>

    <Section title={t('During a set')} footer={<>{ownNote && <>{ownNote} </>}{t('Log set is always there. These join it when they make sense, as many as the screen has room for.')}</>}>
      <Opt id="adjust" icon="slider" tint="var(--blue)" title={t('Weight and reps')} note={notes.adjust}
        sub={android ? t('Less weight and More weight in the notification. They take both free places, so the other buttons step aside.') : t('− and + on the weight and the reps, and a tap to rate the effort.')}
        checked={G.buttons.adjust} onChange={sw('buttons', 'adjust')} />
      <Opt id="nextEx" icon="skipForward" tint="var(--indigo, var(--blue))" title={t('Next exercise')} note={notes.nextEx} sub={t('For when someone took your machine.')}
        checked={G.buttons.nextEx} onChange={sw('buttons', 'nextEx')} />
      <Opt id="pause" icon="pause" tint="var(--grey)" title={t('Pause')} note={notes.pause} sub={t('Pauses the whole workout, clock and all.')}
        checked={G.buttons.pause} onChange={sw('buttons', 'pause')} />
      {effortOn && <Opt id="effort" icon="gauge" tint="var(--purple)" title={effortWord ? t('Effort ({0})', effortWord) : t('Effort')} name={t('Effort')} note={notes.effort}
        sub={t('How hard the last set was, until you rate this one.')} checked={G.show.effort} onChange={sw('show', 'effort')} />}
      {recordHintsOn(S) && <Opt id="record" icon="trophy" tint="var(--yellow)" title={t('Record hints')} note={notes.record}
        sub={android ? t('“2 more reps for a record”, on the Home Screen widget.') : t('“2 more reps for a record”, in the detailed look.')}
        checked={G.show.record} onChange={sw('show', 'record')} />}
      <Opt id="picture" icon="image" tint="var(--teal)" title={t('Exercise picture')} note={notes.picture} sub={t('A small still. Never an animation.')}
        checked={G.show.picture} onChange={sw('show', 'picture')} />
    </Section>

    <Section title={t('During a rest')}>
      <Opt id="next" icon="chevronRight" tint="var(--blue)" title={t('What’s next')} note={notes.next} sub={t('During a rest, the set coming up or the next exercise.')}
        checked={G.show.next} onChange={sw('show', 'next')} />
      {/* Android's rest card is the rest timer's own, and it always has + 15s. */}
      {!android && <Opt id="addRest" icon="timer" tint="var(--green)" title={t('+15 s on rests')} note={notes.addRest} sub={t('For when the rest needs a little more rest.')}
        checked={G.buttons.addRest} onChange={sw('buttons', 'addRest')} />}
    </Section>

    <Section title={t('The whole workout')}>
      <Opt id="heart" icon="heart" tint="var(--red)" title={t('Heart rate')} note={notes.heart} sub={t('From your watch or headphones. Stays out of the way without one.')}
        checked={G.show.heart} onChange={sw('show', 'heart')} />
      <Opt id="calories" icon="flame" tint="var(--orange)" title={t('Calories')} note={notes.calories} sub={t('A rough running total.')}
        checked={G.show.calories} onChange={sw('show', 'calories')} />
      <Opt id="elapsed" icon="stopwatch" tint="var(--orange)" title={t('Time since start')} note={notes.elapsed}
        sub={android ? t('A running clock in the corner while a set is up.') : t('A running clock beside the set and under the rest.')}
        checked={G.show.elapsed} onChange={sw('show', 'elapsed')} />
    </Section>

    <Section title={t('In the app')} footer={t('What comes after this exercise, plus heart rate and calories when they’re on. The rest is on the screen already.')}>
      <Row icon="phoneScreen" iconTint="var(--green)" title={t('Show a strip in the workout')}>
        <Switch aria-label={t('Show a strip in the workout')} checked={G.card} onChange={v => set(g => { g.card = v })} />
      </Row>
      {stripLive && <div className="gl-strip-demo gl-card"><GlanceStrip live={stripLive} /></div>}
    </Section>

    <Section footer={phone ? NOTE[os]() : null}>
      <Row icon="slider" iconTint="var(--grey)" title={t('Per exercise type')} subtitle={t('Pick details and buttons for strength, bands, holds, cardio and carries.')}
        value={own.length ? own.map(kindName).join(', ') : undefined} accessory="chevron" onClick={() => open('live-custom')} />
      {MOBILE && <Row icon="info" iconTint="var(--grey)" title={t('Not showing up?')} accessory="chevron" onClick={() => openLiveHelp(os)} />}
      {!isDefaultGlance(G) && <Row icon="reset" iconTint="var(--grey)" title={t('Back to the defaults')} onClick={reset} />}
    </Section>
  </div>
}

/**
 * Why a pick of Per exercise type shows nowhere right now, or null when it shows: a checkmark that
 * changes nothing on the phone is a dead switch, so the row says what it waits for instead.
 */
export function detailNote (S, G, kind, k) {
  if (k === 'effort' && effortOf(S) === 'none') return t('Effort tracking is off.')
  if (k === 'record' && G.look === 'clean') return t('Only in the detailed look.')
  if (k === 'record' && !recordHintsOn(S)) return t('Record hints are off.')
  if (k === 'partner') return t('Only in a superset.')
  if (k === 'notes') return t('When the exercise has a note.')
  return null
}

/**
 * Where each picked button fits, from the real view of the kind's sample (lib/live-notes.js): the
 * Lock Screen has room for four (Log set included), the Dynamic Island and Android for three, and
 * on iPhone a plain lift's − + pairs sit beside the numbers and take no place. A button that is
 * not drawn for another reason (no later exercise, no effort scale) gets no room note.
 * `{ k: note|null }`.
 */
export function buttonNotes (G, kind, os, S = {}, opts = {}) {
  return kindButtonNotes(S, G, kind, { os, ...opts })
}

/** A switch row of Per exercise type: no icon (a plain list under the kind picker), the note under it. */
function Pick ({ id, title, note, checked, onChange }) {
  const sid = 'gl-p-' + id
  return <Row title={title} subtitle={note ? <span id={sid}>{note}</span> : null}>
    <Switch aria-label={title} aria-describedby={note ? sid : undefined} checked={checked} onChange={onChange} />
  </Row>
}

/** Settings > Workout > Live widget > Per exercise type. */
export function LiveWidgetCustomise () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const G = useMemo(() => glanceOf(S), [S.liveWidget, S.liveLayout])
  const [kind, setKind] = useState('lift')
  const status = useLiveStatus()
  const os = MOBILE ? platformNow() : null
  const surface = os === 'android' ? 'android' : 'lock'
  const details = detailsFor(G, kind)
  const buttons = workButtons(G, kind).filter(k => k !== 'log')
  const own = !!G.kinds[kind]
  const name = kindName(kind)
  // A superset partner shows only in a superset: the strength preview turns into one when it is picked.
  const sample = own && kind === 'lift' && details.includes('partner') ? 'superset' : KIND_SAMPLE[kind]
  // On a phone the island counts only when it has one; the web answers for both iPhone surfaces.
  const notes = useMemo(() => (own ? buttonNotes(G, kind, os, S, { island: os ? status?.island === true : true, sample }) : {}), [own, G, kind, os, S, status, sample])
  const recordNote = useMemo(() => (own ? kindRecordNote(S, G, kind, { os, sample }) : null), [own, S, G, kind, os, sample])
  const effortOn = effortOf(S) !== 'none'
  const set = fn => update(s => {
    const next = normalizeGlance(glanceOf(s))
    const cur = next.kinds[kind] || {}
    next.kinds[kind] = fn({ d: [...(cur.d || detailsFor(next, kind))], b: [...(cur.b || workButtons(next, kind).filter(k => k !== 'log'))] })
    s.liveWidget = next
  })
  // On: this kind starts from exactly what it shows now, so nothing moves at that moment.
  // Off: back to the main page's switches, with a way back to the picks just dropped.
  const setOwn = v => {
    if (v) { set(x => x); return }
    const before = S.liveWidget ?? null
    let after
    update(s => { const next = normalizeGlance(glanceOf(s)); delete next.kinds[kind]; s.liveWidget = after = next })
    useUI.getState().toast(t('Back to the defaults.'), { action: t('Undo'), onAction: () => undoReset(before, after) })
  }
  const toggle = (list, k) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  const detailKeys = KIND_DETAILS[kind].filter(k => (k !== 'effort' || effortOn) && (k !== 'record' || recordHintsOn(S)))
  const buttonKeys = KIND_BUTTONS[kind].filter(k => k !== 'effort' || effortOn)
  return <div className="gl-settings">
    <div className="gl-preview-head">
      <Segmented className="gl-kinds" value={kind} onChange={setKind} options={KINDS.map(k => ({ value: k, label: kindName(k) }))} />
    </div>
    <StickyPreview>
      <GlancePreview S={S} surface={surface} sample={sample} G={G} />
    </StickyPreview>
    <Section footer={own ? t('These picks replace the main page’s switches for {0}.', name) : t('Follows the main page. Switch this on to pick the details and buttons for this type yourself.')}>
      <Row icon="slider" iconTint="var(--grey)" title={t('Own setup for {0}', name)}>
        <Switch aria-label={t('Own setup for {0}', name)} checked={own} onChange={setOwn} />
      </Row>
    </Section>
    {own && <Section title={t('Details')} footer={t('Short words beside the set. Heart rate and calories come from the main page.')}>
      {detailKeys.map(k => {
        const on = details.includes(k)
        const note = k === 'record' && os === 'android' ? t('“2 more reps for a record”, on the Home Screen widget.')
          : on ? detailNote(S, G, kind, k) || (k === 'record' ? recordNote : null) : null
        return <Pick key={k} id={'d-' + k} title={detailName(k)} note={note} checked={on} onChange={() => set(x => ({ ...x, d: toggle(x.d, k) }))} />
      })}
    </Section>}
    {own && <Section title={t('Buttons')} footer={t('Log set is always there. These join it when they make sense, as many as the screen has room for.')}>
      {buttonKeys.map(k => {
        const on = buttons.includes(k)
        return <Pick key={k} id={'b-' + k} title={t(ACTIONS[k].label)} note={on ? notes[k] : null} checked={on} onChange={() => set(x => ({ ...x, b: toggle(x.b, k) }))} />
      })}
    </Section>}
  </div>
}
