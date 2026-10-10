import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import itPack from '../admin-locales/it.js'
import { COACH_GROUP_COPY, credentialHint, credentialLabel, failureTitle } from './admin-coach-i18n.js'
import { AUDIT_DYNAMIC_SOURCES } from './audit.js'
import { _setLangState } from './i18n-core.js'
import { adminT } from './admin-i18n.js'

afterEach(() => _setLangState('en', {}, null, null))

const here = path.dirname(fileURLToPath(import.meta.url))
const files = ['../views/Admin.jsx', '../views/AdminCoach.jsx', './audit.js']
  .map(file => path.resolve(here, file))
const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n')

function placeholders(value) {
  return [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
}

describe('admin localization coverage', () => {
  it('has an Italian translation with matching placeholders for every literal adminT call', () => {
    const keys = [...source.matchAll(/adminT\(\s*(['"`])([\s\S]*?)\1/g)].map(match => match[2])
    const missing = [...new Set(keys.filter(key => !(key in itPack)))]
    expect(missing).toEqual([])

    const mismatched = [...new Set(keys.filter(key => placeholders(key).join() !== placeholders(itPack[key]).join()))]
    expect(mismatched).toEqual([])

    const dynamic = [...COACH_GROUP_COPY.flat(), ...AUDIT_DYNAMIC_SOURCES.labels, ...AUDIT_DYNAMIC_SOURCES.reasons, ...AUDIT_DYNAMIC_SOURCES.acts]
    const missingDynamic = [...new Set(dynamic.filter(key => !(key in itPack)))]
    expect(missingDynamic).toEqual([])
    const mismatchedDynamic = [...new Set(dynamic.filter(key => placeholders(key).join() !== placeholders(itPack[key]).join()))]
    expect(mismatchedDynamic).toEqual([])
  })

  it('does not leave user-facing JSX text or confirmation/accessibility copy outside adminT', () => {
    const technicalText = new Set(['Ollama', 'LM Studio', 'vLLM', 'OpenRouter', '/v1', '/v4', './data', 'secret', 'COACH_DISABLED'])
    const rawJsx = []
    const rawProps = []
    for (const file of files.filter(file => file.endsWith('.jsx'))) {
      const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
      const walk = node => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'JSXText') {
          const text = node.value.trim()
          if (/[A-Za-z]/.test(text) && !technicalText.has(text)) rawJsx.push(text)
        }
        if (node.type === 'JSXAttribute' && ['title', 'message', 'confirmText', 'aria-label', 'placeholder'].includes(node.name?.name) && node.value?.type === 'StringLiteral') rawProps.push(node.value.value)
        for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(walk) : walk(value)
      }
      walk(ast)
    }
    expect(rawJsx).toEqual([])
    expect(rawProps.filter(value => !/^(?:https?:\/\/|sk-|x-opencode-|\.{3})/.test(value))).toEqual([])

    const confirmationLiterals = [...source.matchAll(/\b(?:title|message|confirmText):\s*(['"])([^'"\n]+)\1/g)].map(match => match[2])
    expect(confirmationLiterals).toEqual([])

    _setLangState('it', {}, null, null)
    expect(credentialHint({ state: 'none' }, { setupToken: false })).not.toBe('API key needed')
    expect(credentialLabel('apikey')).toBe('chiave API')
    for (const cls of ['timeout', 'missing', 'auth', 'provider', 'unusable', 'restart', 'nostate', 'off', 'toolarge', 'internal']) expect(failureTitle(cls)).not.toBe(cls)
    _setLangState('en', {}, null, null)

    expect(source).toMatch(/adminT\(g\.sourceTitle\)/)
    expect(source).toMatch(/adminT\(g\.hint\)/)
    expect(source).toMatch(/adminT\(e\.outcome === 'failed' \? 'failed' : e\.outcome === 'ready' \? 'ready' : e\.outcome\)/)
  })
})
