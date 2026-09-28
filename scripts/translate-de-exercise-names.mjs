#!/usr/bin/env node
// Translates a stage of English exercise titles into German, in schema-validated, checkpointed
// batches. Mirrors translate-pt-br-exercise-names.mjs, with the rule check and correction loop
// translate-de-stage.mjs proved necessary; see exercise-name-sources/README.md.
//
//   node scripts/translate-de-exercise-names.mjs --equipment=dumbbell [--limit=40] [--apply]
//   node scripts/translate-de-exercise-names.mjs --ids=0025,1234 --max-retries=2
//
// Without --apply nothing is written: the batch is translated, checked and printed English
// beside German, which is the cheap way to judge a prompt or model change before a whole stage
// rides on it. Body-weight exercises are outside the staged set and are never offered here.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkName, promptGlossary, stagedExercises } from './de-name-rules.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'scripts', 'exercise-name-sources', 'de.json')
const exercisesPath = join(root, 'frontend', 'src', 'lib', 'exercises-data.js')
const claude = process.env.CLAUDE_BIN || 'claude'
const codex = process.env.CODEX_BIN || 'codex'

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const equipment = option('equipment')
// Named exercises, for re-running the handful a review rejected without touching the rest.
const ids = option('ids')?.split(',').map(id => id.trim()).filter(Boolean)
const provider = option('provider') || 'claude'
const limit = Number(option('limit') || (ids ? ids.length : 40))
const batchSize = Number(option('batch-size') || 40)
const maxRetries = Number(option('max-retries') ?? 2)
const apply = process.argv.includes('--apply')

if (!equipment && !ids) throw new Error('Usage: translate-de-exercise-names.mjs (--equipment=dumbbell|all | --ids=0025,1234) [--limit=40] [--batch-size=40] [--max-retries=2] [--provider=claude|codex] [--model=NAME] [--apply]')
if (equipment && ids) throw new Error('Pass --equipment or --ids, not both')
if (!['claude', 'codex'].includes(provider)) throw new Error('provider must be claude or codex')
const model = option('model') || (provider === 'claude' ? 'sonnet' : '')
if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error('limit and batch-size must be positive integers')
}

// The first stage of a language creates the source file; every later one extends it.
const translations = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, 'utf8')) : {}
const { EXDB } = await import(pathToFileURL(exercisesPath))
const staged = stagedExercises(EXDB)
const inStage = new Map(staged.map(exercise => [exercise.id, exercise]))

const selected = ids
  ? ids.map(id => {
      const exercise = inStage.get(id)
      // Loud, because a typo'd or body-weight ID would otherwise just shorten the sample silently.
      if (!exercise) throw new Error(`${id} is not in the staged equipment set (unknown, or body weight)`)
      return exercise
    })
  : equipment === 'all' ? staged : staged.filter(exercise => exercise.eq === equipment)

if (!selected.length) throw new Error(`No staged exercises for --equipment=${equipment}. Values are the catalogue's own, e.g. dumbbell, cable, barbell, "leverage machine".`)
const pending = selected.filter(exercise => !translations[exercise.id]).slice(0, limit)
const skipped = selected.length - selected.filter(exercise => !translations[exercise.id]).length
if (skipped) console.log(`Skipping ${skipped} of ${selected.length} selected: already in de.json.`)
if (!pending.length) {
  console.log('Everything selected is already translated.')
  process.exit(0)
}

const next = { ...translations }
// One request to whichever provider, returning the parsed { translations: [...] } envelope.
// Extracted so the caller can retry it with a correction prompt without duplicating any of it.
// Async like its sibling in translate-de-stage.mjs, so a provider that speaks HTTP rather than
// a subprocess slots in without turning the loop below inside out.
const requestStructured = async (prompt, batch) => {
  let structured
  const schema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array', minItems: batch.length, maxItems: batch.length,
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string', minLength: 1 } },
          required: ['id', 'name'], additionalProperties: false
        }
      }
    },
    required: ['translations'], additionalProperties: false
  }
  if (provider === 'claude') {
    const result = spawnSync(claude, [
      '-p', '--model', model, '--effort', 'high', '--no-session-persistence',
      '--permission-mode', 'dontAsk', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read',
      '--output-format', 'json', '--max-budget-usd', '2', '--json-schema', JSON.stringify(schema)
    ], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Claude exited ${result.status}`)
    const envelope = JSON.parse(result.stdout)
    if (envelope.is_error || !envelope.structured_output) throw new Error(envelope.result || 'Claude returned no structured output')
    structured = envelope.structured_output
  } else {
    const temp = mkdtempSync(join(tmpdir(), 'opengym-de-names-'))
    const schemaPath = join(temp, 'schema.json')
    const outputPath = join(temp, 'output.json')
    try {
      writeFileSync(schemaPath, JSON.stringify(schema))
      const result = spawnSync(codex, [
        'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
        '--sandbox', 'read-only', '--output-schema', schemaPath,
        '--output-last-message', outputPath, '-'
      ], { input: prompt, encoding: 'utf8', cwd: temp, maxBuffer: 16 * 1024 * 1024 })
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Codex exited ${result.status}`)
      structured = JSON.parse(readFileSync(outputPath, 'utf8'))
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
  return structured
}

for (let start = 0; start < pending.length; start += batchSize) {
  const batch = pending.slice(start, start + batchSize)
  const input = batch.map(({ id, n, bp, eq, tg }) => ({ id, english: n, bodyPart: bp, equipment: eq, target: tg }))
  const basePrompt = `Translate every exercise title below into concise, natural German for a gym app.

Rules:
- Return only the structured JSON required by the schema, with every ID exactly once and in input order.
- Return only the German title in "name". Do not append, repeat or bracket the English title — the app shows it itself.
- A title is a noun phrase, not a sentence: no final full stop, and German noun capitalisation ("Bankdrücken mit Langhantel", "Rudern am Kabelzug").
- Capitalise the first word whatever it is. A leading adjective is capitalised here even though German would lowercase it mid-sentence: "Abwechselnder Latzug am Kabelzug", "Assistierter Klimmzug an der Hebelmaschine". Every LATER adjective stays lowercase: "Assistiertes hängendes Knieheben", never "Assistiertes Hängendes Knieheben".
- Name the movement first and put the equipment in a trailing phrase, or join it into one hyphenated compound. Do NOT copy the English order, which leads with the equipment. "dumbbell incline one arm fly" is "Einarmige Fliegende auf der Schrägbank mit Kurzhantel" or "Einarmige Schrägbank-Fliegende mit Kurzhantel" — never "Kurzhantel Schrägbank einarmige Fliegende". German joins nouns with a hyphen or a preposition; it does not stack them with spaces.
- Preserve exercise identity: equipment, stance, grip, direction, side, assisted/weighted status and version qualifiers all distinguish one catalogue entry from another.
- Prefer established German gym terminology (Bankdrücken, Kniebeuge, Kreuzheben, Rudern, Latzug, Klimmzug, Liegestütz, Ausfallschritt, Wadenheben, Beinpresse, Fliegende, Nackendrücken).
- Use standard German ß (Gesäß, Fuß), not the Swiss ss — the app derives the Swiss spelling from this pack.
- Avoid unnecessary anglicisms: no Glutes, Hamstrings, Core. Established loanwords such as Kettlebell, Burpee, Crunch and Plank are fine.
- Do not repair or reinterpret questionable source mechanics; translate the title faithfully.
- Use the metadata only to disambiguate the English title.

TERMINOLOGY:
${promptGlossary()}

INPUT:
${JSON.stringify(input)}`

  console.log(`Translating names ${start + 1}-${start + batch.length} of ${pending.length} with ${provider} (${batch[0].id}…${batch.at(-1).id})`)

  // Validate and retry. The rules are the ones CI enforces (scripts/de-name-rules.mjs), so
  // checking them here turns a failure discovered hours later into a correction the model can act
  // on while it still has the batch in hand. A batch that cannot be fixed is never written.
  let prompt = basePrompt
  let accepted
  // A name that has passed the rules once is kept, and the model is never asked for it again.
  // Without this the loop oscillates: told only about what is broken *now*, the model rewrites
  // the batch from scratch and silently reverts the corrections it made on the previous attempt,
  // so a batch can fail after three attempts having had every name clean at some point in them.
  const pinned = new Map()
  for (let attempt = 0; ; attempt++) {
    const structured = await requestStructured(prompt, batch)
    const received = new Map(structured.translations.map(row => [row.id, row.name.trim()]))
    if (received.size !== batch.length) throw new Error(`${provider} returned duplicate or missing IDs`)
    for (const [id, name] of pinned) received.set(id, name)

    const problems = []
    for (const exercise of batch) {
      const name = received.get(exercise.id)
      if (!name) throw new Error(`${exercise.id}: missing translated name`)
      const broken = checkName(exercise, name)
      if (broken.length) problems.push({ id: exercise.id, name, broken })
      else pinned.set(exercise.id, name)
    }

    if (!problems.length) {
      accepted = received
      if (attempt) console.log(`  clean after ${attempt} correction${attempt > 1 ? 's' : ''}`)
      break
    }

    const summary = problems.map(p => `    ${p.id}: ${p.broken.map(v => v.rule).join(', ')}\n      ${p.name}`).join('\n')
    if (attempt >= maxRetries) {
      throw new Error(`${problems.length} rule violation(s) still present after ${maxRetries + 1} attempts:\n${summary}`)
    }
    console.log(`  ${problems.length} violation(s), correcting (${attempt + 1}/${maxRetries}):\n${summary}`)

    // Only the broken names are quoted back. Re-sending the whole batch as "wrong" invites the
    // model to rewrite names that were already fine, which loses good work and breaks other rules.
    // The settled names are still listed, because a model that is not shown them invents new ones
    // for those IDs — harmless now that they are pinned, but it spends the batch's attention on
    // work that will be discarded instead of on the names that are actually still wrong.
    const settled = [...pinned].map(([id, name]) => `- ${id}: ${JSON.stringify(name)}`).join('\n')
    prompt = `${basePrompt}
${settled ? `\nThese names are already accepted. Return them back exactly as they are:\n${settled}\n` : ''}
Your previous answer broke these rules. Return the FULL JSON for every ID again, changing only the names listed here:
${problems.map(p => `- ${p.id} was: ${JSON.stringify(p.name)}\n${p.broken.map(v => `  ${v.fix}`).join('\n')}`).join('\n')}`
  }

  for (const exercise of batch) next[exercise.id] = accepted.get(exercise.id)
  if (apply) {
    writeFileSync(sourcePath, JSON.stringify(next, null, 2) + '\n')
    console.log(`Checkpoint: ${Object.keys(next).length}/${staged.length} names`)
  }
}

if (!apply) {
  // A dry run exists to be read: a bare count leaves nothing to judge a new model or a changed
  // prompt by, which is the whole reason for running without --apply.
  for (const exercise of pending) console.log(`\n${exercise.id}\n  EN  ${exercise.n}\n  DE  ${next[exercise.id]}`)
  console.log(`\nValidated ${pending.length} names. Re-run with --apply to update ${sourcePath}.`)
  process.exit(0)
}

console.log(`Updated ${sourcePath}: ${Object.keys(next).length}/${staged.length} names`)
