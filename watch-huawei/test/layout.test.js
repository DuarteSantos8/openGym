// The page's boxes added up. Nobody can render the page here, so this is a small layout model of the
// documented rules: every box has an explicit width and height (the engine's default is 0), a row's
// children fit its width, a column's fit its height, targets are at least 56 px with 8 px between them,
// and on a round screen no row is wider than the circle at its height. There is no @media block (the
// simulator ignores -shape for it), so the one set of rules is checked on both shapes. It prints the
// table of heights (round 466 px, rectangle 336 x 480).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dir = new URL('../entry/src/main/js/MainAbility/pages/index/', import.meta.url)
const hml = readFileSync(new URL('index.hml', dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const cssText = readFileSync(new URL('index.css', dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/* ---------- css ---------- */
function rules (text) {
  const out = {}
  const re = /\.([A-Za-z0-9_]+)(:active)?\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    if (m[2]) continue
    const props = {}
    m[3].split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) props[p.slice(0, i).trim()] = p.slice(i + 1).trim() })
    out[m[1]] = props
  }
  return out
}
const base = rules(cssText)

test('the css has no @media block: the simulator ignores -shape for it, so every base rule must be safe on both shapes', () => {
  assert.ok(!/@media/.test(cssText))
})

/* ---------- html ---------- */
function parse (text) {
  const root = { tag: 'doc', attrs: {}, kids: [] }
  const stack = [root]
  const re = /<(\/?)([a-z-]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g
  let m
  while ((m = re.exec(text))) {
    if (m[1]) { stack.pop(); continue }
    const attrs = {}
    m[3].replace(/([a-z:-]+)(?:="([^"]*)")?/g, (a, k, v) => { attrs[k] = v === undefined ? true : v; return a })
    const node = { tag: m[2], attrs: attrs, kids: [] }
    stack[stack.length - 1].kids.push(node)
    if (!m[4] && m[2] !== 'input') stack.push(node)
  }
  return root.kids[0]
}
const tree = parse(hml)
const screens = tree.kids.filter(n => n.attrs.class === 'scr')

/* ---------- a model of the documented layout ---------- */
const R = 233 // a 466 px round screen
const chordAt = (a, b, h) => { const d = Math.max(Math.abs(a - h / 2), Math.abs(b - h / 2)); return d >= h / 2 ? 0 : 2 * Math.sqrt((h / 2) ** 2 - d ** 2) }
const unit = (v, of) => (v === undefined ? null : v.endsWith('%') ? parseFloat(v) / 100 * of : parseFloat(v))

function propsOf (node, isRound) {
  const out = {}
  String(node.attrs.class || '').split(/\s+/).filter(Boolean).forEach(c => {
    assert.ok(base[c], 'no style for .' + c)
    Object.assign(out, base[c])
  })
  return out
}
// [chain of alternatives]: an if / elif / else run of siblings is one slot
function slots (kids) {
  const out = []
  kids.forEach(k => {
    if ((k.attrs.elif !== undefined || k.attrs.else !== undefined) && out.length) out[out.length - 1].push(k)
    else out.push([k])
  })
  return out
}
const isTarget = n => n.tag === 'input' || (n.attrs.onclick !== undefined && n.tag === 'div')
const hasTarget = n => isTarget(n) || n.kids.some(hasTarget)

const problems = []
const bad = msg => problems.push(msg)

// Lays a node out inside a box of pw x ph. Returns { w, h, mt, ml, mr, kids: [slot boxes], node }.
function lay (node, pw, ph, isRound, where) {
  const p = propsOf(node, isRound)
  const w = unit(p.width, pw)
  const h = unit(p.height, ph)
  const name = where + '>' + node.tag + '.' + (node.attrs.class || '')
  if (w === null || h === null) { bad(name + ' has no explicit width or height'); return { w: w || 0, h: h || 0, mt: 0, ml: 0, mr: 0, kids: [], node: node, name: name } }
  if (isTarget(node) && node.tag === 'input' && h < 56) bad(name + ' is a target under 56 px tall')
  if (node.tag === 'input' && w < 55.5) bad(name + ' is a target only ' + w.toFixed(0) + ' px wide')
  const box = { w: w, h: h, mt: unit(p['margin-top'], pw) || 0, ml: unit(p['margin-left'], pw) || 0, mr: unit(p['margin-right'], pw) || 0, kids: [], node: node, name: name, props: p }
  const dir = p['flex-direction'] || (node.tag === 'list' ? 'column' : 'row')
  const kids = node.tag === 'stack' ? node.kids : node.kids
  const sl = slots(kids)
  if (node.tag === 'text' || node.tag === 'input' || node.tag === 'progress') return box
  if (sl.length > 1 && !p['flex-direction'] && node.tag === 'div') bad(name + ' holds several children and does not say which way they lay out')
  sl.forEach(alts => {
    const variants = alts.map(k => lay(k, w, h, isRound, name))
    box.kids.push(variants)
  })
  const rep = box.kids.map(vs => vs.reduce((a, b) => (b.h + b.mt > a.h + a.mt ? b : a)))
  if (node.tag === 'stack') { rep.forEach(r => { if (r.w > w + 0.5 || r.h > h + 0.5) bad(name + ' child exceeds the stack') }) } else if (dir === 'column') {
    const total = rep.reduce((s, r) => s + r.h + r.mt, 0)
    box.content = total
    if (node.tag !== 'list' && total > h + 0.5) bad(name + ' children are ' + total.toFixed(0) + ' tall in a box of ' + h.toFixed(0))
    rep.forEach(r => { if (r.w + r.ml + r.mr > w + 0.5) bad(r.name + ' is wider than ' + name) })
  } else {
    box.content = rep.reduce((s, r) => s + r.w + r.ml + r.mr, 0)
    if (box.content > w + 0.5) bad(name + ' children are ' + box.content.toFixed(0) + ' wide in a box of ' + w.toFixed(0))
    rep.forEach(r => { if (r.h > h + 0.5) bad(r.name + ' is taller than ' + name) })
    // 8 px between neighbouring targets: the margins between them
    for (let i = 1; i < rep.length; i++) {
      const a = box.kids[i - 1]; const b = box.kids[i]
      a.forEach(x => b.forEach(y => { if (isTarget(x.node) && isTarget(y.node) && x.mr + y.ml < 7.99) bad(name + ': ' + x.name + ' and ' + y.name + ' are ' + (x.mr + y.ml).toFixed(1) + ' px apart') }))
    }
  }
  // a column: targets stacked, 8 px between them (margin plus the room a centred box leaves)
  if (dir === 'column' && node.tag !== 'list') {
    for (let i = 1; i < box.kids.length; i++) {
      box.kids[i - 1].forEach(x => box.kids[i].forEach(y => {
        if (!hasTarget(x.node) || !hasTarget(y.node)) return
        const slack = b => (b.node.tag === 'input' ? 0 : (b.h - tallest(b)) / 2)
        const gap = y.mt + slack(y) + slack(x)
        if (gap < 7.99) bad(name + ': ' + x.name + ' and ' + y.name + ' are ' + gap.toFixed(1) + ' px apart')
      }))
    }
  }
  return box
}
function tallest (b) {
  if (b.node.tag === 'input') return b.h
  let m = 0
  b.kids.forEach(vs => vs.forEach(v => { if (hasTarget(v.node)) m = Math.max(m, tallest(v)) }))
  return m || b.h
}

// Every row of a screen block against the circle: [{ name, top, bottom, width, chord }]
function rowsOf (box, top) {
  const out = []
  let y = top
  box.kids.forEach(vs => {
    const rep = vs.reduce((a, b) => (b.h + b.mt > a.h + a.mt ? b : a))
    y += rep.mt
    vs.forEach(v => {
      if (v.node.tag === 'list') {
        let ly = y
        v.kids.forEach(items => {
          const it = items[0]
          if (ly + it.h > y + v.h + 0.5) return
          // a list-item holds a div that holds the button or text
          const inner = it.kids[0][0]
          const content = inner.kids.length ? Math.max.apply(null, inner.kids.map(k => k[0].w)) : it.w
          out.push({ name: it.name, top: ly, bottom: ly + it.h, width: content })
          ly += it.h
        })
        // scrolled to the end, the last item sits at the list's bottom edge
        const last = v.kids[v.kids.length - 1][0]
        const li = last.kids[0][0]
        out.push({ name: last.name + ' (scrolled to the end)', top: y + v.h - last.h, bottom: y + v.h, width: li.kids.length ? Math.max.apply(null, li.kids.map(k => k[0].w)) : last.w })
      } else {
        const width = v.kids.length && v.node.tag === 'div' && v.node.attrs.class !== 'pick' && v.node.attrs.class !== 'ring' ? Math.min(v.w, v.content || v.w) : v.w
        out.push({ name: v.name, top: y, bottom: y + v.h, width: width })
      }
    })
    y += rep.h
  })
  return out
}

const table = []
const all = []
test('every screen: explicit sizes, targets at least 56 px with 8 px between, rows inside the circle', () => {
  const screens2 = screens.map((s, i) => ({ s: s, id: String(s.attrs.if).replace(/[{}]/g, '') }))
  screens2.forEach(({ s, id }) => {
    problems.length = 0
    const dims = {}
    ;[['round 466', 466, 466, true], ['rect 336x480', 336, 480, false]].forEach(([label, sw, sh, isRound]) => {
      const box = lay(s, sw, sh, isRound, id)
      const total = box.kids.reduce((t, vs) => t + vs.reduce((a, b) => (b.h + b.mt > a.h + a.mt ? b : a)).h + vs.reduce((a, b) => (b.h + b.mt > a.h + a.mt ? b : a)).mt, 0)
      if (total > sh) bad(id + ' (' + label + ') is ' + total + ' tall on a ' + sh + ' screen')
      dims[label] = total
      if (isRound) {
        const top = (sh - total) / 2
        let worst = Infinity
        rowsOf(box, top).forEach(r => {
          const chord = chordAt(r.top, r.bottom, sh)
          if (r.width > chord + 0.5) bad(id + ': ' + r.name + ' is ' + r.width.toFixed(0) + ' wide at y ' + r.top.toFixed(0) + '-' + r.bottom.toFixed(0) + ' where the circle is ' + chord.toFixed(0))
          worst = Math.min(worst, chord - r.width)
        })
        dims.room = worst
        dims.top = top
      }
    })
    table.push([id.replace('s_', ''), Math.round(dims['round 466']), Math.round(dims['rect 336x480']), Math.round(dims.top), Math.round(dims.room)])
    all.push.apply(all, problems)
  })
  assert.deepEqual(all, [])
  console.log('screen        round 466  rect 336x480  round top y  narrowest room in circle (px)')
  table.forEach(r => console.log(r[0].padEnd(12), String(r[1]).padStart(9), String(r[2]).padStart(13), String(r[3]).padStart(12), String(r[4]).padStart(10)))
})
