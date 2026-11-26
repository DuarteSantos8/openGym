// Every .js file of the watch app (all but Huawei's own wearengine.js) must stay inside the language
// subset a lite wearable's engine runs without polyfills (nobody can run it there). A list of regexes
// over the source with comments and strings blanked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../entry/src/main/js/MainAbility/', import.meta.url).pathname
const sources = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.js') && e.name !== 'wearengine.js' ? [join(dir, e.name)] : [])

// Blank comments and string contents (keeping newlines), so a word inside them cannot trip a rule.
export function strip (src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const two = src.slice(i, i + 2)
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++ } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else if (ch === "'" || ch === '"') {
      out += ch
      i++
      while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++ }
      out += ch
      i++
    } else { out += ch; i++ }
  }
  return out
}

const RULES = [
  ['class', /\bclass\b/],
  ['spread or rest', /\.\.\./],
  ['template literal', /`/],
  ['for...of / for...in', /\bfor\s*\([^)]*\b(of|in)\b/],
  ['generator', /function\s*\*|\byield\b/],
  ['async/await/Promise', /\basync\b|\bawait\b|\bPromise\b/],
  ['Set/Map/Symbol', /\bnew\s+(Set|Map|WeakSet|WeakMap)\b|\bSymbol\b/],
  ['optional chaining', /\?\.(?!\d)/],
  ['nullish', /\?\?/],
  ['exponent', /\*\*/],
  ['array find/findIndex/includes/fill/from/flat', /\.(find|findIndex|findLast|includes|fill|flat|flatMap|at)\s*\(|\bArray\.from\b/],
  ['Object.assign/entries/values', /\bObject\.(assign|entries|values|fromEntries)\b|\.(entries|values)\s*\(/],
  ['string includes/startsWith/endsWith/padStart/padEnd/repeat', /\.(startsWith|endsWith|padStart|padEnd|repeat|trimStart|trimEnd)\s*\(/],
  ['Number.isFinite/isInteger, Math.trunc/sign', /\bNumber\.(isFinite|isInteger|isNaN)\b|\bMath\.(trunc|sign|cbrt|log2|hypot)\b/],
  ['getter/setter', /[{,]\s*(get|set)\s+[A-Za-z_$][\w$]*\s*\(/],
  ['labelled statement', /^\s*[A-Za-z_$][\w$]*\s*:\s*(for|while|do)\b/m],
  ['regex lookbehind', /\(\?<[=!]/],
  ['default parameter', /function\s*[\w$]*\s*\([^()]*[^=!<>]=[^=>][^()]*\)|\(\s*[\w$]+\s*=[^=>][^()]*\)\s*=>/],
  ['destructuring declaration', /\b(const|let|var)\s*[[{]/],
  ['destructured parameter', /function\s*[\w$]*\s*\(\s*[[{]|\(\s*[[{][^)]*\)\s*=>/],
  ['default parameter on an arrow', /\([^()]*[^=!<>]=[^=>][^()]*\)\s*=>/],
  ['destructuring assignment', /(^|[;{}\n])\s*\[[^\]\n]*\]\s*=(?!=)|\(\s*\{[^}]*\}\s*\)\s*=(?!=)/],
  ['computed key', /[{,]\s*\[[^\]]+\]\s*:/],
  ['shorthand method', /[{,]\s*(?!(?:if|for|while|switch|catch|function|return)\b)[A-Za-z_$][\w$]*\s*\([^()]*\)\s*\{/],
  ['logical assignment', /\|\|=|&&=|\?\?=/],
  ['catch without a binding', /\bcatch\s*\{/],
  ['newer Number/Object/Array/Math/String built-ins', /\bNumber\.(parse\w*|MAX\w*|MIN\w*|EPSILON)\b|\bObject\.(is|freeze|getOwnProperty\w*|defineProperty)\b|\bArray\.of\b|\.(copyWithin|codePointAt|replaceAll|matchAll|localeCompare)\s*\(|\bString\.fromCodePoint\b|\bMath\.(log10|log1p|expm1|sinh|cosh|tanh|asinh|acosh|atanh|fround|clz32|imul)\b/],
  ['Reflect / Proxy / Intl / BigInt / WeakRef', /\b(Reflect|Proxy|Intl|BigInt|WeakRef)\b/],
  ['numeric separator, binary/octal literal, BigInt literal', /\d_\d|\b0[bBoO][0-9]|\b\d+n\b/],
  ['typed arrays', /\b(Int8|Uint8|Uint8Clamped|Int16|Uint16|Int32|Uint32|Float32|Float64)Array\b|\bArrayBuffer\b|\bDataView\b/],
  ['require / dynamic import', /\brequire\s*\(|\bimport\s*\(/],
  ['console / process / globalThis', /\b(console|process|globalThis|window|document)\./]
]

// app.js is Huawei's own boilerplate (`onCreate () {}`): the framework wants methods there.
const violations = (src, file) => RULES.filter(([name, re]) => !(file === 'app.js' && name === 'shorthand method') && re.test(strip(src))).map(([name]) => name)

test('every watch source file stays inside the lite engine\'s language subset', () => {
  const files = sources('')
  ;['app.js', 'common/core.js', 'common/frames.js', 'common/radio.js', 'common/store.js', 'common/en.js', 'common/page-glue.js', 'common/view-common.js', 'common/view-home.js', 'common/view-lift.js', 'common/view-rest.js', 'common/view-over.js', 'pages/index/index.js', 'pages/lift/index.js', 'pages/rest/index.js', 'pages/over/index.js']
    .forEach(f => assert.ok(files.indexOf(f) >= 0, f + ' is checked'))
  files.forEach(f => assert.deepEqual(violations(readFileSync(join(root, f), 'utf8'), f), [], f))
})

test('the checker itself catches each forbidden form', () => {
  const bad = {
    class: 'class A {}',
    'spread or rest': 'f(...a)',
    'template literal': 'const a = `x`',
    'for...of / for...in': 'for (const a of b) {}',
    generator: 'function* g() {}',
    'async/await/Promise': 'async function f() {}',
    'Set/Map/Symbol': 'const s = new Set()',
    'optional chaining': 'a?.b',
    nullish: 'a ?? b',
    exponent: 'a ** 2',
    'array find/findIndex/includes/fill/from/flat': 'a.includes(1)',
    'Object.assign/entries/values': 'Object.assign(a, b)',
    'string includes/startsWith/endsWith/padStart/padEnd/repeat': 's.padStart(2)',
    'Number.isFinite/isInteger, Math.trunc/sign': 'Math.trunc(1)',
    'getter/setter': 'const o = { get a () { return 1 } }',
    'labelled statement': 'outer: for (;;) {}',
    'regex lookbehind': 'const r = /(?<=a)b/',
    'default parameter': 'function f (a, b = 1) {}',
    'destructuring declaration': 'const { a } = b',
    'destructured parameter': 'const f = ({ a }) => a',
    'default parameter on an arrow': 'const f = (a, b = 1) => a',
    'destructuring assignment': 'let a, b\n;[a, b] = [b, a]',
    'computed key': 'const o = { [k]: 1 }',
    'shorthand method': 'const o = { f (a) { return a } }',
    'logical assignment': 'a ||= 1',
    'catch without a binding': 'try { f() } catch { g() }',
    'newer Number/Object/Array/Math/String built-ins': 'Number.parseFloat(a)',
    'Reflect / Proxy / Intl / BigInt / WeakRef': 'new Proxy(a, b)',
    'numeric separator, binary/octal literal, BigInt literal': 'const n = 1_000',
    'typed arrays': 'new Uint8Array(2)'
  }
  Object.keys(bad).forEach(name => assert.ok(violations(bad[name]).indexOf(name) >= 0, name))
  // comments and strings do not count
  assert.deepEqual(violations("// class ... `x`\n/* a?.b */\nconst s = 'class ... ?? ` **'\n"), [])
})

// core.js only: every method it calls must be an ES5 one or one of the page's own env/listener names, so
// a built-in the deny-list above never heard of cannot slip in.
test('core.js calls only ES5 methods and its own names', () => {
  const src = strip(readFileSync(join(root, 'common/core.js'), 'utf8'))
  const es5 = 'forEach map filter some every indexOf lastIndexOf slice concat push pop shift unshift splice sort reverse join keys isArray stringify parse floor ceil round max min abs charAt split replace test toString'.split(' ')
  const own = 'transmit save buzz now tick random today onComplete onError getFullYear getMonth getDate'.split(' ') // (today: env.today(); the Date getters are ES1)
  const called = []
  src.replace(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g, (m, name) => { called.push(name) })
  const bad = called.filter(n => es5.indexOf(n) < 0 && own.indexOf(n) < 0)
  assert.deepEqual(bad, [])
  const globals = []
  src.replace(/\b(Math|Object|Array|JSON|Number|String|Date)\.([A-Za-z_$][\w$]*)/g, (m, a, b) => { globals.push(a + '.' + b) })
  const ok = ['Math.floor', 'Math.ceil', 'Math.round', 'Math.max', 'Math.min', 'Math.abs', 'Object.keys', 'Array.isArray', 'JSON.stringify', 'JSON.parse']
  assert.deepEqual(globals.filter(g => ok.indexOf(g) < 0), [])
})

// A page that imports core.js (directly, or through view.js, metrics.js...) is built with its own copy of it:
// the core lives in app.js only and the page reaches it through getApp().data.k().
test('no page reaches core.js through its imports', () => {
  const reach = (file, seen) => {
    if (seen.indexOf(file) >= 0) return
    seen.push(file)
    const src = readFileSync(join(root, file), 'utf8')
    src.replace(/^import [^'\n]*'([^']+)'/gm, (m, spec) => {
      if (spec.charAt(0) === '.') reach(join(file, '..', spec), seen)
    })
  }
  sources('pages').forEach(f => {
    const seen = []
    reach(f, seen)
    assert.ok(seen.length > 1 || f === 'pages/rest/index.js', f + ' imports its helpers') // the rest page is empty until task 11
    assert.deepEqual(seen.filter(n => n === 'common/core.js'), [], f)
  })
})
