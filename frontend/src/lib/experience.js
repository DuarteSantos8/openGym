// Experience level (EP21): Beginner, Intermediate or Experienced, one setting that decides how
// much of the training screen a person meets on day one.
//
// THE RULES
//   - S.experience is 'beginner' | 'intermediate' | 'advanced', or absent. Absent means nobody
//     chose: every screen is exactly what it was before this setting existed.
//   - A level is a starting point, not a lock. It writes the four training-detail modules below
//     (lib/modules.js) and nothing else; each can still be switched by hand in Settings → Modules,
//     and the level itself changes in Settings → Training plan.
//   - Only modules that are about detail on the screen are touched: effort, plates, strength
//     levels, form videos. Body, health, the watch, the Coach, integrations and the rest are left
//     alone, so choosing a level never pauses a connection and never hides someone's data.
//   - Nothing is ever deleted. Beginner hides; Experienced shows.
//
// Pure, like lib/modules.js, so any helper can read it.

export const LEVELS = ['beginner', 'intermediate', 'advanced']

/* What each level switches. Effort ratings (RIR/RPE) and plate maths are the two things a first
   month does not need; strength levels compare you to other lifters, which helps nobody on day
   one; filming a set is a tool for someone who already knows what to look for. */
const LEVEL_MODULES = {
  beginner: { effort: false, plates: false, strength: false, videos: false },
  intermediate: { effort: true, plates: true, strength: true, videos: false },
  advanced: { effort: true, plates: true, strength: true, videos: true },
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

export const isLevel = v => LEVELS.includes(v)

/** The level this profile chose, or null when it never did. */
export const experienceOf = S => (isLevel(S?.experience) ? S.experience : null)

/** { [moduleId]: boolean } a level stands for, or null for an unknown level. */
export const levelModules = level => (isLevel(level) ? { ...LEVEL_MODULES[level] } : null)

/**
 * Writes a level into a draft state (useStore update): the level itself and its modules, each key
 * explicitly, so the choice syncs per module like any other Modules change. An unknown level
 * changes nothing.
 */
export function applyExperience(s, level) {
  const m = levelModules(level)
  if (!m) return false
  s.experience = level
  s.modules = { ...(isMap(s.modules) ? s.modules : {}), ...m }
  return true
}

/**
 * Whether the workout screen keeps its rarer set actions (drop set, rest-pause, taken to failure)
 * one step back, under More. Only for a profile that chose Beginner.
 */
export const simpleWorkout = S => experienceOf(S) === 'beginner'

// Twelve sessions over six weeks is roughly where the first, fast adaptations settle and a
// second progression style starts to pay (ACSM 2009 progression models: novice → intermediate
// is counted in months of consistent training, not in a number on the bar).
export const STEP_UP = { workouts: 12, days: 42 }

/**
 * 'intermediate' once a Beginner has trained enough to be offered the next level, else null.
 * A suggestion only: nothing changes until the person says so.
 */
export function stepUpSuggestion(S, today = new Date().toISOString().slice(0, 10)) {
  if (experienceOf(S) !== 'beginner') return null
  const days = (Array.isArray(S?.workouts) ? S.workouts : [])
    .map(w => w?.d).filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (days.length < STEP_UP.workouts) return null
  const span = (Date.parse(today + 'T00:00:00Z') - Date.parse(days[0] + 'T00:00:00Z')) / 86400e3
  return span >= STEP_UP.days ? 'intermediate' : null
}
