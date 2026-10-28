// Safari before 16.2 has no color-mix(), and the iOS app goes back to iOS 15.5 (A1 report, h097327):
// there every tint that mixes (Coach header, error bubbles, admin pills, focus badges, the body
// map) used to vanish. So every mixing declaration in src CSS needs a plain stand-in that old
// Safari takes instead: the same property just before it in the same rule, or, for a custom
// property and for the properties the CSS minifier dedupes (a fill, a color), the same selector
// and property inside an `@supports not (color: color-mix(...))` block. The check runs on the
// sources and on what lightningcss (Vite's CSS minifier, same targets) makes of them, since a
// fallback the minifier drops is no fallback.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transform } from 'lightningcss'

const SRC = resolve(process.cwd(), 'src')
const cssFiles = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'locales' && name !== 'node_modules') cssFiles(p, out) }
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

// Rules as { sel, decls: [[prop, value]], fallbackBlock }, at any depth. Good enough for our own
// CSS: no strings with braces in them, comments stripped first.
function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const stack = []
  let buf = ''
  for (const ch of text) {
    if (ch === '{') { stack.push(buf.trim()); buf = '' }
    else if (ch === '}') {
      const sel = stack.pop()
      if (buf.trim() && sel != null) {
        const decls = buf.split(';').map(d => d.trim()).filter(Boolean).map(d => {
          const i = d.indexOf(':')
          return [d.slice(0, i).trim(), d.slice(i + 1).trim()]
        })
        rules.push({ sel, decls, fallbackBlock: stack.some(s => /^@supports\s+not\s*\(\s*color\s*:\s*color-mix\(/.test(s)) })
      }
      buf = ''
    } else buf += ch
  }
  return rules
}

const DEDUPED = new Set(['color', 'fill', 'stroke', '-webkit-text-fill-color'])
const norm = s => s.replace(/\s+/g, ' ').trim()
const selectorsOf = sel => {
  const out = []
  let depth = 0, cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(norm(cur)); cur = '' } else cur += ch
  }
  out.push(norm(cur))
  return out
}

export function missingFallbacks(css) {
  const rules = rulesOf(css)
  // Per selector of a list: the minifier merges rules with the same body into one list.
  const blockHas = (sel, prop) => selectorsOf(sel).every(one => rules.some(r => r.fallbackBlock
    && selectorsOf(r.sel).includes(one) && r.decls.some(([p, v]) => p === prop && !v.includes('color-mix('))))
  const missing = []
  for (const r of rules) {
    if (r.fallbackBlock) continue
    r.decls.forEach(([prop, value], i) => {
      if (!value.includes('color-mix(')) return
      const before = r.decls.slice(0, i).some(([p, v]) => p === prop && !v.includes('color-mix('))
      const ok = prop.startsWith('--') || DEDUPED.has(prop) ? blockHas(r.sel, prop) : before || blockHas(r.sel, prop)
      if (!ok) missing.push(`${norm(r.sel)} { ${prop} }`)
    })
  }
  return missing
}

const v = (major, minor = 0) => (major << 16) | (minor << 8)
const TARGETS = { safari: v(15), chrome: v(100), firefox: v(100), edge: v(100) }

describe('color-mix() has a fallback for Safari before 16.2', () => {
  const files = cssFiles(SRC)
  it('finds the CSS', () => {
    expect(files.map(f => relative(SRC, f))).toEqual(expect.arrayContaining(['index.css', 'coach.css', 'admin.css', 'views/FocusView.css']))
  })
  for (const file of files) {
    const css = readFileSync(file, 'utf8')
    if (!css.includes('color-mix(')) continue
    it(`${relative(SRC, file)}: in the source`, () => { expect(missingFallbacks(css)).toEqual([]) })
    it(`${relative(SRC, file)}: after the minifier`, () => {
      const min = transform({ filename: file, code: Buffer.from(css), minify: true, targets: TARGETS }).code.toString()
      expect(missingFallbacks(min)).toEqual([])
    })
  }

  it('the checker itself catches a bare mix, a deduped one and a custom property', () => {
    expect(missingFallbacks('.a{background:color-mix(in srgb,red 10%,blue)}')).toEqual(['.a { background }'])
    expect(missingFallbacks('.a{background:red;background:color-mix(in srgb,red 10%,blue)}')).toEqual([])
    expect(missingFallbacks('.a{fill:red;fill:color-mix(in srgb,red 10%,blue)}')).toEqual(['.a { fill }'])
    expect(missingFallbacks(':root{--x:color-mix(in srgb,red 10%,blue)}')).toEqual([':root { --x }'])
    expect(missingFallbacks(':root{--x:color-mix(in srgb,red 10%,blue)}@supports not (color: color-mix(in srgb, red 50%, blue)){:root{--x:red}}')).toEqual([])
    expect(missingFallbacks('.a{fill:color-mix(in srgb,red 1%,blue)}.b{fill:color-mix(in srgb,red 1%,blue)}@supports not (color: color-mix(in srgb, red 50%, blue)){.a,.b{fill:red}}')).toEqual([])
  })
})
