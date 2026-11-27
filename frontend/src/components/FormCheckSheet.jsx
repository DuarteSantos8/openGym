// Form check, the sheets around the camera view (lib/form-check-native.js), for any drill
// (lib/form-drills/): a short "how to stand" from the drill's setup with the camera to use and
// the standard a rep counts from, then what was measured: the counted reps (or the seconds held)
// big with the no-reps (or the time out of line) under them, the drill's two or three tiles, its
// one cue as a callout, and every rep (or stretch of the hold) folded away below. It states
// measurements and never says whether the form was good. Nothing is kept; "Use N reps" (the
// counted reps only) or, for a hold, "Use N s" is the only thing that reaches the workout.
import { useEffect, useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { durationText, fmtDuration } from '../lib/duration.js'
import { voiceOpts } from '../lib/speech.js'
import { formCheckAvailable, runFormCheck } from '../lib/form-check-native.js'
import { storedStandard, storeStandard } from '../lib/form-check-standard.js'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'

const openSheet = render => useUI.getState().openSheet(render)
const toast = m => useUI.getState().toast(m)

/** Whether to offer Form check at all: the iPhone app with a camera. Asked once per launch. */
export function useFormCheckAvailable() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    formCheckAvailable().then(v => { if (live) setOk(v) })
    return () => { live = false }
  }, [])
  return ok
}

/**
 * Opens the intro of `drill` (lib/form-drills/) for `title` (the exercise's name). `onUse(n)`:
 * writes n reps (a hold: n seconds) into the set in progress; null leaves the button out, and
 * `useNote`, when given, says why on the result.
 */
export function formCheckSheet({ title, drill, onUse = null, useNote = '' }) {
  openSheet(close => <FormCheckIntro title={title} drill={drill} close={close} onStart={(camera, standard) => {
    close()
    start(drill, camera, standard, title, onUse, useNote)
  }} />)
}

async function start(drill, camera, standard, title, onUse, useNote) {
  try {
    const result = await runFormCheck({ drill: drill.id, camera, standard, voice: voiceOpts(useStore.getState().S) })
    openSheet(close => <FormCheckResult result={result} drill={drill} title={title} close={close} onUse={onUse} useNote={useNote} />)
  } catch (e) {
    toast(e?.code === 'denied' ? t('Camera access is off. Allow it for openGym in the iPhone’s Settings.') : t('The camera could not start.'))
  }
}

// Translated where they are shown (t(w)), so the source-string check cannot see them;
// FormCheckSheet.test.jsx checks every pack has them.
export const VIEW_WORDS = { side: 'side', front: 'front', diagonal: 'at an angle' }

/** "Works from: side, front": the camera angles the drill judges, best first, in the app's language. */
export function viewsLine(views = []) {
  const words = views.map(v => VIEW_WORDS[v]).filter(Boolean).map(w => t(w))
  if (!words.length) return ''
  let list = words.join(', ')
  try { list = new Intl.ListFormat(dateLocale(), { style: 'short', type: 'unit' }).format(words) } catch { /* no ListFormat: commas */ }
  return t('Works from: {0}', list)
}

/** A hold's seconds as the result shows them: "45" under a minute, "1:05" from a minute up. */
export const heldText = n => (n < 60 ? String(n) : fmtDuration(n))

export function FormCheckIntro({ title, drill, close, onStart }) {
  const [camera, setCamera] = useState('back')
  const [standard, setStandard] = useState(() => storedStandard(drill.id) || drill.defaultStandard)
  const depthId = useId()
  const pickStandard = v => { setStandard(v); storeStandard(drill.id, v) }
  const views = viewsLine(drill.views)
  const one = drill.standards.length === 1 ? drill.standards[0] : null
  return <div className="fc-sheet">
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{title}</div>
    {drill.name && <p className="fc-line" data-fc-drill><b>{t(drill.name)}</b>{views && <span className="small muted" data-fc-views><br />{views}</span>}</p>}
    <p className="fc-line" data-fc-setup>{t(drill.setup)}</p>
    <p className="fc-line small muted" data-fc-aloud>{drill.kind === 'hold'
      ? t('Every 10 seconds held is said aloud. Nothing is filmed or kept: the camera is only read on this phone.')
      : t('Each rep is counted aloud. Nothing is filmed or kept: the camera is only read on this phone.')}</p>
    <Segmented className="seg-inline" value={camera} onChange={setCamera}
      options={[{ value: 'back', label: t('Back camera') }, { value: 'front', label: t('Front camera') }]} />
    {one ? <div className="fc-pick" data-fc-standard>
      <div className="fc-pick-l small muted">{t('Counts from')}</div>
      <div className="small">{t(one.label)}</div>
    </div> : <div className="fc-pick" data-fc-standard>
      <div id={depthId} className="fc-pick-l small muted">{t('Counts from')}</div>
      <Segmented className="seg-inline" value={standard} onChange={pickStandard} ariaLabelledby={depthId}
        options={drill.standards.map(s => ({ value: s.id, label: t(s.label) }))} />
    </div>}
    <div className="fc-actions">
      <Button variant="primary" icon="camera" onClick={() => onStart(camera, standard)}>{t('Start')}</Button>
      <Button onClick={close}>{t('Cancel')}</Button>
    </div>
  </div>
}

export function FormCheckResult({ result, drill, title, close, onUse, useNote = '' }) {
  const { reps = [], tiles = [], details = [], cue = '', cueId, note = '' } = result || {}
  const n = result?.count || 0
  const missed = result?.missed || 0
  const hold = drill?.kind === 'hold'
  const [open, setOpen] = useState(false)
  const missRow = r => {
    const m = drill?.misses?.[r.reason]
    return m ? t(m.row) : t('Not counted')
  }
  return <div className="fc-sheet" data-fc-result>
    <h3 style={{ marginBottom: 4 }}>{t('Form check')}</h3>
    {title && <div className="muted small">{title}</div>}
    <div className="fc-hero" data-fc-hero>
      <b className="fc-hero-n" data-fc-count aria-label={hold ? durationText(n) : undefined}>{hold ? heldText(n) : n}</b>
      <span className="fc-hero-l">{!hold ? t('Counted reps') : n < 60 ? t('Seconds held in position') : t('Held in position')}</span>
      {missed > 0 && <span className="fc-hero-miss" data-fc-missed>{hold ? t('{0} s out of line', missed) : t('{0} did not count', missed)}</span>}
    </div>
    {tiles.length > 0 && <div className="tiles fc-tiles">
      {tiles.map(x => <div key={x.id || x.label} className="tile" data-fc-tile={x.id || x.label}>
        <div className="l">{x.label}</div>
        <div className="v">{x.value}</div>
        {x.sub && <div className="fc-tile-s">{x.sub}</div>}
      </div>)}
    </div>}
    <div className="fc-callout" data-fc-cue><Icon name={cueId === 'missed' ? 'warning' : 'lightbulb'} /><p>{cue}</p></div>
    {reps.length > 0 && <>
      <Button className="fc-more" trailingIcon={open ? 'chevronUp' : 'chevronDown'} aria-expanded={open} onClick={() => setOpen(o => !o)}>{hold ? t('Every stretch') : t('Every rep')}</Button>
      {open && <>
        <ol className="fc-reps">
          {reps.map((r, i) => <li key={i} className={'fc-rep' + (r.counted === false ? ' missed' : '')} data-fc-rep>
            <span className="fc-n">{hold ? t('Stretch {0}', i + 1) : t('Rep {0}', i + 1)}</span>
            <span className="fc-rows">{(details[i] || []).map((d, k) => <span key={k} className="fc-row small"><span className="muted">{d.label}</span> {d.value}</span>)}</span>
            {r.counted === false && <span className="fc-flag fc-miss small"><Icon name="xmark" />{missRow(r)}</span>}
            {r.lost && <span className="fc-flag fc-lost small"><Icon name="info" />{t('Camera lost you')}</span>}
          </li>)}
        </ol>
        {note && <p className="fc-line small" data-fc-note>{note}</p>}
      </>}
    </>}
    <p className="small dim fc-line">{t('Measured from a 2D camera view: a guide, not a verdict.')}</p>
    {!onUse && useNote && n > 0 && <p className="small muted fc-line" data-fc-use-note>{useNote}</p>}
    <div className="fc-actions">
      {onUse && n > 0 && <Button variant="primary" onClick={() => { onUse(n); close() }}>{hold ? t('Use {0} s', n) : tn('Use {0} rep', 'Use {0} reps', n)}</Button>}
      <Button onClick={close}>{t('Close')}</Button>
    </div>
  </div>
}
