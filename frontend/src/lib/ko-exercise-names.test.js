import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ko from '../exercise-names/ko.js'
import { EXDB } from './exercises-data.js'
import { EXERCISE_NAME_LANGS, CASED_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText, exerciseNameClass } from './i18n-core.js'
const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/ko.json', import.meta.url), 'utf8'))
const bench = EXDB.find(e => e.id === '0025')
describe('Korean exercise names', () => {
  afterEach(() => _setLangState('en', {}, null, null))
  test('matches the source and exactly the 1324 built-in IDs', () => {
    expect(EXDB).toHaveLength(1324)
    expect(Object.keys(ko).sort()).toEqual(EXDB.map(e => e.id).sort())
    expect(ko).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('ko')
    expect(CASED_NAME_LANGS).toContain('ko')
    for (const e of EXDB) expect(ko[e.id]?.trim(), e.id).toBeTruthy()
  })
  test('uses natural gym terms and Korean modifier order', () => {
    expect(ko['0314']).toBe('인클라인 덤벨 벤치프레스')
    expect(ko['0027']).toBe('벤트오버 바벨 로우')
    expect(ko['0586']).toBe('라잉 머신 레그 컬')
    expect(ko['0662']).toBe('푸시업')
    expect(ko['0735']).toBe('윗몸일으키기 버전 2')
  })
  test('preserves reviewed names, solid compounds and angle notation', () => {
    const fixed = {
      '2330': '케이블 랫풀다운 (풀 레인지)',
      '0238': '케이블 스트레이트 암 풀다운',
      '0507': '잭나이프 싯업',
      '0739': '45도 레그프레스',
      '0738': '45도 카프 프레스',
      '0316': '인클라인 덤벨 브리딩',
      '0039': '바벨 프론트 체스트 스쿼트',
    }
    for (const [id, name] of Object.entries(fixed)) expect(ko[id]).toBe(name)
    for (const name of Object.values(ko)) expect(name).not.toMatch(/벤치 프레스|숄더 프레스|레그 프레스|체스트 프레스|45°/)
  })
  test('allows shared Korean names only for normalized upstream duplicates', () => {
    const normalize = name => (name.toLowerCase().match(/[a-z0-9]+/g) || [])
      .map(word => word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word).join(' ')
    expect(normalize('Dumbbells close-grip press!')).toBe(normalize('dumbbell close grip press'))
    const collisions = names => {
      const groups = new Map()
      for (const ex of EXDB) {
        const group = groups.get(names[ex.id]) || []
        group.push(ex)
        groups.set(names[ex.id], group)
      }
      return [...groups.values()].filter(group => new Set(group.map(ex => normalize(ex.n))).size > 1)
    }
    expect(collisions(ko).map(group => group.map(ex => ex.id))).toEqual([])
    // A fly/breeding merger must be caught, even if every ID remains covered.
    expect(collisions({ ...ko, '0316': ko['0319'] }).some(group => group.some(ex => ex.id === '0316'))).toBe(true)
  })
  test('preserves identity-changing qualifiers and equipment in every applicable name', () => {
    const rules = [
      [/assisted/i, /어시스티드/], [/weighted/i, /중량/],
      [/\bmale\b/i, /남성/], [/\bfemale\b/i, /여성/],
      [/\bdumbbells?\b/i, /덤벨/], [/\bkettlebell\b/i, /케틀벨/],
      [/\bsmith\b/i, /스미스 머신/], [/\bcable\b/i, /케이블/],
      [/\bband\b/i, /밴드/], [/\b(?:exercise|stability) ball\b/i, /짐볼/],
      [/\bmedicine ball\b/i, /메디신볼/], [/\bbosu ball\b/i, /보수볼/],
      [/\b(?:one arm|single arm|one hand)\b/i, /원암/],
      [/\b(?:one leg|single leg|one legged)\b/i, /싱글 레그|한발/],
      [/\bclose[- ]grip\b/i, /클로즈 그립/], [/\bwide[- ]grip\b/i, /와이드 그립/],
      [/\breverse[- ]grip\b/i, /리버스 그립/],
      [/\bv\. 2\b/i, /버전 2/], [/\bv\. 3\b/i, /버전 3/],
      [/\bincline\b/i, /인클라인/], [/\bdecline\b/i, /디클라인/],
    ]
    for (const e of EXDB) for (const [en, target] of rules) {
      if (en.test(e.n)) expect(ko[e.id], `${e.id}: ${e.n}`).toMatch(target)
    }
  })
  test('keeps bilingual display, both switches, bilingual search and exact letter casing', () => {
    _setLangState('ko', {}, null, ko)
    expect(exerciseNameFor(bench)).toBe(`바벨 벤치프레스 (${bench.n})`)
    expect(exerciseNameSearchText(bench)).toContain('바벨 벤치프레스')
    expect(exerciseNameSearchText(bench)).toContain(bench.n)
    expect(exerciseNameClass(bench)).toBe('')
    _setLangState('ko', {}, null, ko, false)
    expect(exerciseNameFor(bench)).toBe('바벨 벤치프레스')
    _setLangState('ko', {}, null, ko, true, true)
    expect(exerciseNameFor(bench)).toBe(bench.n)
    expect(exerciseNameClass(bench)).toBe('capitalize')
  })
  test('keeps custom names exact under both switches and restores English', () => {
    const custom = { id: 'custom-1', n: '내 운동 EZbar' }
    for (const [parens, enOnly] of [[true, false], [false, false], [true, true]]) {
      _setLangState('ko', {}, null, ko, parens, enOnly)
      expect(exerciseNameFor(custom)).toBe(custom.n)
      expect(exerciseNameSearchText(custom)).toBe(custom.n)
    }
    _setLangState('en', {}, null, ko)
    expect(exerciseNameFor(bench)).toBe(bench.n)
  })
  test('builder rejects duplicate, unknown, missing and empty entries before generating', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opengym-ko-'))
    const builder = fileURLToPath(new URL('../../../scripts/build-ko-exercise-names.mjs', import.meta.url))
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    try {
      const missing = { ...source }; delete missing['0025']
      for (const [name, raw, expected] of [
        ['duplicate', '{"0025":"벤치프레스","0025":"중복"}', /Duplicate exercise ID/],
        ['unknown', JSON.stringify({ ...source, invalid: '운동' }), /Unknown exercise ID/],
        ['missing', JSON.stringify(missing), /Incomplete ko/],
        ['empty', JSON.stringify({ ...source, '0025': ' ' }), /non-empty string/],
      ]) {
        const path = join(dir, `${name}.json`); writeFileSync(path, raw)
        let stderr = ''
        try { execFileSync(process.execPath, [builder, '--root', root, '--source', path], { stdio: 'pipe' }) }
        catch (err) { stderr = String(err.stderr) }
        expect(stderr).toMatch(expected)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
