#!/usr/bin/env node
// Builds catalogue/photos/: start and end drawings for catalogue exercises from Everkinetic
// (https://github.com/everkinetic/data, Greg Priday's drawings, CC BY-SA 4.0), matched by name and
// equipment, resized, with the licence and author kept for every file. A maintainer step, run by
// hand; the app never contacts Everkinetic or GitHub.
//
//   npm i --no-save sharp                                      (once, at the repository root)
//   node scripts/catalogue/everkinetic-pictures.mjs
//
// Why Everkinetic and nothing else (so far): its drawings have one known author and a free licence
// from the source. Pictures elsewhere were left out because their origin could not be established:
// free-exercise-db (its maintainer does not know where its images come from; some were traced to
// ExRx.net) and community uploads to wger (wger's maintainers say many are probably not the
// uploader's to give). Matching is exact on words: a wrong picture is worse than none.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CAT = path.join(ROOT, 'catalogue/exercises')
const OUT = path.join(ROOT, 'catalogue/photos')
const RAW = 'https://raw.githubusercontent.com/everkinetic/data/main/'
const BLOB = 'https://github.com/everkinetic/data/blob/main/'
export const AUTHOR = 'Greg Priday (Everkinetic)'
export const LICENSE = 'CC-BY-SA-4.0'
export const POSES = [['relaxation', 'start'], ['tension', 'end']]

const SYN = { db: 'dumbbell', dumbbells: 'dumbbell', bb: 'barbell', kb: 'kettlebell', ez: 'ezbar', sz: 'ezbar', szbar: 'ezbar',
  pullup: 'pull up', pushup: 'push up', situp: 'sit up', chinup: 'chin up', bodyweight: '', lever: 'machine', leverage: 'machine',
  biceps: 'bicep', triceps: 'tricep', abs: 'ab' }
const STOP = new Set(['with', 'on', 'the', 'a', 'an', 'of', 'to', 'and', 'in', 'at', 'using', 'for'])
const stem = w => w.length > 4 && /(ss|sh|ch|x)es$/.test(w) ? w.slice(0, -2) : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w
export const words = s => String(s || '').toLowerCase().replace(/[()/,.'"]/g, ' ').split(/[\s-]+/).filter(Boolean)
  .flatMap(w => (SYN[w] ?? w).split(' ')).filter(w => w && !STOP.has(w)).map(stem)
const key = ws => [...new Set(ws)].sort().join(' ')
const SRC_EQ = { barbell: 'barbell', dumbbell: 'dumbbell', dumbbells: 'dumbbell', kettlebell: 'kettlebell', 'ez-bar': 'ezbar', 'ez bar': 'ezbar', cable: 'cable', band: 'band' }
const CAT_EQ = { 'body weight': '', 'ez barbell': 'ezbar', 'leverage machine': 'machine' }

/** Catalogue lookup by word key; female drawings (`femaleVariant` targets) are pictures, not exercises. */
export function catalogueIndex(cat) {
  const female = new Set(cat.map(c => c.femaleVariant).filter(Boolean))
  const byKey = new Map()
  for (const c of cat) {
    if (female.has(c.id)) continue
    const eq = words(CAT_EQ[c.equipment] ?? c.equipment)
    for (const k of new Set([key(words(c.name)), key([...words(c.name), ...eq])])) {
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(c.id)
    }
  }
  return byKey
}

// Everkinetic id_num -> catalogue id, for names the exact matcher cannot pair. Each one was checked
// by hand: same movement, position and equipment (Everkinetic title -> catalogue name). Left out on
// purpose: anything with two plausible catalogue entries (Machine Bench Press, Leg Press, Bench
// Dips, ...) or a different variant (Incline Fly with a Twist, Decline Oblique Crunch, ...).
export const ALIASES = {
  '0004': '0091', // Seated Military Press -> barbell seated overhead press
  '0005': '0406', // Shoulder Shrugs [dumbbell] -> dumbbell shrug
  '0009': '0220', // Cable Shoulder Shrugs -> cable shrug
  '0021': '0620', // Flat Bench Leg Raises -> lying leg raise flat bench
  '0022': '0762', // Smith Machine Rear Deltoid Row -> smith rear delt row
  '0024': '0377', // Rear Deltoid Row Dumbbell -> dumbbell rear delt row_shoulder
  '0028': '0076', // Rear Deltoid Row Barbell -> barbell rear delt row
  '0029': '0606', // T-Bar Rows [t-bar machine] -> lever t bar row
  '0034': '5088', // Internal Cable Rotation -> cable shoulder internal rotation
  '0041': '0767', // Smith Machine Shoulder Shrugs -> smith shrug
  '0048': '0227', // Cable Crossover -> cable standing fly
  '0053': '0302', // Decline Dumbbell Fly's -> dumbbell decline fly
  '0057': '0185', // Flat Bench Cable Flys -> cable lying fly
  '0059': '0321', // Hammer Grip Incline Bench Press [dumbbells] -> dumbbell incline hammer press
  '0060': '0171', // Incline Cable Fly's -> cable incline fly
  '0062': '0319', // Incline Dumbbell Fly's -> dumbbell incline fly
  '0069': '0653', // Bosu Ball Push Up -> push-up (bosu ball)
  '0071': '1285', // One Arm Flat Bench Fly's -> dumbbell one arm bench fly
  '0075': '0279', // Push Up with Feet Elevated -> decline push-up
  '0080': '0314', // Incline Dumbbell Press -> dumbbell incline bench press
  '0082': '0122', // Wide Grip Bench Press [barbell] -> barbell wide bench press
  '0083': '0036', // Wide Grip Decline Bench Press -> barbell decline wide-grip press
  '0085': '1300', // Decline Chest Press [machine] -> lever decline chest press
  '0091': '8189', // Wide Grip Chin Up -> wide chin up
  '0092': '0238', // Straight Arm Push Down [cable] -> cable straight arm pulldown
  '0093': '0245', // Underhand Pull downs -> cable underhand pulldown
  '0098': '1295', // Pullover On Stability Ball With Weight -> dumbbell pullover on exercise ball
  '0099': '0032', // Barbell Dead Lifts -> barbell deadlift
  '0100': '0752', // Smith Machine Dead Lifts -> smith deadlift
  '0104': '1314', // Back Extension on Stability Ball -> back extension on exercise ball
  '0107': '0300', // Dumbbell Dead Lifts -> dumbbell deadlift
  '0112': '0860', // One Legged Cable Kickback -> cable kickback
  '0118': '0085', // Romanian Dead Lift -> barbell romanian deadlift
  '0119': '0599', // Seated Leg Curl [machine] -> lever seated leg curl
  '0120': '4347', // Standing Leg Curls [machine] -> lever standing leg curl
  '0139': '0024', // Front Squat to Bench with Barbells -> barbell bench front squat
  '0142': '0585', // Leg Extensions [machine] -> lever leg extension
  '0144': '0744', // Lying Squat [machine] -> sled lying squat
  '0156': '0597', // Thigh Abductor [machine] -> lever seated hip abduction
  '0157': '0598', // Thigh Adductor [machine] -> lever seated hip adduction
  '0158': '0851', // Weighted Sissy Squat with Weight Plate -> weighted sissy squat
  '0160': '0124', // Wide Stance Squat with Barbell -> barbell wide squat
  '0168': '0035', // Decline Close Grip Bench to Skull Crusher -> barbell decline close grip to skull press
  '0172': '0814', // Tricep Dips using Body Weight -> triceps dip
  '0174': '4344', // Incline Triceps Extension with Barbell -> barbell incline triceps extension skull crusher
  '0175': '0052', // JM Press -> barbell jm bench press
  '0179': '1720', // Lying Close-Grip Triceps Extension Behind the Head -> barbell lying back of the head tricep extension
  '0182': '0337', // Lying Triceps Extension Across Face with Dumbbell -> dumbbell lying extension (across face)
  '0183': '0061', // Lying Triceps Press with Barbell -> barbell lying triceps extension
  '0184': '0351', // Lying Two Arm Triceps Extension with Dumbbell -> dumbbell lying triceps extension
  '0186': '0344', // Single Arm Pronated Triceps Extension -> dumbbell lying one arm pronated triceps extension
  '0187': '0346', // Single Arm Supinated Triceps Extension -> dumbbell lying one arm supinated triceps extension
  '0188': '0259', // Close Triceps Pushup -> close-grip push-up
  '0189': '0207', // Reverse Grip Triceps Pushdown -> cable reverse-grip pushdown
  '0191': '6158', // Seated One Arm Triceps Extension with Dumbbell -> dumbbell seated single arm overhead triceps extension
  '0192': '2188', // Seated Two-Arm Triceps Extension with Dumbbell -> dumbbell seated triceps extension
  '0196': '1740', // Bent-Over One Arm Triceps Extension -> dumbbell standing bent over one arm triceps extension
  '0197': '1741', // Bent-Over Two Arm Triceps Extension -> dumbbell standing bent over two arm triceps extension
  '0202': '0018', // Standing Triceps Extension with Towel -> assisted standing triceps extension (with towel)
  '0204': '0333', // Triceps Kickback with Dumbbell -> dumbbell kickback
  '0206': '0200', // Triceps Pushdown with Rope and Cable -> cable pushdown (with rope attachment)
  '0207': '0241', // Triceps Pushdown with V Bar and Cable -> cable triceps pushdown (v-bar)
  '0208': '0850', // Weighted Ball Side Bend -> weighted side bend (on stability ball)
  '0211': '0031', // Biceps Curls with Barbell -> barbell curl
  '0212': '0868', // Standing Biceps Curl with Cable -> cable curl
  '0213': '0313', // Alternating Hammer Curl with Dumbbell -> dumbbell hammer curl
  '0214': '0318', // Alternating Incline Curl with Dumbbell -> dumbbell incline curl
  '0219': '0106', // Close Grip Standing Biceps Curls with Barbell -> barbell standing close grip curl
  '0223': '0285', // Alternating Bicep Curl with Dumbbell -> dumbbell alternate biceps curl
  '0225': '0374', // Prone Incline Biceps Curl with Dumbbell -> dumbbell prone incline curl
  '0226': '0447', // EZ Bar Curl -> ez barbell curl
  '0233': '0181', // Lying Close Grip Biceps Curls with Cable -> cable lying close grip curl
  '0237': '3084', // One Arm Preacher Curl with Dumbbell -> dumbbell single arm preacher curl
  '0247': '0190', // Standing One Arm Bicep Curl with Cable -> cable one arm curl
  '0248': '0422', // Standing One Arm Curl Over Incline Bench -> dumbbell standing one arm curl (over incline bench)
  '0253': '0575', // Bicep Curl with Machine -> lever bicep curl
  '0258': '0353', // One Arm Bicep Concentration on Stability Ball -> dumbbell one arm concentration curl (on stability ball)
  '0261': '0968', // Quick Alternating Biceps Curls with Band -> band alternating biceps curl
  '0263': '1652', // Bicep Curl on Stability Ball with Leg Raised -> dumbbell bicep curl on exercise ball with leg raised
  '0265': '1658', // Forward Lunge with Bicep Curl using Dumbbell -> dumbbell lunge with bicep curl
  '0269': '1656', // Biceps Curl V Sit on Dome with Dumbbells -> dumbbell biceps curl v sit on bosu ball
  '0272': '0088', // Seated Calf Raise with Barbell -> barbell seated calf raise
  '0277': '0257', // Knee Circles -> circles knee stretch
  '0278': '0111', // Rocking Standing Calf Raise with Barbell -> barbell standing rocking leg calf raise
  '0280': '0763', // Smith Machine Reverse Calf Raises -> smith reverse calf raises
  '0288': '0212', // Seated Ab Crunch with Cable -> cable seated crunch
  '0291': '0274', // Crunches -> crunch floor
}

/** The catalogue id an Everkinetic exercise maps to, or null. An ambiguous name maps to nothing. */
export function matchOne(e, byKey) {
  if (e.id_num && ALIASES[e.id_num]) return ALIASES[e.id_num]
  const eq = (e.equipment || []).map(q => SRC_EQ[String(q).toLowerCase()]).filter(Boolean).flatMap(words)
  for (const k of [key(words(e.title)), key([...words(e.title), ...eq])]) {
    const hit = byKey.get(k)
    if (hit && hit.length === 1) return hit[0]
    if (hit && hit.length > 1) return null
  }
  return null
}

/** NOTICE.md: what these files are, their licence, the change made, and one line per file. */
export function notice(index, cat) {
  const names = Object.fromEntries(cat.map(c => [c.id, c.name]))
  const rows = Object.entries(index).flatMap(([id, ps]) => ps.map(p => `| ${id} ${names[id] || ''} | \`${p.f}\` | ${p.pose} | ${p.source} |`))
  return `# Extra exercise pictures (Everkinetic)

Start and end drawings by **${AUTHOR}**, from https://github.com/everkinetic/data, licensed
**CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/). They are **not** covered by
openGym's AGPL, and not by the Gym visual licence of \`catalogue/media/\`. The app shows the author
and licence with every picture.

**Changes:** every drawing was resized to fit 480×480 px and re-encoded as WebP. These resized
versions are shared under the same licence, CC BY-SA 4.0.

Generated by \`scripts/catalogue/everkinetic-pictures.mjs\`. An exercise only gets pictures when its
name and equipment reduce to exactly the same words as an Everkinetic exercise, or through an alias
checked by hand (same movement, position and equipment); an ambiguous name gets none.

Pictures from other sources were left out because their origin could not be established:
free-exercise-db (its maintainer does not know where its images come from, see
[free-exercise-db#2](https://github.com/yuhonas/free-exercise-db/issues/2) and
[#13](https://github.com/yuhonas/free-exercise-db/issues/13)) and community uploads to wger
([wger#2196](https://github.com/wger-project/wger/issues/2196)).

| Catalogue exercise | File | Pose | Source |
|---|---|---|---|
${rows.join('\n')}
`
}

async function main() {
  let sharp
  try { sharp = (await import('sharp')).default } catch {
    console.error('needs sharp to resize the pictures: run `npm i --no-save sharp` at the repository root first')
    process.exit(1)
  }
  const ek = await (await fetch(RAW + 'exercises.json')).json()
  const cat = fs.readdirSync(CAT).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(CAT, f), 'utf8')))
  const byKey = catalogueIndex(cat)
  const index = {}
  let missing = 0
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT, 'files'), { recursive: true })
  // Exact matches claim their catalogue exercise first; an alias only fills an exercise left open.
  const viaAlias = e => Boolean(e.id_num && ALIASES[e.id_num])
  for (const e of [...ek.filter(x => !viaAlias(x)), ...ek.filter(viaAlias)]) {
    const id = matchOne(e, byKey)
    if (!id || index[id]) continue
    const pics = []
    for (const [file, pose] of POSES) {
      const src = `dist/png/${e.id_num}-${file}.png`
      const res = await fetch(RAW + src)
      if (!res.ok) { pics.length = 0; missing++; break }
      const out = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).webp({ quality: 80 }).toBuffer()
      const f = `files/${e.id_num}-${file}.webp`
      fs.writeFileSync(path.join(OUT, f), out)
      pics.push({ f, pose, license: LICENSE, author: AUTHOR, source: BLOB + src })
    }
    if (pics.length === POSES.length) index[id] = pics
  }
  const ids = Object.keys(index).sort()
  const sorted = Object.fromEntries(ids.map(k => [k, index[k]]))
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(sorted, null, 1) + '\n')
  fs.writeFileSync(path.join(OUT, 'NOTICE.md'), notice(sorted, cat))
  for (const f of fs.readdirSync(path.join(OUT, 'files'))) if (!ids.some(k => index[k].some(p => p.f === 'files/' + f))) fs.rmSync(path.join(OUT, 'files', f))
  console.log(`pictures: ${ids.length * POSES.length} for ${ids.length} catalogue exercises (${missing} matched without drawings)`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
