// The routines list: search, filters and sort over the cards the page already has. The page works
// without this file (every routine is listed); with it, the cards are hidden and reordered in
// place, the filters live in the address so a filtered list can be shared, and the "copied"
// counts come from the routines service. The rules themselves are in filter.mjs.
import { GROUPS, QUICK, emptyState, stateFromQuery, queryFromState, activeCount, haystack, matches, facetCounts, sortRoutines, highlightRanges, words, fold } from './filter.mjs'

const $ = id => document.getElementById(id)
const data = JSON.parse($('rt-data').textContent)
const list = data.routines
const form = $('filters')
const grid = $('grid')
const cards = new Map([...grid.children].map(li => [li.dataset.slug, li]))
const reduce = matchMedia('(prefers-reduced-motion: reduce)')
const wide = matchMedia('(min-width: 960px)')
let names = null
let hays = {}
let popular = {}
let state = stateFromQuery(location.search)

const options = {}
for (const g of GROUPS) options[g] = [...form.querySelectorAll(`input[name="${g}"]`)].map(i => i.value)
// What a picked option is called, for the chips above the results.
const labelOf = (g, v) => form.querySelector(`input[name="${g}"][value="${CSS.escape(v)}"]`)?.nextElementSibling?.firstChild?.textContent?.trim() || v

function rebuildHays() {
  hays = Object.fromEntries(list.map(r => [r.s, haystack(r, names || {})]))
}
rebuildHays()

// The exercise names (every language) arrive on the first keystroke: most visits never search.
let loadingNames = null
function needNames() {
  if (names || loadingNames) return
  loadingNames = fetch(data.base + 'names.json').then(r => (r.ok ? r.json() : {})).then(n => { names = n; rebuildHays(); render() }).catch(() => {})
}

function readForm() {
  const s = { ...emptyState(), home: state.home }
  s.q = $('q').value
  s.sort = $('sort').value
  for (const g of GROUPS) {
    const on = [...form.querySelectorAll(`input[name="${g}"]:checked`)].map(i => i.value)
    if (g === 'len') s.len = on[0] || ''
    else s[g] = on
  }
  s.kitonly = $('kitonly').checked && s.kit.length > 0
  return s
}

function writeForm(s) {
  $('q').value = s.q
  $('sort').value = s.sort
  for (const g of GROUPS) {
    for (const i of form.querySelectorAll(`input[name="${g}"]`)) i.checked = g === 'len' ? s.len === i.value : s[g].includes(i.value)
  }
  $('kitonly').checked = s.kitonly
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Text with the search words wrapped in <mark>, built from text nodes (never from HTML). */
function paint(el, q) {
  if (el.dataset.raw == null) el.dataset.raw = el.textContent
  const raw = el.dataset.raw
  const ranges = q ? highlightRanges(raw, q) : []
  if (!ranges.length) { if (el.textContent !== raw || el.children.length) el.textContent = raw; return }
  const out = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) out.push(document.createTextNode(raw.slice(at, a)))
    const m = document.createElement('mark')
    m.textContent = raw.slice(a, b)
    out.push(m)
    at = b
  }
  if (at < raw.length) out.push(document.createTextNode(raw.slice(at)))
  el.replaceChildren(...out)
}

function activeChips() {
  const box = $('active')
  const items = []
  for (const g of GROUPS) {
    const vals = g === 'len' ? (state.len ? [state.len] : []) : state[g]
    for (const v of vals) items.push({ label: labelOf(g, v), drop: s => (g === 'len' ? { ...s, len: '' } : { ...s, [g]: s[g].filter(x => x !== v), ...(g === 'kit' && s.kit.length === 1 ? { kitonly: false } : {}) }) })
  }
  if (state.kitonly) items.push({ label: 'Only what I picked', drop: s => ({ ...s, kitonly: false }) })
  if (state.home) items.push({ label: 'At home', drop: s => ({ ...s, home: false }) })
  box.replaceChildren()
  box.hidden = !items.length
  for (const it of items) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ac'
    b.setAttribute('aria-label', `Remove ${it.label}`)
    b.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>'
    b.firstChild.textContent = it.label
    b.addEventListener('click', () => {
      const next = b.nextElementSibling || b.previousElementSibling
      apply(it.drop(state))
      ;(next && document.contains(next) ? next : $('q')).focus?.()
    })
    box.appendChild(b)
  }
  if (items.length > 1) {
    const c = document.createElement('button')
    c.type = 'button'
    c.className = 'ac-clear'
    c.textContent = 'Clear all'
    c.addEventListener('click', () => { clearAll(); $('q').focus() })
    box.appendChild(c)
  }
}

function render() {
  const shown = sortRoutines(list.filter(r => matches(r, state, hays[r.s])), state.sort, popular)
  const keep = new Set(shown.map(r => r.s))
  for (const [slug, li] of cards) li.hidden = !keep.has(slug)
  // Reorder only when the order changed: moving nodes resets hover and focus for nothing.
  const now = [...grid.children].filter(li => !li.hidden).map(li => li.dataset.slug)
  if (now.join() !== shown.map(r => r.s).join()) for (const r of shown) grid.appendChild(cards.get(r.s))
  const q = state.q.trim()
  const qw = words(q)
  for (const r of shown) {
    const li = cards.get(r.s)
    li.querySelectorAll('[data-hl]').forEach(el => paint(el, q))
    // Found, but not in anything the card shows: say where, so the match doesn't look random.
    const hit = li.querySelector('[data-hit]')
    const seen = fold([r.t, r.d, r.a].join(' '))
    const hidden = qw.filter(w => !seen.includes(w))
    hit.hidden = !hidden.length
    if (hidden.length) {
      const inTags = hidden.every(w => fold((r.tags || []).join(' ')).includes(w))
      const inDays = hidden.every(w => fold((r.sn || []).join(' ')).includes(w))
      hit.textContent = inTags ? 'Matches a tag' : inDays ? 'Matches a day name' : 'Matches an exercise'
    }
  }
  const n = shown.length
  $('count').textContent = q || activeCount(state) ? `${plural(n, 'routine', 'routines')} found` : plural(n, 'routine', 'routines')
  $('fdone-n').textContent = n === 1 ? '1 routine' : `${n} routines`
  $('empty').hidden = n > 0
  const a = activeCount(state)
  $('fcount').hidden = !a
  $('fcount').textContent = a
  $('fclear').disabled = !a && !state.kitonly
  for (const b of document.querySelectorAll('[data-quick]')) b.setAttribute('aria-pressed', String(QUICK[b.dataset.quick].on(state)))
  activeChips()
  const counts = facetCounts(list, state, options, hays)
  for (const g of GROUPS) {
    for (const i of form.querySelectorAll(`input[name="${g}"]`)) {
      const c = counts[g][i.value]
      const ct = i.parentElement.querySelector('[data-ct]')
      if (ct) ct.textContent = c
      // An option that would empty the list is greyed, never removed, so nothing jumps around.
      i.disabled = !i.checked && c === 0
      i.parentElement.title = i.disabled ? 'Nothing matches this with your other filters' : ''
    }
  }
  $('kitonly').disabled = !state.kit.length
  const search = queryFromState(state)
  if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash)
}

/** The results' top edge stays where the reader can see it when the list gets shorter. */
function keepResultsInView() {
  const head = document.querySelector('.rt-rhead')
  const sticky = wide.matches ? 70 : (document.querySelector('.rt-tools')?.getBoundingClientRect().bottom || 120)
  const top = head.getBoundingClientRect().top
  if (top < sticky) window.scrollBy({ top: top - sticky - 12, behavior: reduce.matches ? 'auto' : 'smooth' })
}

function apply(next, { scroll = true } = {}) {
  state = { ...next, kitonly: next.kitonly && next.kit.length > 0 }
  writeForm(state)
  render()
  if (scroll && !form.classList.contains('open')) keepResultsInView()
}

let typing = 0
$('q').addEventListener('input', () => {
  needNames()
  clearTimeout(typing)
  typing = setTimeout(() => { state = readForm(); render() }, 110)
})
$('q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(typing); state = readForm(); render(); keepResultsInView() }
  if (e.key === 'Escape' && $('q').value) { $('q').value = ''; state = readForm(); render() }
})
form.addEventListener('change', () => apply(readForm()))
$('sort').addEventListener('change', () => { state = readForm(); if (state.sort === 'popular') loadPopular(); render() })
// The radios for session length can be unpicked by picking them again.
form.addEventListener('click', e => {
  const i = e.target.closest('input[type=radio]')
  if (!i) return
  if (i.dataset.was === '1') { i.checked = false; i.dataset.was = ''; apply(readForm()); return }
  form.querySelectorAll(`input[name="${i.name}"]`).forEach(x => { x.dataset.was = '' })
  i.dataset.was = '1'
})
document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => {
  const qp = QUICK[b.dataset.quick]
  apply(qp.set(state, !qp.on(state)))
}))
function clearAll() {
  apply({ ...emptyState(), q: state.q, sort: state.sort })
  form.querySelectorAll('input[type=radio]').forEach(x => { x.dataset.was = '' })
}
form.addEventListener('reset', e => { e.preventDefault(); clearAll() })
$('eclear').addEventListener('click', () => { apply({ ...emptyState(), sort: state.sort }); $('q').focus() })

/* ------------------------------- the sheet (phones and tablets) ------------------------------- */

const scrim = document.createElement('div')
scrim.className = 'rt-scrim'
scrim.hidden = true
document.body.appendChild(scrim)
let opener = null
function openSheet() {
  if (wide.matches) return
  opener = document.activeElement
  scrim.hidden = false
  requestAnimationFrame(() => scrim.classList.add('on'))
  form.classList.add('open')
  form.setAttribute('role', 'dialog')
  form.setAttribute('aria-modal', 'true')
  document.documentElement.classList.add('rt-sheet-open')
  $('fopen').setAttribute('aria-expanded', 'true')
  setTimeout(() => $('fclose').focus({ preventScroll: true }), 60)
}
function closeSheet() {
  if (!form.classList.contains('open')) return
  form.classList.remove('open')
  form.style.transform = ''
  form.setAttribute('role', 'search')
  form.removeAttribute('aria-modal')
  scrim.classList.remove('on')
  setTimeout(() => { scrim.hidden = true }, 300)
  document.documentElement.classList.remove('rt-sheet-open')
  $('fopen').setAttribute('aria-expanded', 'false')
  ;(opener || $('fopen')).focus({ preventScroll: true })
  keepResultsInView()
}
$('fopen').addEventListener('click', openSheet)
$('fclose').addEventListener('click', closeSheet)
$('fdone').addEventListener('click', closeSheet)
scrim.addEventListener('click', closeSheet)
wide.addEventListener('change', () => { if (wide.matches) closeSheet() })
document.addEventListener('keydown', e => {
  if (!form.classList.contains('open')) return
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return }
  if (e.key !== 'Tab') return
  const f = [...form.querySelectorAll('button:not(:disabled), input:not(:disabled), select')].filter(x => x.getClientRects().length)
  if (!f.length) return
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
})
// Pull the sheet down by its top bar to close it: it follows the finger, a flick is enough.
let drag = null
form.querySelector('.rt-fhead').addEventListener('pointerdown', e => {
  if (wide.matches || e.target.closest('button')) return
  drag = { y: e.clientY, last: e.clientY, t: performance.now(), v: 0, id: e.pointerId }
  form.setPointerCapture?.(e.pointerId)
})
form.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return
  const now = performance.now()
  drag.v = (e.clientY - drag.last) / Math.max(1, now - drag.t)
  drag.last = e.clientY
  drag.t = now
  const dy = e.clientY - drag.y
  // Upwards it resists instead of stopping dead.
  const y = dy >= 0 ? dy : -Math.sqrt(-dy) * 2
  form.style.transition = 'none'
  form.style.transform = `translateY(${y}px)`
})
const endDrag = e => {
  if (!drag || e.pointerId !== drag.id) return
  const dy = e.clientY - drag.y
  const v = drag.v
  form.style.transition = ''
  drag = null
  if (dy > 110 || v > 0.5) closeSheet()
  else form.style.transform = ''
}
form.addEventListener('pointerup', endDrag)
form.addEventListener('pointercancel', endDrag)

/* ------------------------------- popularity ------------------------------- */

function showPopular() {
  for (const r of list) {
    const el = cards.get(r.s)?.querySelector('[data-pop]')
    const n = popular[r.id] || 0
    if (!el) continue
    el.hidden = !n
    el.textContent = n ? `Copied ${n === 1 ? 'once' : n + ' times'}` : ''
  }
}
let popLoaded = false
function loadPopular() {
  if (popLoaded) return
  popLoaded = true
  fetch(data.api + 'stats', { headers: { accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : {})).then(j => { popular = j && typeof j === 'object' ? (j.copies || {}) : {}; showPopular(); if (state.sort === 'popular') render() })
    .catch(() => {})
}
const idle = window.requestIdleCallback || (f => setTimeout(f, 800))
idle(loadPopular)

writeForm(state)
if (state.q) needNames()
render()
