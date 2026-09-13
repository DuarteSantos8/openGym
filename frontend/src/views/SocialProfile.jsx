import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { EXIDX } from '../lib/exercises.js'
import { DAYN, exCount, fmtDate, fmtNum, weekOrder } from '../lib/format.js'
import { exLine, fmtSec } from '../lib/history.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import ProfileAvatar from '../components/ProfileAvatar.jsx'
import { Button } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import '../social.css'

function recordValue(record, unit) {
  if (record.metric === 'weight') return `${fmtNum(record.value)} ${unit}${record.reps > 0 ? ' × ' + t('{0} reps', fmtNum(record.reps)) : ''}`
  if (record.metric === 'sec') return fmtSec(record.value)
  if (record.metric === 'min') return `${fmtNum(record.value)} min`
  return t('{0} reps', fmtNum(record.value))
}

export default function SocialProfile() {
  const { id } = useParams()
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const userId = useStore(s => s.user?.id)

  useEffect(() => { setProfile(null); setError('') }, [id, userId])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision(n => n + 1) }
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [id, userId])

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    api('/api/social/profile?id=' + encodeURIComponent(id), { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) { setProfile(value); setError('') } })
      .catch(e => {
        if (abort.signal.aborted || e.name === 'AbortError') return
        setError(e.message)
        if ([401, 403, 404].includes(e.status)) setProfile(null)
      })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [id, userId, revision])

  const retry = <Button size="sm" disabled={loading} onClick={() => setRevision(n => n + 1)}>{t('Try again')}</Button>

  if (error && !profile) return <div className="social social-profile">
    <div className="friend-profile-nav"><button className="iconbtn" onClick={() => nav('/profile?view=social')} aria-label={t('Social')}><Icon name="chevronLeft" /></button>
      <span>{t('Friend profile')}</span></div>
    <div className="card social-error" role="alert">{error}{retry}</div>
  </div>
  if (!profile) return <p role="status" className="muted">{t('Loading profile…')}</p>

  const customNames = new Map(profile.plan.customExercises.map(exercise => [exercise.id, exercise.n]))
  const nameOf = exercise => customNames.get(exercise.id) || exerciseNameFor(EXIDX[exercise.id]) || t('Exercise')
  const routinesById = new Map(profile.plan.routines.map(routine => [routine.id, routine]))
  const scheduled = weekOrder(profile.weekStart).filter(day => profile.plan.week[day]?.length)
  const bodyWeight = profile.bodyWeight

  return <div className="social social-profile">
    <div className="friend-profile-nav"><button className="iconbtn" onClick={() => nav('/profile?view=social')} aria-label={t('Social')}><Icon name="chevronLeft" /></button>
      <span>{t('Friend profile')}</span>
      <button className="iconbtn" disabled={loading} onClick={() => setRevision(n => n + 1)} aria-label={t('Refresh')}><Icon name="reset" /></button></div>
    {error && <div className="card social-error" role="alert">{error}{retry}</div>}

    <section className="card profile-identity friend-profile-identity">
      <ProfileAvatar name={profile.name} avatar={profile.avatar} size="xl" />
      <div className="profile-identity-copy"><h1>{profile.name}</h1><p>{profile.lastWorkout
        ? t('Last workout: {0}', fmtDate(profile.lastWorkout, false, true)) : t('No workouts logged yet')}</p></div>
    </section>

    <div className="tiles">
      <div className="tile"><div className="l"><Icon name="dumbbell" />{t('Workouts')}</div><div className="v">{profile.workouts}</div></div>
      <div className="tile"><div className="l"><Icon name="calendar" />{t('This month')}</div><div className="v">{profile.thisMonth}</div></div>
      <div className="tile"><div className="l"><Icon name="flame" />{t('Week streak')}</div><div className="v">{profile.weekStreak}</div></div>
      <div className="tile"><div className="l"><Icon name="scale" />{t('Body weight')}</div><div className="v social-weight">{profile.bodyWeightShared === false ? t('Private') : bodyWeight ? `${fmtNum(bodyWeight.value)} ${profile.unit}` : '—'}</div>
        {bodyWeight && <div className="small dim">{fmtDate(bodyWeight.date, false, true)}{bodyWeight.change30d == null ? ''
          : ` · 30d ${(bodyWeight.change30d > 0 ? '+' : '') + fmtNum(bodyWeight.change30d)} ${profile.unit}`}</div>}</div>
    </div>

    <h4 className="sec">{t('Weekly plan')}</h4>
    <div className="card">
      {scheduled.length ? scheduled.map(day => <div className="social-schedule" key={day}><b>{t(DAYN[day])}</b>
        <span>{profile.plan.week[day].map(routineId => routinesById.get(routineId)?.name).filter(Boolean).join(' + ')}</span></div>)
        : <p className="small muted">{t('No weekly schedule yet.')}</p>}
    </div>

    <h4 className="sec">{t('Routines')} · {profile.plan.routines.length}</h4>
    {profile.plan.routines.length ? <div className="card social-routines">{profile.plan.routines.map(routine => <details key={routine.id}>
      <summary><span className="social-plan-icon"><Icon name="clipboard" /></span><span className="grow"><b>{routine.name}</b>
        <small>{exCount(routine.ex.length)}</small></span><Icon name="chevronRight" className="chev" /></summary>
      <div className="social-exercises">{routine.ex.map((exercise, index) => <div key={`${exercise.id}-${index}`}>
        <span>{nameOf(exercise)}</span><small>{exLine(exercise, profile.unit)}</small></div>)}</div>
    </details>)}</div> : <div className="card small muted">{t('No routines yet.')}</div>}

    <h4 className="sec">{t('Personal records')} · {profile.recordCount}</h4>
    <div className="card social-records social-all-records">
      {profile.records.length ? <ul>{profile.records.map(record => <li key={record.exerciseId}>
        <div className="grow"><b>{record.name || exerciseNameFor(EXIDX[record.exerciseId]) || t('Exercise')}</b>
          <span className="small muted">{fmtDate(record.date, false, true)}</span></div>
        <strong>{recordValue(record, profile.unit)}</strong>
      </li>)}</ul> : <p className="small muted">{t('No personal records yet')}</p>}
    </div>
  </div>
}
