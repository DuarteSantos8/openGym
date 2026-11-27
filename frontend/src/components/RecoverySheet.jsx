import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtClock, fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { NOTE_MAX } from '../lib/history.js'
import { tappable, useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { MOBILE } from '../lib/mobile.js'
import { readDayWorkouts } from '../lib/health-sync.js'
import {
  RECOVERY_KINDS, RECOVERY_LABEL, RECOVERY_ICON, RECOVERY_PRESETS, RECOVERY_MIN_MAX,
  HEALTH_RECOVERY_KINDS, RECOVERY_METRIC_KEYS, RECOVERY_METRIC_LABEL,
  isRecoveryMetricOn, withRecoveryMetric, recoverySessionsOf, withRecovery, recoveryLine,
  matchingRecoverySessions, recoveryPace, recoverySpeedText, recoveryAvgSpeedKmh,
  recoveryElevText, recoveryCadenceVal, formatLapSec, hasRecoverySpecs,
} from '../lib/recovery-sessions.js'
import { distText } from './ActivitySheet.jsx'
import DateField from './DateField.jsx'
import Icon from './Icon.jsx'
import { Button, Stepper } from './ui.jsx'

// Recovery sessions (lib/recovery-sessions.js): the sauna, the ice bath, the massage. Two taps:
// what it was and how long, the day and a note if you like. Opened from History, a day in the
// calendar and the journal; an existing one opens here to edit or remove.

const SOURCE_LINE = {
  hc: 'From Health Connect',
  ah: 'From Apple Health',
}

function RecoverySpecs({ S, spec, min, update }) {
  const [editingMetrics, setEditingMetrics] = useState(false)
  if (!hasRecoverySpecs(spec)) return null
  const pace = recoveryPace(min, spec.km, S?.unit)
  const avgSpeed = recoveryAvgSpeedKmh(spec, min)
  const speedText = recoverySpeedText(avgSpeed, S?.unit)
  const maxSpeedText = spec.speed?.max > (avgSpeed || 0) ? recoverySpeedText(spec.speed.max, S?.unit) : null
  const elevText = recoveryElevText(spec.elev, S?.unit)
  const cadence = recoveryCadenceVal(spec, min)
  const laps = Array.isArray(spec.laps) && spec.laps.length > 0 ? spec.laps : null

  const available = []
  if (spec.km > 0) available.push({ k: 'km', label: t('Distance'), val: distText(S, spec.km) })
  if (pace) available.push({ k: 'pace', label: t('Pace'), val: pace })
  if (speedText) available.push({ k: 'speed', label: t('Avg speed'), val: speedText, sub: maxSpeedText ? `${t('Max')} ${maxSpeedText}` : null })
  if (spec.steps > 0) available.push({ k: 'steps', label: t('Steps'), val: fmtNum(spec.steps) })
  if (cadence) available.push({ k: 'cadence', label: t('Cadence'), val: t('{0} spm', fmtNum(cadence)) })
  if (spec.hr?.avg > 0) {
    const hrSub = [
      spec.hr.min > 0 && spec.hr.min < spec.hr.avg ? `${t('Min')} ${fmtNum(spec.hr.min)}` : null,
      spec.hr.max > spec.hr.avg ? `${t('Max')} ${fmtNum(spec.hr.max)}` : null,
    ].filter(Boolean).join(' · ')
    available.push({ k: 'hr', label: t('Heart rate'), val: t('{0} bpm', fmtNum(spec.hr.avg)), sub: hrSub || null })
  }
  if (spec.kcal > 0) available.push({ k: 'kcal', label: t('Calories'), val: t('{0} kcal', fmtNum(spec.kcal)) })
  if (elevText) available.push({ k: 'elev', label: t('Elevation'), val: elevText })
  if (spec.floors > 0) available.push({ k: 'floors', label: t('Floors'), val: fmtNum(spec.floors) })

  const cells = available.filter(c => isRecoveryMetricOn(S, c.k))
  const showLaps = laps && isRecoveryMetricOn(S, 'laps')
  const head = [
    spec.app || null,
    SOURCE_LINE[spec.src] ? t(SOURCE_LINE[spec.src]) : null,
    spec.at > 0 ? `${t('Started')} ${fmtClock(spec.at)}` : null,
  ].filter(Boolean).join(' · ')
  if (!available.length && !laps && !head) return null

  const toggleMetric = key => {
    const nextOn = !isRecoveryMetricOn(S, key)
    update(s => { s.recoveryMetrics = withRecoveryMetric(s.recoveryMetrics, key, nextOn) })
  }

  return <div className="rec-specs">
    <div className="rec-specs-head">
      <div className="small muted">{head || t('Recovery details')}</div>
      {(available.length > 0 || laps) && <button type="button" className={'rec-specs-btn' + (editingMetrics ? ' on' : '')}
        aria-expanded={editingMetrics} aria-label={t('Recovery details')}
        onClick={() => setEditingMetrics(v => !v)}>
        <Icon name="gear" />
      </button>}
    </div>
    {editingMetrics && <div className="chips rec-metric-chips" role="group" aria-label={t('Recovery details')}>
      {RECOVERY_METRIC_KEYS.map(k => {
        const on = isRecoveryMetricOn(S, k)
        return <button key={k} type="button" className={'chip nocap' + (on ? ' on' : '')}
          aria-pressed={on} onClick={() => toggleMetric(k)}>{t(RECOVERY_METRIC_LABEL[k])}</button>
      })}
    </div>}
    {cells.length > 0 && <div className="rec-specs-grid">
      {cells.map(c => <div className="rec-spec-cell" key={c.k}>
        <span className="rec-spec-k">{c.label}</span>
        <b>{c.val}</b>
        {c.sub && <span className="rec-spec-s">{c.sub}</span>}
      </div>)}
    </div>}
    {showLaps && <div className="rec-laps">
      <div className="rec-spec-k" style={{ marginBottom: 4 }}>{t('Splits')}</div>
      <div className="rec-laps-list">
        {laps.map((lap, i) => <span className="rec-lap" key={i}>
          #{i + 1} {formatLapSec(lap.sec)}{lap.km > 0 ? ` · ${distText(S, lap.km)}` : ''}
        </span>)}
      </div>
    </div>}
  </div>
}

const pickSummary = (S, m) => [
  m.app || null,
  fmtClock(m.start),
  t('{0} min', m.min),
  isRecoveryMetricOn(S, 'km') && m.km > 0 ? distText(S, m.km) : null,
  isRecoveryMetricOn(S, 'steps') && m.steps > 0 ? t('{0} steps', fmtNum(m.steps)) : null,
  isRecoveryMetricOn(S, 'hr') && m.hr?.avg > 0 ? t('{0} bpm', fmtNum(m.hr.avg)) : null,
  isRecoveryMetricOn(S, 'kcal') && m.kcal > 0 ? t('{0} kcal', fmtNum(m.kcal)) : null,
  isRecoveryMetricOn(S, 'elev') && m.elev > 0 ? recoveryElevText(m.elev, S?.unit) : null,
].filter(Boolean).join(' · ')

function RecoveryLog({ id = null, day = null, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const had = id ? recoverySessionsOf(S).find(r => r.id === id) : null
  const [kind, setKind] = useState(had?.kind || 'sauna')
  const [min, setMin] = useState(had?.min || RECOVERY_PRESETS[had?.kind || 'sauna'][1])
  const [d, setD] = useState(had?.d || day || todayISO())
  const [note, setNote] = useState(had?.note || '')
  const [dayWorkouts, setDayWorkouts] = useState({ d: null, records: [], src: null })
  const [checkingDay, setCheckingDay] = useState(null)
  const [pickedItems, setPickedItems] = useState([])
  const prevMinRef = useRef(null)
  const autoNoteRef = useRef('')
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)

  const canSuggest = !had && MOBILE && HEALTH_RECOVERY_KINDS.has(kind)
  // Pre-fetch the selected day as soon as a new recovery sheet opens on mobile so switching to
  // Easy walk or Mobility is instant (and show a checking indicator if the read is still running).
  useEffect(() => {
    if (had || !MOBILE) return
    if (dayWorkouts.d === d) return
    let cancelled = false
    setCheckingDay(d)
    readDayWorkouts(d, S).then(res => {
      if (!cancelled) {
        setDayWorkouts({ d, records: res.records, src: res.src })
        setCheckingDay(cur => (cur === d ? null : cur))
      }
    }).catch(() => {
      if (!cancelled) {
        setDayWorkouts({ d, records: [], src: null })
        setCheckingDay(cur => (cur === d ? null : cur))
      }
    })
    return () => { cancelled = true }
  }, [had, d, S, dayWorkouts.d])

  const checking = canSuggest && checkingDay === d && dayWorkouts.d !== d
  const matches = useMemo(() => {
    if (!canSuggest || dayWorkouts.d !== d) return []
    return matchingRecoverySessions(dayWorkouts.records, S, { d, kind, src: dayWorkouts.src })
  }, [canSuggest, dayWorkouts, d, kind, S])

  const pickedSet = useMemo(() => new Set(pickedItems.map(m => m.id)), [pickedItems])
  const singlePicked = pickedItems.length === 1 ? pickedItems[0] : null
  const multiPicked = pickedItems.length > 1
  const allSelected = matches.length > 0 && matches.every(m => pickedSet.has(m.id))

  const clearAutoNote = () => {
    if (autoNoteRef.current && note === autoNoteRef.current) setNote('')
    autoNoteRef.current = ''
  }

  const applyAutoNote = text => {
    const prefill = text ? text.slice(0, NOTE_MAX) : ''
    if (!note.trim() || note === autoNoteRef.current) {
      setNote(prefill)
      autoNoteRef.current = prefill
    }
  }

  const pickKind = k => {
    const wasPicked = pickedItems.length > 0
    setKind(k)
    setPickedItems([])
    prevMinRef.current = null
    clearAutoNote()
    // A preset of the old kind (or a picked device session) becomes the middle preset of the new;
    // a manually typed duration stays.
    if (wasPicked || RECOVERY_PRESETS[kind].includes(min)) setMin(RECOVERY_PRESETS[k][1])
  }

  const pickDate = nextD => {
    setD(nextD)
    if (pickedItems.length > 0) {
      setPickedItems([])
      setMin(prevMinRef.current ?? RECOVERY_PRESETS[kind][1])
      prevMinRef.current = null
      clearAutoNote()
    }
  }

  const setManualMin = nextMin => {
    setMin(nextMin)
    if (singlePicked && nextMin !== singlePicked.min) {
      setPickedItems([])
      prevMinRef.current = null
    }
  }

  const togglePick = item => {
    const exists = pickedItems.some(x => x.id === item.id)
    const nextList = exists ? pickedItems.filter(x => x.id !== item.id) : [...pickedItems, item]
    if (!exists && pickedItems.length === 0) prevMinRef.current = min
    setPickedItems(nextList)
    if (nextList.length === 0) {
      setMin(prevMinRef.current ?? RECOVERY_PRESETS[kind][1])
      prevMinRef.current = null
      clearAutoNote()
    } else if (nextList.length === 1) {
      setMin(nextList[0].min)
      applyAutoNote(nextList[0].notes)
    } else {
      // Multi-select keeps each session's own recorded note unless the user types a shared one.
      clearAutoNote()
    }
  }

  const toggleAll = () => {
    if (allSelected) {
      setPickedItems([])
      setMin(prevMinRef.current ?? RECOVERY_PRESETS[kind][1])
      prevMinRef.current = null
      clearAutoNote()
      return
    }
    if (pickedItems.length === 0) prevMinRef.current = min
    setPickedItems(matches)
    if (matches.length === 1) {
      setMin(matches[0].min)
      applyAutoNote(matches[0].notes)
    } else {
      clearAutoNote()
    }
  }

  const specFrom = o => ({
    at: o.start ?? o.at, src: o.src, srcId: o.srcId, app: o.app, title: o.title,
    km: o.km, kcal: o.kcal, steps: o.steps, hr: o.hr, elev: o.elev,
    speed: o.speed, cadence: o.cadence, floors: o.floors, laps: o.laps,
  })
  const activeSpec = singlePicked
    ? specFrom(singlePicked)
    : (had && had.kind === kind && had.d === d ? specFrom(had) : null)

  const save = () => {
    if (d > todayISO()) return
    if (!id && multiPicked) {
      const ordered = [...pickedItems].sort((a, b) => (a.start || 0) - (b.start || 0))
      const typedNote = note.trim().slice(0, NOTE_MAX)
      let count = 0
      const baseNow = Date.now()
      update(s => {
        const existing = recoverySessionsOf(s)
        const seenSrc = new Set(existing.map(r => r.srcId).filter(Boolean))
        const insertedStarts = []
        let map = s.recoverySessions
        for (const item of ordered) {
          const dup = (item.srcId && seenSrc.has(item.srcId))
            || (item.start > 0 && (
              existing.some(r => r.d === d && r.kind === kind && r.at > 0 && Math.abs(r.at - item.start) < 60e3)
              || insertedStarts.some(at => Math.abs(at - item.start) < 60e3)
            ))
          if (dup) continue
          if (item.srcId) seenSrc.add(item.srcId)
          if (item.start > 0) insertedStarts.push(item.start)
          const itemNote = typedNote || (item.notes ? item.notes.slice(0, NOTE_MAX) : '')
          map = withRecovery(map, uid(), {
            d, kind, min: item.min, note: itemNote, ...specFrom(item),
          }, baseNow + count)
          count++
        }
        if (count > 0) s.recoverySessions = map
      })
      close()
      if (count === 1) toast(t('{0} logged. Your muscles say thanks.', t(RECOVERY_LABEL[kind])))
      else if (count > 1) toast(t('{0} sessions logged. Your muscles say thanks.', count))
      return
    }
    if (!(min >= 1)) return
    let inserted = true
    update(s => {
      const existing = recoverySessionsOf(s)
      const logged = !id && singlePicked && (
        (singlePicked.srcId && existing.some(r => r.srcId === singlePicked.srcId))
        || existing.some(r => r.d === d && r.kind === kind && r.at > 0 && Math.abs(r.at - singlePicked.start) < 60e3)
      )
      if (logged) { inserted = false; return }
      s.recoverySessions = withRecovery(s.recoverySessions, id || uid(), {
        d, kind, min, note: note.trim().slice(0, NOTE_MAX), ...(activeSpec || {}),
      })
    })
    close()
    if (inserted) toast(had ? t('Saved') : t('{0} logged. Your muscles say thanks.', t(RECOVERY_LABEL[kind])))
  }
  const remove = () => {
    update(s => { s.recoverySessions = withRecovery(s.recoverySessions, id, null) })
    close()
    toast(t('Recovery session removed'))
  }
  const totalMin = multiPicked ? pickedItems.reduce((sum, m) => sum + (m.min || 0), 0) : 0
  const totalKm = multiPicked ? pickedItems.reduce((sum, m) => sum + (m.km > 0 ? m.km : 0), 0) : 0
  return <>
    <h3>{had ? t('Edit recovery') : t('Log recovery')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Sauna, ice bath, massage: the work between the workouts. It shows in your history, not in your sets.')}</div>
    <div className="chips rec-kinds" role="radiogroup" aria-label={t('Kind')} style={{ margin: '0 0 12px', flexWrap: 'wrap' }}>
      {RECOVERY_KINDS.map(k => <button key={k} type="button" role="radio" aria-checked={kind === k}
        className={'chip nocap ichip' + (kind === k ? ' on' : '')} onClick={() => pickKind(k)}>
        <Icon name={RECOVERY_ICON[k]} />{t(RECOVERY_LABEL[k])}</button>)}
    </div>
    {checking && <div className="rec-checking" role="status" aria-live="polite">
      <span className="rec-spinner" aria-hidden="true" />
      <span>{t('Checking…')}</span>
    </div>}
    {matches.length > 0 && <>
      <div className="rec-picks-head">
        <div className="small muted">{dayWorkouts.src === 'ah' ? t('From Apple Health') : t('From Health Connect')}</div>
        {matches.length > 1 && <button type="button" className="rec-select-all" onClick={toggleAll}>
          {allSelected ? t('Clear') : t('Select all')}
        </button>}
      </div>
      <div className="rec-picks">
        {matches.map(m => {
          const on = pickedSet.has(m.id)
          return <button key={m.id} type="button" className={'rec-pick' + (on ? ' on' : '')}
            aria-pressed={on} onClick={() => togglePick(m)}>
            <span className={'rec-pick-i' + (on ? '' : ' rec-i')} aria-hidden="true"><Icon name={on ? 'check' : RECOVERY_ICON[m.kind]} /></span>
            <span className="rec-pick-txt">
              <span className="rec-pick-t">{m.title || t(RECOVERY_LABEL[m.kind])}</span>
              <span className="rec-pick-s">{pickSummary(S, m)}</span>
            </span>
          </button>
        })}
      </div>
    </>}
    {multiPicked && <div className="rec-batch-summary small muted" role="status" aria-live="polite">
      {[
        t('{0} selected', pickedItems.length),
        t('{0} min total', totalMin),
        isRecoveryMetricOn(S, 'km') && totalKm > 0 ? distText(S, totalKm) : null,
      ].filter(Boolean).join(' · ')}
    </div>}
    {activeSpec && <RecoverySpecs S={S} spec={activeSpec} min={min} update={update} />}
    {!multiPicked && <>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('How long')}</div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {RECOVERY_PRESETS[kind].map(m => <button key={m} type="button" className={'chip nocap' + (min === m ? ' on' : '')}
          aria-pressed={min === m} onClick={() => setManualMin(m)}>{t('{0} min', m)}</button>)}
        <Stepper value={min} min={1} max={RECOVERY_MIN_MAX} step={1} decimal={false} onChange={setManualMin} unit={t('min')} ariaLabel={t('Minutes')} />
      </div>
    </>}
    <label className="measure-date">
      <span>{t('Date')}</span>
      <DateField value={d} max={todayISO()} onChange={pickDate} label={t('Date')} />
    </label>
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How was it? (optional)')} onFocus={onNoteFocus} onChange={e => { autoNoteRef.current = ''; setNote(e.target.value) }} />
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={save} disabled={!multiPicked && !(min >= 1)}>
      {multiPicked ? t('Log {0} sessions', pickedItems.length) : t('Save')}
    </Button>
    {had && <><div style={{ height: 8 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove')}</Button></>}
  </>
}

/** Log a new recovery session (on `day`, else today), or edit the one with `id`. */
export const recoverySheet = ({ id = null, day = null } = {}) =>
  useUI.getState().openSheet(close => <RecoveryLog id={id} day={day} close={close} />)

/** One session as a list row, the way History lists a workout. */
export function RecoveryRow({ r, showDate = true }) {
  const S = useStore(s => s.S)
  return <div className="item rec-row" {...tappable(() => recoverySheet({ id: r.id }))}>
    <span className="lrow-i rec-i" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={RECOVERY_ICON[r.kind]} /></span>
    <div className="grow"><div className="tt">{r.title || t(RECOVERY_LABEL[r.kind])}</div>
      <div className="ss">{[
        showDate ? fmtDate(r.d, true) : null,
        t('{0} min', r.min),
        isRecoveryMetricOn(S, 'km') && r.km > 0 ? distText(S, r.km) : null,
        isRecoveryMetricOn(S, 'hr') && r.hr?.avg > 0 ? t('{0} bpm', fmtNum(r.hr.avg)) : null,
        isRecoveryMetricOn(S, 'kcal') && r.kcal > 0 ? t('{0} kcal', fmtNum(r.kcal)) : null,
        r.app || null,
        r.note,
      ].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}

export { RecoveryLog, recoveryLine }
