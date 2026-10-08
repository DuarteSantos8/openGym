// Recommendation layer: sits before the existing workout-generation pipeline.
// Pure function over S — deterministic, no AI, no new database.
import { todayISO } from './format.js'
import { effectiveRoutines, nextTrainingDay } from './history.js'
import { activeProfile, exAvailable } from './equipment.js'
import { EXIDX } from './exercises.js'

// Hard constraints / equipment: which routines can actually be started
function availableRoutines(S) {
  const routines = S?.routines || []
  return routines.filter(r => {
    if (!(r?.ex || []).length) return false
    // With an active profile, skip routines that contain unavailable exercises
    if (activeProfile(S)) {
      for (const cfg of r.ex) {
        const id = cfg?.id
        if (id && !exAvailable(S, EXIDX[id] || { id, eq: null })) return false
      }
      // With profile and at least one available exercise, keep it (partial filter
      // means some exercises missing — still usable with replacements)
    }
    return true
  })
}

function daysSinceLastWorkout(S) {
  const today = todayISO()
  const workouts = S?.workouts || []
  const last = workouts.slice(-1)[0]
  if (!last?.d) return Infinity
  const a = new Date(today + 'T12:00:00')
  const b = new Date(last.d + 'T12:00:00')
  return Math.round((a - b) / 86400000)
}

export function recommendToday(S) {
  const todayIso = todayISO()
  const routines = S?.routines || []
  const planned = effectiveRoutines(S, todayIso)
  const available = availableRoutines(S)

  // 1. No plan at all — first time
  if (!routines.length) {
    return {
      routineId: null,
      routine: null,
      duration: S?.workoutLength || 25,
      reason: 'No plan yet — load a starter plan or build one.',
      context: 'first',
      daysSince: Infinity,
    }
  }

  // 2. Today is planned (scheduled routine)
  if (planned.length) {
    const routine = planned[0]
    const days = daysSinceLastWorkout(S)
    const dur = S?.workoutLength || 35

    if (days === 0) {
      return {
        routineId: routine.id,
        routine,
        duration: Math.min(dur, 25),
        reason: 'You trained yesterday — shorter session fits.',
        context: 'recent-1',
        daysSince: 0,
      }
    }
    if (days === 1) {
      return {
        routineId: routine.id,
        routine,
        duration: dur,
        reason: "Yesterday was rest — today's planned session fits well.",
        context: 'normal',
        daysSince: 1,
      }
    }
    if (days >= 7) {
      return {
        routineId: routine.id,
        routine,
        duration: Math.max(dur, 35),
        reason: 'Back after a longer gap — full session fits.',
        context: 'gap',
        daysSince: days,
      }
    }
    return {
      routineId: routine.id,
      routine,
      duration: dur,
      reason: 'Today is on plan — start when ready.',
      context: 'normal',
      daysSince: days,
    }
  }

  // 3. No planned routine today — choose from available
  const pick = available.length ? available[0] : routines[0]
  const days = daysSinceLastWorkout(S)
  const dur = S?.workoutLength || 35

  if (days === Infinity) {
    return {
      routineId: pick.id,
      routine: pick,
      duration: 25,
      reason: 'First session — start with a full session, or shorter if preferred.',
      context: 'first',
      daysSince: Infinity,
    }
  }

  if (days === 0) {
    return {
      routineId: pick.id,
      routine: pick,
      duration: Math.min(dur, 25),
      reason: 'Trained yesterday — shorter session recommended.',
      context: 'recent-1',
      daysSince: 0,
    }
  }

  if (days === 1) {
    return {
      routineId: pick.id,
      routine: pick,
      duration: dur,
      reason: 'Yesterday was rest — full session fits.',
      context: 'normal',
      daysSince: 1,
    }
  }

  if (days >= 7) {
    return {
      routineId: pick.id,
      routine: pick,
      duration: Math.max(dur, 35),
      reason: 'Back after a break — full session recommended.',
      context: 'gap',
      daysSince: days,
    }
  }

  // 2–6 days
  return {
    routineId: pick.id,
    routine: pick,
    duration: dur,
    reason: 'No session planned today — pick anything sensible.',
    context: 'normal',
    daysSince: days,
  }
}
