import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EXERCISE_GUIDES } from '../../frontend/src/content/exercise-guides.js'

const exerciseDir = new URL('../../catalogue/exercises/', import.meta.url)
export const outputFile = fileURLToPath(new URL('../../frontend/src/content/exercise-levels.js', import.meta.url))

// The category defines the audit population, never the predicted pattern or experience level.
const strengthCategories = new Set(['strength', 'calisthenics', 'isometric', 'olympic', 'plyometrics'])

// Keep the entire strength-programme population. In mixed source categories an
// ambiguous drill remains eligible. Exclusions describe the activity itself.
export function strengthEligible({category, name, equipment, target}) {
  if (strengthCategories.has(category)) return true
  const n = name.toLowerCase().replace(/[-_]/g, ' ')
  if (/\b(?:stretch(?:es|ing)?|foam roll(?:ing)?|smr|massage|meditation|breathing|relaxation|contract relax|mobilization|mobility)\b/.test(n)
    || equipment === 'massage ball' || (equipment === 'roller' && /^roll /.test(n))) return false
  if (category === 'combat' && /\b(?:boxing|kick|jab|hook|punch|block|uppercut|kickboxing)\b/.test(n)) return false
  if (category === 'cardio' && target === 'cardiovascular system' && /\b(?:jacks?|walking|walk|run|running|jog|jogging|cycling|aquabike|skating|cycle cross trainer|prancing|quick feet|trot in place|step in place|lever stepper|ski step|hula hoop|high knees butt kicks|high knee to butt kick|bicycle|bike|treadmill|elliptical|ergometer|skierg|stepmill|skips?|skipping|sprints?|sprinting|march|marching|shuffle|shuttle|ropes?|aerobic|dancing|dance|swim|swimming)\b/.test(n)) return false
  if (['stretching','yoga'].includes(category) && /\b(?:forward (?:bend|fold)|pigeon|butterfly|lotus|corpse|child|downward facing dog|happy baby|meditation|fish pose|mountain pose|tree pose|savasana|hero pose)\b/.test(n)) return false
  if (category === 'mobility' && /\b(?:circles?|swirl|side to side|range of motion|balance board|balance pad|rocking|heel walk|gliding)\b/.test(n)
    && ['body weight','stability ball','assisted'].includes(equipment)) return false
  if (category === 'mobility' && /\b(?:warming up|circling|flinging|pass through|nerve glide|leg length test|roll ball|shoulder level test|shoulder pendulum|vibrate plate|scalene muscles activation|swirls|tiger tail|toe touching|reach on chair|swing arms in place)\b/.test(n)) return false
  if (category === 'rehab' && /\b(?:hydrotherapy walking|rollball)\b/.test(n)) return false
  if (category === 'yoga' && /\b(?:resting|reclining big toe|hands to feet|standing seal|garland flower|default pose|sitting yoga pose|legs up the wall|seated wide angle|head to knee|cow face|vajrasana|supine spinal twist|thread the needle|puppy pose|pyramid pose|frog pose|standing forward bend)\b/.test(n)) return false
  return true
}

const families = [
  ['core', /\b(?:plank|crunch|sit ?ups?|leg raises?|knee raises?|ab wheel|ab roller|roll ?out|dead bug|deadbug|bird dog|hollow body|side bend|russian twist|pallof|wood ?chop|mountain climber|dragon flag|l sit|v sit|v up|heel touch)\b/],
  ['lunge', /\b(?:lunges?|split squats?|step ups?|step downs?|bulgarian split|cossack)\b/],
  ['squat', /\b(?:squats?|leg press|wall sit|pistol squat|thrusters?)\b/],
  ['hinge', /\b(?:dead ?lifts?|rdl|good mornings?|hip thrusts?|hip hinge|kettlebell swings?|glute bridges?|hyperextensions?|back extensions?|reverse hyper|power cleans?|power snatch)\b/],
  ['pull-v', /\b(?:pull ?ups?|chin ?ups?|pull ?downs?|upright rows?|rope climb|lat prayers?)\b/],
  ['push-v', /\b(?:shoulder press|overhead press|military press|arnold press|push press|pike push ?up|handstand push ?up|jerks?|dips?)\b/],
  ['pull-h', /\b(?:rows?|face pulls?|pull apart|reverse fl(?:y|ies))\b/],
  ['push-h', /\b(?:push ?ups?|bench press|floor press|chest press)\b/],
  ['isolation', /\b(?:curls?|fly|flyes?|flies|crossovers?|kickbacks?|kick backs?|shrugs?|pullovers?|calf raises?|heel raises?|lateral raises?|front raises?|rear delt raises?|leg extensions?|knee extensions?|triceps? extensions?|push ?downs?|hip abductions?|hip adductions?|hip extensions?|wrist extensions?|external rotation|internal rotation|dorsiflexion|plantar flexion)\b/],
]

// Known target plus a named joint action disambiguates broad names like "standing press".
function targetedPattern(name, target) {
  if (/\bpress(?:es)?\b/.test(name)) {
    if (target === 'pectorals') return 'push-h'
    if (target === 'front delts') return 'push-v'
  }
  if (/\b(?:twists?|rotations?|tucks?|scissors|kicks?|flutter|holds?|bicycles?|wipers?|jackknife|saw|double leg|knee to elbow|vacuum|hundred|body saw)\b/.test(name)
      && ['abs','obliques'].includes(target)) return 'core'
  if (/\b(?:clean|snatch|rack pull|pull through|hip raise bridge|butt bridge|hamstring bridge|swing)\b/.test(name)
    && /\b(?:barbell|kettlebell|dumbbell|sandbag|rack pull|pull through|bridge)\b/.test(name)) return 'hinge'
  if (/\b(?:high pull|sternum chin|ropes climb)\b/.test(name)) return 'pull-v'
  if (/\b(?:scapular retraction|pullapart)\b/.test(name)) return 'pull-h'
  if (/\b(?:chest pass|close grip press)\b/.test(name)) return 'push-h'
  if (/\b(?:superman|back hyperextension)\b/.test(name)) return 'hinge'
  if (['abs','obliques'].includes(target)
    && /\b(?:crunches|rollerout|heel touchers|windmill|hip raise|side bridge|air bike|leg lifts?|leg lowering|situp|jack ?knif[eves]+|l sits?|v sits?|hollow|scissor|cross crawls?|elbow to knee|bent knee to chest|knee ins?|knee tucks?|hip lifts?|seated in out|flutter kicks?)\b/.test(name)) return 'core'
  if (/\b(?:adduction|abduction|hip flexion|scapular elevation|neck flexion|neck extension|tibialis (?:anterior )?(?:press|raise)|toe raises?|calf press|calf jump|cross over|skull ?crushers?|skull press|chest squeeze|heel drops?|knee flexion|wrist roll(?:er|erer)?|pronation|supination|plate pinch|hand squeeze|hand grip|finger curls?)\b/.test(name)) return 'isolation'
  if (target === 'triceps' && /\b(?:extensions?|pressdown|kick backs?|skullcrusher)\b/.test(name)) return 'isolation'
  if (['front delts','side delts','rear delts','traps','serratus anterior','upper back'].includes(target)
    && /\b(?:raises?|wall slide|external shoulder rotation|internal shoulder rotation)\b/.test(name)) return 'isolation'
  if (['glutes','abductors','adductors'].includes(target)
    && /\b(?:leg lifts?|leg raises?|leg kick|kick backs?|donkey kicks?|fire hydrants?|clamshells?|clam shells?)\b/.test(name)) return 'isolation'
  if (target === 'hamstrings' && /\b(?:hamstring runner|nordic hamstring|nordic ham|assisted prone hamstring)\b/.test(name)) return 'isolation'
  if (['side delts','rear delts'].includes(target) && /\b(?:full can exercise|empty can exercise|y elevation)\b/.test(name)) return 'isolation'
  if (target === 'forearms' && /\b(?:hand gripper|finger extension|radial deviation|ulnar deviation)\b/.test(name)) return 'isolation'
  if (target === 'abs' && /\b(?:cocoon|butt ups?|hanging front lever|front lever|abdominal 4 points|lying alternate toe touch|knee circle raise|abdominal bracing)\b/.test(name)) return 'core'
  if (target === 'glutes' && /\b(?:bridge|hip lifts?|frog pumps?|swing|hip thrusts?|single leg thrusts?)\b/.test(name)) return 'hinge'
  if (target === 'hamstrings' && /\b(?:glute ham raise|hamstring bridge)\b/.test(name)) return 'hinge'
  if (target === 'quads' && /\b(?:deep knee bend|chair stand up|countermovement jump|squatting|wall sit)\b/.test(name)) return 'squat'
  if (target === 'quads' && /\b(?:split jump|jump split|patrick step|poliquin step|peterson step)\b/.test(name)) return 'lunge'
  if (['quads','glutes'].includes(target) && /\bleg\b.*\bpress\b/.test(name)) return 'squat'
  if (target === 'pectorals' && /\bchest push\b/.test(name)) return 'push-h'
  if (target === 'triceps' && /\b(?:french press|tate press|elbow press|triceps press)\b/.test(name)) return 'isolation'
  if (target === 'triceps' && /\b(?:incline|decline|lying)\b.*\bpress\b/.test(name)) return 'push-h'
  if (target === 'glutes' && /\b(?:rear kick|back kick|glute squeeze|glutes contraction|glute press)\b/.test(name)) return 'isolation'
  if (['glutes','abductors'].includes(target) && /\b(?:monster walk|side walk|clam|side kick|hip abductor)\b/.test(name)) return 'isolation'
  if (target === 'forearms' && /\b(?:wrist rotation|fingers press|gripper hands)\b/.test(name)) return 'isolation'
  if (target === 'levator scapulae' && /\b(?:head harness|side neck raise|neck.*flexion|cervical extension|neck isometric)\b/.test(name)) return 'isolation'
  if (target === 'biceps' && /\b(?:biceps hold|bent arm iso hold|21s)\b/.test(name)) return 'isolation'
  if (['quads','calves'].includes(target) && /\b(?:quadriceps contraction|pogo jump|toe (?:side )?walk|toe jump|calf.*jump)\b/.test(name)) return 'isolation'
  if (['abs','obliques'].includes(target) && /\b(?:cocoons|hanging pike|trainer pike|toes to bar|knees to elbows|leg pull in|pull in|abdominal fallout|shoulder tap|heel tap|crunchy frog|chop|woodchopper|leg cross|leg figure eight|toe touch|abdominal draw in|toe tap|ab swing|air cycles|air cycling|ab press|legs raise|side bent|isometric core)\b/.test(name)) return 'core'
  if (/\b(?:handstand hold|handstand walk|^handstand$|forearms stand|stalder press)\b/.test(name)) return 'push-v'
  if (/\b(?:planche|maltese)\b/.test(name)) return 'push-h'
  if (/\b(?:skin the cat|gorilla chin|side to side chin|climbing monkey bars)\b/.test(name)) return 'pull-v'
  if (/\b(?:lying prone (?:ys|a|w|y|t)|scapula retraction|seated (?:pulse )?back squeeze|mid back elbow squeeze)\b/.test(name)) return 'pull-h'
  if (/\b(?:shoulder (?:transverse )?(?:extension|flexion)|elbow flexion|thumb extension|finger(?:s)? (?:extension|flexion)|wrist flexion|thumb abduction|foot (?:eversion|inversion)|(?:eversion|inversion) foot|dorsi flexion|ankle dorsal flexion|squeezing toes|toes press|scapula elevation depression)\b/.test(name)) return 'isolation'
  if (/\b(?:lying pelvic (?:tilt|lift)|standing pelvic tilt|suspended abdominal|criss cross legs|lying neck pull|teaser|corkscrew|kneeling chop|seated forward roll up|lying leg hip side raise|arm slingers hanging|suitcase carry|suitcase walk|landmine (?:kneeling )?180s?|otis up)\b/.test(name)) return 'core'
  if (/\b(?:bear crawl|incline shoulder tap|decline shoulder tap|abdominal bracing|lying straight leg marches|lying hip side raise|shoulder taps?)\b/.test(name)) return 'core'
  if (/\b(?:cuban press|french press|pec dec|handboard half crimp|toe extensors?|tibialis flexion)\b/.test(name)) return 'isolation'
  if (/\b(?:pelvic lift|rolling bridge|tire flip)\b/.test(name)) return 'hinge'
  if (/\b(?:box jump|jump box|jump on fit box|jump from seated position|countermovement jump|depth jump|box drop jump)\b/.test(name)
    && ['quads','glutes','calves'].includes(target)) return 'squat'
  if (/\b(?:side kick|frog kick|hip side raise|leg half circle|glute march|kicks leg bent)\b/.test(name)
    && ['glutes','abductors','adductors'].includes(target)) return 'isolation'
  if (/\b(?:lateral walk|shoulder flexor|head twist|side lifting head|fingers press|serratus slide|lying chin tucks?|chin tuck|wrist rotation)\b/.test(name)
    && ['glutes','abductors','forearms','serratus anterior','levator scapulae'].includes(target)) return 'isolation'
  if (['abs','obliques','spine'].includes(target)
    && /\b(?:pulse up|rollover|roll up|rolling back|boomerang|leg pull front supported|leg pull side|pelvic tilt|side and front in out|lean back on a chair|kneeling thor lift|diagonal bend hold|hanging side lean|lateral bend|inchworm|swimming all fours)\b/.test(name)) return 'core'
  if (target === 'abs' && /^(bottoms up|flag|sideways lifts vertical)\b/.test(name)) return 'core'
  if (target === 'lats' && /\b(?:band skier|suspension power pull|cable twisting pull)\b/.test(name)) return /skier/.test(name) ? 'pull-v' : 'pull-h'
  if (target === 'quads' && /\b(?:duck walk|half knee bends?|step over box|stair up)\b/.test(name)) return /stair|step over/.test(name) ? 'lunge' : 'squat'
  if (target === 'triceps' && /\b(?:diamond press|pin presses|supine chest throw|cable (?:seating|standing) close press)\b/.test(name)) return 'push-h'
  if (['front delts','rear delts','abductors'].includes(target) && /\b(?:shoulder|hip) (?:medial|lateral) rotation\b/.test(name)) return 'isolation'
  if (target === 'abductors' && /\b(?:side lying leg circle|side lying scissors|outward knee kick)\b/.test(name)) return 'isolation'
  if (target === 'calves' && /\b(?:rotary calf|heel press)\b/.test(name)) return 'isolation'
  if (target === 'spine' && /\b(?:swan dive|prone press swan|old school reverse extensions|prone cobra)\b/.test(name)) return 'hinge'
  if (target === 'glutes' && /\b(?:kneeling hold to stand|duck walk|stand up high knee)\b/.test(name)) return 'lunge'
  if (target === 'levator scapulae' && /\b(?:flexion and extension neck|neck bridge|neck side to side)\b/.test(name)) return 'isolation'
  if (target === 'pectorals' && /\b(?:band punch|push with chair)\b/.test(name)) return 'push-h'
  return null
}

export function classify({ name, target, equipment }) {
  const fullName = name.toLowerCase().replace(/[-_]/g, ' ')
  const movement = fullName.split('(')[0].replace(/\bsnatch grip\b/g, '')
    .replace(/\s+(?:from|in) (?:a |the )?plank position\b.*$/, '').trim()
  const explicitLevel = fullName.match(/\((beginner|intermediate|advanced)\)/)?.[1]
  const rated = (level, pattern) => ({level: explicitLevel ?? level, pattern})
  // Named strength holds in mixed yoga entries have recognizable movement families.
  if (/\b(?:chair pose|revolved chair|utkatasana|prayer squat|garland pose)\b/.test(movement)) return rated('beginner', 'squat')
  if (/\b(?:warrior ii|warrior pose(?! iii)|humble warrior|low lunge yoga pose|twisted leg lunge pose)\b/.test(movement)) return rated('intermediate', 'lunge')
  if (/\b(?:chaturanga|four limbed staff)\b/.test(movement)) return rated('intermediate', 'push-h')
  if (/\b(?:boat yoga pose|half boat pose)\b/.test(movement)) return rated('intermediate', 'core')
  if (/\bbridge pose\b/.test(movement)) return rated('beginner', 'hinge')
  if (/\b(?:stretch(?:ing)?|massage|smr|pose|mobility|mobilization)\b/.test(fullName)
    || equipment === 'massage ball' || (equipment === 'roller' && /^roll /.test(movement))) return null
  if (/\bsit \(wall\)/.test(fullName)) return rated('beginner', 'squat')
  if (/^spine \(lumbar\) (?:lateral flexion|flexion|rotation)$/.test(fullName)) return rated('intermediate', 'core')
  const hipLegRaise = ['glutes', 'abductors', 'adductors'].includes(target)
    && /\bleg (?:raises?|lifts?)\b/.test(movement) && !/\bplank\b/.test(movement)
  if (/\bsnatch balance\b/.test(movement)) return rated('advanced', 'squat')
  if (target === 'abs' && /\bcurl ups?\b/.test(movement)) return rated('intermediate', 'core')
  const pattern = hipLegRaise ? 'isolation' : families.find(([, terms]) => terms.test(movement))?.[0] ?? targetedPattern(movement, target)
  if (!pattern) return null

  // Practice demand, not prescribed load or a claim of safety. Authored guides override every rule.
  let level = 'intermediate'
  if (/\b(?:planche|maltese|dragon flag|handstand|pistol squat|muscle up|front lever|back lever|snatch|jerk)\b/.test(movement)) level = 'advanced'
  else if (['leverage machine','sled machine','assisted'].includes(equipment)
    || /\b(?:supported|assisted|wall push up|kneeling push up)\b/.test(movement)
    || (pattern === 'isolation' && ['band','cable','body weight','dumbbell'].includes(equipment))) level = 'beginner'
  return rated(level, pattern)
}

export async function readCatalogue() {
  const rows = []
  for (const file of (await readdir(exerciseDir)).filter(name => name.endsWith('.json')).sort()) {
    const { id, variantOf, category, name, target, equipment } = JSON.parse(await readFile(new URL(file, exerciseDir), 'utf8'))
    rows.push({ id, variantOf, category, name, target, equipment })
  }
  return rows
}

export function seedLevels(rows) {
  const levels = {}
  const counts = Object.fromEntries(['strength','canonical','all'].map(key => [key, {total:0, matched:0}]))
  for (const row of rows.filter(row => !row.variantOf)) {
    const entry = EXERCISE_GUIDES[row.id] ?? classify(row)
    if (entry) levels[row.id] = { level:entry.level, pattern:entry.pattern }
    const groups = [counts.canonical]
    if (strengthEligible(row)) groups.push(counts.strength)
    for (const group of groups) {
      group.total++
      if (entry) group.matched++
    }
  }
  const ids = new Set(rows.filter(row => !row.variantOf).map(row => row.id))
  for (const {id,variantOf} of rows.filter(row => row.variantOf)) {
    if (!ids.has(variantOf)) throw new Error('Missing canonical exercise for ' + id)
    if (levels[variantOf]) levels[id] = levels[variantOf]
  }
  counts.all = {total:rows.length, matched:Object.keys(levels).length}
  return {levels,counts}
}

export function serialize(levels) {
  const groups = new Map()
  for (const [id, {level, pattern}] of Object.entries(levels).sort(([a],[b]) => a.localeCompare(b,'en'))) {
    if (!/^\d+$/.test(id)) throw new Error('Expected a numeric catalogue ID: ' + id)
    const key = level + ' ' + pattern
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(id)
  }
  const lines = [
    '// Generated by scripts/catalogue/seed-level.mjs. Unclassified IDs are absent.',
    'export const EXERCISE_LEVELS = {}',
    'function add(level, pattern, ids) {',
    "  for (const id of ids.trim().split(/\\s+/)) EXERCISE_LEVELS[id] = { level, pattern }",
    '}',
  ]
  for (const [key, ids] of [...groups].sort(([a],[b]) => a.localeCompare(b,'en'))) {
    const [level, pattern] = key.split(' ')
    lines.push('', 'add(' + JSON.stringify(level) + ', ' + JSON.stringify(pattern) + ', ' + '`')
    for (let i = 0; i < ids.length; i += 36) lines.push(ids.slice(i, i + 36).join(' '))
    lines.push('`)')
  }
  return lines.join('\n') + '\n'

}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const {levels,counts} = seedLevels(await readCatalogue())
  await writeFile(outputFile, serialize(levels))
  const aliases = {
    total: counts.all.total - counts.canonical.total,
    matched: counts.all.matched - counts.canonical.matched,
  }
  for (const [group, {matched, total}] of Object.entries({...counts, aliases})) {
    console.log(group + ': ' + matched + '/' + total + ' matched, ' + (total - matched) + ' unknown')
  }
}
