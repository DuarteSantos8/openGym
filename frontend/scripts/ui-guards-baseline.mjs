#!/usr/bin/env node
// The UI guards' measurements (src/ui-guards.test.js) and the baseline they ratchet against.
//
//   node scripts/ui-guards-baseline.mjs   # rewrite src/ui-guards.baseline.json from the sources
//
// The ratchet moves one way. A guard fails when a file's count rises above its baseline (or a file
// missing from the baseline counts above 0), and also when it falls below: a PR that migrates a
// file lowers that file's entry in the same PR, by running this script. Never run it to turn a
// rise green: that records the regression as the new normal.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
export const BASELINE = join(SRC, 'ui-guards.baseline.json')
export const LOWER = 'lower the baseline: run scripts/ui-guards-baseline.mjs'

// The CSS that predates the kit. Every other stylesheet is new and held to G7.
export const LEGACY_CSS = ['admin.css', 'coach.css', 'index.css', 'tab-shell.css', 'views/FocusView.css']
// The only stylesheets whose :root rules may define colour tokens: the theme and the kit's tokens.
export const THEME_FILES = ['index.css', 'ui-kit.css']
// Where the hand-built markup G3 looks for is allowed: the primitives themselves.
export const PRIMITIVE_FILES = [
  'components/blocks.jsx', 'components/layout.jsx', 'components/sheet-layout.jsx', 'components/ui.jsx',
  // the native redesign's kit
  'components/date-nav.jsx', 'components/line-art.jsx', 'components/tab-kit.jsx',
]
// Routed views that draw their own chrome and never render <Page> (G4).
export const PAGE_EXEMPT = ['FocusView', 'Login', 'MobileOnboarding', 'Workout']

const SKIP_DIRS = new Set(['locales', 'instr', 'exercise-desc', 'exercise-names', 'node_modules'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p, out) } else out.push(p)
  }
  return out
}
const rel = p => relative(SRC, p).split(sep).join('/')
const read = p => ({ file: rel(p), path: p, text: readFileSync(p, 'utf8') })

// Every source file, tests included (G6 reads tests; the counts skip them).
export const sources = (src = SRC) => walk(src).filter(p => /\.(jsx?|mjs)$/.test(p)).map(read)
export const isTest = file => /\.test\.[mc]?jsx?$/.test(file)
export const codeFiles = (src = SRC) => sources(src).filter(s => !isTest(s.file))
export const jsxFiles = (src = SRC) => codeFiles(src).filter(s => s.file.endsWith('.jsx'))
export const cssFiles = (src = SRC) => walk(src).filter(p => p.endsWith('.css')).map(read)

// Comments out, so a colour or a style in prose is not counted. A comment opens only after a
// space, a brace or a paren: `accept="image/*"` and `https://` are not comments.
export const stripJs = text => text
  .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
  .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
export const stripCss = text => text.replace(/\/\*[\s\S]*?\*\//g, '')
const count = (text, re) => (text.match(re) || []).length

/* ------------------------------------------------------------ a small JS reader -- */

// The index just past the string that opens at `i`.
function skipString(text, i) {
  const q = text[i]
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++
    else if (text[j] === q) return j + 1
  }
  return text.length
}

// The index of the bracket that closes the one at `open`.
function closer(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i) - 1; continue }
    if (c === '{' || c === '(' || c === '[') depth++
    else if ((c === '}' || c === ')' || c === ']') && --depth === 0) return i
  }
  return text.length - 1
}

// Walk the top level of an expression, calling `at(i)` at each character outside brackets and
// strings; `at` returns true to stop.
function topLevel(text, at) {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i) - 1; continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (depth === 0 && at(i)) return i
  }
  return -1
}

function splitTop(text, ops) {
  const parts = []
  let start = 0
  topLevel(text, i => {
    const op = ops.find(o => text.startsWith(o, i))
    if (op) { parts.push(text.slice(start, i)); start = i + op.length }
    return false
  })
  parts.push(text.slice(start))
  return parts.map(p => p.trim())
}

// `a ? b : c` at the top level → [b, c].
function ternary(text) {
  const q = topLevel(text, i => text[i] === '?' && text[i + 1] !== '.' && text[i + 1] !== '?' && text[i - 1] !== '?')
  if (q < 0) return null
  const rest = text.slice(q + 1)
  let nested = 0
  const colon = topLevel(rest, i => {
    if (rest[i] === '?' && rest[i + 1] !== '.' && rest[i + 1] !== '?' && rest[i - 1] !== '?') nested++
    else if (rest[i] === ':' && nested-- === 0) return true
    return false
  })
  return colon < 0 ? null : [rest.slice(0, colon), rest.slice(colon + 1)]
}

// Where a statement that starts at `from` ends: a `;`, or a line end not continued by an operator.
function statementEnd(code, from) {
  let depth = 0
  for (let i = from; i < code.length; i++) {
    const c = code[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i) - 1; continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) { if (--depth < 0) return i }
    else if (depth === 0 && c === ';') return i
    else if (depth === 0 && c === '\n') {
      const before = code.slice(from, i).trimEnd(), after = code.slice(i + 1).trimStart()
      if (!/[=+\-*/?:&|,(]$/.test(before) && !/^(?:[?:.+\-*/&|]|\?\?)/.test(after)) return i
    }
  }
  return code.length
}

// The initializer of the `const|let|var name =` nearest before `pos` (or the first one).
function initializerOf(code, name, pos) {
  const defs = [...code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*`, 'g'))]
  if (!defs.length) return null
  const def = defs.filter(d => d.index < pos).pop() || defs[0]
  const start = def.index + def[0].length
  return code.slice(start, statementEnd(code, start))
}

// The expressions a local function returns: an arrow's body, or each `return` of a block.
function returnsOf(code, name) {
  let body = null
  const decl = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(code)
  if (decl) {
    const params = closer(code, decl.index + decl[0].length - 1)
    const open = code.indexOf('{', params)
    body = code.slice(open + 1, closer(code, open))
  } else {
    const init = initializerOf(code, name, code.length)
    const arrow = init && /^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*/.exec(init)
    if (!arrow) return null
    const rest = init.slice(arrow[0].length).trim()
    if (!rest.startsWith('{')) return [rest]
    body = rest.slice(1, closer(rest, 0))
  }
  return [...body.matchAll(/\breturn\b/g)].map(m => body.slice(m.index + 6, statementEnd(body, m.index + 6)))
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/
export const isLiteral = v => NUMBER.test(v) || /^'(?:\\.|[^'\\])*'$/.test(v) || /^"(?:\\.|[^"\\])*"$/.test(v)
  || (/^`(?:\\.|[^`\\])*`$/.test(v) && !v.includes('${'))
const IDENT = /^[A-Za-z_$][\w$]*$/

/* ------------------------------------------------------------ G1 inline styles -- */

// How many literal-valued properties an expression passed to `style` holds. A property whose
// value is computed (a width from state, a colour picked at runtime) or a custom property (--tint)
// may stay inline; every literal one should be a class, wherever it hides: beside dynamic
// siblings, in a ternary, a spread, a constant, a helper's return, a constant used as a value.
// A style that cannot be followed (a prop, an import) counts 1, except a `style` passed through.
function styleCount(expr, code, pos, depth = 0) {
  let e = expr.trim()
  if (depth > 8) return 1
  while (e.startsWith('(') && closer(e, 0) === e.length - 1) e = e.slice(1, -1).trim()
  if (!e || /^(?:null|undefined|false|true)$/.test(e)) return 0
  const branches = ternary(e)
  if (branches) return branches.reduce((n, b) => n + styleCount(b, code, pos, depth + 1), 0)
  const ors = splitTop(e, ['||', '??'])
  if (ors.length > 1) return ors.reduce((n, b) => n + styleCount(b, code, pos, depth + 1), 0)
  const ands = splitTop(e, ['&&'])
  if (ands.length > 1) return styleCount(ands.at(-1), code, pos, depth + 1)
  if (e.startsWith('{') && closer(e, 0) === e.length - 1) return objectCount(e.slice(1, -1), code, pos, depth)
  if (IDENT.test(e)) {
    const init = initializerOf(code, e, pos)
    if (init != null) return styleCount(init, code, pos, depth + 1)
    return e === 'style' ? 0 : 1
  }
  const member = /^([A-Za-z_$][\w$]*)((?:\??\.[\w$]+)+)$/.exec(e)
  if (member) {
    const keys = member[2].split(/\??\./).filter(Boolean)
    const init = initializerOf(code, member[1], pos)
    if (init != null && init.trim().startsWith('{')) {
      const value = memberValue(init.trim(), keys)
      if (value != null) return styleCount(value, code, pos, depth + 1)
    }
    return keys.at(-1) === 'style' && init == null ? 0 : 1
  }
  const call = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(e)
  if (call && closer(e, call[0].length - 1) === e.length - 1) {
    const returns = IDENT.test(call[1]) && returnsOf(code, call[1])
    if (returns) return returns.reduce((n, r) => n + styleCount(r, code, pos, depth + 1), 0)
    const args = splitTop(e.slice(call[0].length, -1), [','])
    const objects = args.filter(a => a.startsWith('{'))
    return objects.length ? objects.reduce((n, a) => n + styleCount(a, code, pos, depth + 1), 0) : 1
  }
  return 1
}

// The value at `keys` in an object literal's source, or null.
function memberValue(object, keys) {
  let body = object.slice(1, closer(object, 0))
  for (let k = 0; k < keys.length; k++) {
    const m = splitTop(body, [',']).map(p => /^(['"]?)([\w$-]+)\1\s*:\s*([\s\S]+)$/.exec(p)).find(p => p && p[2] === keys[k])
    if (!m) return null
    if (k === keys.length - 1) return m[3]
    const v = m[3].trim()
    if (!v.startsWith('{')) return null
    body = v.slice(1, closer(v, 0))
  }
  return null
}

function objectCount(body, code, pos, depth) {
  let n = 0
  for (const m of splitTop(body, [',']).filter(Boolean)) {
    if (m.startsWith('...')) { n += styleCount(m.slice(3), code, pos, depth + 1); continue }
    const kv = /^(['"]?)([\w$-]+)\1\s*:\s*([\s\S]+)$/.exec(m)
    const key = kv ? kv[2] : m
    if (key.startsWith('--')) continue
    const value = (kv ? kv[3] : m).trim()
    if (isLiteral(value)) n++
    else if (IDENT.test(value)) { const init = initializerOf(code, value, pos); if (init != null && isLiteral(init.trim())) n++ }
  }
  return n
}

// G1: literal-valued inline style properties, in every `style={…}`.
export function staticStyles(text) {
  const code = stripJs(text)
  let n = 0
  for (const m of code.matchAll(/\bstyle\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1
    n += styleCount(code.slice(open + 1, closer(code, open)), code, m.index)
  }
  return n
}

/* ------------------------------------------------------------ G2/G7 colours -- */

const NAMED = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod '
  + 'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
  + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue '
  + 'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew '
  + 'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
  + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '
  + 'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream '
  + 'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen '
  + 'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown '
  + 'royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' ')
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g
const CSS_NAMED = new RegExp(`(?<![\\w-])(?:${NAMED.join('|')})(?![\\w-])`, 'gi')
// In code a colour name is a quoted value given to something: `color: 'white'`, fill="black".
const JS_NAMED = new RegExp(`(?:(?<![=!<>])=(?!=)|:|\\?|\\|\\|)\\s*(['"\`])(?:${NAMED.join('|')})\\1`, 'g')

// Colours written into a stylesheet: hex, rgb()/hsl()…, names. A theme file's :root rules
// (`:root`, `:root[data-theme=…]`) are where colour tokens live and are not counted there.
const THEME_RULE = /^:root(?:\[[^\]]*\])*$/
export function cssColours(text, themeFile = false) {
  let n = 0
  for (const [, selector, decls] of stripCss(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (themeFile && selector.split(',').every(s => THEME_RULE.test(s.trim()))) continue
    const values = decls.split(';').map(d => d.slice(d.indexOf(':') + 1)).join(';')
    n += count(values, HEX) + count(values, COLOR_FN) + count(values, CSS_NAMED)
  }
  return n
}
export const jsColours = text => { const code = stripJs(text); return count(code, HEX) + count(code, COLOR_FN) + count(code, JS_NAMED) }

// G7: what a new stylesheet may not hold: a colour outside a theme file's :root, a page width.
export const newCssViolations = (text, file = '') =>
  cssColours(text, THEME_FILES.includes(file)) + count(stripCss(text), /(?<![\w-])max-(?:width|inline-size)\s*:/g)

/* ------------------------------------------------------------ G3 hand-built markup -- */

// The classes a primitive renders. A className holding one of them, however it is built (a
// string, a ternary, an array, a template, cx()), is markup a primitive should render.
const PRIMITIVE_CLASSES = new Set(['big', 'card', 'chip', 'chips', 'empty', 'item', 'lrow', 'row', 'tag', 'tile', 'tiles'])
const tokensIn = expr => [...expr.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)]
  .flatMap(m => m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)).filter(Boolean)

export function handBuilt(text) {
  const code = stripJs(text)
  let n = 0
  const inside = []
  for (const m of code.matchAll(/\bclassName\s*=\s*/g)) {
    const at = m.index + m[0].length
    const end = code[at] === '{' ? closer(code, at) + 1 : /['"`]/.test(code[at]) ? skipString(code, at) : statementEnd(code, at)
    inside.push([at, end])
    const tokens = tokensIn(code.slice(at, end))
    const tag = /<([\w.]+)[^<]*$/.exec(code.slice(Math.max(0, m.index - 400), m.index))?.[1]
    if (tokens.some(t => PRIMITIVE_CLASSES.has(t)) || (tag === 'h4' && tokens.includes('sec'))) n++
  }
  for (const m of code.matchAll(/\b(?:cx|clsx|classNames)\s*\(/g)) {
    if (inside.some(([a, b]) => m.index >= a && m.index < b)) continue
    const open = m.index + m[0].length - 1
    if (tokensIn(code.slice(open, closer(code, open) + 1)).some(t => PRIMITIVE_CLASSES.has(t))) n++
  }
  // A sheet's title: SheetHeader.
  return n + count(code, /<h3[\s>]/g)
}

/* ------------------------------------------------------------ G4 pages -- */

// Each name App.jsx imports from a view: its file and the export it is.
function viewImports(app) {
  const out = {}
  for (const [, what, path] of app.matchAll(/^import\s+([^'"]+?)\s+from\s+['"](\.\/views\/[^'"]+)['"]/gm)) {
    const [def, named] = what.includes('{') ? [what.slice(0, what.indexOf('{')), what.slice(what.indexOf('{') + 1, what.indexOf('}'))] : [what, '']
    const d = def.replace(',', '').trim()
    if (d) out[d] = { path, name: 'default' }
    for (const n of named.split(',').map(s => s.trim()).filter(Boolean)) {
      const [orig, local = orig] = n.split(/\s+as\s+/)
      out[local] = { path, name: orig }
    }
  }
  for (const m of app.matchAll(/\b(?:const|let)\s+([\w$]+)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*['"](\.\/views\/[^'"]+)['"]\s*\)(?:\s*\.then\(\s*\(?\s*([\w$]+)\s*\)?\s*=>\s*\(\s*\{\s*default\s*:\s*\3\.([\w$]+))?/g)) {
    out[m[1]] = { path: m[2], name: m[4] || 'default' }
  }
  return out
}

// The source of the component a file exports as `name`: its function's body, or an arrow's.
function componentBody(code, name) {
  let local = name
  if (name === 'default') {
    const def = /\bexport\s+default\s+(?:function\s+([\w$]+)|([\w$]+))/.exec(code)
    if (!def) return null
    local = def[1] || def[2]
  }
  const fn = new RegExp(`\\bfunction\\s+${local}\\s*\\(`).exec(code)
  if (fn) {
    const open = code.indexOf('{', closer(code, fn.index + fn[0].length - 1))
    return code.slice(open, closer(code, open) + 1)
  }
  const init = initializerOf(code, local, code.length)
  return init
}

function rendersPage(code, name, seen = new Set()) {
  if (seen.has(name)) return false
  seen.add(name)
  const body = componentBody(code, name)
  if (body == null) return false
  if (/<Page\b/.test(body)) return true
  return [...new Set([...body.matchAll(/<([A-Z][\w$]*)/g)].map(m => m[1]))]
    .some(child => componentBody(code, child) != null && rendersPage(code, child, seen))
}

// G4: the components App.jsx routes to that do not render <Page>, by name.
export function routeViewsWithoutPage(src = SRC) {
  const app = stripJs(readFileSync(join(src, 'App.jsx'), 'utf8'))
  const imports = viewImports(app)
  const routed = new Set()
  for (const m of app.matchAll(/\belement\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1
    for (const [, name] of app.slice(open, closer(app, open)).matchAll(/<([A-Z][\w$]*)/g)) if (imports[name]) routed.add(name)
  }
  return [...routed].filter(local => {
    const { path, name } = imports[local]
    return !rendersPage(stripJs(readFileSync(join(src, path), 'utf8')), name)
  }).sort()
}

/* ------------------------------------------------------------ G8 page chrome -- */

// A page names itself and its actions through <Page>; its header, and the spacing and width
// around it, are the kit's and the shell's (owner rule, 2026-10-14). The header components and
// layout.jsx are where a header is built; the full-screen views draw their own chrome.
export const HEADER_FILES = ['components/layout.jsx', 'components/RootHeader.jsx', 'components/SubHeader.jsx']
const HEADER_CLASSES = new Set(['hdr', 'tab-hdr', 'sub-hdr', 'root-hdr'])
const exemptView = file => PAGE_EXEMPT.some(name => file === `views/${name}.jsx`)

// Every place a page chooses its own header: importing a header component past <Page>, building
// a header's classes by hand, or handing <Page> a class or a style of its own. `file: what`.
export function pageChrome(src = SRC) {
  const out = []
  for (const s of jsxFiles(src)) {
    const file = relative(src, s.path).split(sep).join('/')
    if (HEADER_FILES.includes(file)) continue
    const code = stripJs(s.text)
    // static, dynamic and lazy imports, with or without the extension
    for (const [, spec] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\(\s*)['"]([^'"]*\/(?:RootHeader|SubHeader)(?:\.jsx)?)['"]/g)) out.push(`${file}: imports ${spec.split('/').pop().replace(/(?:\.jsx)?$/, '.jsx')}`)
    if (!exemptView(file)) {
      if (file.startsWith('views/')) {
        for (const m of code.matchAll(/<(header|h1)\b/g)) out.push(`${file}: renders its own <${m[1]}>`)
      }
      for (const m of code.matchAll(/\bclassName\s*=\s*/g)) {
        const at = m.index + m[0].length
        const end = code[at] === '{' ? closer(code, at) + 1 : /['"`]/.test(code[at]) ? skipString(code, at) : statementEnd(code, at)
        const own = tokensIn(code.slice(at, end)).find(tok => HEADER_CLASSES.has(tok))
        if (own) out.push(`${file}: builds .${own}`)
      }
    }
    for (const m of code.matchAll(/<Page\b/g)) {
      const attrs = tagAttributes(code, m.index)
      if (/\s(?:className|style)\s*=/.test(attrs) || /\s\.\.\.spread\b/.test(attrs)) out.push(`${file}: styles <Page>`)
    }
  }
  return [...new Set(out)].sort()
}

// The attribute names of the JSX tag that opens at `start`, with every {…} value and string
// blanked out, up to the `>` that ends the tag. A `{...x}` spread shows as ` ...spread`, since
// it can carry a className or a style the guard cannot see.
function tagAttributes(code, start) {
  let depth = 0, out = ''
  for (let i = start + 1; i < code.length; i++) {
    const c = code[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i) - 1; if (!depth) out += '""'; continue }
    if (c === '{') { if (!depth && /^\{\s*\.\.\./.test(code.slice(i, i + 12))) out += ' ...spread'; depth++ }
    else if (c === '}') depth--
    else if (!depth && c === '>') break
    else if (!depth) out += c
  }
  return out
}

/* ------------------------------------------------------------ G6 sheets facade -- */

// Who imports a module under src/sheets/, other than sheets.jsx and src/sheets/ itself.
export function sheetsImporters(src = SRC) {
  const dir = join(src, 'sheets') + sep
  const out = []
  for (const s of sources(src)) {
    if (s.file === 'sheets.jsx' || s.file.startsWith('sheets/')) continue
    const specs = [...s.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bvi\.mock\(\s*|\brequire\(\s*|^\s*import\s+)['"](\.[^'"]+)['"]/gm)].map(m => m[1])
    if (specs.some(spec => resolve(dirname(s.path), spec).startsWith(dir))) out.push(s.file)
  }
  return out
}

/* ------------------------------------------------------------ the baseline -- */

const perFile = (files, measure) => Object.fromEntries(files.map(f => [f.file, measure(f.text, f.file)]).filter(([, n]) => n > 0))

export function measure(src = SRC) {
  const jsx = jsxFiles(src)
  return {
    G1: perFile(jsx, staticStyles),
    G2css: perFile(cssFiles(src).filter(f => LEGACY_CSS.includes(f.file)), (text, file) => cssColours(text, THEME_FILES.includes(file))),
    G2js: perFile(codeFiles(src), jsColours),
    G3: perFile(jsx.filter(f => !PRIMITIVE_FILES.includes(f.file)), handBuilt),
    G4: routeViewsWithoutPage(src).filter(name => !PAGE_EXEMPT.includes(name)),
  }
}

// Every file off its baseline: above it (a regression), or below it (a migration that has to
// lower the baseline in the same PR). A list compares the same way, an entry at a time.
export function ratchet(now, base = {}) {
  if (Array.isArray(now)) {
    return [
      ...now.filter(x => !base.includes(x)).map(x => `${x}: new, not allowed`),
      ...base.filter(x => !now.includes(x)).map(x => `${x}: fixed, ${LOWER}`),
    ]
  }
  return [...new Set([...Object.keys(now), ...Object.keys(base)])].sort().flatMap(file => {
    const n = now[file] ?? 0, b = base[file] ?? 0
    if (n > b) return [`${file}: ${n} (baseline ${b})`]
    if (n < b) return [`${file}: ${n} (baseline ${b}), ${LOWER}`]
    return []
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = measure()
  writeFileSync(BASELINE, JSON.stringify(m, null, 2) + '\n')
  const total = o => Object.values(o).reduce((a, b) => a + b, 0)
  console.log(`ui-guards baseline: G1 ${total(m.G1)} literal style properties, G2 ${total(m.G2css)} CSS / ${total(m.G2js)} JS colours, G3 ${total(m.G3)} hand-built, G4 ${m.G4.length} views without <Page>`)
}
