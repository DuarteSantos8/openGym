#!/usr/bin/env node
/* Can the oldest browser we ship to parse the bundle? The iOS app's deployment target is 15.5,
 * so its WebView is Safari 15.5, and one regex lookbehind (Safari 16.4) in one chunk was enough
 * for 1.4.2 to never get past the splash on iOS 15.5 to 16.3: the chunk fails to parse, the
 * module graph dies, React never mounts.
 *
 * vite.config.js already asks the transpiler for safari15 (build.target), but some syntax it
 * cannot lower (a lookbehind has no rewrite) and some it turns into a `new RegExp(...)` that dies
 * at load instead of at parse. This walks every built chunk and fails on what Safari 15.5 lacks:
 *   - regex lookbehind, the v flag, duplicate group names, inline modifiers (literal or RegExp()),
 *   - class static blocks, `using` declarations, import attributes,
 *   - built-ins newer than 15.5 that a module would call unguarded (Object.groupBy and friends).
 *
 * Usage: node scripts/check-bundle-syntax.mjs [dist dir]   (exit code 1 on any problem). */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst } from 'vite'

// What a regex pattern uses, read the way the regex engine reads it: escapes skipped, and
// nothing inside a [...] class counts as a group.
export function regexFeatures(pattern, flags = '') {
  const found = []
  if (flags.includes('v')) found.push('regex v flag (Safari 17)')
  const names = new Set()
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') { i++; continue }
    if (inClass) { if (c === ']') inClass = false; continue }
    if (c === '[') { inClass = true; continue }
    if (c !== '(' || pattern[i + 1] !== '?') continue
    const rest = pattern.slice(i + 2)
    if (rest.startsWith('<=') || rest.startsWith('<!')) found.push('regex lookbehind (Safari 16.4)')
    else if (rest.startsWith('<')) {
      const name = /^<([^>]+)>/.exec(rest)?.[1]
      if (name && names.has(name)) found.push('regex duplicate group name (Safari 17)')
      if (name) names.add(name)
    } else if (/^[ims-]+:/.test(rest)) found.push('regex inline modifier (not in Safari 15)')
  }
  return [...new Set(found)]
}

// Built-ins a module could call at load. Safari 15.4 brought at(), findLast(), Object.hasOwn and
// structuredClone, so those are fine; these came later.
const NEWER_STATICS = {
  Object: ['groupBy'], Map: ['groupBy'], Array: ['fromAsync'], Promise: ['withResolvers', 'try'],
  URL: ['canParse', 'parse'], AbortSignal: ['any'],
}
const NEWER_METHODS = ['toSorted', 'toReversed', 'toSpliced', 'isWellFormed', 'toWellFormed']

const isRegExpCtor = n => n?.type === 'Identifier' && n.name === 'RegExp'
const str = n => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value : null)

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key in node) {
    const v = node[key]
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c === 'object') walk(c, visit) }
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit)
  }
}

/** Every construct in this chunk that Safari 15.5 cannot run, as readable strings. */
export function unsupportedSyntax(code, file = 'chunk.js') {
  let ast
  try { ast = parseAst(code) } catch (e) { return [`${file}: does not parse (${e.message.split('\n')[0]})`] }
  const problems = []
  const at = (n, what) => {
    const line = code.slice(0, n.start).split('\n').length
    const snippet = code.slice(n.start, Math.min(n.end, n.start + 60)).replace(/\s+/g, ' ')
    problems.push(`${file}:${line}: ${what}: ${snippet}`)
  }
  walk(ast, n => {
    if (n.type === 'Literal' && n.regex) for (const f of regexFeatures(n.regex.pattern, n.regex.flags)) at(n, f)
    else if ((n.type === 'NewExpression' || n.type === 'CallExpression') && isRegExpCtor(n.callee)) {
      const pattern = str(n.arguments[0])
      if (pattern !== null) for (const f of regexFeatures(pattern, str(n.arguments[1]) || '')) at(n, f)
    } else if (n.type === 'StaticBlock') at(n, 'class static block (Safari 16.4)')
    else if (n.type === 'VariableDeclaration' && /using/.test(n.kind)) at(n, '`using` declaration')
    else if ((n.type === 'ImportExpression' && n.options) || n.attributes?.length) at(n, 'import attributes (Safari 17.2)')
    else if (n.type === 'MemberExpression' && !n.computed && n.property?.type === 'Identifier') {
      const obj = n.object?.type === 'Identifier' ? n.object.name : null
      if (obj && NEWER_STATICS[obj]?.includes(n.property.name)) at(n, `${obj}.${n.property.name} (newer than Safari 15.5)`)
      else if (NEWER_METHODS.includes(n.property.name)) at(n, `.${n.property.name}() (Safari 16)`)
    }
  })
  return problems
}

export function checkBundle(dist) {
  const assets = join(dist, 'assets')
  if (!existsSync(assets)) return [`${dist}: no assets/ (build first)`]
  return readdirSync(assets).filter(f => f.endsWith('.js'))
    .flatMap(f => unsupportedSyntax(readFileSync(join(assets, f), 'utf8'), `assets/${f}`))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'))
  const problems = checkBundle(dist)
  if (problems.length) {
    for (const p of problems) console.error('✗ ' + p)
    console.error(`\n${problems.length} construct(s) Safari 15.5 (the iOS deployment target) cannot run.`)
    process.exit(1)
  }
  console.log(`✓ ${dist}: every chunk runs on Safari 15.5`)
}
