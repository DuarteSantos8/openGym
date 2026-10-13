import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { nextOpenSet } from '../lib/workout-keys.js'
import { startPreparedSession } from '../lib/workout-preparation.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { defaultConfig, setsRepsOf } from '../lib/history.js'
import { exercisePicker, exConfigSheet } from '../sheets.jsx'
import Media from './Media.jsx'
import { Button } from './ui.jsx'
import './WorkoutPreview.css'

export function ExercisePreview({ active, next, title }) {
  if (!next) return null
  const entry = active.entries[next.idx]
  const ex = exOr(entry.id)
  return <section className="card workout-preview" aria-label={title}>
    <div className="muted small">{title}</div>
    <h2>{exerciseNameFor(ex)}</h2>
    <div className="row wrap small muted">
      <span>{t('Set {0}', next.i + 1)}</span>
      {entry.target && <span>{setsRepsOf(entry.target)}</span>}
      {next.side && <span>{t('Per side')} · {next.side}</span>}
      {ex.eq && <span>{t(ex.eq)}</span>}
    </div>
    <Media key={entry.id + ':' + next.idx} ex={ex} compact />
  </section>
}

export default function WorkoutPreparation() {
  const active = useStore(s => s.S.active)
  const update = useStore(s => s.update)
  const nav = useNavigate()
  const addFirst = () => exercisePicker((ex, quick) => {
    const add = cfg => update(s => {
      if (!s.active?.preparing) return
      s.active.entries.push(...buildSessionEntries(s, { ex: [{ ...cfg, id: ex.id }] }))
    })
    if (quick) add(defaultConfig(ex.id))
    else exConfigSheet(ex, null, add)
  })
  return <div className="narrow workout-preparation">
    <div className="hdr"><div><h1>{active.name}</h1><div className="sub">{t('Get ready')}</div></div></div>
    <p className="muted">{t('Preview the first exercise and get your equipment ready. Your workout timer starts when you are ready.')}</p>
    <ExercisePreview active={active} next={nextOpenSet(active.entries, 0)} title={t('First exercise')} />
    {!active.entries.length && <Button icon="plus" onClick={addFirst}>{t('Add exercise')}</Button>}
    <Button variant="primary" icon="play" disabled={!active.entries.length}
      onClick={() => update(s => { s.active = startPreparedSession(s.active) }, true)}>{t('Ready, start workout')}</Button>
    <Button variant="ghost" onClick={() => nav('/home')}>{t('Back')}</Button>
    <Button variant="ghost" onClick={() => { update(s => { s.active = null }); nav('/workout') }}>{t('Cancel')}</Button>
  </div>
}
