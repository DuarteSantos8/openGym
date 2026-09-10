import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { workoutControls } from '../lib/workout-controls.js'
import {
  modeOf, isBw, isPerSide, repStep, EFFORT, effortOf, stepEffort,
  cascadeWeight, insertWarmupRow, removeRowAt, buildSets, defaultConfig,
  NOTE_MAX,
} from '../lib/history.js'
import { effortColor } from '../lib/effort.js'
import { stepWeight, weightIncrement, defaultIncrement } from '../lib/progression.js'
import {
  isWarmupRow, isDropSet, isRestPauseSet, dropsOf, clustersOf,
  addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt,
  nextDropWeight, nextBurstReps, isSideSet, makeSideSet, setSideField, toggleSide,
  addSideDrop, removeSideDropAt, setSideDropAt, addSideCluster, removeSideClusterAt, setSideClusterAt,
} from '../lib/workout-model.js'
import {
  exercisePicker, exConfigSheet, confirmSheet, menuSheet,
  effortPickerSheet, exerciseDetailSheet, exerciseHistorySheet,
} from '../sheets.jsx'
import { buildEditedWorkout, updateWorkoutInHistory, applyEditedWorkoutWeights } from '../lib/edit-workout.js'
import { exerciseMuscleSnapshot } from '../lib/muscles.js'
import { Button, Check, NumberField, Row, Switch } from '../components/ui.jsx'
import Stepper from '../components/Stepper.jsx'
import Icon from '../components/Icon.jsx'
import Media from '../components/Media.jsx'

function EditExerciseNote({ initialNote, initialPin, onSave, close }) {
  const [note, setNote] = useState(initialNote || '')
  const [pin, setPin] = useState(!!initialPin)

  return <>
    <h3>{t('Exercise note')}</h3>
    <textarea className="input" rows={3} maxLength={NOTE_MAX} value={note}
      placeholder={t('Adjust seat height, weight felt heavy, grip slipped…')}
      onChange={e => setNote(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="sect-b">
      <Row icon="flag" iconTint="var(--yellow)" title={t('Show this next time')}
        subtitle={t('Brings it up again the next time you train this exercise.')}>
        <Switch checked={pin} onChange={setPin} disabled={!note.trim()} />
      </Row>
    </div>
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={() => { onSave(note.trim(), pin); close() }}>{t('Save')}</Button>
  </>
}

export default function WorkoutEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)

  const originalWorkout = S.workouts.find(w => w.id === id)

  useEffect(() => {
    if (!originalWorkout) {
      toast(t('Workout not found'))
      nav('/history', { replace: true })
    }
  }, [originalWorkout, nav, toast])

  const [name, setName] = useState(originalWorkout?.name || '')
  const [d, setD] = useState(originalWorkout?.d || todayISO())
  const [time, setTime] = useState(() => {
    if (!originalWorkout?.start) return '18:00'
    const date = new Date(originalWorkout.start)
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  })
  const [durationMin, setDurationMin] = useState(() => {
    if (!originalWorkout) return 60
    const ms = (originalWorkout.end || originalWorkout.start) - originalWorkout.start
    return Math.max(1, Math.round(ms / 60000)) || 60
  })
  const [note, setNote] = useState(originalWorkout?.note || '')
  const [entries, setEntries] = useState(() => {
    return (originalWorkout?.entries || []).map(entry => ({
      ...entry,
      sets: (entry.sets || []).map(s => ({ ...s, done: s.done !== false })),
    }))
  })
  const [dirty, setDirty] = useState(false)

  if (!originalWorkout) return null

  const wc = workoutControls(S)
  const kind = effortOf(S)
  const eff = EFFORT[kind]

  const mutEntry = (entryIdx, fn) => {
    setEntries(prev => {
      const copy = [...prev]
      const entry = { ...copy[entryIdx], sets: [...copy[entryIdx].sets] }
      fn(entry)
      copy[entryIdx] = entry
      return copy
    })
    setDirty(true)
  }

  const mutSet = (entryIdx, setIdx, fn) => {
    mutEntry(entryIdx, entry => {
      entry.sets[setIdx] = fn(entry.sets[setIdx])
    })
  }

  const setField = (entryIdx, setIdx, field, val) => {
    mutEntry(entryIdx, entry => {
      const s = { ...entry.sets[setIdx] }
      if (val == null) delete s[field]
      else s[field] = val
      entry.sets[setIdx] = s
      if (field === 'w') {
        entry.sets = cascadeWeight(entry.sets, setIdx, val)
      }
    })
  }

  const toggleSet = (entryIdx, setIdx, side) => {
    mutEntry(entryIdx, entry => {
      const s = entry.sets[setIdx]
      if (side) {
        entry.sets[setIdx] = toggleSide(s, side)
      } else {
        entry.sets[setIdx] = { ...s, done: !s.done }
      }
    })
  }

  const addSet = entryIdx => {
    mutEntry(entryIdx, entry => {
      const l = entry.sets[entry.sets.length - 1]
      const m = modeOf({ ...(entry.target || {}), id: entry.id })
      if (m === 'cardio') {
        entry.sets.push({ min: l ? l.min : (entry.target?.min || 20), speed: l ? l.speed : (entry.target?.speed || 8), done: true })
      } else if (m === 'time') {
        entry.sets.push({ sec: l ? l.sec : (entry.target?.sec || 45), w: l ? (l.w || 0) : (entry.target?.weight || 0), done: true })
      } else {
        const row = { w: l ? l.w : 0, r: l ? l.r : (entry.target?.reps || 10), done: true }
        entry.sets.push(isPerSide({ ...(entry.target || {}), id: entry.id })
          ? (l && isSideSet(l)
            ? makeSideSet({ w: l.sides.L.w, r: (l.sides.L.r || 0) * 2 })
            : makeSideSet(row))
          : row)
      }
    })
  }

  const removeSet = entryIdx => {
    mutEntry(entryIdx, entry => {
      if (entry.sets.length > 1) entry.sets.pop()
    })
  }

  const removeSetAt = (entryIdx, setIdx) => {
    mutEntry(entryIdx, entry => {
      entry.sets = removeRowAt(entry.sets, setIdx)
    })
  }

  const addWarmup = entryIdx => {
    mutEntry(entryIdx, entry => {
      const m = modeOf({ ...(entry.target || {}), id: entry.id })
      entry.sets = insertWarmupRow(entry.sets, m, entry.target || {}, defaultIncrement(entry.id, S.unit))
    })
  }

  const moveExercise = (entryIdx, direction) => {
    const targetIdx = entryIdx + direction
    if (targetIdx < 0 || targetIdx >= entries.length) return
    setEntries(prev => {
      const copy = [...prev]
      const temp = copy[entryIdx]
      copy[entryIdx] = copy[targetIdx]
      copy[targetIdx] = temp
      return copy
    })
    setDirty(true)
  }

  const removeExercise = entryIdx => {
    const entry = entries[entryIdx]
    const hasDone = (entry.sets || []).some(s => s.done)
    const ex = exOr(entry.id)
    confirmSheet({
      title: t('Remove {0}?', exerciseNameFor(ex)),
      message: hasDone
        ? t('The sets you logged for this exercise in this session will be lost.')
        : t('This removes the exercise from your current session.'),
      confirmText: t('Remove'),
      danger: true,
      onConfirm: () => {
        setEntries(prev => prev.filter((_, idx) => idx !== entryIdx))
        setDirty(true)
      },
    })
  }

  const swapExercise = entryIdx => {
    exercisePicker((ex, quick) => {
      const commit = cfg => {
        const full = { ...cfg, id: ex.id }
        const sets = buildSets(S, full, {
          step: modeOf(full) === 'reps' ? weightIncrement(full, S.unit) : defaultIncrement(ex.id, S.unit),
          preferLast: true,
        })
        setEntries(prev => {
          const copy = [...prev]
          copy[entryIdx] = { ...copy[entryIdx], id: ex.id, target: { ...cfg }, sets }
          return copy
        })
        setDirty(true)
      }
      if (quick) commit(defaultConfig(ex.id))
      else exConfigSheet(ex, null, commit, null, null)
    })
  }

  const editExerciseNote = entryIdx => {
    const entry = entries[entryIdx]
    openSheet(close => (
      <EditExerciseNote
        initialNote={entry.note}
        initialPin={entry.notePin}
        close={close}
        onSave={(newNote, newPin) => {
          mutEntry(entryIdx, e => {
            if (newNote) {
              e.note = newNote
              if (newPin) e.notePin = true
              else delete e.notePin
            } else {
              delete e.note
              delete e.notePin
            }
          })
        }}
      />
    ))
  }

  const handleAddExercise = () => {
    exercisePicker((ex, quick) => {
      const commit = cfg => {
        const full = { ...cfg, id: ex.id }
        const sets = buildSets(S, full, {
          step: modeOf(full) === 'reps' ? weightIncrement(full, S.unit) : defaultIncrement(ex.id, S.unit),
          preferLast: true,
        })
        setEntries(prev => [...prev, { id: ex.id, target: { ...cfg }, sets }])
        setDirty(true)
      }
      if (quick) commit(defaultConfig(ex.id))
      else exConfigSheet(ex, null, commit, null, null)
    })
  }

  const handleCancel = () => {
    if (dirty) {
      confirmSheet({
        title: t('Discard changes?'),
        message: t('Any changes made to this workout will be lost.'),
        confirmText: t('Discard'),
        danger: true,
        onConfirm: () => nav(-1),
      })
    } else {
      nav(-1)
    }
  }

  const handleSave = () => {
    const hasAnyDone = entries.some(e => e.sets?.some(s => s.done))
    if (!hasAnyDone) {
      toast(t('Complete at least one set before saving'))
      return
    }

    const [h, m] = String(time || '18:00').split(':').map(Number)
    const startDate = new Date(d + 'T12:00:00')
    startDate.setHours(h || 0, m || 0, 0, 0)
    const startTs = startDate.getTime()

    const updatedWorkout = buildEditedWorkout({
      originalWorkout,
      name,
      d,
      start: startTs,
      durationMin,
      entries,
      note,
      snapshotFor: e => (exOr(e.id)?.custom ? exerciseMuscleSnapshot(exOr(e.id)) : null),
    })

    update(s => {
      s.workouts = updateWorkoutInHistory(s.workouts, originalWorkout.id, updatedWorkout)
      s.exWeights = applyEditedWorkoutWeights(s.exWeights, updatedWorkout)
    })

    useStore.getState().autoBackupNow()
    toast(t('Workout updated'))
    nav(-1)
  }

  const totalSets = entries.reduce((acc, e) => acc + (e.sets?.length || 0), 0)
  const doneSets = entries.reduce((acc, e) => acc + (e.sets?.filter(s => s.done).length || 0), 0)

  return (
    <div className="narrow">
      <div className="whdr stick">
        <div className="hdr">
          <button className="iconbtn" aria-label={t('Cancel')} onClick={handleCancel}>
            <Icon name="chevronLeft" />
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 600 }}>{t('Edit workout')}</div>
            <div className="sub">{fmtDate(d, true)} · {t('{0} sets', `${doneSets}/${totalSets}`)}</div>
          </div>
          <Button variant="primary" size="sm" onClick={handleSave}>
            {t('Save')}
          </Button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="small muted" style={{ marginBottom: 4 }}>{t('Workout title')}</div>
        <input
          className="input"
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setDirty(true) }}
          placeholder={t('Workout name')}
        />
        <div style={{ height: 10 }} />
        <Row icon="calendar" title={t('Date')}>
          <input
            type="date"
            className="timef"
            value={d}
            max={todayISO()}
            onChange={e => { setD(e.target.value); setDirty(true) }}
          />
        </Row>
        <Row icon="clock" title={t('Start time')}>
          <input
            type="time"
            className="timef"
            value={time}
            onChange={e => { setTime(e.target.value); setDirty(true) }}
          />
        </Row>
        <Stepper
          label={t('Duration')}
          unit="min"
          value={durationMin}
          step={5}
          decimal={false}
          onChange={v => { setDurationMin(Math.max(1, Math.round(v))); setDirty(true) }}
        />
        <div style={{ height: 10 }} />
        <div className="small muted" style={{ marginBottom: 4 }}>{t('Session note')}</div>
        <textarea
          className="input"
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          onChange={e => { setNote(e.target.value); setDirty(true) }}
          placeholder={t('How the session went as a whole.')}
        />
      </div>

      <div className="workout-list">
        {entries.map((entry, entryIdx) => {
          const ex = exOr(entry.id)
          const mode = modeOf({ ...(entry.target || {}), id: entry.id })
          const cardio = mode === 'cardio'
          const timed = mode === 'time'
          const cfg = { ...(entry.target || {}), id: entry.id }
          const bw = !cardio && isBw(cfg)
          const perSide = mode === 'reps' && isPerSide(cfg)
          const added = bw && entry.sets.some(s => s.w > 0)
          const loadStep = mode === 'reps' ? weightIncrement(cfg, S.unit) : 2.5
          const loadCol = { f: 'w', step: loadStep, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
          const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
          const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
            : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
              : (bw && !added) ? repCol : loadCol
          const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
            : timed ? ((bw && !added) ? null : loadCol)
              : (bw && !added) ? null : repCol
          const col3 = mode === 'reps' && eff ? { f: eff.f, eff: kind, hd: t(eff.hd) } : null

          const bump = (s, i, col, dir) => {
            const cur = s[col.f]
            if (mode === 'reps' && col.f === 'w') return setField(entryIdx, i, col.f, stepWeight(cur, col.step, dir))
            setField(entryIdx, i, col.f, Math.max(0, Math.round(((cur || 0) + dir * col.step) * 100) / 100))
          }

          const cell = (s, i, col, cls) => (
            <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')}>
              {wc.steppers && <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>}
              <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
                onChange={v => setField(entryIdx, i, col.f, v)} /></span>
              {wc.steppers && <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>}
            </div>
          )

          const effortCell = (s, i, col) => {
            const v = s[col.f] ?? null
            const rir = col.eff === 'rpe' ? (v == null ? null : 10 - v) : v
            const color = effortColor(rir)
            const open = () => effortPickerSheet(col.eff, v, nv => setField(entryIdx, i, col.f, nv))
            if (v == null) return (
              <button className="effcell is-empty" aria-label={col.hd} onClick={open}>{col.hd}</button>
            )
            const step = dir => setField(entryIdx, i, col.f, stepEffort(col.eff, v, dir))
            return (
              <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
                style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
                {wc.steppers && <button aria-label="Decrease" onClick={() => step(-1)}><Icon name="minus" /></button>}
                <button className="val" aria-label={col.hd} onClick={open}>{fmtNum(v)}</button>
                {wc.steppers && <button aria-label="Increase" onClick={() => step(1)}><Icon name="plus" /></button>}
              </div>
            )
          }

          const sideBump = (sd, i, side, col, dir) => {
            const cur = sd[col.f] || 0
            if (col.f === 'w') {
              mutSet(entryIdx, i, row => setSideField(row, side, col.f, stepWeight(cur, col.step, dir)))
              return
            }
            const step = col.f === 'r' ? 1 : col.step
            mutSet(entryIdx, i, row => setSideField(row, side, col.f, Math.max(0, Math.round(((cur || 0) + dir * step) * 100) / 100)))
          }

          const sideCell = (sd, i, side, col, cls) => (
            <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')}>
              {wc.steppers && <button aria-label="Decrease" onClick={() => sideBump(sd, i, side, col, -1)}><Icon name="minus" /></button>}
              <span className="val"><NumberField decimal={col.dec} value={sd[col.f] ?? ''}
                onChange={v => mutSet(entryIdx, i, row => setSideField(row, side, col.f, v))} /></span>
              {wc.steppers && <button aria-label="Increase" onClick={() => sideBump(sd, i, side, col, 1)}><Icon name="plus" /></button>}
            </div>
          )

          const sideEffortCell = (sd, i, side, col) => {
            const v = sd[col.f] ?? null
            const rir = col.eff === 'rpe' ? (v == null ? null : 10 - v) : v
            const color = effortColor(rir)
            const open = () => effortPickerSheet(col.eff, v, nv => mutSet(entryIdx, i, row => setSideField(row, side, col.f, nv)))
            if (v == null) return <button className="effcell is-empty" aria-label={col.hd} onClick={open}>{col.hd}</button>
            const step = dir => mutSet(entryIdx, i, row => setSideField(row, side, col.f, stepEffort(col.eff, v, dir)))
            return (
              <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
                style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
                {wc.steppers && <button aria-label="Decrease" onClick={() => step(-1)}><Icon name="minus" /></button>}
                <button className="val" aria-label={col.hd} onClick={open}>{fmtNum(v)}</button>
                {wc.steppers && <button aria-label="Increase" onClick={() => step(1)}><Icon name="plus" /></button>}
              </div>
            )
          }

          const sideRow = (s, i, side) => {
            const sd = (s.sides && s.sides[side]) || { w: 0, r: 0, done: false }
            return <div className={'setrow side' + (sd.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
              <span className="sidetag" aria-hidden="true">{side === 'L' ? t('L') : t('R')}</span>
              {sideCell(sd, i, side, col1, 'w')}
              {col2 && sideCell(sd, i, side, col2, 'r')}
              {col3 && sideEffortCell(sd, i, side, col3)}
              <Check checked={sd.done} onChange={() => toggleSet(entryIdx, i, side)} />
            </div>
          }

          const miniStepper = (value, step, dec, onChange, snapWeightStep = false) => (
            <div className="stp mini">
              <button aria-label="Decrease" onClick={() => onChange(snapWeightStep ? stepWeight(value, step, -1) : Math.max(0, Math.round(((value || 0) - step) * 100) / 100))}><Icon name="minus" /></button>
              <span className="val"><NumberField decimal={dec} value={value ?? ''} onChange={onChange} /></span>
              <button aria-label="Increase" onClick={() => onChange(snapWeightStep ? stepWeight(value, step, 1) : Math.max(0, Math.round(((value || 0) + step) * 100) / 100))}><Icon name="plus" /></button>
            </div>
          )

          const openSetMenu = (s, i) => {
            const warm = isWarmupRow(s)
            menuSheet({
              title: (warm ? t('Warm-up') : t('Set {0}', entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length)),
              items: [
                !warm && mode === 'reps' && !isRestPauseSet(s) && {
                  icon: 'arrowDown',
                  label: t('Drop set'),
                  sub: t('+ Drop'),
                  onClick: () => mutSet(entryIdx, i, row => isSideSet(row) ? addSideDrop(row) : addDrop(row, { w: nextDropWeight(row.w || 0), r: row.r })),
                },
                !warm && mode === 'reps' && !isDropSet(s) && {
                  icon: 'bolt',
                  label: t('Rest-pause burst'),
                  sub: t('+ Burst'),
                  onClick: () => mutSet(entryIdx, i, row => {
                    if (isSideSet(row)) return addSideCluster(row, 15)
                    const clusters = clustersOf(row)
                    const base = clusters.length ? clusters[clusters.length - 1].r : (row.r || 0)
                    const addedR = nextBurstReps(base)
                    return { ...addCluster(row, { r: addedR, restSec: 15 }), r: (row.r || 0) + addedR }
                  }),
                },
                {
                  icon: 'trash',
                  label: t('Remove this set'),
                  danger: true,
                  disabled: entry.sets.length <= 1,
                  onClick: () => removeSetAt(entryIdx, i),
                },
              ],
            })
          }

          const openMore = () => menuSheet({
            title: exerciseNameFor(ex),
            items: [
              { icon: 'pencil', label: entry.note ? t('Edit note') : t('Add note'), sub: entry.note || undefined, onClick: () => editExerciseNote(entryIdx) },
              { icon: 'info', label: t('Details'), onClick: () => exerciseDetailSheet(ex) },
              { icon: 'history', label: t('History'), onClick: () => exerciseHistorySheet(entry.id) },
              { icon: 'flame', label: t('Add warm-up set'), onClick: () => addWarmup(entryIdx) },
              { icon: 'shuffle', label: t('Swap exercise'), onClick: () => swapExercise(entryIdx) },
              { icon: 'chevronUp', label: t('Move up'), onClick: () => moveExercise(entryIdx, -1), disabled: entryIdx <= 0 },
              { icon: 'chevronDown', label: t('Move down'), onClick: () => moveExercise(entryIdx, 1), disabled: entryIdx >= entries.length - 1 },
              { icon: 'trash', label: t('Remove exercise'), onClick: () => removeExercise(entryIdx), danger: true },
            ],
          })

          return (
            <div key={entry.id + '-' + entryIdx} className="card" style={{ marginBottom: 14 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 600, textTransform: 'capitalize' }}>
                  {exerciseNameFor(ex)}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {entry.note && (
                    <button className="iconbtn" aria-label={t('Note')} style={{ color: 'var(--acc)' }} onClick={() => editExerciseNote(entryIdx)}>
                      <Icon name="pencil" />
                    </button>
                  )}
                  <button className="iconbtn" aria-label={t('More')} onClick={openMore}>
                    <Icon name="more" />
                  </button>
                </div>
              </div>

              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
                {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('Per side')}</span>}
                {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
                {ex.eq && <span className="tag">{t(ex.eq)}</span>}
              </div>

              {entry.note && <div className="exnote" style={{ marginBottom: 8 }}>{entry.note}</div>}

              <div className={'sethead' + (col3 ? ' eff3' : '')}>
                <span className="n-sp" />
                <span className="w-sp">{col1.hd}</span>
                {col2 && <span className="r-sp">{col2.hd}</span>}
                {col3 && <span className="eff-sp">{col3.hd}</span>}
                <span className="ck-sp" />
              </div>

              {entry.sets.map((s, i) => {
                const warm = isWarmupRow(s)
                const warmBefore = i > 0 && isWarmupRow(entry.sets[i - 1])
                const isFirstWarmup = warm && !warmBefore
                const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length

                return (
                  <div key={i}>
                    {isFirstWarmup && <div className="setph">{t('Warm-up')}</div>}
                    {!warm && warmBefore && <div className="setsep" />}
                    {perSide && !warm && isSideSet(s) ? (
                      <div className={'setrow-side' + (s.done ? ' done' : '')}>
                        <button type="button" className="n" aria-label={t('Set {0}', phaseNum)} onClick={() => openSetMenu(s, i)}>{phaseNum}</button>
                        <div className="side-rows">
                          {sideRow(s, i, 'L')}
                          {sideRow(s, i, 'R')}
                        </div>
                      </div>
                    ) : (
                      <div className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
                        <button type="button" className="n" aria-label={t('Set {0}', phaseNum)} onClick={() => openSetMenu(s, i)}>{phaseNum}</button>
                        {cell(s, i, col1, 'w')}
                        {col2 && cell(s, i, col2, 'r')}
                        {col3 && effortCell(s, i, col3)}
                        <Check checked={s.done} onChange={() => toggleSet(entryIdx, i)} />
                      </div>
                    )}
                    {!warm && mode === 'reps' && dropsOf(s).map((d, di) => (
                      <div className="subrow" key={'d' + di}>
                        <span className="subn">{t('Drop {0}', di + 1)}</span>
                        {miniStepper(d.w, loadStep, true, v => mutSet(entryIdx, i, row => setDropAt(row, di, { w: v })), true)}
                        {miniStepper(d.r, 1, false, v => mutSet(entryIdx, i, row => setDropAt(row, di, { r: v })))}
                        <button className="iconbtn" aria-label={t('Remove drop')} onClick={() => mutSet(entryIdx, i, row => removeDropAt(row, di))}><Icon name="xmark" /></button>
                      </div>
                    ))}
                    {!warm && mode === 'reps' && clustersOf(s).map((c, ci) => (
                      <div className="subrow" key={'c' + ci}>
                        <span className="subn">{t('Burst {0}', ci + 1)}</span>
                        {miniStepper(c.r, 1, false, v => mutSet(entryIdx, i, row => {
                          const delta = (Number(v) || 0) - (clustersOf(row)[ci]?.r || 0)
                          return { ...setClusterAt(row, ci, { r: v }), r: Math.max(0, (row.r || 0) + delta) }
                        }))}
                        <span className="dim small">{c.restSec}s</span>
                        <button className="iconbtn" aria-label={t('Remove burst')} onClick={() => mutSet(entryIdx, i, row => {
                          const removed = clustersOf(row)[ci]?.r || 0
                          return { ...removeClusterAt(row, ci), r: Math.max(0, (row.r || 0) - removed) }
                        })}><Icon name="xmark" /></button>
                      </div>
                    ))}
                  </div>
                )
              })}

              <div style={{ height: 10 }} />
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <Button size="sm" icon="flame" onClick={() => addWarmup(entryIdx)}>{t('Add warm-up set')}</Button>
                <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={() => removeSet(entryIdx)}>{t('Remove set')}</Button>
                <Button size="sm" icon="plus" onClick={() => addSet(entryIdx)}>{t('Add set')}</Button>
              </div>
            </div>
          )
        })}

        <Button icon="plus" onClick={handleAddExercise} style={{ marginTop: 8, marginBottom: 24 }}>
          {t('Add exercise')}
        </Button>
      </div>
    </div>
  )
}
