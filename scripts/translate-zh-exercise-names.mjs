#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'scripts', 'exercise-name-sources', 'zh.json')
const glossaryPath = join(root, 'scripts', 'exercise-name-sources', 'GLOSSARY.zh.md')
const exercisesPath = join(root, 'frontend', 'src', 'lib', 'exercises-data.js')
const claude = process.env.CLAUDE_BIN || 'claude'
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const limit = Number(option('limit') || 1324)
const batchSize = Number(option('batch-size') || 80)
const apply = process.argv.includes('--apply')

if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error('limit and batch-size must be positive integers')
}

const existing = JSON.parse(readFileSync(sourcePath, 'utf8'))
const glossary = readFileSync(glossaryPath, 'utf8')
const { EXDB } = await import(pathToFileURL(exercisesPath))
const pending = EXDB.filter(exercise => !existing[exercise.id]).slice(0, limit)
const next = { ...existing }

for (let start = 0; start < pending.length; start += batchSize) {
  const batch = pending.slice(start, start + batchSize)
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
  const input = batch.map(({ id, n, bp, eq, tg }) => ({ id, english: n, bodyPart: bp, equipment: eq, target: tg }))
  const prompt = `Translate every exercise title below into concise, natural Simplified Chinese (zh-CN) for a gym app.

Rules:
- Return only the structured JSON required by the schema, with every ID exactly once and in input order.
- Return only the Chinese title in "name". Do not append or repeat the English title.
- Preserve exercise identity, equipment, stance, grip, direction, side, assisted/weighted status, (male)/(female) and version qualifiers.
- NO spaces between Chinese words: 杠铃卧推, never 杠铃 卧推.
- Use the terminology Chinese gyms actually use (卧推, 划船, 深蹲, 硬拉, 弯举, 臂屈伸, 飞鸟, 侧平举, 提踵, 卷腹, 引体向上, 俯卧撑) and the equipment terms in the glossary, which match the app's zh UI labels.
- Put the equipment first, then position and grip qualifiers, then the movement: 哑铃上斜卧推.
- Write qualifiers in full-width parentheses: （男）, （女）, （第2版）.
- Never start a name with a Latin capital letter: 曲杆杠铃, not EZ杆; 两头起, not V字起坐.
- Simplified characters only, no final full stop.
- Do not repair or reinterpret questionable source mechanics; translate the title faithfully.
- Use the metadata only to disambiguate the English title.

GLOSSARY:
${glossary}

INPUT:
${JSON.stringify(input)}`

  console.log(`Translating names ${start + 1}-${start + batch.length} of ${pending.length} (${batch[0].id}…${batch.at(-1).id})`)
  const result = spawnSync(claude, [
    '-p', '--model', 'sonnet', '--effort', 'high', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read',
    '--output-format', 'json', '--max-budget-usd', '2', '--json-schema', JSON.stringify(schema)
  ], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Claude exited ${result.status}`)
  const envelope = JSON.parse(result.stdout)
  if (envelope.is_error || !envelope.structured_output) throw new Error(envelope.result || 'Claude returned no structured output')
  const rows = envelope.structured_output.translations
  const received = new Map(rows.map(row => [row.id, row.name.trim()]))
  if (received.size !== batch.length) throw new Error('Claude returned duplicate or missing IDs')
  for (const exercise of batch) {
    const name = received.get(exercise.id)
    if (!name) throw new Error(`${exercise.id}: missing translated name`)
    next[exercise.id] = name
  }
  if (apply) {
    writeFileSync(sourcePath, JSON.stringify(next, null, 2) + '\n')
    console.log(`Checkpoint: ${Object.keys(next).length}/${EXDB.length} names`)
  }
}

if (!apply) console.log(`Validated ${pending.length} names. Re-run with --apply to update the source.`)
else console.log(`Updated ${sourcePath}: ${Object.keys(next).length}/${EXDB.length} names`)
