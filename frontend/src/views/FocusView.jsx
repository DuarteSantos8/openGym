import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { EFFORT, effortOf, modeOf } from '../lib/history.js'
import { lastEntryFor, pinnedNoteFor } from '../lib/history.js'
import { effortColor, rirOf } from '../lib/effort.js'
import { progressionGuidance } from '../lib/progression-copy.js'
import {
  addCluster, addDrop, addSideCluster, addSideDrop, clustersOf, dropsOf,
  isSideSet, isWarmupRow, nextBurstReps, nextDropWeight, setClusterAt,
  setDropAt, setSideClusterAt, setSideDropAt, setSideField,
} from '../lib/workout-model.js'
import { weightIncrement, stepWeight } from '../lib/progression.js'
import { effortPickerSheet, exerciseDetailSheet, exerciseHistorySheet, exerciseNoteSheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Stepper } from '../components/ui.jsx'
import './FocusView.css'

const firstIncomplete = entry => {
  const index = entry.sets.findIndex(set => !set.done)
  return index < 0 ? Math.max(0, entry.sets.length - 1) : index
}

const clampSet = (entry, index) => Math.min(Math.max(index, 0), Math.max(0, entry.sets.length - 1))

const supersetSequence = (entries, unit) => {
  const rounds = Math.max(0, ...unit.map(index => entries[index]?.sets?.length || 0))
  return Array.from({ length: rounds }, (_, setIdx) =>
    unit.filter(entryIdx => entries[entryIdx]?.sets?.[setIdx]).map(entryIdx => ({ entryIdx, setIdx })),
  ).flat()
}

const toggleWarmup = row => {
  const next = { ...row }
  if (isWarmupRow(next)) {
    delete next.phase
    delete next.warmup
  } else next.phase = 'warmup'
  return next
}

const addDropTo = (row, target) => {
  if (isSideSet(row)) return addSideDrop(row, target?.intensifier?.pct)
  const drops = dropsOf(row).length ? dropsOf(row) : row.drops || []
  const base = drops.at(-1)?.w ?? row.w ?? 0
  return addDrop(row, { w: nextDropWeight(base, target?.intensifier?.pct), r: row.r || 0 })
}

const addBurstTo = (row, restSec) => {
  if (isSideSet(row)) return addSideCluster(row, restSec)
  const clusters = clustersOf(row).length ? clustersOf(row) : row.clusters || []
  const reps = nextBurstReps(clusters.at(-1)?.r ?? row.r ?? 0)
  return { ...addCluster(row, { r: reps, restSec }), r: (row.r || 0) + reps }
}

function Prescription({ entry, setIdx, unit, fallbackRest }) {
  const target = entry.target || {}
  const reps = target.repsMin > 0 ? `${target.repsMin}–${target.reps}` : target.reps > 0 ? String(target.reps) : ''
  const load = target.weight > 0
    ? `@ ${fmtNum(target.weight)}${target.weightMax > target.weight ? `–${fmtNum(target.weightMax)}` : ''} ${unit}`
    : ''
  const rpe = target.rpeMin > 0
    ? `RPE ${fmtNum(target.rpeMin)}${target.rpeMax > target.rpeMin ? `–${fmtNum(target.rpeMax)}` : ''}`
    : ''
  const rest = target.restSec > 0 ? `Rest ${target.restSec}s` : fallbackRest > 0 ? `Rest ${fallbackRest}s` : ''
  const badges = [reps && `${reps} Reps`, load, rpe, rest, target.tempo].filter(Boolean)

  return <div className="focus-prescription">
    <span className="focus-progress">{setIdx + 1}/{entry.sets.length}</span>
    {badges.map(label => <span className="tag nocap" key={label}>{label}</span>)}
  </div>
}

export default function FocusView({
  entryIdx, unit, onToggle, onToggleSide, onField, onMutateSet, onStartTimed,
  onAddWarmup, onRemoveSetAt, onProgressionSettings, onSwap, onRemoveExercise,
  busy, onSelectEntry, onAdvanceUnit, onPairPrev, onPairNext, onUnpair, pointerEpoch,
}) {
  const S = useStore(state => state.S)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const last = lastEntryFor(S, entry.id)
  const pinnedNote = pinnedNoteFor(S, entry.id)
  const guidance = progressionGuidance(entry.plan)
  // Exercise operations use indexes, so their local-only epoch discards stale pointers instead
  // of letting a moved, removed, or newly inserted entry inherit one.
  const [pointerState, setPointerState] = useState(() => ({ epoch: pointerEpoch, pointers: new Map() }))
  const pointers = pointerState.epoch === pointerEpoch ? pointerState.pointers : new Map()
  const stored = pointers.get(entryIdx)
  const setIdx = clampSet(entry, Number.isInteger(stored) ? stored : firstIncomplete(entry))
  const set = entry.sets[setIdx]
  const firstOpenSet = firstIncomplete(entry)
  const locked = !set.done && setIdx > firstOpenSet
  const readOnly = set.done || locked
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const effort = effortOf(S)
  const effortField = EFFORT[effort]?.f
  const effortValue = effortField ? set[effortField] ?? null : null
  const effortTint = effortValue == null ? null : effortColor(rirOf({ [effortField]: effortValue }))
  const loadStep = weightIncrement({ ...(entry.target || {}), id: entry.id }, S.unit)
  const selectSet = index => setPointerState(current => {
    const next = new Map(current.epoch === pointerEpoch ? current.pointers : [])
    next.set(entryIdx, clampSet(entry, index))
    return { epoch: pointerEpoch, pointers: next }
  })
  const sequence = unit.length > 1 ? supersetSequence(S.active.entries, unit) : []
  const sequenceIdx = sequence.findIndex(item => item.entryIdx === entryIdx && item.setIdx === setIdx)
  const clearPointer = index => setPointerState(current => {
    if (current.epoch !== pointerEpoch) return { epoch: pointerEpoch, pointers: new Map() }
    if (!current.pointers.has(index)) return current
    const next = new Map(current.pointers)
    next.delete(index)
    return { epoch: pointerEpoch, pointers: next }
  })
  const selectSequence = index => {
    const item = sequence[index]
    if (!item) return
    setPointerState(current => {
      const next = new Map(current.epoch === pointerEpoch ? current.pointers : [])
      next.set(item.entryIdx, item.setIdx)
      return { epoch: pointerEpoch, pointers: next }
    })
    onSelectEntry(item.entryIdx)
  }
  const drops = dropsOf(set).length ? dropsOf(set) : Array.isArray(set.drops) ? set.drops : []
  const bursts = clustersOf(set).length ? clustersOf(set) : Array.isArray(set.clusters) ? set.clusters : []

  const sideFields = side => {
    const sideSet = set.sides[side]
    const change = (field, value) => onMutateSet(setIdx, row => setSideField(row, side, field, value))
    const sideDrops = dropsOf(sideSet).length ? dropsOf(sideSet) : Array.isArray(sideSet.drops) ? sideSet.drops : []
    const sideBursts = clustersOf(sideSet).length ? clustersOf(sideSet) : Array.isArray(sideSet.clusters) ? sideSet.clusters : []
    return <section className="focus-side" data-focus-side={side}>
      <div className="focus-side-header">
        <strong>{side === 'L' ? t('Left') : t('Right')}</strong>
        <button aria-label={side === 'L' ? t('Complete left side') : t('Complete right side')}
          className={'focus-side-check' + (sideSet.done ? ' done' : '')}
          onClick={() => onToggleSide(setIdx, side,
            !sideSet.done && (set.sides.L.done || set.sides.R.done) ? onProgress : undefined)}><Icon name="check" /></button>
      </div>
      <Stepper label={t('Load ({0})', S.unit)} ariaLabel="load" value={sideSet.w || 0} step={loadStep} onStep={stepWeight} disabled={readOnly || sideSet.done}
        onChange={value => change('w', value)} />
      <Stepper label={t('Reps')} ariaLabel="reps" value={sideSet.r || 0} step={1} decimal={false} disabled={readOnly || sideSet.done}
        onChange={value => change('r', value)} />
      <div className="focus-extras">
        {sideDrops.map((drop, index) => <div className="focus-extra" key={`drop-${index}`}>
          <span>{t('Drop {0}', index + 1)}</span>
          <Stepper label={t('Load')} ariaLabel="load" value={drop.w || 0} step={loadStep} onStep={stepWeight} disabled={readOnly || sideSet.done}
            onChange={value => onMutateSet(setIdx, row => setSideDropAt(row, side, index, { w: value }))} />
          <Stepper label={t('Reps')} ariaLabel="reps" value={drop.r || 0} step={1} decimal={false} disabled={readOnly || sideSet.done}
            onChange={value => onMutateSet(setIdx, row => setSideDropAt(row, side, index, { r: value }))} />
        </div>)}
        {sideBursts.map((burst, index) => <div className="focus-extra" key={`burst-${index}`}>
          <span>{t('Burst {0}', index + 1)}</span>
          <Stepper label={t('Reps')} ariaLabel="reps" value={burst.r || 0} step={1} decimal={false} disabled={readOnly || sideSet.done}
            onChange={value => onMutateSet(setIdx, row => setSideClusterAt(row, side, index, value))} />
          <span className="dim small">{burst.restSec}s</span>
        </div>)}
      </div>
    </section>
  }

  const onProgress = ({ unitDone }) => {
    const active = useStore.getState().S.active
    if (!active) return
    if (unitDone) {
      onAdvanceUnit()
      const nextEntryIdx = useStore.getState().S.active?.cur
      if (nextEntryIdx !== entryIdx) clearPointer(nextEntryIdx)
    }
    else if (unit.length === 1) selectSet(setIdx + 1)
    else clearPointer(active.cur)
  }

  const complete = () => {
    if (!isSideSet(set)) return onToggle(setIdx, onProgress)
    const sides = set.done ? ['L', 'R'] : ['L', 'R'].filter(side => !set.sides[side].done)
    sides.forEach((side, index) => onToggleSide(setIdx, side, index === sides.length - 1 ? onProgress : undefined))
  }

  const openEffort = () => effortPickerSheet(effort, effortValue, value => onField(setIdx, effortField, value))

  const openExerciseMenu = () => menuSheet({
    title: exerciseNameFor(exOr(entry.id)),
    items: [
      { icon: 'pencil', label: entry.note ? t('Edit note') : t('Add note'), onClick: () => exerciseNoteSheet(entryIdx) },
      { icon: 'info', label: t('Details'), onClick: () => exerciseDetailSheet(exOr(entry.id)) },
      { icon: 'history', label: t('History'), onClick: () => exerciseHistorySheet(entry.id) },
      { icon: 'chartLine', label: t('Progression settings'), onClick: onProgressionSettings },
      onPairPrev && { icon: 'link', label: t('Make superset with previous'), onClick: onPairPrev },
      onPairNext && { icon: 'link', label: t('Make superset with next'), onClick: onPairNext },
      { icon: 'shuffle', label: t('Swap exercise'), onClick: onSwap, disabled: busy },
      { icon: 'trash', label: t('Remove exercise'), onClick: onRemoveExercise, danger: true, disabled: busy },
    ],
  })

  const openSetMenu = () => menuSheet({
    title: t('Set {0}', setIdx + 1),
    items: [
      { icon: 'flame', label: isWarmupRow(set) ? t('Mark as work set') : t('Mark as warm-up'), onClick: () => onMutateSet(setIdx, toggleWarmup) },
      { icon: 'arrowDown', label: t('Add drop set'), onClick: () => onMutateSet(setIdx, row => addDropTo(row, entry.target)) },
      { icon: 'bolt', label: t('Add burst'), onClick: () => onMutateSet(setIdx, row => addBurstTo(row, S.restPauseSec || 15)) },
      { icon: 'trash', label: t('Delete set'), danger: true, disabled: entry.sets.length <= 1, onClick: () => onRemoveSetAt(setIdx) },
    ],
  })

  return <div className="focus-view" data-testid="focus-view">
    <div className="focus-card">
      {unit.length > 1 && <div className="focus-superset-inline">
        <Icon name="reset" />
        <strong>{t('Superset:')} {unit.map(index => exerciseNameFor(exOr(S.active.entries[index].id))).join(' + ')}</strong>
        <span>{t('Round {0}', setIdx + 1)} · {t('Exercise {0} of {1}', unit.indexOf(entryIdx) + 1, unit.length)}</span>
        <Button size="xs" variant="ghost" icon="link" aria-label={t('Unpair')} onClick={onUnpair}>{t('Unpair')}</Button>
        <div className="focus-superset-nav">
          <button aria-label={t('Previous superset set')} disabled={sequenceIdx <= 0} onClick={() => selectSequence(sequenceIdx - 1)}><Icon name="chevronLeft" /></button>
          <button aria-label={t('Next superset set')} disabled={sequenceIdx < 0 || sequenceIdx >= sequence.length - 1} onClick={() => selectSequence(sequenceIdx + 1)}><Icon name="chevronRight" /></button>
        </div>
      </div>}
      <header className="focus-card-header">
        <h2>{exerciseNameFor(ex)}</h2>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
        {isWarmupRow(set) && <span className="focus-warmup" aria-label={t('Warm-up')}>🔥</span>}
        <button className="iconbtn" aria-label={t('More')} onClick={openExerciseMenu}><Icon name="more" /></button>
      </header>

      <div className="focus-context">
        <div className="focus-tags">
          {mode === 'cardio' && <span className="tag acc">{t('Cardio')}</span>}
          {isSideSet(set) && <span className="tag acc">{t('Per side')}</span>}
          {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
          {ex.eq && <span className="tag">{t(ex.eq)}</span>}
        </div>
        {entry.target?.note && <div className="focus-note">{entry.target.note}</div>}
        {pinnedNote && <div className="focus-note pinned"><Icon name="flag" />{t('From {0}:', fmtDate(pinnedNote.d, true))} {pinnedNote.note}</div>}
        {entry.note && <div className="focus-note">{entry.note}</div>}
        {last && <div className="focus-last">{t('Last time')} · {fmtDate(last.d)}</div>}
        {guidance && <button className="focus-guidance" onClick={onProgressionSettings}><Icon name="lightbulb" />{t(guidance.policyLabel)}</button>}
      </div>
      <Prescription entry={entry} setIdx={setIdx} unit={S.unit} fallbackRest={S.restSec} />
      {locked && <p className="focus-lock-note" role="status">{t('Complete set {0} to edit this one.', firstOpenSet + 1)}</p>}

      <div data-testid="focus-set" className={(set.done ? 'complete ' : '') + (locked ? 'locked' : '')}>
        {isSideSet(set) ? <div className="focus-sides">{sideFields('L')}{sideFields('R')}</div> : <>
          {mode === 'cardio' ? <>
            <Stepper label={t('Duration (min)')} ariaLabel="duration" value={set.min || 0} step={1} decimal={false} disabled={readOnly}
              onChange={value => onField(setIdx, 'min', value)} />
            <Stepper label={t('Speed (km/h)')} ariaLabel="speed" value={set.speed || 0} step={0.5} disabled={readOnly}
              onChange={value => onField(setIdx, 'speed', value)} />
          </> : <>
            <Stepper label={t('Load ({0})', S.unit)} ariaLabel="load" value={set.w || 0} step={loadStep} onStep={stepWeight} disabled={readOnly}
              onChange={value => onField(setIdx, 'w', value)} />
          {mode === 'time' ? <div className="focus-timed">
            <strong>{t('{0}s hold', set.sec || entry.target?.sec || 45)}</strong>
            <Button icon="play" aria-label={t('Start set')} disabled={readOnly || busy}
              onClick={() => onStartTimed(setIdx, onProgress)}>{t('Start')}</Button>
          </div> : <Stepper label={t('Reps')} ariaLabel="reps" value={set.r || 0} step={1} decimal={false} disabled={readOnly}
            onChange={value => onField(setIdx, 'r', value)} />}</>}
        </>}
        <div className="focus-extras">
          {drops.map((drop, index) => <div className="focus-extra" key={`drop-${index}`}>
            <span>{t('Drop {0}', index + 1)}</span>
            <Stepper label={t('Load')} ariaLabel="load" value={drop.w || 0} step={loadStep} onStep={stepWeight} disabled={readOnly}
              onChange={value => onMutateSet(setIdx, row => setDropAt(row, index, { w: value }))} />
            <Stepper label={t('Reps')} ariaLabel="reps" value={drop.r || 0} step={1} decimal={false} disabled={readOnly}
              onChange={value => onMutateSet(setIdx, row => setDropAt(row, index, { r: value }))} />
          </div>)}
          {bursts.map((burst, index) => <div className="focus-extra" key={`burst-${index}`}>
            <span>{t('Burst {0}', index + 1)}</span>
            <Stepper label={t('Reps')} ariaLabel="reps" value={burst.r || 0} step={1} decimal={false} disabled={readOnly}
              onChange={value => onMutateSet(setIdx, row => {
                const delta = (Number(value) || 0) - (clustersOf(row)[index]?.r ?? row.clusters?.[index]?.r ?? 0)
                return { ...setClusterAt(row, index, { r: value }), r: Math.max(0, (row.r || 0) + delta) }
              })} />
            <span className="dim small">{burst.restSec}s</span>
          </div>)}
        </div>
        {mode === 'reps' && effortField && <button className={'effcell focus-effort' + (effortValue == null ? ' is-empty' : '')}
          style={effortTint ? { color: effortTint, borderColor: effortTint, background: `color-mix(in srgb, ${effortTint} 20%, var(--surface-2))` } : undefined}
          aria-label={t(EFFORT[effort].hd)} disabled={readOnly} onClick={openEffort}>{effortValue == null ? t(EFFORT[effort].hd) : fmtNum(effortValue)}</button>}
      </div>

      <Button variant="primary" icon="check" aria-label={t('Complete set')} onClick={complete}>{set.done ? t('Completed') : t('Complete')}</Button>
      <div className="focus-secondary">
        <button className="focus-skip" aria-label={t('Skip set')} disabled={setIdx >= entry.sets.length - 1} onClick={() => selectSet(setIdx + 1)}>
          <Icon name="play" />{t('Skip')}
        </button>
        <button className="iconbtn" aria-label={t('Set menu')} onClick={openSetMenu}><Icon name="more" /></button>
      </div>
    </div>

    <footer className="focus-pager">
      <button aria-label={t('Previous set')} disabled={setIdx === 0} onClick={() => selectSet(setIdx - 1)}><Icon name="chevronLeft" /></button>
      <div className="focus-dots">
        {entry.sets.map((row, index) => <button key={index} aria-label={t('Set {0}', index + 1)}
          className={(index === setIdx ? 'active ' : '') + (row.done ? 'done' : '')}
          onClick={() => selectSet(index)} />)}
      </div>
      <button aria-label={t('Next set')} disabled={setIdx === entry.sets.length - 1} onClick={() => selectSet(setIdx + 1)}><Icon name="chevronRight" /></button>
    </footer>
  </div>
}
