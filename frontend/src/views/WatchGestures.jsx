// Settings → Apple Watch → Gestures: what Double Tap and the Action Button do in a workout.
// One screen, two tabs. A watch plays the previewed action; a carousel (or the same choices as a
// list) picks it. A choice is saved when the carousel settles or a list row is tapped, with an
// Undo, never by a button that could be forgotten. The watch gets it with the next snapshot
// (lib/watch-settings.js); the rules it follows are in docs/dev/WATCH_GESTURES.md.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import GestureWatch from '../components/GestureWatch.jsx'
import { Button, Segmented, Section, Row } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, onWatchPrefs, readGestureState, writeGestureState, WATCH_DEFAULTS } from '../lib/watch-settings.js'
import { ICONS, NAME, effect, inputName, actionsFor, pageAt, setupState, testState, TEST_WAIT_MS } from '../lib/watch-gestures.js'

const LIST_KEY = 'gym_watch_gesture_list_v1'
const readList = () => { try { return localStorage.getItem(LIST_KEY) === '1' } catch { return false } }
// The largest text sizes: the carousel and the picture give way to the list (it never clips).
const bigText = () => parseFloat(getComputedStyle(document.documentElement).fontSize) >= 24
// An explicit smooth scroll beats the CSS scroll-behavior, so Reduce Motion is asked for here.
const calm = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function WatchGesturesPage() {
  const loc = useLocation()
  const [input, setInput] = useState(loc.state?.input === 'actionButton' ? 'actionButton' : 'doubleTap')
  const [prefs, setPrefs] = useState(readWatchPrefs)
  const [gs, setGs] = useState(readGestureState)
  const [list, setList] = useState(readList)
  const [big, setBig] = useState(bigText)
  const [now, setNow] = useState(Date.now)
  useEffect(() => onWatchPrefs(() => { setPrefs(readWatchPrefs()); setGs(readGestureState()) }), [])
  useEffect(() => {
    const f = () => setBig(bigText())
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  // The test waits ~30 s for the watch: one tick at its end turns "waiting" into the calm message.
  const [stamp, setStamp] = useState(0)   // this visit's test, so an old answer is not shown as new
  const test = testState(stamp, gs.testOk, now)
  useEffect(() => {
    if (test !== 'waiting') return
    const left = stamp + TEST_WAIT_MS + 1 - Date.now()
    const tm = setTimeout(() => setNow(Date.now()), Math.max(0, left))
    return () => clearTimeout(tm)
  }, [test, stamp])

  const actions = actionsFor(input)
  const saved = prefs[input]
  const savedIdx = Math.max(0, actions.findIndex(a => a.id === saved))
  const asList = list || big
  const [pv, setPv] = useState(savedIdx)   // the page the carousel shows; the watch plays it
  const car = useRef(null), settle = useRef(0), due = useRef(null), slow = useRef(false)
  const previewed = actions[asList ? savedIdx : pv] || actions[0]

  const choose = id => {
    const prev = prefs[input]
    if (id === prev) return
    setPrefs(writeWatchPrefs({ [input]: id }))
    useUI.getState().toast(t('{0} set to {1}', inputName(input), NAME[id]()), {
      action: t('Undo'), onAction: () => setPrefs(writeWatchPrefs({ [input]: prev })),
    })
  }
  const dir = () => (getComputedStyle(car.current).direction === 'rtl' ? -1 : 1)
  const goTo = (i, smooth) => {
    const el = car.current
    if (!el) return
    el.scrollTo({ left: dir() * i * el.clientWidth, behavior: smooth && !calm() ? 'smooth' : 'auto' })
  }
  // A tab, the list, or an Undo: the carousel rests on the saved action again.
  useLayoutEffect(() => {
    setPv(savedIdx)
    if (car.current && pageAt(car.current.scrollLeft, car.current.clientWidth, actions.length) !== savedIdx) goTo(savedIdx, false)
  }, [input, savedIdx, asList]) // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = car.current
    const i = pageAt(el.scrollLeft, el.clientWidth, actions.length)
    setPv(i)
    // the page leaving fades and shrinks as the finger moves it (index.css .gw-pg)
    const p = Math.abs(el.scrollLeft) / (el.clientWidth || 1)
    ;[...el.children].forEach((c, k) => c.style.setProperty('--d', Math.min(1, Math.abs(p - k)).toFixed(3)))
    clearTimeout(settle.current)
    // Settled: saved. A run of arrow or VoiceOver steps waits longer: one save and one Undo for the run.
    due.current = { input, id: actions[i].id }
    settle.current = setTimeout(() => { due.current = null; slow.current = false; choose(actions[i].id) }, slow.current ? 900 : 160)
  }
  // Leaving before it settled still saves what the carousel rests on (without the toast).
  useEffect(() => () => { clearTimeout(settle.current); if (due.current) writeWatchPrefs({ [due.current.input]: due.current.id }) }, [])
  const step = d => { slow.current = true; goTo(Math.max(0, Math.min(actions.length - 1, pv + d)), true) }
  const onKey = e => {
    const rtl = dir() === -1
    const d = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: 1, ArrowDown: -1 }[e.key]
    if (d) { e.preventDefault(); step(d) } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); goTo(e.key === 'Home' ? 0 : actions.length - 1, true) }
  }
  const toggleList = () => { const v = !list; setList(v); try { localStorage.setItem(LIST_KEY, v ? '1' : '0') } catch { /* this run only */ } }

  const sendTest = () => { const at = Date.now(); setNow(at); setStamp(at); setPrefs(writeWatchPrefs({ gestureTest: at })) }
  const setup = setupState(gs)
  const say = t('Preview: the watch shows {0}.', NAME[previewed.id]().toLowerCase())

  return <div className="gw">
    <Segmented className="gw-seg" value={input} onChange={setInput}
      options={[{ value: 'doubleTap', label: t('Double Tap') }, { value: 'actionButton', label: t('Action Button') }]} />
    {input === 'actionButton' && <Section className="gw-note">
      <Row icon={setup === 'todo' ? 'actionButton' : 'check'} iconTint={setup === 'todo' ? 'var(--orange)' : 'var(--green)'} accessory="chevron" onClick={() => openSetup(() => setGs(readGestureState()))}
        title={setup === 'working' ? t('Action Button is working') : setup === 'done' ? t('Action Button is set up') : t('One step on your watch first')}
        subtitle={setup === 'working' ? t('openGym heard a press from your watch. Tap to see the steps again.')
          : setup === 'done' ? t('You said you did this. We cannot check it from here. If a press does nothing, tap to see the steps.')
          : t('Set Action Button to openGym, on the watch or in the Watch app on this iPhone.')} />
    </Section>}

    {!big && <div className="gw-hwrap">
      <GestureWatch input={input} action={previewed.id} say={say} />
      <button className="gw-mode" onClick={toggleList} aria-label={list ? t('Show as carousel') : t('Show as list')}>
        <Icon name={list ? 'grid' : 'list'} /></button>
    </div>}

    {asList
      ? <div role="radiogroup" aria-label={t('{0} action', inputName(input))}><Section className="gw-list">
        {actions.map(a => <Row key={a.id} role="radio" aria-checked={a.id === saved} onClick={() => choose(a.id)}
          icon={ICONS[a.id]} iconTint={a.id === 'none' ? 'var(--grey)' : 'var(--acc)'} accessory={a.id === saved ? 'check' : 'none'}
          title={a.id === WATCH_DEFAULTS[input] ? <>{NAME[a.id]()}<span className="gw-rec">{t('Recommended')}</span></> : NAME[a.id]()} subtitle={effect(a.id, input)} />)}
      </Section></div>
      : <>
        <div ref={car} className="gw-car" role="slider" tabIndex={0} aria-orientation="horizontal" aria-label={t('{0} action', inputName(input))}
          aria-valuemin={1} aria-valuemax={actions.length} aria-valuenow={pv + 1} onScroll={onScroll} onKeyDown={onKey}
          aria-valuetext={t('{0}, {1} of {2}', NAME[previewed.id](), pv + 1, actions.length) + (previewed.id === saved ? ', ' + t('selected') : '') + '. ' + effect(previewed.id, input)}>
          {actions.map(a => <section key={a.id} className="gw-pg" aria-hidden="true">
            <i className={'gw-glyph' + (a.id === 'none' ? ' off' : '')}><Icon name={ICONS[a.id]} /></i>
            <h2>{NAME[a.id]()}{a.id === saved && <Icon name="check" className="gw-ck on" />}{a.id === WATCH_DEFAULTS[input] && <span className="gw-rec">{t('Recommended')}</span>}</h2>
            <p>{effect(a.id, input)}</p></section>)}
        </div>
        <div className="gw-pager">
          <button className="gw-nb" aria-label={t('Previous action')} disabled={pv === 0} onClick={() => step(-1)}><Icon name="chevronLeft" /></button>
          <div className="gw-dots" aria-hidden="true">{actions.map((a, i) => <i key={a.id} className={i === pv ? 'on' : ''} />)}</div>
          <button className="gw-nb" aria-label={t('Next action')} disabled={pv === actions.length - 1} onClick={() => step(1)}><Icon name="chevronRight" /></button>
        </div>
      </>}

    {input === 'doubleTap' && <div className="gw-try">
      <button className="gw-link" onClick={sendTest} disabled={test === 'waiting'}><Icon name="watch" />{t('Try it on my watch')}</button>
      <p role="status" className={'gw-testmsg ' + test}>
        {test === 'waiting' && t('Waiting for your watch. Raise your wrist and double tap the test button.')}
        {test === 'ok' && <><Icon name="check" />{t('Worked. Double Tap reached openGym.')}</>}
        {test === 'timeout' && t('No answer yet. Open openGym on your watch, keep the screen awake, and try again.')}
      </p>
    </div>}

    <details className="gw-smart">
      <summary>{t('What Smart does')}</summary>
      <dl>
        <div><dt>{t('Lifting a set')}</dt><dd>{t('Log set')}</dd></div>
        <div><dt>{t('Resting')}</dt><dd>{t('Skip rest')}</dd></div>
        <div><dt>{t('A timed hold')}</dt><dd>{t('Start or stop')}</dd></div>
        <div><dt>{t('Other screens')}</dt><dd>{t('Their main button')}</dd></div>
      </dl>
      <p>{t('Never Finish or Discard.')}</p>
    </details>
    <p className="gw-fine"><Icon name="info" /><span>{input === 'doubleTap'
      ? t('Needs Apple Watch Series 9 or later, or Ultra 2, on watchOS 11 or later. Turn it on in the Watch app, under Gestures. It works while the watch screen is awake.')
      : t('Apple Watch Ultra only. The first press starts your workout. During a workout, later presses run your choice. Some watchOS 26.5 users report that later presses do not arrive.')}</span></p>
  </div>
}

/** The three steps on the watch, which only the lifter can do. "I've done this" is their word: the phone cannot check. */
function openSetup(done) {
  useUI.getState().openSheet(close => <div className="gw-sheet">
    <h3>{t('Set up the Action Button')}</h3>
    <p className="gw-lead">{t('Do this once. Apple does not let an app do it for you, so openGym cannot see if it is done.')}</p>
    <ol>
      <li><b>{t('Open the Action Button settings')}</b><span>{t('On your watch: Settings, then Action Button. Or on this iPhone: Watch app, My Watch, Action Button.')}</span></li>
      <li><b>{t('Set Action to Workout, App to openGym')}</b><span>{t('openGym then shows up as a workout app.')}</span></li>
      <li><b>{t('Under First Press, pick a workout type')}</b><span>{t('For example Strength Training. The first press starts that workout. During a workout, later presses run your choice.')}</span></li>
    </ol>
    <Button variant="primary" onClick={() => { writeGestureState({ setup: true }); done(); close() }}>{t('I’ve done this')}</Button>
    <Button onClick={close}>{t('Not now')}</Button>
    <p className="gw-why">{t('Pause and resume stay with the system: press the Action Button and the side button together.')}</p>
    <p className="gw-why">{t('If the button is set to a Shortcut, a Control Center control or another app, openGym will not hear it. We cannot check that from here.')}</p>
  </div>)
}
