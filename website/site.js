// Behaviour for the openGym site: the header's navigation sheet, the contents
// drawer and its scrollspy, the scroll reveals, the demo frame, and the two things
// that come from the GitLab API (repo counts, release timeline).
// Every one of them fails soft — the page is complete without any of this running.

const GL_PROJECT = 'https://gitlab.com/api/v4/projects/DuarteSantos8%2Fopengym'

// Discord publishes an invite's guild counts to anyone who asks for the invite with
// ?with_counts=1 — no bot token, no widget to enable, and the API reflects the caller's
// Origin, so the browser is allowed to read it. The code is the permanent invite in the
// nav; if that invite is ever revoked this returns 404 and the count simply stays blank.
const DC_INVITE = 'https://discord.com/api/v10/invites/e62jY6fwVb?with_counts=1'

/* ------------------------------------------------------- one panel controller
   The navigation sheet and the contents drawer are the same object with different
   contents: one opener, one close button, Escape, a tap outside, focus held inside
   while open and handed back to the opener on close. Writing it once is the only
   way the two of them can stay indistinguishable to a reader.

   Both are CLOSED in CSS, so a panel is shut on first paint whatever this script
   does — and nothing is read back from storage to reopen one. */
const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'

function panel({ opener, panelEl, flag, closeBtn }) {
  if (!opener || !panelEl) return null
  const body = document.body
  let lastFocus = null

  const isOpen = () => body.classList.contains(flag)

  const set = open => {
    if (open === isOpen()) return
    if (open) lastFocus = document.activeElement
    body.classList.toggle(flag, open)
    opener.setAttribute('aria-expanded', String(open))
    panelEl.setAttribute('aria-hidden', String(!open))
    // The panel scrolls on its own; letting the page scroll behind it is the classic
    // menu bug where the reader loses their place on close.
    body.style.overflow = open ? 'hidden' : ''
    if (open) {
      // The close button first: it is the answer to "how do I get out of this".
      const first = panelEl.querySelector(closeBtn) || panelEl.querySelector(FOCUSABLE)
      first && first.focus({ preventScroll: true })
    } else if (lastFocus && document.contains(lastFocus)) {
      lastFocus.focus({ preventScroll: true })
    }
  }

  opener.addEventListener('click', e => { e.stopPropagation(); set(!isOpen()) })
  panelEl.querySelector(closeBtn)?.addEventListener('click', () => set(false))
  // Tapping a link inside navigates, so the panel has to get out of the way —
  // in-page anchors especially, which do not reload anything.
  panelEl.addEventListener('click', e => { if (e.target.closest('a')) set(false) })
  // The scrim is body::after, so it has no element of its own to listen on — a click
  // that lands outside both the panel and its opener is a click on the scrim.
  document.addEventListener('click', e => {
    if (!isOpen()) return
    if (e.target.closest('#' + panelEl.id) || e.target.closest('#' + opener.id)) return
    set(false)
  })
  document.addEventListener('keydown', e => {
    if (!isOpen()) return
    if (e.key === 'Escape') { e.preventDefault(); set(false); return }
    if (e.key !== 'Tab') return
    // Focus trap: Tab cycles inside the open panel instead of wandering the page
    // behind the scrim, where nothing is clickable anyway.
    const items = [...panelEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })
  return { set, isOpen }
}

;(() => {
  const nav = panel({
    opener: document.querySelector('.nav-toggle'),
    panelEl: document.getElementById('sitemenu'),
    flag: 'menu-open',
    closeBtn: '.nl'          // the hamburger itself is the ✕; focus the first link
  })
  const toc = panel({
    opener: document.querySelector('.toc-btn'),
    panelEl: document.getElementById('menu'),
    flag: 'contents-open',
    closeBtn: '.rail-close'
  })
  // Only one at a time: opening either closes the other, so there is never a
  // question of which panel a tap outside belongs to.
  document.querySelector('.nav-toggle')?.addEventListener('click', () => toc?.set(false))
  document.querySelector('.toc-btn')?.addEventListener('click', () => nav?.set(false))
  // Growing past the header breakpoint puts the links back in the bar, which would
  // leave the page scroll-locked behind a sheet nobody can see.
  addEventListener('resize', () => { if (innerWidth >= 1000) nav?.set(false) })

  // An earlier build remembered an open rail across visits. It no longer does, and
  // the stale key would otherwise sit in the browser forever.
  try { localStorage.removeItem('og_rail') } catch (e) {}
})()

/* --------------------------------------------------------------- you are here
   Marked at runtime rather than baked into each page: that is what lets all four
   pages ship the byte-identical header the whole site is built around. Only links
   to a page (not to a section of one) can be "the page you are on". */
;(() => {
  const here = location.pathname.replace(/\/index\.html$/, '/')
  document.querySelectorAll('.nav-quick .ql, .navsheet .nl').forEach(a => {
    const href = a.getAttribute('href') || ''
    if (href.includes('#') || /^https?:/.test(href)) return
    if (new URL(a.href).pathname.replace(/\/index\.html$/, '/') === here) {
      a.setAttribute('aria-current', 'page')
    }
  })
})()

/* ------------------------------------------------------------------- scrollspy
   The topic rail marks the section under the reader. Position math on scroll, not
   an IntersectionObserver: the sections differ wildly in height, and "the last
   heading that scrolled past a third of the screen" is the answer people expect. */
;(() => {
  const links = [...document.querySelectorAll('.side-link[href^="#"]')]
  if (!links.length) return
  const pairs = links
    .map(a => [document.getElementById(a.getAttribute('href').slice(1)), a])
    .filter(([t]) => t)
  if (!pairs.length) return
  let lit = null
  let raf = 0
  const spy = () => {
    raf = 0
    const y = scrollY + innerHeight * .33
    let cur = null
    for (const [t, a] of pairs) {
      if (t.getBoundingClientRect().top + scrollY <= y) cur = a
    }
    if (cur === lit) return
    lit?.classList.remove('on')
    ;(lit = cur)?.classList.add('on')
  }
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy) }, { passive: true })
  addEventListener('resize', spy)
  spy()
})()

/* ------------------------------------------------------------ chapter groups
   Where a rail has chapters with subchapters (.side-group / .side-subs), the group
   being read unfolds and the others stay closed, so a long contents list is never
   a wall. A no-op on the pages whose rail is a flat list. */
;(() => {
  const groups = [...document.querySelectorAll('.side-group')]
  if (!groups.length) return
  const openGroup = g => groups.forEach(x => x.classList.toggle('open', x === g))
  groups.forEach(g => {
    g.querySelector('.side-link')?.addEventListener('click', () => openGroup(g))
  })
  const target = a => a && document.getElementById(a.getAttribute('href').slice(1))
  const chapPairs = groups
    .map(g => [target(g.querySelector('.side-link[href^="#"]')), g])
    .filter(([t]) => t)
  const subPairs = [...document.querySelectorAll('.side-sub[href^="#"]')]
    .map(a => [target(a), a])
    .filter(([t]) => t)
  let raf = 0
  const spy = () => {
    raf = 0
    const y = scrollY + innerHeight * .33
    let curG = null
    for (const [t, g] of chapPairs) if (t.getBoundingClientRect().top + scrollY <= y) curG = g
    if (curG && !curG.classList.contains('open')) openGroup(curG)
    let curS = null
    for (const [t, a] of subPairs) if (t.getBoundingClientRect().top + scrollY <= y) curS = a
    subPairs.forEach(([, a]) => a.classList.toggle('on', a === curS && !!curS && curS.closest('.side-group') === curG))
  }
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(spy) }, { passive: true })
  spy()
})()

/* --------------------------------------------------------------- scroll reveal */
;(() => {
  const items = document.querySelectorAll('.rv')
  if (!items.length) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('in'))
    return
  }
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      obs.unobserve(e.target)          // one-way: nothing re-hides on the way back up
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: .06 })
  items.forEach(el => io.observe(el))
})()

/* ------------------------------------------------------------------ demo frame
   The demo is the whole frontend bundle. It is only worth loading when the framed
   phone is actually on screen, and never on a narrow viewport, where the CSS hides
   the frame in favour of a plain "open it full-screen" card. */
;(() => {
  const slot = document.querySelector('[data-demo]')
  if (!slot) return

  const mount = () => {
    if (slot.dataset.mounted) return
    if (!slot.offsetParent) return                 // frame hidden — phone layout
    slot.dataset.mounted = '1'
    const f = document.createElement('iframe')
    f.src = slot.dataset.demo
    f.title = 'openGym live demo'
    f.loading = 'lazy'
    f.style.cssText = 'width:100%;height:100%;border:0;display:block;border-radius:34px;background:#000'
    slot.appendChild(f)
  }

  if (!('IntersectionObserver' in window)) { mount(); return }
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) if (e.isIntersecting) { mount(); obs.disconnect() }
  }, { rootMargin: '600px' })                      // load just before it scrolls into view
  io.observe(slot)
  // A rotation or a resized window can reveal the frame long after that first check.
  addEventListener('resize', mount, { passive: true })
})()

/* ------------------------------------------------------- repo counts (nav + specs)
   Points at gitlab.com while the GitHub account is suspended; switch the two API URLs
   back to api.github.com once it is restored.

   The cache keys carry a _gl suffix: a visitor with a still-warm sessionStorage entry
   from the gitea era would otherwise be read with the old field names and show NaN. */
;(async () => {
  const set = (id, v) => document.querySelectorAll('[data-gh="' + id + '"]').forEach(el => { el.textContent = v })
  try {
    let d = null
    const cached = sessionStorage.getItem('repo_meta_gl')
    if (cached) d = JSON.parse(cached)
    else {
      const r = await fetch(GL_PROJECT)
      if (!r.ok) return
      const j = await r.json()
      // An unauthenticated project response carries star_count and forks_count and nothing
      // else countable — open_issues_count is only there for a logged-in caller, so reading
      // it here printed "undefined" on the live site. The issues endpoint answers it in the
      // X-Total header instead, and GitLab lists that header in Access-Control-Expose-Headers,
      // so the browser is allowed to read it. per_page=1 keeps the body to a single issue.
      let issues = ''
      try {
        const ri = await fetch(GL_PROJECT + '/issues?state=opened&per_page=1')
        if (ri.ok) issues = ri.headers.get('X-Total') || ''
      } catch (e) { /* count stays blank rather than wrong */ }
      d = { stars_count: j.star_count, forks_count: j.forks_count, open_issues_count: issues }
      sessionStorage.setItem('repo_meta_gl', JSON.stringify(d))
    }
    set('stars', '★ ' + d.stars_count)
    set('stars-n', d.stars_count)
    set('forks-n', d.forks_count)
    // Leave the placeholder standing rather than writing an empty box.
    if (d.open_issues_count !== '' && d.open_issues_count != null) set('issues-n', d.open_issues_count)
  } catch (e) { /* offline / rate-limited — leave placeholders */ }
})()

/* --------------------------------------------------- Discord members (nav + specs)
   Same shape as the repo counts above, and just as optional: the placeholder next to
   the Discord link is empty, so a blocked or rate-limited request leaves the link
   reading exactly as it did before anyone counted anything. */
;(async () => {
  const set = (id, v) => document.querySelectorAll('[data-dc="' + id + '"]').forEach(el => { el.textContent = v })
  try {
    let n = null
    const cached = sessionStorage.getItem('discord_members')
    if (cached) n = JSON.parse(cached)
    else {
      const r = await fetch(DC_INVITE)
      if (!r.ok) return
      const j = await r.json()
      n = j.approximate_member_count
      if (typeof n !== 'number') return
      sessionStorage.setItem('discord_members', JSON.stringify(n))
    }
    // Grouped like the other four-figure numbers on the page (1,324 exercises).
    const fmt = n.toLocaleString('en-US')
    set('members', fmt)
    set('members-n', fmt)
  } catch (e) { /* offline / blocked — the link keeps its plain label */ }
})()

/* -------------------------------------------------------------- about timeline
   Built from the published GitLab releases, so the page updates itself with every
   release. The static entries marked data-fallback stay in place when the API is
   unreachable; the hand-written first entry is always kept.

   GitLab's release objects differ from Gitea's: the notes are `description` (not `body`),
   the date is `released_at` (not `published_at`), the web link sits in `_links.self`, and
   there is no draft/prerelease pair — a not-yet-released one is `upcoming_release`. */
;(async () => {
  const tl = document.getElementById('milestones')
  if (!tl) return
  try {
    let rel = null
    const cached = sessionStorage.getItem('repo_releases_gl')
    if (cached) rel = JSON.parse(cached)
    else {
      const r = await fetch(GL_PROJECT + '/releases?per_page=100')
      if (!r.ok) return
      rel = (await r.json()).filter(x => !x.upcoming_release)
        .map(x => ({ tag: x.tag_name, name: x.name, at: x.released_at, body: x.description || '', url: (x._links && x._links.self) || ('https://gitlab.com/DuarteSantos8/opengym/-/releases/' + x.tag_name) }))
      sessionStorage.setItem('repo_releases_gl', JSON.stringify(rel))
    }
    if (!rel.length) return
    const fmt = d => new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
    // first paragraph of the notes (hard-wrapped lines rejoined), markdown crudely stripped
    const blurb = md => {
      const lines = md.replace(/\r/g, '').split('\n')
      let start = lines.findIndex(l => l.trim() && !l.trim().startsWith('#'))
      if (start < 0) return ''
      let para = []
      for (let i = start; i < lines.length && lines[i].trim(); i++) para.push(lines[i].trim())
      const txt = para.join(' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>]/g, '')
      return txt.length > 220 ? txt.slice(0, 217).replace(/\s+\S*$/, '') + '…' : txt
    }
    tl.querySelectorAll('[data-fallback]').forEach(el => el.remove())
    for (const x of rel.slice().reverse()) {   // oldest → newest, matching the timeline
      const li = document.createElement('li')
      const title = x.name && x.name !== x.tag ? x.name : x.tag
      li.innerHTML = '<b></b><span class="when"></span><p></p>'
      li.querySelector('b').textContent = title.startsWith(x.tag) ? title : x.tag + ' — ' + title
      li.querySelector('.when').textContent = fmt(x.at)
      const p = li.querySelector('p')
      p.textContent = blurb(x.body) + ' '
      const a = document.createElement('a')
      a.href = x.url; a.rel = 'noopener'; a.textContent = 'notes →'
      p.appendChild(a)
      tl.appendChild(li)
    }
  } catch (e) { /* fallback entries stay */ }
})()

/* The "and the rest of it" rail: arrows for pointers that cannot swipe. The cards are plain
   reading, so there is nothing to activate on them. */
;(() => {
  const rail = document.querySelector('.frail')
  if (!rail) return
  const nav = document.querySelector('.frail-nav')
  if (nav) {
    nav.hidden = false
    const [prev, next] = nav.querySelectorAll('.rnav')
    const step = () => (rail.querySelector('.fcard')?.offsetWidth || 260) + 16
    nav.addEventListener('click', e => {
      const btn = e.target.closest('.rnav')
      if (btn) rail.scrollBy({ left: Number(btn.dataset.dir) * step(), behavior: 'smooth' })
    })
    const sync = () => {
      prev.disabled = rail.scrollLeft < 4
      next.disabled = rail.scrollLeft > rail.scrollWidth - rail.clientWidth - 4
    }
    rail.addEventListener('scroll', sync, { passive: true })
    addEventListener('resize', sync)
    sync()
  }
})()

/* The hero intro is armed in the inline <head> script, before the first paint — a deferred
   script would arm it too late and the hero would flash. All this does is take the class off
   once the last element has landed, so nothing stays mid-animation. */
;(() => {
  const root = document.documentElement
  if (!root.classList.contains('intro')) return
  const done = () => root.classList.remove('intro')
  const last = document.querySelector('.hero-stage') || document.querySelector('.hero .actions')
  if (last) last.addEventListener('animationend', done, { once: true })
  setTimeout(done, 2400)   // if the animation never fires, do not leave the hero hidden
})()
