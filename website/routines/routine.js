// One routine's page: counts a "Copy to openGym" (no cookie, nothing about you, see the service),
// turns the sessions into tabs on phones and tablets, draws the QR code on computers when asked,
// and keeps a "Copy to openGym" button in reach on phones.
const $ = id => document.getElementById(id)
const art = document.querySelector('.rt-art')
const id = art?.dataset.id
const api = document.querySelector('meta[name=rt-api]')?.content || '/routines/api/'

/* ------------------------------- counting copies ------------------------------- */

const counted = new Set()
function count(kind) {
  if (!id || counted.has(kind)) return
  counted.add(kind)
  const body = JSON.stringify({ id, kind })
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(api + 'copy', new Blob([body], { type: 'application/json' }))) return
  } catch { /* fall through */ }
  fetch(api + 'copy', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
}
const pop = document.querySelector('.rt-copy [data-pop]')
let flashTimer = 0
function flash(text) {
  if (!pop) return
  pop.hidden = false
  pop.classList.add('flash')
  pop.textContent = text
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => pop.classList.remove('flash'), 6000)
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-copy]')
  if (!a) return
  count(a.dataset.copy)
  if (a.dataset.copy === 'file') flash('Saved. Now in openGym: Plan, Import plan, and pick the file.')
  else flash('Opening openGym. No app yet? The page that opens has the download.')
})

fetch(api + 'stats', { headers: { accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).then(j => {
  const n = j?.copies?.[id] || 0
  if (n && pop && !pop.classList.contains('flash')) { pop.hidden = false; pop.textContent = `Copied into openGym ${n === 1 ? 'once' : n + ' times'} so far.` }
}).catch(() => {})

/* ------------------------------- sessions as tabs (below 1100px) ------------------------------- */

const days = document.querySelector('.rt-days.tabbed')
if (days) {
  const tablist = days.querySelector('[role=tablist]')
  const tabs = [...tablist.querySelectorAll('[role=tab]')]
  const panels = [...days.querySelectorAll('.rt-day')]
  const narrow = matchMedia('(max-width: 1099.98px)')
  const select = (i, { focus = false, scroll = false } = {}) => {
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1 })
    panels.forEach((p, k) => p.classList.toggle('on', k === i))
    if (focus) tabs[i].focus()
    tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (scroll) tablist.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  // Tab semantics only while it really is tabs; side by side it is a plain list of sections.
  const sync = () => {
    panels.forEach((p, k) => {
      if (narrow.matches) { p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', tabs[k].id); p.tabIndex = 0 }
      else { p.removeAttribute('role'); p.setAttribute('aria-labelledby', `day-${k + 1}-h`); p.removeAttribute('tabindex') }
    })
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i))
    t.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
      if (d) { e.preventDefault(); select((i + d + tabs.length) % tabs.length, { focus: true }) }
      if (e.key === 'Home') { e.preventDefault(); select(0, { focus: true }) }
      if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1, { focus: true }) }
    })
  })
  // A day in the week strip opens its session.
  document.querySelectorAll('.rt-week [data-day]').forEach(a => a.addEventListener('click', e => {
    if (!narrow.matches) return
    e.preventDefault()
    select(Number(a.dataset.day), { scroll: true })
  }))
  const fromHash = /^#day-(\d+)$/.exec(location.hash)
  select(fromHash ? Math.min(panels.length, Number(fromHash[1])) - 1 : 0)
  sync()
  narrow.addEventListener('change', sync)
}

/* ------------------------------- the QR code (computers, on request) ------------------------------- */

const qr = $('qr')
const fine = matchMedia('(hover: hover) and (pointer: fine)')
if (qr && fine.matches) {
  qr.hidden = false
  const toggle = $('qrtoggle')
  const box = $('qrbox')
  const tabs = [...qr.querySelectorAll('[role=tab]')]
  const canvas = $('qrc')
  let lib = null
  const draw = async url => {
    lib ||= await import('./qr.mjs')
    try {
      lib.generate(url).toCanvas(canvas, { on: [0, 0, 0, 255], off: [255, 255, 255, 255], pad: 2 })
      canvas.setAttribute('aria-label', 'QR code for ' + (tabs.find(t => t.dataset.qr === url)?.textContent || 'this page'))
    } catch { qr.hidden = true }
  }
  const pick = (t, focus) => {
    tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1 })
    if (focus) t.focus()
    draw(t.dataset.qr)
  }
  tabs.forEach((t, i) => {
    t.tabIndex = i ? -1 : 0
    t.addEventListener('click', () => pick(t))
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true) }
    })
  })
  toggle.addEventListener('click', () => {
    const open = box.hidden
    box.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.querySelector('span').textContent = open ? 'Hide the QR code' : 'Show a QR code'
    if (open && tabs[0]) pick(tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0])
  })
}

/* ------------------------------- the button that follows you (phones) ------------------------------- */

const sticky = $('sticky')
const copy = $('copy')
if (sticky && copy && 'IntersectionObserver' in window) {
  let copyVisible = false, footVisible = false, top = true
  const update = () => sticky.classList.toggle('away', copyVisible || footVisible || top)
  new IntersectionObserver(([e]) => { copyVisible = e.isIntersecting; update() }).observe(copy)
  const foot = document.querySelector('footer')
  if (foot) new IntersectionObserver(([e]) => { footVisible = e.isIntersecting; update() }).observe(foot)
  const onScroll = () => { const t = scrollY < 240; if (t !== top) { top = t; update() } }
  addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  update()
}
