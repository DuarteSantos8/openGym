import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { pyramidRestFor } from '../lib/pyramid.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { clampDuration, fmtRest, REST_MAX } from '../lib/duration.js'
import { durationSheet } from './DurationWheel.jsx'
import { Button, Section, SelectRow } from './ui.jsx'

function RestField({ title, value, fallback, onChange }) {
  const mode = value == null ? 'default' : value === 0 ? 'off' : 'custom'
  return <SelectRow title={title} value={mode} options={[
    { value: 'default', label: t('Default ({0})', fmtRest(fallback)) },
    { value: 'off', label: t('Off') },
    { value: 'custom', label: mode === 'custom' ? fmtRest(value) : t('Custom') },
  ]} onChange={choice => choice === 'custom'
    ? durationSheet({ title, value: value ?? fallback, max: REST_MAX, off: t('Off'), onDone: onChange })
    : onChange(choice === 'off' ? 0 : null)} />
}

export function ExerciseRestSettings({ entry, defaultRest, onSave, close }) {
  const [warm, setWarm] = useState(entry.target?.warmupRestSec ?? null)
  const [work, setWork] = useState(entry.target?.workRestSec ?? null)
  const [rows, setRows] = useState(entry.sets.map(row => row.restSec ?? null))
  const fallback = entry.target?.restSec > 0 ? entry.target.restSec : defaultRest
  let warmNumber = 0, workNumber = 0
  return <>
    <h3>{t('Warm-up and work rest')}</h3>
    <p className="dim small">{t('This exercise, this session only')}</p>
    <Section>
      <RestField title={t('Warm-up')} value={warm} fallback={work ?? fallback} onChange={setWarm} />
      <RestField title={t('Work sets')} value={work} fallback={fallback} onChange={setWork} />
    </Section>
    <Section title={t('Per-set rest')}>
      {entry.sets.map((row, index) => {
        const isWarm = isWarmupRow(row)
        const number = isWarm ? ++warmNumber : ++workNumber
        const next = entry.sets.slice(index + 1).find(set => !set.done)
        const pyramidRest = pyramidRestFor(entry.target, entry.sets, index)
        const workRest = pyramidRest > 0 ? pyramidRest : work ?? fallback
        const inherited = isWarm && next && isWarmupRow(next) ? warm ?? workRest : workRest
        return <RestField key={index} title={(isWarm ? t('Warm-up') + ' · ' : '') + t('Set {0}', number)}
          value={rows[index]} fallback={inherited} onChange={value => setRows(values => values.map((old, i) => i === index ? value : old))} />
      })}
    </Section>
    <Button variant="primary" onClick={() => { close(); onSave({ warm, work, rows }) }}>{t('Save')}</Button>
  </>
}

export function exerciseRestSettingsSheet(index) {
  const state = useStore.getState().S
  const active = state.active
  const entry = active?.entries?.[index]
  if (!entry) return
  // A delayed Save must not address a different set after an insertion or reorder.
  const signature = JSON.stringify(active.entries)
  const assign = (object, key, value) => {
    if (value == null) delete object[key]
    else object[key] = clampDuration(value)
  }
  return useUI.getState().openSheet(close => <ExerciseRestSettings entry={entry} defaultRest={state.restSec} close={close}
    onSave={({ warm, work, rows }) => useStore.getState().update(s => {
      if (s.active?.id !== active.id || JSON.stringify(s.active.entries) !== signature) return
      const current = s.active.entries[index]
      current.target = { ...current.target }
      assign(current.target, 'warmupRestSec', warm)
      assign(current.target, 'workRestSec', work)
      current.sets.forEach((row, i) => assign(row, 'restSec', rows[i]))
    })} />)
}
