import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import itPack from '../admin-locales/it.js'
import { COACH_GROUP_COPY, credentialHint, credentialLabel, failureTitle, SETUP_TOKEN_RISK } from './admin-coach-i18n.js'
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

// Inspect rendered expression branches, not predicates, styles or machine values.
function renderedLiterals(node, technicalText, output) {
  if (!node) return
  const add = text => {
    if (/[A-Za-z]/.test(text) && !technicalText.has(text.trim())) output.push(text)
  }
  if (node.type === 'StringLiteral') add(node.value)
  else if (node.type === 'TemplateLiteral') {
    node.quasis.forEach(part => add(part.value.cooked || ''))
    node.expressions.forEach(part => renderedLiterals(part, technicalText, output))
  } else if (node.type === 'ConditionalExpression') {
    renderedLiterals(node.consequent, technicalText, output)
    renderedLiterals(node.alternate, technicalText, output)
  } else if (node.type === 'LogicalExpression') renderedLiterals(node.right, technicalText, output)
  else if (node.type === 'BinaryExpression' && node.operator === '+') {
    renderedLiterals(node.left, technicalText, output)
    renderedLiterals(node.right, technicalText, output)
  }
  // Calls (including adminT arguments), member access and identifiers are not copy literals.
}

describe('admin localization coverage', () => {
  it('has an Italian translation with matching placeholders for every literal adminT call', () => {
    const keys = [...source.matchAll(/adminT\(\s*(['"`])([\s\S]*?)\1/g)].map(match => match[2])
    const missing = [...new Set(keys.filter(key => !(key in itPack)))]
    expect(missing).toEqual([])

    const mismatched = [...new Set(keys.filter(key => placeholders(key).join() !== placeholders(itPack[key]).join()))]
    expect(mismatched).toEqual([])

    const dynamic = [SETUP_TOKEN_RISK, ...COACH_GROUP_COPY.flat(), ...AUDIT_DYNAMIC_SOURCES.labels, ...AUDIT_DYNAMIC_SOURCES.reasons, ...AUDIT_DYNAMIC_SOURCES.acts]
    const missingDynamic = [...new Set(dynamic.filter(key => !(key in itPack)))]
    expect(missingDynamic).toEqual([])
    const mismatchedDynamic = [...new Set(dynamic.filter(key => placeholders(key).join() !== placeholders(itPack[key]).join()))]
    expect(mismatchedDynamic).toEqual([])
  })

  it('detects copy in concatenation and templates while allowing translated and technical values', () => {
    const ast = parse("<div>{count + ' users'}{`exercise ${index} of ${total}`}{active ? 'running' : adminT('Rest')}{adminT('User {0}', 'Alice')}{'/v1'}{active === 'internal' ? name : null}</div>", { sourceType: 'module', plugins: ['jsx'] })
    const output = []
    for (const child of ast.program.body[0].expression.children) renderedLiterals(child.expression, new Set(['/v1']), output)
    expect(output).toEqual([' users', 'exercise ', ' of ', 'running'])
  })

  it('does not leave user-facing JSX text or confirmation/accessibility copy outside adminT', () => {
    const technicalText = new Set(['Ollama', 'LM Studio', 'vLLM', 'OpenRouter', '/v1', '/v4', './data', 'secret', 'COACH_DISABLED'])
    const rawJsx = []
    const rawProps = []
    for (const file of files.filter(file => file.endsWith('.jsx'))) {
      const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
      const walk = (node, parent) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'JSXText') {
          const text = node.value.trim()
          if (/[A-Za-z]/.test(text) && !technicalText.has(text)) rawJsx.push(text)
        }
        if (node.type === 'JSXExpressionContainer' && ['JSXElement', 'JSXFragment'].includes(parent?.type) && parent.openingElement?.name?.name !== 'code') renderedLiterals(node.expression, technicalText, rawJsx)
        if (node.type === 'JSXAttribute' && ['title', 'message', 'confirmText', 'aria-label', 'placeholder'].includes(node.name?.name)) {
          if (node.value?.type === 'StringLiteral') rawProps.push(node.value.value)
          else if (node.value?.type === 'JSXExpressionContainer') renderedLiterals(node.value.expression, technicalText, rawProps)
        }
        for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(child => walk(child, node)) : walk(value, node)
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
