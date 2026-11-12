// Cardio plans on one exercise (lib/cardio-plans.js): pick a saved plan and its segments become the
// exercise's sets, save the sets you have as a plan, write a new one, or paste one from a note.
// Three views in one sheet: the list, the editor, and the paste box.
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, uid } from '../lib/format.js'
import { fromSpeed, speedUnitOf, toSpeed } from '../lib/speed.js'
import { INCLINE_MAX, INCLINE_STEP, clampIncline } from '../lib/incline.js'
import { NAME_MAX, PLAN_MAX_SEGMENTS, SEGMENT_MIN_MAX, SPEED_MAX, newPlan, parsePlanText, planMinutes, plansOf, removePlan, savePlan, setsToSegments } from '../lib/cardio-plans.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { Button, Stepper } from './ui.jsx'

const BLANK = { min: 5, speed: 5 }

/**
 * `sets`: the exercise's rows right now (to save as a plan). `withIncline`: the exercise has a grade.
 * `onApply(plan)`: the plan was picked; the caller writes it into the workout.
 */
export default function CardioPlansSheet({ close, sets, withIncline, onApply }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const speedUnit = speedUnitOf(S)
  const plans = plansOf(S)
  const [view, setView] = useState('list')
  const [draft, setDraft] = useState(null)      // { id?, at?, name, segments }
  const [pasted, setPasted] = useState('')
  const [note, setNote] = useState('')
  const nameRef = useRef(null)
  const pasteRef = useRef(null)
  const onNameFocus = useSheetKeyboard(nameRef)
  const onPasteFocus = useSheetKeyboard(pasteRef)
  const mine = setsToSegments(sets)

  const edit = (seg, extra = {}) => { setDraft({ name: '', segments: seg, ...extra }); setView('edit') }
  const backToList = () => { setView('list'); setDraft(null); setNote('') }

  const readPasted = () => {
    const r = parsePlanText(pasted, { speedUnit })
    if (!r.segments.length) { setNote(t('Nothing could be read from that text.')); return }
    setNote(t('Read {0} segments. Check them, then save.', r.segments.length) + (r.skipped ? ' ' + t('{0} could not be read.', r.skipped) : ''))
    edit(r.segments)
  }

  if (view === 'paste') {
    return <>
      <h3>{t('Paste a plan')}</h3>
      <textarea ref={pasteRef} className="input" rows={9} autoFocus value={pasted} onFocus={onPasteFocus}
        placeholder={t('One segment per line, like “3 min @ 5 km/h · 4%”, or blocks of Minutes, Incline and Speed.')}
        onChange={e => { setPasted(e.target.value); setNote('') }} />
      {note && <div className="small dim" role="status" style={{ marginTop: 8 }}>{note}</div>}
      <div style={{ height: 14 }} />
      <Button variant="primary" disabled={!pasted.trim()} onClick={readPasted}>{t('Read plan')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={() => { setNote(''); setView('list') }}>{t('Back')}</Button>
    </>
  }

  if (view === 'edit' && draft) {
    const segs = draft.segments
    const setSeg = (i, patch) => setDraft(d => ({ ...d, segments: d.segments.map((g, j) => (j === i ? { ...g, ...patch } : g)) }))
    const name = draft.name.replace(/\s+/g, ' ').trim()
    const canSave = !!name && segs.length > 0
    const save = () => {
      if (!canSave) return
      let saved = null
      update(s => { saved = savePlan(s, { id: draft.id || uid(), at: draft.at || Date.now(), name, segments: segs }) })
      if (!saved) return
      backToList()
    }
    const remove = () => {
      update(s => { removePlan(s, draft.id) })
      backToList()
    }
    return <>
      <h3>{draft.id ? t('Edit plan') : t('New plan')}</h3>
      <input ref={nameRef} className="input" type="text" maxLength={NAME_MAX} value={draft.name} aria-label={t('Plan name')}
        placeholder={t('Plan name')} onFocus={onNameFocus} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
      {note && <div className="small dim" role="status" style={{ marginTop: 8 }}>{note}</div>}
      <div style={{ marginTop: 10 }}>
        {segs.map((g, i) => (
          <div key={i} className="cardio-seg">
            <div className="cardio-seg-hd">
              <strong>{t('Segment {0}', i + 1)}</strong>
              <Button size="sm" icon="trash" aria-label={t('Remove segment')} disabled={segs.length <= 1}
                onClick={() => setDraft(d => ({ ...d, segments: d.segments.filter((_, j) => j !== i) }))} />
            </div>
            <div className="cfgrow row">
              <div><Stepper label={t('Duration (min)')} value={g.min} step={1} min={1} max={SEGMENT_MIN_MAX} decimal={false}
                onChange={v => setSeg(i, { min: v })} /></div>
              <div><Stepper label={speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} value={toSpeed(g.speed, speedUnit)} step={0.5} min={0.5}
                max={toSpeed(SPEED_MAX, speedUnit)} onChange={v => setSeg(i, { speed: fromSpeed(v, speedUnit) })} /></div>
              {withIncline && <div><Stepper label={t('Incline (%)')} value={g.incline || 0} step={INCLINE_STEP} max={INCLINE_MAX}
                onChange={v => setSeg(i, { incline: clampIncline(v) ?? undefined })} /></div>}
            </div>
          </div>
        ))}
      </div>
      <div className="small dim" style={{ margin: '4px 0 10px' }}>{t('Total: {0} min', fmtNum(planMinutes({ segments: segs })))}</div>
      <Button icon="plus" disabled={segs.length >= PLAN_MAX_SEGMENTS}
        onClick={() => setDraft(d => ({ ...d, segments: [...d.segments, { ...(d.segments[d.segments.length - 1] || BLANK) }] }))}>{t('Add segment')}</Button>
      <div style={{ height: 14 }} />
      <Button variant="primary" disabled={!canSave} onClick={save}>{t('Save plan')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={backToList}>{t('Back')}</Button>
      {draft.id && <>
        <div style={{ height: 8 }} />
        <Button style={{ color: 'var(--red)' }} icon="trash" onClick={() => useUI.getState().openSheet(c => (
          <div>
            <h3>{t('Delete plan')}</h3>
            <div className="muted small" style={{ marginBottom: 14 }}>{t('This removes “{0}” from your plans. Workouts you already logged are not touched.', draft.name)}</div>
            <Button variant="primary" style={{ background: 'var(--red)' }} onClick={() => { c(); remove() }}>{t('Delete plan')}</Button>
            <div style={{ height: 8 }} />
            <Button onClick={c}>{t('Cancel')}</Button>
          </div>
        ), { kind: 'center' })}>{t('Delete plan')}</Button>
      </>}
    </>
  }

  return <>
    <h3>{t('Cardio plans')}</h3>
    {plans.length === 0
      ? <div className="muted small" style={{ margin: '4px 0 12px' }}>{t('No plans yet')}</div>
      : <div className="list" style={{ marginBottom: 12 }}>
        {plans.map(p => (
          <div key={p.id} className="item">
            <button type="button" className="grow cardio-plan-pick" onClick={() => { onApply(p); close() }}>
              <div className="tt">{p.name}</div>
              <div className="small dim">{t('Segments: {0} · {1} min', p.segments.length, fmtNum(planMinutes(p)))}</div>
            </button>
            <Button size="sm" icon="pencil" aria-label={t('Edit plan')} onClick={() => edit(p.segments.map(g => ({ ...g })), { id: p.id, at: p.at, name: p.name })} />
          </div>
        ))}
      </div>}
    <Button icon="plus" onClick={() => edit([{ ...BLANK }])}>{t('New plan')}</Button>
    <div style={{ height: 8 }} />
    {mine.length > 0 && <>
      <Button icon="clipboard" onClick={() => edit(mine, { name: '' })}>{t('Save these sets as a plan')}</Button>
      <div style={{ height: 8 }} />
    </>}
    <Button icon="note" onClick={() => { setPasted(''); setNote(''); setView('paste') }}>{t('Paste a plan')}</Button>
  </>
}

export const cardioPlansSheet = props => useUI.getState().openSheet(close => <CardioPlansSheet {...props} close={close} />)
