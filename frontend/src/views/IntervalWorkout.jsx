import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import Media from '../components/Media.jsx'
import { advanceInterval, currentIntervalDuration, INTERVAL_PHASE_WORK, INTERVAL_PHASE_REST } from '../lib/intervalFlow.js'
import { completedIntervalExercises } from '../lib/intervalFlow.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { finishWorkout } from '../sheets.jsx'
import { beep, chime } from '../lib/sound.js'

const clock = sec => {
  const s = Math.max(0, Math.ceil(sec))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

export default function IntervalWorkout() {
  const active = useStore(s => s.S.active)
  const update = useStore(s => s.update)

  const flow = active?.interval
  const sound = useStore(s => s.S.sound !== false)

  const lastCountdownRef = useRef(null)
  const previousPhaseRef = useRef(null)

  const phaseKey = flow
    ? `${flow.round}:${flow.exercise}:${flow.phase}`
    : null

  const duration = currentIntervalDuration(flow)

  const [endsAt, setEndsAt] = useState(() => Date.now() + duration * 1000)
  const [left, setLeft] = useState(duration)
  const [paused, setPaused] = useState(false)

  const entry = active?.entries?.[flow?.exercise]
  const exercise = entry ? exOr(entry.id) : null
  const exerciseName = entry ? exerciseNameFor(entry.id) : ''

const nextExerciseIndex = flow?.exerciseCount
  ? (flow.exercise + 1) % flow.exerciseCount
  : null

const nextEntry = nextExerciseIndex !== null
  ? active?.entries?.[nextExerciseIndex]
  : null

const nextExercise = nextEntry ? exOr(nextEntry.id) : null
const nextExerciseName = nextEntry
  ? exerciseNameFor(nextEntry.id)
  : ''

  const completed = completedIntervalExercises(flow)
  const total = (flow?.rounds || 0) * (flow?.exerciseCount || 0)

  const pct = duration > 0
    ? Math.max(0, Math.min(100, (left / duration) * 100))
    : 0

  const phaseLabel = flow?.phase === INTERVAL_PHASE_WORK
    ? t('Work')
    : t('Rest')

  useEffect(() => {
    if (!phaseKey) return

    const previous = previousPhaseRef.current
    previousPhaseRef.current = phaseKey

    // No sonar en el primer render ni en acabar l'entrenament.
    if (previous === null || flow?.phase === 'done') return

    if (previous !== phaseKey) {
      chime(sound)
    }
  }, [phaseKey, flow?.phase, sound])

  useEffect(() => {
    if (!flow || paused) return

    const tick = () => {
      const next = Math.max(0, (endsAt - Date.now()) / 1000)
      setLeft(next)

      // El temporitzador consulta cada 250 ms.
      // La clau impedeix repetir el beep dins del mateix segon.
      const second = Math.ceil(next)
      const countdownKey = `${phaseKey}:${second}`

      if (
        second >= 1 &&
        second <= 3 &&
        lastCountdownRef.current !== countdownKey
      ) {
        lastCountdownRef.current = countdownKey
        beep(sound, 660, 0.1)
      }

      if (next <= 0) {
        const nextFlow = advanceInterval(flow)

        update(s => {
          if (!s.active?.interval) return
          s.active.interval = nextFlow
        })

        const nextDuration = currentIntervalDuration(nextFlow)
        setLeft(nextDuration)
        setEndsAt(Date.now() + nextDuration * 1000)
      }
    }

    tick()
    const iv = setInterval(tick, 250)

    return () => clearInterval(iv)
  }, [endsAt, flow, paused, update, sound, phaseKey])

  useEffect(() => {
    if (!flow) return
    if (flow.phase !== 'done') return

    finishWorkout()
  }, [flow])

  const togglePause = () => {
    if (paused) {
      setEndsAt(Date.now() + left * 1000)
      setPaused(false)
      return
    }

    setLeft(Math.max(0, (endsAt - Date.now()) / 1000))
    setPaused(true)
  }

  const skip = () => {
    const nextFlow = advanceInterval(flow)

    update(s => {
      if (!s.active?.interval) return
      s.active.interval = nextFlow
    })

    const nextDuration = currentIntervalDuration(nextFlow)
    setLeft(nextDuration)
    setEndsAt(Date.now() + nextDuration * 1000)
    setPaused(false)
  }

  if (!active || !flow) return null

  if (flow.phase === 'done') return null

  return (
    <div className="narrow">
      <div className="hdr">
        <div className="row between">
          <div>
            <div style={{ fontWeight: 600 }}>{active.name}</div>
            <div className="sub">
              {t('Round {0} of {1}', flow.round + 1, flow.rounds)}
            </div>
          </div>

          <Button
            icon="check"
            variant="primary"
            aria-label={t('Finish')}
            onClick={finishWorkout}
          />
        </div>
      </div>

      <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
        <div className="small dim">{phaseLabel}</div>

{flow.phase === INTERVAL_PHASE_WORK && (
  <div style={{ marginTop: 10, marginBottom: 18 }}>
    {exercise && <Media ex={exercise} minimizable />}

    <div style={{ fontSize: 26, fontWeight: 700, marginTop: 14 }}>
      {exerciseName}
    </div>

    <div className="small dim" style={{ marginTop: 4 }}>
      {completed + 1} / {total}
    </div>
  </div>
)}

{flow.phase === INTERVAL_PHASE_REST && (
  <div style={{ marginTop: 10, marginBottom: 18 }}>
    <div className="small dim">
      {t('Next exercise')}
    </div>

    {nextExercise && (
      <>
        <div style={{ marginTop: 10 }}>
          <Media ex={nextExercise} minimizable />
        </div>

        <div style={{ fontSize: 26, fontWeight: 700, marginTop: 14 }}>
          {nextExerciseName}
        </div>
      </>
    )}
  </div>
)}
        <div style={{ fontSize: 72, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {clock(left)}
        </div>

        <div className="bar" style={{ marginTop: 20 }}>
          <i style={{ width: pct + '%' }} />
        </div>

        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <Button
            icon={paused ? 'play' : 'pause'}
            onClick={togglePause}
          >
            {t(paused ? 'Resume' : 'Pause')}
          </Button>

          <Button onClick={skip}>
            {t('Skip')}
          </Button>
        </div>
      </div>
    </div>
  )
}
