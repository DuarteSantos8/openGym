// opengym.ch/brand: the background picker, copy-on-tap colours and the contents that follow the reading.
(() => {
  const K = 'brand/kit/logo/'
  // 1. Pick a background, get the right logo file
  const stage = document.querySelector('.bg-stage')
  if (stage) {
    const logo = stage.querySelector('.bg-stage-logo')
    const note = document.querySelector('.bg-note')
    const svg = document.querySelector('.bg-dl-live a[data-dl="svg"]')
    const png = document.querySelector('.bg-dl-live a[data-dl="png"]')
    const tabs = [...document.querySelectorAll('.bg-tab')]
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
  }

  // 2. Tap a colour to copy it
  document.querySelectorAll('.bg-sw').forEach(b => b.addEventListener('click', () => {
    try { navigator.clipboard.writeText(b.dataset.copy) } catch (e) {}
    b.classList.add('is-copied'); setTimeout(() => b.classList.remove('is-copied'), 1200)
  }))

  // 3. The contents mark the section being read
  const links = [...document.querySelectorAll('.bg-toc-a')]
  const targets = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean)
  if (!links.length || !('IntersectionObserver' in window)) return
  let current = null
  const io = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) current = e.target.id })
    links.forEach(a => a.classList.toggle('is-on', a.getAttribute('href') === '#' + current))
  }, { rootMargin: '-20% 0px -70% 0px' })
  targets.forEach(t => io.observe(t))
})()
