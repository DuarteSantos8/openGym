#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'scripts', 'instruction-sources', 'pt-BR.json')
const glossaryPath = join(root, 'scripts', 'instruction-sources', 'GLOSSARY.md')
const exercisesPath = join(root, 'frontend', 'src', 'lib', 'exercises-data.js')
const claude = process.env.CLAUDE_BIN || 'claude'
const codex = process.env.CODEX_BIN || 'codex'
const stageOrder = ['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'cardio', 'neck']

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const bodyPart = option('body-part')
const provider = option('provider') || 'claude'
const limit = Number(option('limit') || 10)
const batchSize = Number(option('batch-size') || 10)
const apply = process.argv.includes('--apply')

if (!bodyPart) throw new Error('Usage: translate-pt-br-stage.mjs --body-part=waist|all [--limit=10] [--batch-size=10] [--apply]')
if (!['claude', 'codex'].includes(provider)) throw new Error('provider must be claude or codex')
if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error('limit and batch-size must be positive integers')
}

const translations = JSON.parse(readFileSync(sourcePath, 'utf8'))
const glossary = readFileSync(glossaryPath, 'utf8')
const { EXDB } = await import(pathToFileURL(exercisesPath))
const requestedParts = bodyPart === 'all' ? stageOrder : [bodyPart]
const pending = requestedParts
  .flatMap(part => EXDB.filter(exercise => exercise.bp === part && !translations[exercise.id]))
  .slice(0, limit)

if (!pending.length) {
  console.log(`No untranslated ${bodyPart} exercises remain.`)
  process.exit(0)
}

const next = { ...translations }
for (let start = 0; start < pending.length; start += batchSize) {
  const batch = pending.slice(start, start + batchSize)
  const schema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array', minItems: batch.length, maxItems: batch.length,
        items: {
          oneOf: batch.map(exercise => ({
            type: 'object',
            properties: {
              id: { const: exercise.id },
              steps: { type: 'array', minItems: exercise.st.length, maxItems: exercise.st.length, items: { type: 'string', minLength: 1 } }
            },
            required: ['id', 'steps'], additionalProperties: false
          }))
        }
      }
    },
    required: ['translations'], additionalProperties: false
  }
  const input = batch.map(({ id, n, st }) => ({ id, name: n, steps: st }))
  const prompt = `Translate every instruction step below from English into natural Brazilian Portuguese for a fitness app.

Rules:
- Return only the structured JSON required by the schema, with every ID exactly once and in input order.
- Preserve the exact number, order, movement meaning and safety cues of the English steps.
- Use Brazilian você conventions and neutral imperatives: mantenha, contraia, eleve, retorne.
- Follow the glossary. In particular, translate "engage your core/abs" as "contraia o abdômen", never "ative o core".
- Do not use Portuguese (Portugal) wording. Do not add explanations or repair source mechanics.
- Translate only instruction steps; IDs remain unchanged.

GLOSSARY:
${glossary}

INPUT:
${JSON.stringify(input)}`

  console.log(`Translating ${start + 1}-${start + batch.length} of ${pending.length} with ${provider} (${batch[0].id}…${batch.at(-1).id})`)
  let structured
  if (provider === 'claude') {
    const result = spawnSync(claude, [
      '-p', '--model', 'sonnet', '--effort', 'high', '--no-session-persistence',
      '--permission-mode', 'dontAsk', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read',
      '--output-format', 'json', '--max-budget-usd', '2', '--json-schema', JSON.stringify(schema)
    ], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Claude exited ${result.status}`)
    const envelope = JSON.parse(result.stdout)
    if (envelope.is_error || !envelope.structured_output) throw new Error(envelope.result || 'Claude returned no structured output')
    structured = envelope.structured_output
  } else {
    const temp = mkdtempSync(join(tmpdir(), 'opengym-pt-br-'))
    const schemaPath = join(temp, 'schema.json')
    const outputPath = join(temp, 'output.json')
    const codexSchema = {
      type: 'object',
      properties: {
        translations: {
          type: 'array', minItems: batch.length, maxItems: batch.length,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } }
            },
            required: ['id', 'steps'], additionalProperties: false
          }
        }
      },
      required: ['translations'], additionalProperties: false
    }
    try {
      writeFileSync(schemaPath, JSON.stringify(codexSchema))
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

  const rows = structured.translations
  const received = new Map(rows.map(row => [row.id, row.steps]))
  if (received.size !== batch.length) throw new Error(`${provider} returned duplicate or missing IDs`)
  for (const exercise of batch) {
    const steps = received.get(exercise.id)
    if (!steps || steps.length !== exercise.st.length) throw new Error(`${exercise.id}: invalid step count`)
    next[exercise.id] = steps
  }
  if (apply) {
    writeFileSync(sourcePath, JSON.stringify(next, null, 2) + '\n')
    console.log(`Checkpoint: ${Object.keys(next).length}/${EXDB.length} exercises`)
  }
}

if (!apply) {
  console.log(`Validated ${pending.length} translations. Re-run with --apply to update ${sourcePath}.`)
  process.exit(0)
}

console.log(`Updated ${sourcePath}: ${Object.keys(next).length}/${EXDB.length} exercises`)
