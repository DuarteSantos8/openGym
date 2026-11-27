// The step before the plan goes to paper (#817): what is printed, and whether each exercise gets
// its picture. Opened from the Plan menu (the whole week) and from a routine's editor (that one
// routine); both print through lib/plan-share.js printPlan, the browser's print dialog on the web
// and the phone's print sheet in the app.
//
// "With pictures" is on unless this device turned it off: the pictures are the 180 px stills the
// app already has (built into the phone app, served next to the web app and kept by its service
// worker), so they are there offline, and they are small enough on paper (27 mm) that a page is
// mostly white. Loading them takes a moment; the button says so, and after a few seconds the plan
// prints with whatever loaded (lib/print-pictures.js).
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { printPlan } from '../lib/plan-share.js'
import { readPrintPictures, writePrintPictures } from '../lib/print-pictures.js'
import { foldersOf, folderKey, isArchive, printableRoutines } from '../lib/routine-folders.js'
import { Button, Row, Switch } from './ui.jsx'

export default function PrintPlanSheet({ routineId, name, close }) {
  const [pictures, setPictures] = useState(() => readPrintPictures())
  const [busy, setBusy] = useState(false)
  // Which folders go on the whole-plan printout: every folder but the archive to begin with.
  // Routines in no folder always print. Not remembered: the archive is out each time you open this.
  const folders = routineId ? [] : foldersOf(useStore.getState().S.routines)
  const [on, setOn] = useState(() => new Set(printableRoutines(useStore.getState().S.routines).map(r => folderKey(r.folder)).filter(Boolean)))
  const flip = f => setOn(o => { const n = new Set(o); const k = folderKey(f); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const everything = folders.every(f => on.has(folderKey(f)))
  const all = () => setOn(new Set(folders.map(folderKey)))
  // Swiped away while the pictures load: nothing prints.
  const gone = useRef(false)
  useEffect(() => () => { gone.current = true }, [])
  const toggle = on => { setPictures(on); writePrintPictures(on) }
  const go = async () => {
    if (busy) return
    setBusy(true)
    const S = useStore.getState().S
    const owner = useStore.getState().user?.name || ''
    let closed = false
    const shut = () => {
      if (gone.current) return false
      if (!closed) { closed = true; close() }
      return true
    }
    try {
      // The sheet stays up while the pictures load, so the button can say what is happening;
      // it closes before the print dialog or the phone's print sheet opens over it.
      await printPlan(S, owner, {
        ...(routineId ? { routineId } : { folders: [...on] }), name, withPictures: pictures,
        beforePrint: shut,
      })
    } finally {
      shut()
    }
  }
  return <>
    <h3 style={{ marginBottom: 10 }}>{name || t('Weekly Training Plan')}</h3>
    <div className="list menu-list" style={{ marginBottom: 12 }}>
      <Row icon="image" title={t('With pictures')} subtitle={t('A small picture next to each exercise, like a plan from the gym.')}>
        <Switch checked={pictures} onChange={toggle} aria-label={t('With pictures')} />
      </Row>
    </div>
    {folders.length > 0 && <>
      <div className="list menu-list" style={{ marginBottom: 12 }}>
        {folders.map(f => {
          const label = isArchive(f) ? t('Include archived workouts') : t('Include “{0}” workouts', f)
          return <Row key={f} icon={isArchive(f) ? 'archive' : 'folder'} title={label}>
            <Switch checked={on.has(folderKey(f))} onChange={() => flip(f)} aria-label={label} />
          </Row>
        })}
      </div>
      <Button variant="tinted" disabled={everything} onClick={all}>{t('Include everything')}</Button>
      <div style={{ height: 12 }} />
    </>}
    <Button variant="primary" disabled={busy} onClick={go}>{busy ? t('Loading…') : t('Print / Save as PDF')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
