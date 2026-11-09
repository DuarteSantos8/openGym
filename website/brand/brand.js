// opengym.ch/brand: the background picker, copy-on-tap colours, the banner index and the entrances.
(() => {
  const K = 'brand/kit/logo/'
  // 1. Pick a background, get the right logo file
  const stage = document.querySelector('.bk-stage')
  const logo = stage && stage.querySelector('.bk-stage-logo')
  const note = document.querySelector('.bk-note')
  const svg = document.querySelector('.bk-cell[data-dl="svg"]')
  const png = document.querySelector('.bk-cell[data-dl="png"]')
  const tabs = [...document.querySelectorAll('.bk-tab')]
  const pick = t => {
    tabs.forEach(x => x.setAttribute('aria-selected', String(x === t)))
    stage.dataset.bg = t.dataset.bg
    logo.src = K + t.dataset.file + '.svg'
    svg.href = K + t.dataset.file + '.svg'
    png.href = K + t.dataset.file + '@4x.png'
    note.textContent = t.dataset.note
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t))
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!d) return
      const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); pick(n)
    })
  })

  // 2. Tap a colour to copy it
  document.querySelectorAll('.bk-row').forEach(b => b.addEventListener('click', () => {
    try { navigator.clipboard.writeText(b.dataset.copy) } catch (e) {}
    b.classList.add('is-copied'); setTimeout(() => b.classList.remove('is-copied'), 1200)
  }))

  // 3. Banner index: the frame shows the row you point at, level with it
  const ix = document.querySelector('.bk-ix')
  if (ix && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const frame = ix.querySelector('.bk-ix-frame'); const img = frame.querySelector('img')
    const show = row => {
      if (img.getAttribute('src') !== row.dataset.preview) { img.style.opacity = 0; setTimeout(() => { img.src = row.dataset.preview; img.style.opacity = 1 }, 120) }
      const max = ix.offsetHeight - frame.offsetHeight
      frame.style.transform = `translateY(${Math.max(0, Math.min(max, row.offsetTop - frame.offsetHeight / 2 + row.offsetHeight / 2))}px)`
    }
    ix.querySelectorAll('.bk-ix-row').forEach(r => { r.addEventListener('mouseenter', () => show(r)); r.addEventListener('focus', () => show(r)) })
  }

  // 4. Entrances: each section's parts rise in turn as it arrives (once)
  const groups = [['.bk-hero h1', '.bk-lead', '.bk-actions', '.bk-plate'], ['.bk-stage', '.bk-tabs', '.bk-logo-side h2', '.bk-note', '.bk-cells'],
    ['.bk-ratio', '.bk-sheet h2', '.bk-sheet-note', '.bk-rows li'], ['.bk-icons-head h2', '.bk-icons-head p', '.bk-tile'],
    ['.bk-banners h2', '.bk-ix-list li', '.bk-ix-frame'], ['.bk-use h2', '.bk-use-text p', '.bk-rules > div', '.bk-rules .bk-btn'], ['.bk-close-mark']]
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -8% 0px' })
  groups.forEach(g => { let d = 0; g.forEach(sel => document.querySelectorAll(sel).forEach(el => { el.setAttribute('data-in', ''); el.style.setProperty('--d', d + 'ms'); d = Math.min(d + 70, 560); io.observe(el) })) })
})()
