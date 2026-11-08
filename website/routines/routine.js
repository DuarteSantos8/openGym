// One routine's page: counts a "Copy to openGym" (no cookie, nothing about you, see the service),
// draws the QR code on computers, and keeps a "Copy to openGym" button in reach on phones.
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

/* ------------------------------- the QR code (computers) ------------------------------- */

const qr = $('qr')
const fine = matchMedia('(hover: hover) and (pointer: fine)')
if (qr && fine.matches) {
  qr.hidden = false
  const tabs = [...qr.querySelectorAll('[role=tab]')]
  const canvas = $('qrc')
  let lib = null
  const draw = async url => {
    lib ||= await import('./qr.mjs')
    try {
      lib.generate(url).toCanvas(canvas, { on: [0, 0, 0, 255], off: [255, 255, 255, 255], pad: 3 })
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
  if (tabs[0]) pick(tabs[0])
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
