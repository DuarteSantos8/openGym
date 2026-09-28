import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import ptBR from '../instr/pt-BR.js'
import { EXDB } from './exercises-data.js'
import { INSTR_LANGS } from './i18n-core.js'

describe('Brazilian Portuguese exercise instructions', () => {
  const exercises = new Map(EXDB.map(exercise => [exercise.id, exercise]))
  const source = JSON.parse(readFileSync(new URL('../../../scripts/instruction-sources/pt-BR.json', import.meta.url), 'utf8'))

  test('matches the curated source and covers the complete exercise corpus', () => {
    expect(Object.keys(ptBR)).toHaveLength(EXDB.length)
    expect(ptBR).toEqual(source)
  })

  test('only enables pt-BR instructions when the pack is complete', () => {
    expect(INSTR_LANGS.includes('pt-BR')).toBe(Object.keys(ptBR).length === EXDB.length)
  })

  test('completes Stage 1 waist and core coverage', () => {
    const stage = EXDB.filter(exercise => exercise.bp === 'waist')
    expect(stage).toHaveLength(169)
    stage.forEach(exercise => expect(ptBR, exercise.id).toHaveProperty(exercise.id))
  })

  test('contains only known exercises with complete, non-empty step lists', () => {
    for (const [id, steps] of Object.entries(ptBR)) {
      const exercise = exercises.get(id)
      expect(exercise, `unknown exercise ${id}`).toBeDefined()
      expect(steps, id).toHaveLength(exercise.st.length)
      steps.forEach((step, index) => {
        expect(step.trim(), `${id} step ${index + 1}`).not.toBe('')
        expect(step, `${id} step ${index + 1}`).not.toBe(exercise.st[index])
        expect(step, `${id} step ${index + 1}`).not.toMatch(/(?:^|[^\p{L}])(?:the|your|with|from|towards?|repeat|desired|starting|slowly|hold|while|then|back|straight|ground|feet|hands|body|legs|arms|knees|shoulders)(?=$|[^\p{L}])/iu)
        expect(step, `${id} step ${index + 1}`).not.toMatch(/(?:^|[^\p{L}])(?:ginásio|anca|abdómen|gémeos|ecrã|core|banda|piso|omoplata|peso de mão|barra de elevações|pegada por cima|pegada invertida|pegada inversa|bola suíça)(?=$|[^\p{L}])/iu)
        expect(step, `${id} step ${index + 1}`).not.toMatch(/flexion\p{L}*\s+(?:a\s+|o\s+|os\s+|um\s+|uma\s+)?(?:barra|pesos?|halter(?:es)?|mão)(?=$|[^\p{L}])/iu)
      })
    }
  })

  test('does not replace kettlebells with dumbbells', () => {
    for (const exercise of EXDB) {
      exercise.st.forEach((step, index) => {
        if (/kettlebells?/iu.test(step)) {
          expect(ptBR[exercise.id][index], `${exercise.id} step ${index + 1}`).toMatch(/kettlebells?/iu)
        }
      })
    }
  })

  test('uses wrist extension for reverse wrist curls', () => {
    const reverseWristCurlIds = ['0079', '0082', '0104', '0210', '0224', '0358', '0367', '0368', '0385', '0771', '0994', '1441']
    reverseWristCurlIds.forEach(id => expect(ptBR[id].join(' '), id).toMatch(/estend\p{L}*(?: lentamente)? (?:o |os )?punhos?/iu))
  })
})
