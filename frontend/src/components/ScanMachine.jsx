// Scan a machine: a QR code or NFC tag already on a gym machine. Route mode (the workout, the
// Exercises list) takes what it reads to the exercise linked to it, or links it on the spot.
// Link mode (an exercise's details) links the code it reads to that exercise. The rules for
// what may be linked and how a code is read: lib/machine-codes.js. A code is only ever shown as
// React text, through shownCode.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { exerciseNameText } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { entryProgress } from '../lib/exercise-chips.js'
import { codeFromQr, codeFromNfc, refusal, exercisesFor, link, shownCode, searchHint } from '../lib/machine-codes.js'
import { pickForScan } from '../lib/machine-scan.js'
import { routeScannedText } from '../lib/scan-route.js'
import { parseTagUrl } from '../lib/nfc-tags.js'
import { nfcReadSupport, readMachineTags, readMachineTagOnce } from '../lib/nfc.js'
import { exercisePicker } from '../sheets.jsx'
import { scanQrWith, handleScannedText, indexAddress } from './ScanCode.jsx'
import { Button, Row } from './ui.jsx'

const ui = () => useUI.getState()
const store = () => useStore.getState()

const REFUSED = {
  own: () => t('This is an openGym code. It already has a job.'),
  'gym-card': () => t('That’s your gym membership code. It can’t be linked to an exercise.'),
  'random-uid': () => t('This tag changes its ID every time, so it can’t be linked.'),
  empty: () => t('Couldn’t read this tag. Try its QR code.'),
}

const nameOf = id => {
  const S = store().S
  return exerciseNameText(EXIDX[id] || (S.customEx || []).find(e => e && e.id === id) || { id, name: id })
}

// What a read is: openGym's own code (`own`: its route) or a machine code, the same for QR text
// and for an NFC tag (whose link record may itself be one of ours).
async function classify({ text, tag }) {
  const S = store().S
  const raw = text !== undefined ? text : (tag?.records || []).find(r => r?.type === 'uri')?.value
  const route = typeof raw === 'string' ? routeScannedText(raw, { indexAddress: await indexAddress() }) : null
  const own = route && ['routine-link', 'library', 'tag'].includes(route.kind) ? route : null
  const code = text !== undefined ? codeFromQr(text) : codeFromNfc(tag)
  return { S, raw, own, code }
}


async function onRead(input, { mode, ex, onExercise, live }) {
  const { S, raw, own, code } = await classify(input)
  if (mode === 'link') {
    const why = refusal(S, code, { own: !!own })
    if (why) { ui().toast(REFUSED[why]()); return }
    return linkTo(ex, code)
  }
  if (own) {
    const sticker = own.kind === 'tag' ? parseTagUrl(own.url) : null
    if (sticker?.kind === 'exercise') onExercise(sticker.id)
    else await handleScannedText(raw, { indexAddress: await indexAddress() })
    return
  }
  const why = refusal(S, code)
  if (why) { ui().toast(REFUSED[why]()); return }
  const ids = exercisesFor(S, code)
  if (!ids.length) { ui().openSheet(close => <Unlinked code={code} close={close} onExercise={onExercise} />); return }
  const id = pickForScan(live, ids)
  if (id) onExercise(id)
  else ui().openSheet(close => <Which ids={ids} live={live} close={close} onExercise={onExercise} />)
}

function Unlinked({ code, close, onExercise }) {
  const go = () => {
    close()
    const picker = exercisePicker(ex => {
      picker.close()
      store().update(s => { link(s, ex.id, code) })
      onExercise(ex.id)
    }, { query: searchHint(code) })
  }
  return <>
    <h3>{t('Scan a machine')}</h3>
    <div className="small muted" style={{ margin: '4px 0 10px' }}>{t('This code isn’t linked yet.')}</div>
    <div className="small" style={{ marginBottom: 12, wordBreak: 'break-all' }}>{shownCode(code)}</div>
    <Button variant="primary" onClick={go}>{t('Link to an exercise…')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </>
}

function Which({ ids, live, close, onExercise }) {
  const entries = live?.entries || []
  const state = id => { const e = entries.find(x => x.id === id); return e ? (entryProgress(e) === 'done' ? 'done' : 'open') : 'absent' }
  const rank = { open: 0, done: 1, absent: 2 }
  const sorted = [...ids].sort((a, b) => rank[state(a)] - rank[state(b)])
  return <>
    <h3>{t('Which exercise?')}</h3>
    {sorted.map(id => <Row key={id} title={nameOf(id)} accessory={state(id) === 'done' ? 'check' : 'none'} onClick={() => { close(); onExercise(id) }} />)}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </>
}

function linkTo(ex, code) {
  const others = exercisesFor(store().S, code).filter(id => id !== ex.id)
  const finish = only => {
    store().update(s => { link(s, ex.id, code, { only }) })
    ui().toast(t('Linked to {0}', exerciseNameText(ex)))
    ui().openSheet(close => <>
      <h3>{t('Linked to {0}', exerciseNameText(ex))}</h3>
      <Button variant="primary" onClick={() => { close(); linkMachineSheet(ex) }}>{t('Scan another code on this machine')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={close}>{t('Done')}</Button>
    </>)
  }
  if (!others.length) { finish(false); return }
  ui().openSheet(close => <>
    <h3>{t('This code also opens {0}.', others.map(nameOf).join(', '))}</h3>
    <div className="small" style={{ margin: '4px 0 12px', wordBreak: 'break-all' }}>{shownCode(code)}</div>
    <Button variant="primary" onClick={() => { close(); finish(false) }}>{t('Open both')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); finish(true) }}>{t('Only {0}', exerciseNameText(ex))}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </>)
}

function ScanMachine({ close, ...ctx }) {
  const [nfc, setNfc] = useState(null)
  const read = input => { close(); onRead(input, ctx) }
  const camera = () => { close(); scanQrWith(text => onRead({ text }, ctx)) }
  const mode = nfc?.supported && nfc.enabled ? nfc.mode : null

  useEffect(() => {
    let gone = false
    nfcReadSupport().then(r => { if (!gone) setNfc(r || { supported: false }) }).catch(() => { if (!gone) setNfc({ supported: false }) })
    return () => { gone = true }
  }, [])
  // Without NFC the camera is the only way in: straight to it.
  useEffect(() => { if (nfc && !mode) camera() }, [nfc]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode !== 'hold') return undefined
    return readMachineTags(tag => read({ tag }))
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const readOnce = async () => {
    try {
      const tag = await readMachineTagOnce({ alert: t('Hold the top of your iPhone near the sticker.') })
      if (tag) read({ tag })
    } catch { ui().toast(REFUSED.empty()) }
  }
  if (!nfc) return <h3>{t('Scan a machine')}</h3>
  return <>
    <h3>{t('Scan a machine')}</h3>
    {mode === 'hold' && <div className="small muted" style={{ margin: '4px 0 12px' }}>{t('Hold your phone to the machine’s NFC tag, or scan its QR code.')}</div>}
    {mode === 'button' && <Button variant="primary" icon="nfc" onClick={readOnce}>{t('Read NFC tag')}</Button>}
    {mode && <>
      {mode === 'button' && <div style={{ height: 8 }} />}
      <Button variant={mode === 'hold' ? 'primary' : 'plain'} icon="qr" onClick={camera}>{t('Scan QR code')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={close}>{t('Cancel')}</Button>
    </>}
  </>
}

/** Route mode. `onExercise(id)` is told which exercise the machine is; `live` is the workout in progress. */
export const scanMachineSheet = ({ onExercise, live = null }) =>
  ui().openSheet(close => <ScanMachine mode="route" onExercise={onExercise} live={live} close={close} />)

/** Link mode: read one code and link it to `ex`. */
export const linkMachineSheet = ex =>
  ui().openSheet(close => <ScanMachine mode="link" ex={ex} close={close} />)
