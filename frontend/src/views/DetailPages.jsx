import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'
import { sameWorkout } from '../lib/workout-date.js'
import { pathBefore, afterSheets } from '../lib/nav.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import { ExerciseDetail, WorkoutDetail, FavButton } from '../sheets.jsx'

// An exercise's detail and a past workout as screens of their own on the iPhone (the openers are
// openExerciseDetail / openWorkoutDetail in sheets.jsx), so they can slide in like any page. The
// content is the sheet's own component. Back goes where it came from; opened cold (a reload on the
// URL) it goes to the list. Leaving runs once, whether the back button, Delete or the record
// vanishing (a merge, a sync) asks for it.
function useLeave(fallback, gone) {
  const nav = useNavigate()
  const left = useRef(false)
  const hasBack = (window.history.state?.idx || 0) > 0
  const leave = () => {
    if (left.current) return
    left.current = true
    afterSheets(() => (hasBack ? nav(-1) : nav(fallback, { replace: true })))
  }
  useEffect(() => { if (gone) leave() }, [gone])
  // the Back tap's move can be dropped by a newer input (transitions halt()), so it lets go again
  const back = () => { leave(); setTimeout(() => { left.current = false }, 600) }
  const backBtn = <button className="iconbtn" data-back={(hasBack ? pathBefore() : null) || fallback} onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
  return { leave, backBtn }
}

export function ExercisePage() {
  const { id } = useParams()
  useStore(s => s.S)   // a custom exercise edited from here shows its new name
  const ex = EXIDX[id]
  const { leave, backBtn } = useLeave('/library', !ex)
  if (!ex) return null
  return <div className="narrow">
    <ScreenHeader hard title={exerciseNameFor(ex)} left={backBtn} right={<FavButton id={ex.id} />} />
    <ExerciseDetail ex={ex} close={leave} page />
  </div>
}

export function WorkoutPage() {
  const { id } = useParams()
  const w = useStore(s => s.S.workouts.find(x => sameWorkout(x, { id })))
  const { leave, backBtn } = useLeave('/history', !w)
  if (!w) return null
  return <div className="narrow">
    <ScreenHeader hard title={w.name} left={backBtn} />
    <WorkoutDetail w={w} close={leave} page />
  </div>
}
