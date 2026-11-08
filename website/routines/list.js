// The routines list: search, filters and sort over the cards the page already has. The page works
// without this file (every routine is listed); with it, the cards are hidden and reordered in
// place, the filters live in the address so a filtered list can be shared, and the "copied"
// counts come from the routines service.
import { GROUPS, emptyState, stateFromQuery, queryFromState, activeCount, haystack, matches, facetCounts, sortRoutines } from './filter.mjs'

const $ = id => document.getElementById(id)
const data = JSON.parse($('rt-data').textContent)
const list = data.routines
const form = $('filters')
const grid = $('grid')
const cards = new Map([...grid.children].map(li => [li.dataset.slug, li]))
let names = null
let hays = {}
let popular = {}
let state = stateFromQuery(location.search)

const options = {}
for (const g of GROUPS) options[g] = [...form.querySelectorAll(`input[name="${g}"]`)].map(i => i.value)

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
  const s = emptyState()
  s.q = $('q').value
  s.sort = $('sort').value
  for (const g of GROUPS) {
    const on = [...form.querySelectorAll(`input[name="${g}"]:checked`)].map(i => i.value)
    if (g === 'len') s.len = on[0] || ''
    else s[g] = on
  }
  return s
}

function writeForm(s) {
  $('q').value = s.q
  $('sort').value = s.sort
  for (const g of GROUPS) {
    for (const i of form.querySelectorAll(`input[name="${g}"]`)) i.checked = g === 'len' ? s.len === i.value : s[g].includes(i.value)
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function render() {
  const shown = sortRoutines(list.filter(r => matches(r, state, hays[r.s])), state.sort, popular)
  const keep = new Set(shown.map(r => r.s))
  for (const [slug, li] of cards) li.hidden = !keep.has(slug)
  for (const r of shown) grid.appendChild(cards.get(r.s))
  $('count').textContent = plural(shown.length, 'routine', 'routines')
  $('fdone-n').textContent = shown.length
  $('empty').hidden = shown.length > 0
  const n = activeCount(state)
  $('fcount').hidden = !n
  $('fcount').textContent = n
  $('rclear').hidden = !n && !state.q
  const counts = facetCounts(list, state, options, hays)
  for (const g of GROUPS) {
    for (const i of form.querySelectorAll(`input[name="${g}"]`)) {
      const c = counts[g][i.value]
      const ct = i.parentElement.querySelector('[data-ct]')
      if (ct) ct.textContent = c
      // An option that would empty the list is greyed, never removed, so nothing jumps around.
      i.disabled = !i.checked && c === 0
    }
  }
  const q = queryFromState(state)
  if (q !== location.search) history.replaceState(null, '', location.pathname + q + location.hash)
}

let typing = 0
$('q').addEventListener('input', () => {
  needNames()
  clearTimeout(typing)
  typing = setTimeout(() => { state = readForm(); render() }, 120)
})
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault() })
form.addEventListener('change', () => { state = readForm(); render() })
$('sort').addEventListener('change', () => { state = readForm(); if (state.sort === 'popular') loadPopular(); render() })
// The radios for session length can be unpicked by picking them again.
form.addEventListener('click', e => {
  const i = e.target.closest('input[type=radio]')
  if (!i) return
  if (i.dataset.was === '1') { i.checked = false; i.dataset.was = ''; state = readForm(); render(); return }
  form.querySelectorAll(`input[name="${i.name}"]`).forEach(x => { x.dataset.was = '' })
  i.dataset.was = '1'
})
function clearAll() {
  const sort = state.sort
  state = { ...emptyState(), sort }
  writeForm(state)
  form.querySelectorAll('input[type=radio]').forEach(x => { x.dataset.was = '' })
  render()
}
form.addEventListener('reset', e => { e.preventDefault(); clearAll() })
$('rclear').addEventListener('click', () => { clearAll(); $('q').focus() })

/* ------------------------------- the sheet (phones) ------------------------------- */

const wide = matchMedia('(min-width: 960px)')
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
  document.body.classList.add('rt-sheet-open')
  $('fopen').setAttribute('aria-expanded', 'true')
  setTimeout(() => $('fclose').focus(), 60)
}
function closeSheet() {
  if (!form.classList.contains('open')) return
  form.classList.remove('open')
  form.setAttribute('role', 'search')
  form.removeAttribute('aria-modal')
  scrim.classList.remove('on')
  setTimeout(() => { scrim.hidden = true }, 300)
  document.body.classList.remove('rt-sheet-open')
  $('fopen').setAttribute('aria-expanded', 'false')
  ;(opener || $('fopen')).focus()
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
  const f = [...form.querySelectorAll('button, input:not(:disabled), select')].filter(x => x.offsetParent !== null)
  if (!f.length) return
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
})
// Swipe the sheet down to close it, from its header.
let drag = null
form.querySelector('.rt-fhead').addEventListener('pointerdown', e => { if (!wide.matches) drag = { y: e.clientY, t: performance.now(), id: e.pointerId } })
window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return
  const dy = Math.max(0, e.clientY - drag.y)
  form.style.transition = 'none'
  form.style.transform = `translateY(${dy}px)`
})
window.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return
  const dy = Math.max(0, e.clientY - drag.y)
  const v = dy / Math.max(1, performance.now() - drag.t)
  form.style.transition = ''
  form.style.transform = ''
  drag = null
  if (dy > 120 || v > 0.6) closeSheet()
})

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
