#!/usr/bin/env node
// Checks catalogue/ (run by CI on every pull request, and by build.mjs before it writes anything):
//
//   node scripts/catalogue/validate.mjs
//
// Problems are printed one per line as "<file>: <what is wrong>", so a contributor sees exactly
// which exercise to fix.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const list = s => s.split(',').map(x => x.trim()).filter(Boolean)

// The words the app filters, maps and translates. A new value needs app support first (a muscle
// the body map can draw, an equipment chip with a translation), so it is added here on purpose.
export const BODY_PARTS = list('back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs, waist, full body')
export const EQUIPMENT = list('body weight, dumbbell, cable, barbell, leverage machine, band, smith machine, kettlebell, weighted, stability ball, ez barbell, assisted, sled machine, medicine ball, rope, roller, resistance band, bosu ball, olympic barbell, wheel roller, upper body ergometer, skierg machine, hammer, stationary bike, tire, trap bar, elliptical machine, stepmill machine, suspension trainer, sandbag, landmine, weight plate, clubbell, macebell')
export const TARGETS = list('abs, pectorals, biceps, glutes, delts, triceps, upper back, lats, calves, quads, forearms, cardiovascular system, hamstrings, spine, traps, adductors, serratus anterior, abductors, levator scapulae')
export const SECONDARY = list('shoulders, deltoids, rear deltoids, rotator cuff, chest, upper chest, triceps, biceps, brachialis, forearms, wrists, wrist flexors, wrist extensors, grip muscles, back, upper back, lats, latissimus dorsi, rhomboids, trapezius, traps, lower back, core, abdominals, obliques, lower abs, hip flexors, glutes, quadriceps, hamstrings, adductors, inner thighs, groin, calves, soleus, shins, ankles, ankle stabilizers, feet, hands, sternocleidomastoid')
export const CATEGORIES = list('strength, stretching, mobility, plyometrics, cardio, olympic, calisthenics, pilates, yoga, combat, isometric, rehab')
export const MUSCLES = list('trapezius, deltoids, chest, upper-back, serratus, biceps, triceps, forearm, abs, obliques, lower-back, gluteal, quadriceps, hamstring, adductors, hip-flexors, calves, tibialis')
export const LANGS = list('ar, bn, de, es, fr, hi, hu, it, ko, pl, pt, pt-BR, ru, th, tr, uk, zh, zh-TW')
const KEYS = ['id', 'name', 'bodyPart', 'equipment', 'target', 'secondaryMuscles', 'category', 'description', 'instructions', 'muscleMap', 'femaleVariant', 'maleVariant', 'variantOf', 'textSource']
const I18N_KEYS = ['name', 'description', 'instructions']

export function validateCatalogue(dir) {
  const problems = []
  const exercises = []
  const exDir = path.join(dir, 'exercises')
  const say = (file, msg) => problems.push(`${file}: ${msg}`)
  const isText = s => typeof s === 'string' && s.trim() === s && s.length > 0
  for (const f of fs.readdirSync(exDir).sort()) {
    const file = 'catalogue/exercises/' + f
    if (!/^\d{4,5}\.json$/.test(f)) { say(file, 'file name must be the exercise id, e.g. 0001.json'); continue }
    let e
    try { e = JSON.parse(fs.readFileSync(path.join(exDir, f), 'utf8')) } catch (err) { say(file, 'not valid JSON: ' + err.message); continue }
    if (e.id !== f.slice(0, -5)) say(file, `"id" must be "${f.slice(0, -5)}"`)
    for (const k of Object.keys(e)) if (!KEYS.includes(k)) say(file, `unknown field "${k}"`)
    exercises.push(e)
    if (e.variantOf) continue // a drawing of another exercise: no text of its own
    if (!isText(e.name) || e.name !== e.name.toLowerCase()) say(file, '"name" must be lowercase text without surrounding spaces')
    if (!BODY_PARTS.includes(e.bodyPart)) say(file, `"bodyPart" must be one of: ${BODY_PARTS.join(', ')}`)
    if (!EQUIPMENT.includes(e.equipment)) say(file, `"equipment" must be one of: ${EQUIPMENT.join(', ')}`)
    if (!TARGETS.includes(e.target)) say(file, `"target" must be one of: ${TARGETS.join(', ')}`)
    if (!Array.isArray(e.secondaryMuscles) || e.secondaryMuscles.some(m => !SECONDARY.includes(m)))
      say(file, `"secondaryMuscles" must be a list of: ${SECONDARY.join(', ')}`)
    if (e.category != null && !CATEGORIES.includes(e.category)) say(file, `"category" must be one of: ${CATEGORIES.join(', ')}`)
    if (typeof e.description !== 'string') say(file, '"description" must be text (may be empty)')
    if (!Array.isArray(e.instructions) || e.instructions.some(s => !isText(s))) say(file, '"instructions" must be a list of steps (text)')
    if (e.textSource !== 'exercisedb') {
      // Text written for openGym follows the app's copy rules; the imported text is left as it came.
      const texts = [e.name, e.description, ...(e.instructions || [])]
      if (texts.some(s => typeof s === 'string' && s.includes('—'))) say(file, 'no em dash (—) in exercise text, use a comma or a full stop')
      if (!e.description) say(file, '"description" is empty')
      if ((e.instructions || []).length < 2) say(file, '"instructions" needs at least two steps')
    }
    if (e.muscleMap) {
      const m = e.muscleMap
      for (const k of ['primaries', 'secondaries']) if (m[k] && (!Array.isArray(m[k]) || m[k].some(x => !MUSCLES.includes(x)))) say(file, `"muscleMap.${k}" must list body-map muscles: ${MUSCLES.join(', ')}`)
      if (m.bodyPart && !BODY_PARTS.includes(m.bodyPart)) say(file, '"muscleMap.bodyPart" is not a body part')
      if (m.weights && Object.entries(m.weights).some(([k, v]) => !MUSCLES.includes(k) || typeof v !== 'number' || v < 0 || v > 1)) say(file, '"muscleMap.weights" maps body-map muscles to numbers from 0 to 1')
    }
  }
  const ids = new Map(exercises.map(e => [e.id, e]))
  for (const e of exercises) {
    const file = `catalogue/exercises/${e.id}.json`
    // A female drawing is either a hidden entry of this exercise ("variantOf") or, for two
    // exercises that both shipped before v1.4.0 and keep their own ids, the other one pointing back.
    const fem = e.femaleVariant && ids.get(e.femaleVariant)
    if (e.femaleVariant && fem?.variantOf !== e.id && fem?.maleVariant !== e.id) say(file, `"femaleVariant" ${e.femaleVariant} must be an entry with "variantOf": "${e.id}" or "maleVariant": "${e.id}"`)
    if (e.maleVariant && ids.get(e.maleVariant)?.femaleVariant !== e.id) say(file, `"maleVariant" ${e.maleVariant} must name this entry as its "femaleVariant"`)
    if (e.variantOf && ids.get(e.variantOf)?.femaleVariant !== e.id) say(file, `"variantOf" ${e.variantOf} must name this entry as its "femaleVariant"`)
  }
  const seen = new Map()
  for (const e of exercises) {
    if (e.variantOf || typeof e.name !== 'string') continue
    if (seen.has(e.name) && e.textSource !== 'exercisedb') say(`catalogue/exercises/${e.id}.json`, `name "${e.name}" is already used by ${seen.get(e.name)}`)
    else seen.set(e.name, e.id)
  }

  const i18n = {}
  const i18nDir = path.join(dir, 'i18n')
  for (const f of fs.readdirSync(i18nDir).filter(f => f.endsWith('.json')).sort()) {
    const lang = f.slice(0, -5)
    const file = 'catalogue/i18n/' + f
    if (!LANGS.includes(lang)) { say(file, `unknown language, expected one of: ${LANGS.join(', ')}`); continue }
    let rows
    try { rows = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8')) } catch (err) { say(file, 'not valid JSON: ' + err.message); continue }
    for (const [id, r] of Object.entries(rows)) {
      const ex = ids.get(id)
      if (!ex || ex.variantOf) { say(file, `"${id}" is not an exercise id`); continue }
      for (const k of Object.keys(r)) if (!I18N_KEYS.includes(k)) say(file, `"${id}": unknown field "${k}" (use ${I18N_KEYS.join(', ')})`)
      if (r.name != null && !isText(r.name)) say(file, `"${id}".name must be text`)
      if (r.description != null && typeof r.description !== 'string') say(file, `"${id}".description must be text`)
      if (r.instructions != null && (!Array.isArray(r.instructions) || r.instructions.some(s => !isText(s)))) say(file, `"${id}".instructions must be a list of steps`)
    }
    i18n[lang] = rows
  }
  return { exercises, i18n, problems }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../catalogue')
  const { exercises, problems } = validateCatalogue(dir)
  if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problem(s)`); process.exit(1) }
  console.log(`catalogue OK: ${exercises.length} entries`)
}
