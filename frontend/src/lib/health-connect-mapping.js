// Health Connect describes movement classes, not openGym's equipment/grip/angle variants.
// Rules read canonical English catalogue data only, never translated or user-entered names.
// Keep this separate from set timing so coverage can be audited without constructing workouts.
import { CATALOGUE, EXIDX, canonicalExId, isCustomEx } from './exercises.js'

const BUILTIN = new Map(CATALOGUE.map(e => [e.id, e]))
// The catalogue occasionally has misleading equipment (2197 is a treadmill, not a bike).
export const SEGMENT_EXERCISES = {
  running_treadmill: ['2197'],
  biking_stationary: ['0798', '2138', '2279', '3893', '2193', '10729'],
  elliptical: ['2331'],
}
const OVERRIDES = new Map(Object.entries(SEGMENT_EXERCISES).flatMap(([type, ids]) => ids.map(id => [id, type])))
const RESISTANCE = new Set(['strength', 'olympic'])
const GENERAL = new Set(['calisthenics', 'isometric', 'plyometrics', 'cardio', 'combat', 'rehab'])
const LOAD_EQUIPMENT = new Set(['barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'dumbbell',
  'kettlebell', 'cable', 'leverage machine', 'smith machine', 'sled machine', 'weighted',
  'weight plate', 'sandbag', 'landmine', 'macebell'])

export const GENERAL_SEGMENTS = new Set(['other_workout', 'stretching', 'yoga', 'pilates',
  'biking', 'biking_stationary', 'elliptical', 'rowing_machine', 'running', 'running_treadmill',
  'walking', 'stair_climbing', 'stair_climbing_machine', 'swimming_freestyle', 'swimming_backstroke',
  'swimming_breaststroke', 'swimming_butterfly', 'swimming_other', 'wheelchair',
  'high_intensity_interval_training'])

function structuredType(ex, mode) {
  if (ex?.cat === 'yoga') return 'yoga'
  if (ex?.cat === 'pilates') return 'pilates'
  if (ex?.cat === 'stretching' || ex?.cat === 'mobility') return 'stretching'
  if (ex?.eq === 'stationary bike') return 'biking_stationary'
  if (ex?.eq === 'elliptical machine') return 'elliptical'
  if (ex?.eq === 'stepmill machine') return 'stair_climbing_machine'
  if (RESISTANCE.has(ex?.cat)) return 'weightlifting'
  if (GENERAL.has(ex?.cat) || mode === 'cardio' || mode === 'time') return 'other_workout'
  // Structured custom load metadata is enough for generic resistance, not a particular lift.
  if (mode === 'reps' && LOAD_EQUIPMENT.has(ex?.eq)) return 'weightlifting'
  return 'unknown'
}

/** Catalogue movements collapse variations only where their movement class stays meaningful. */
export function segmentTypeFor(entry, mode) {
  const id = canonicalExId(entry?.id)
  const canonical = BUILTIN.get(id)
  const registered = EXIDX[id]
  const custom = !canonical || (registered && isCustomEx(registered))
  const ex = custom ? registered || entry?.exercise || entry?.muscleSnapshot || entry?.target || {} : canonical
  // Do not parse custom names: "curl" in a user's language is not a canonical movement tag.
  if (custom) return structuredType(ex, mode)
  const override = OVERRIDES.get(id)
  if (override) return override
  const n = ex.n.toLowerCase().replace(/[-]/g, ' ')
  const has = re => re.test(n)
  if (['yoga', 'pilates', 'stretching', 'mobility'].includes(ex.cat)) return structuredType(ex, mode)

  // Cardio equipment before "row", "curl" or "press" prevents machine names being read as lifts.
  if (ex.eq === 'stationary bike' || has(/\b(stationary bike|hands bike|aquabike)\b/)) return 'biking_stationary'
  if (ex.eq === 'elliptical machine' || has(/\belliptical\b/)) return 'elliptical'
  if (ex.eq === 'stepmill machine' || has(/\b(stepper|stepmill|stair machine)\b/)) return 'stair_climbing_machine'
  if (has(/\browing (machine|with rowing machine)\b/)) return 'rowing_machine'
  if (has(/\b(outdoor bicycle|cycling|biking)\b/)) return 'biking'
  if (has(/\bswimming\b/)) {
    if (has(/\b(crawl|freestyle)\b/)) return 'swimming_freestyle'
    if (has(/\bbackstroke\b/)) return 'swimming_backstroke'
    if (has(/\bbreaststroke\b/)) return 'swimming_breaststroke'
    if (has(/\bbutterfly\b/)) return 'swimming_butterfly'
    return 'swimming_other'
  }
  if (ex.cat === 'cardio' && has(/\btreadmill\b/)) return has(/\b(run|running)\b/) ? 'running_treadmill' : 'walking'
  if (ex.cat === 'cardio' && has(/\b(run|running|sprint|sprints|jog|trot)\b/) && !has(/\b(burpee|squat|lunge|jump|hop)\b/)) return 'running'
  if (ex.cat === 'cardio' && has(/\b(walk|walking|marching)\b/) && !has(/\b(lunge|kick|twist)\b/)) return 'walking'
  if (has(/\bstair up\b/)) return 'stair_climbing'
  if (has(/\bburpee/)) return 'burpee'
  if (has(/\bjump(ing)? (skip )?rope\b|\bjump rope\b/)) return 'jump_rope'
  if (has(/\b(jumping jack|cross jacks|criss cross jack|split jacks|low jacks|rotational jacks)\b/)) return 'jumping_jack'
  if (has(/\bmountain climber/)) return 'mountain_climber'
  if (has(/\bhula hoop\b/)) return 'hula_hoop'
  if (has(/\b(ball slam|slam ball)\b/)) return 'ball_slam'
  if (has(/\b(punch|jab|uppercut|boxing .*cross|boxing .*hook)\b/)) return 'punch'

  // Muscle + movement metadata identifies presses whose name omits bench/shoulder.
  if (has(/\bpress(es)?\b/) && !has(/\b(clean|snatch|thruster|pullover|fly|squat|lunge|twist|rotation|cuban|pallof)\b/)) {
    if (ex.tg === 'pectorals' || (ex.tg === 'triceps' && has(/\b(floor|bench|incline|decline|close grip|pin)\b/))) return 'bench_press'
    if (ex.tg === 'delts') return ex.eq === 'barbell' || ex.eq === 'olympic barbell' ? 'barbell_shoulder_press' : 'shoulder_press'
  }
  if (has(/\b(bench press|chest press)\b/) && !has(/\b(squat|lunge|fly|pullover|calf)\b/)) return 'bench_press'
  if (has(/\b(deadlift|dead lift|good morning|romanian)\b/)) return 'deadlift'
  if (has(/\b(hip thrusts?|glute bridges?|bridge hip|pelvic lift)\b/)) return 'hip_thrust'
  if (has(/\b(leg press|calf press on leg press)\b/) && !has(/\bcalf\b/)) return 'leg_press'
  if (has(/\bsquats?\b/) && !has(/\b(press|curl|row|snatch|thruster)\b/)) return 'squat'
  if (has(/\blunges?\b/) && !has(/\b(curl|press|row)\b/)) return 'lunge'
  if (has(/\b(pull up|pullup|chin up|chinup)\b/)) return 'pull_up'
  if (has(/\b(pulldown|pull down)\b/) && !has(/\b(triceps|straight arm|stiff arm)\b/)) return 'lat_pull_down'
  if (has(/\b(shoulder press|military press|overhead press|arnold press|z press)\b/) && !has(/\b(squat|lunge)\b/)) return ex.eq === 'barbell' || ex.eq === 'olympic barbell' ? 'barbell_shoulder_press' : 'shoulder_press'
  // HC's only row token says "dumbbell", but all these are the same horizontal pulling class.
  // Upright rows and rear-delt flies are deliberately excluded.
  if (has(/\brow\b/) && !has(/\b(upright|fly|external rotation)\b/) && ['back', 'upper arms', 'shoulders'].includes(ex.bp)) return 'dumbbell_row'
  if (has(/\b(front raises?|front shoulder raises?|forward raises?)\b/)) return 'front_raise'
  if (has(/\b(lateral raises?|side raises?)\b/) && !has(/\b(leg|hip)\b/)) return 'lateral_raise'
  if (has(/\b(leg extension|knee extension)\b/)) return 'leg_extension'
  if (has(/\b(leg curl|hamstring curl|knee flexion|nordic curl)\b/)) return 'leg_curl'
  if (has(/\bcurl\b/) && ['biceps', 'brachialis', 'forearms'].includes(ex.tg) && !has(/\b(wrist|finger|hamstring)\b/)) return 'arm_curl'
  if (ex.tg === 'triceps' && has(/\b(extension|pushdown|push down|pressdown|kickback|skull crusher|skullcrusher|french press)\b/)) {
    return has(/\b(one arm|single arm)\b/) ? 'single_arm_triceps_extension' : 'double_arm_triceps_extension'
  }
  if (has(/\b(back extension|hyperextension|reverse hyper)\b/)) return 'back_extension'
  if (has(/\bcrunch\b/)) return 'crunch'
  if (has(/\bsit up\b|\bsitup\b/)) return 'sit_up'
  if (has(/\b(leg raise|knee raise|knees raise|reverse crunch)\b/) && ['waist', 'hips'].includes(ex.bp)) return 'leg_raise'
  if (has(/\b(russian twist|torso rotation|seated twist)\b/)) return 'upper_twist'
  // Dynamic plank/row/push-up combinations cannot be represented as a static plank.
  if (has(/\bplank\b/) && !has(/\b(row|push|jack|crunch|twist|rotation|raise|tap|kick|climber|walk|reach|jump)\b/)) return 'plank'
  if (ex.eq === 'kettlebell' && has(/\bswing\b/)) return 'kettlebell_swing'
  // No calf raise, push-up, dip, fly, hip abduction or rear-delt fly type exists in HC.
  return structuredType(ex, mode)
}

export function mappingCoverage() {
  const counts = { total: CATALOGUE.length, specific: 0, resistance: 0, general: 0, unknown: 0 }
  const unknown = []
  for (const ex of CATALOGUE) {
    const type = segmentTypeFor({ id: ex.id })
    if (type === 'unknown') { counts.unknown++; unknown.push({ id: ex.id, name: ex.n, category: ex.cat }) }
    else if (type === 'weightlifting') counts.resistance++
    else if (GENERAL_SEGMENTS.has(type)) counts.general++
    else counts.specific++
  }
  return { ...counts, coverage: (counts.total - counts.unknown) / counts.total * 100, unknownExercises: unknown }
}
