// A reviewed preparation list, rather than every exercise tagged as stretching. The IDs
// reference existing catalogue animations. Coverage describes preparation relevance, not
// training stimulus: it must not feed the lifting muscle map, volume or progression.
export const WARMUP_MOVEMENTS = [
  { id: '10759', family: 'pulse', coverage: ['quadriceps', 'hip-flexors', 'calves'], mode: 'time', sec: 45 }, // high knee walk
  { id: '3094', family: 'pulse', coverage: ['deltoids', 'gluteal', 'calves', 'hip-flexors'], mode: 'time', sec: 30 }, // jumping jack
  { id: '3905', family: 'shoulders', coverage: ['deltoids', 'chest', 'upper-back', 'trapezius', 'biceps', 'triceps'], mode: 'time', sec: 30 }, // arm circles
  { id: '1428', family: 'wrists', coverage: ['forearm'], mode: 'time', sec: 20 }, // wrist circles
  { id: '8052', family: 'spine', coverage: ['upper-back', 'obliques', 'deltoids'], mode: 'reps', reps: 6, perSide: true }, // kneeling thoracic rotation
  { id: '4580', family: 'spine', coverage: ['lower-back', 'abs', 'upper-back'], mode: 'reps', reps: 8 }, // cat cow stretch
  { id: '4286', family: 'hips', coverage: ['gluteal', 'hip-flexors', 'lower-back'], mode: 'time', sec: 30 }, // hip circles
  { id: '3502', family: 'leg-swings', coverage: ['hamstring', 'hip-flexors', 'gluteal'], mode: 'reps', reps: 10, perSide: true }, // back forward leg swings
  { id: '4630', family: 'leg-swings', coverage: ['adductors', 'gluteal', 'hip-flexors'], mode: 'reps', reps: 10, perSide: true }, // side to side leg swings
  { id: '1368', family: 'ankles', coverage: ['calves', 'tibialis'], mode: 'time', sec: 20, perSide: true }, // ankle circles
  { id: '3948', family: 'squat', coverage: ['quadriceps', 'gluteal', 'adductors'], mode: 'reps', reps: 8 }, // air squat
  { id: '1471', family: 'inchworm', coverage: ['abs', 'hamstring', 'deltoids', 'serratus'], mode: 'reps', reps: 5 }, // inchworm
  { id: '4633', family: 'lunge', coverage: ['gluteal', 'hip-flexors', 'hamstring', 'upper-back', 'obliques'], mode: 'reps', reps: 5, perSide: true }, // world's greatest stretch
].map(movement => Object.freeze({ ...movement, coverage: Object.freeze(movement.coverage) }))
Object.freeze(WARMUP_MOVEMENTS)

export const WARMUP_IDS = Object.freeze(WARMUP_MOVEMENTS.map(movement => movement.id))
const BY_ID = new Map(WARMUP_MOVEMENTS.map(movement => [movement.id, movement]))
export const MAX_WARMUP_STEPS = WARMUP_IDS.length
export const WARMUP_TIME_LIMITS = Object.freeze({ min: 5, max: 180 })
export const WARMUP_REP_LIMITS = Object.freeze({ min: 1, max: 50 })

export function defaultWarmupStep(id) {
  const movement = BY_ID.get(id)
  if (!movement) return undefined
  const key = movement.mode === 'time' ? 'sec' : 'reps'
  return { id, mode: movement.mode, [key]: movement[key], ...(movement.perSide ? { perSide: true } : {}) }
}

function normalizeStep(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !BY_ID.has(value.id)) return undefined
  if (value.mode !== 'time' && value.mode !== 'reps') return undefined
  const key = value.mode === 'time' ? 'sec' : 'reps'
  // Imported strings, booleans and Infinity are not durations or repetition counts.
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return undefined
  const { min, max } = value.mode === 'time' ? WARMUP_TIME_LIMITS : WARMUP_REP_LIMITS
  return {
    id: value.id,
    mode: value.mode,
    [key]: Math.max(min, Math.min(max, Math.round(value[key]))),
    ...(value.perSide === true ? { perSide: true } : {}),
  }
}

// An absent warm-up stays absent on old plans. A disabled sequence keeps its edits so
// switching it back on does not discard the user's work. Only this minimal shape travels
// through sync/import; no catalogue objects or untrusted extra fields enter session state.
export function normalizeWarmup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (typeof value.enabled !== 'boolean' || !Array.isArray(value.steps)) return undefined
  const steps = []
  for (const candidate of value.steps) {
    const step = normalizeStep(candidate)
    if (step) steps.push(step)
    if (steps.length === MAX_WARMUP_STEPS) break
  }
  return { enabled: value.enabled, steps }
}

