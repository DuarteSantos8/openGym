// The HTML of opengym.ch/routines: the list, one page per routine, the submit page. Plain
// template strings, every value through esc(). build.mjs writes the files; this only returns text.
import {
  GOALS, LEVELS, SPLITS, KIT, GROUPS, LANG_NAMES, GOAL_NAMES, LEVEL_NAMES, SPLIT_NAMES, KIT_NAMES, GROUP_NAMES,
  weeklyCounts, LIMITS, LICENSES
} from './lib.mjs'

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const jsonForScript = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const cap = s => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
export const clock = s => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`)
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]
const LONG_DAY = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Labels the list and the routine pages show (the library keeps its own words for the files). */
export const KIT_LABELS = { ...KIT_NAMES, bodyweight: 'No equipment' }
export const FOCUS_LABELS = { ...GROUP_NAMES, balanced: 'Balanced' }
export const LEN_LABELS = { 30: 'Up to 30 min', 45: 'Up to 45 min', 60: 'Up to an hour', 61: 'Over an hour' }

export const MEDIA_NOTICE = 'Exercise pictures © Aliaksandr Makatserchyk, Gym visual, gymvisual.com. Media licensed for use in openGym only; see'

/** The exercise name a routine in `lang` shows: the catalogue's translation, else English. */
export const nameIn = (id, lang, cat, names) => (lang !== 'en' && names[id]?.[lang]) || cap(cat.get(id)?.n || id)

export function prescription(x) {
  const amount = x.sec ? clock(x.sec) : x.repsMin ? `${x.repsMin}-${x.reps}` : String(x.reps)
  return `${x.sets} × ${amount}`
}

const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2.5v2.5M20.5 14.5v6h-3M14.5 20.5v-1"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>'
}

/* ------------------------------- the shell ------------------------------- */

export function page(ctx, { title, description, canonical, body, script, robots, jsonld = [], ogImage, ogType = 'website', lang = 'en', current = '', bodyClass = '' }) {
  const img = ogImage || 'https://opengym.ch/img/social.jpg'
  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#000000">
<meta name="rt-api" content="${esc(ctx.api)}">
<meta name="robots" content="${ctx.noindex ? 'noindex,nofollow' : robots || 'index,follow,max-image-preview:large'}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="openGym">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="stylesheet" href="/styles.css?v=${ctx.siteV}">
<link rel="stylesheet" href="${ctx.base}assets/routines.css?v=${ctx.v}">
<script>document.documentElement.className += ' js'</script>
${jsonld.map(j => `<script type="application/ld+json">${jsonForScript(j)}</script>`).join('\n')}
</head>
<body class="topnav rt-page${bodyClass ? ' ' + bodyClass : ''}">
<a class="skip" href="#main">Skip to content</a>
${ctx.staging ? '<div class="rt-staging" role="note">Staging preview. Submissions go to a test inbox, nothing here is public yet.</div>\n' : ''}${ctx.nav(current)}
<main id="main">
${body}
</main>
<footer><div class="wrap foot">
  <span class="c">Routine texts are their authors', shared under the licence named on each page. ${esc(MEDIA_NOTICE)} <a href="${ctx.base}media/NOTICE.md">NOTICE.md</a>.</span>
  <div class="links">
    <a href="${ctx.base}">All routines</a>
    <a href="${ctx.base}submit/">Share yours</a>
    <a href="/docs.html">Docs</a>
    <a href="/privacy.html">Privacy</a>
    <a href="https://github.com/DuarteSantos8/openGym/tree/main/routines" rel="noopener">Routines on GitHub</a>
  </div>
</div></footer>
<script src="/site.js?v=${ctx.siteV}" defer></script>
${script ? `<script type="module" src="${ctx.base}assets/${script}?v=${ctx.v}"></script>` : ''}
</body>
</html>
`
}

/* ------------------------------- bits ------------------------------- */

/** The seven-day strip of a card: one cell a day, lit where the routine trains. */
function weekCells(r) {
  const at = new Map((r.schedule || []).map(([d, i]) => [d, i]))
  if (!at.size) return `<span class="rc-anyday">Any ${plural(r.days, 'day', 'days')} a week</span>`
  const label = `Trains ${WEEK.filter(([d]) => at.has(d)).map(([d]) => LONG_DAY[d]).join(', ')}`
  return `<span class="rc-week" role="img" aria-label="${esc(label)}">${WEEK.map(([d, n]) => `<i class="${at.has(d) ? 'on' : ''}">${n[0]}</i>`).join('')}</span>`
}

/** The routine page's week: a column a day on wide screens, a row a day on phones. */
function weekStrip(r) {
  const at = new Map((r.schedule || []).map(([d, i]) => [d, i]))
  if (!at.size) {
    return `<p class="rt-week-none">No fixed weekdays. Train the ${r.sessions.length === 1 ? 'session' : `${r.sessions.length} sessions`} in order, ${plural(r.days, 'day', 'days')} a week, whenever life allows.</p>`
  }
  return `<ol class="rt-week" aria-label="The week">${WEEK.map(([d, n]) => {
    const i = at.get(d)
    const inner = `<span class="d" aria-hidden="true">${n}</span><span class="sr">${LONG_DAY[d]}: </span><span class="s">${i == null ? 'Rest' : esc(r.sessions[i].name)}</span>`
    return `<li class="${i == null ? 'rest' : 'on'}">${i == null ? `<span class="cell">${inner}</span>` : `<a class="cell" href="#day-${i + 1}" data-day="${i}">${inner}</a>`}</li>`
  }).join('')}</ol>`
}

const kitLine = f => (f.kit.length ? f.kit.map(k => KIT_LABELS[k]).join(', ') : 'No equipment')

/** The values of a filter group that at least one routine has, in the group's own order. */
function present(all, routines, valuesOf) {
  const have = new Set(routines.flatMap(r => valuesOf(r).map(String)))
  return all.map(String).filter(v => have.has(v))
}

/* ------------------------------- the list ------------------------------- */

/** The options the list offers: only values at least one routine has (a chip that can never show anything is a dead end). */
export function listOptions(routines) {
  const langs = [...new Set(routines.map(r => r.language))].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a < b ? -1 : 1))
  return {
    goal: present(GOALS, routines, r => [r.goal]),
    days: present([1, 2, 3, 4, 5, 6, 7], routines, r => [r.days]),
    len: ['30', '45', '60', '61'].filter(v => routines.some(r => (v === '61' ? r.duration > 60 : r.duration <= Number(v)))),
    kit: [...(routines.some(r => !r.facts.kit.length) ? ['bodyweight'] : []), ...present(KIT.filter(k => k !== 'bodyweight'), routines, r => r.facts.kit)],
    level: present(LEVELS, routines, r => [r.level]),
    focus: [...present(GROUPS, routines, r => r.facts.focus), ...(routines.some(r => !r.facts.focus.length) ? ['balanced'] : [])],
    split: present(SPLITS, routines, r => [r.split]),
    lang: langs
  }
}

/** The compact record of a routine the list's script filters on (website/routines/filter.mjs). */
export const listRecord = r => ({
  s: r.slug, id: r.id, t: r.title, d: r.description, a: r.author.name, g: r.goal, l: r.level, sp: r.split,
  n: r.days, m: r.duration, k: r.facts.kit, f: r.facts.focus, lang: r.language, tags: r.tags, at: r.added,
  src: r.source, ex: r.facts.ids, sn: r.sessions.map(s => s.name)
})

export function listPage(ctx, routines) {
  const cards = routines.map(r => card(ctx, r)).join('\n')
  const data = routines.map(listRecord)
  const opts = listOptions(routines)
  const chips = (name, labels, type = 'checkbox') => opts[name].map(v => `<label class="chip"><input type="${type}" name="${name}" value="${esc(v)}"><span>${esc(labels[v] ?? v)}<b class="ct" data-ct aria-hidden="true"></b></span></label>`).join('')
  // A group with a single option can't narrow anything, so it isn't offered (equipment always is).
  const group = (name, legend, labels, { type, cls = '', extra = '' } = {}) => (opts[name].length > 1 || name === 'kit'
    ? `<fieldset class="fg"><legend>${legend}</legend><div class="chips ${cls}">${chips(name, labels, type)}</div>${extra}</fieldset>`
    : '')
  const n = routines.length
  const body = `
<header class="wrap rt-hero">
  <div class="rt-hero-text">
    <h1>Routines worth stealing</h1>
    <p class="lead">Free training plans from openGym and the people who use it. Find one that fits your week and your kit, copy it into the app, or share the plan you swear by.</p>
    <div class="actions">
      <a class="btn" href="#browse">Browse ${n} routines</a>
      <a class="btn ghost" href="${ctx.base}submit/">Share yours</a>
    </div>
  </div>
  <aside class="rt-hero-how" aria-labelledby="how-h">
    <h2 id="how-h">Getting one into openGym</h2>
    <ul>
      <li>${ICON.phone}<div><b>On your phone</b><span>Open a routine, tap a day, and openGym adds it beside your own.</span></div></li>
      <li>${ICON.file}<div><b>The whole week</b><span>Download the plan file and import it under Plan, Import plan.</span></div></li>
      <li>${ICON.qr}<div><b>On a computer</b><span>Every routine has a QR code. Scan it with your phone camera or in openGym and carry on there.</span></div></li>
    </ul>
  </aside>
</header>

<div class="wrap rt-browse" id="browse">
  <div class="rt-tools">
    <label class="rt-search">
      <span class="sr">Search routines</span>
      ${ICON.search}
      <input id="q" type="search" name="q" placeholder="Search by name, author or exercise" autocomplete="off" enterkeyhint="search">
    </label>
    <button class="rt-fbtn" id="fopen" type="button" aria-controls="filters" aria-expanded="false">${ICON.sliders}<span>Filters</span><span class="ct" id="fcount" hidden></span></button>
    <label class="rt-sort"><span class="rt-sort-l">Sort</span>
      <select id="sort" name="sort">
        <option value="new">Newest</option>
        <option value="popular">Most copied</option>
        <option value="name">A to Z</option>
        <option value="short">Shortest sessions</option>
      </select>
    </label>
  </div>

  <div class="rt-cols">
    <form class="rt-filters" id="filters" aria-labelledby="filters-h" role="search">
      <div class="rt-fhead">
        <span class="rt-grab" aria-hidden="true"></span>
        <h2 id="filters-h">Filters</h2>
        <button type="button" class="rt-fclose" id="fclose" aria-label="Close filters">${ICON.close}</button>
      </div>
      <div class="rt-fscroll">
        ${group('goal', 'Goal', GOAL_NAMES)}
        ${group('days', 'Days a week', {}, { cls: 'days' })}
        ${group('len', 'Session length', LEN_LABELS, { type: 'radio' })}
        ${group('kit', 'Equipment', KIT_LABELS, { extra: '<label class="rt-switch"><input type="checkbox" name="kitonly" id="kitonly"><span class="tr" aria-hidden="true"></span><span class="tx">Only what I picked<small>Hide routines that need anything else</small></span></label>' })}
        ${group('level', 'Level', LEVEL_NAMES)}
        ${group('focus', 'Muscle focus', FOCUS_LABELS)}
        ${group('split', 'Split', SPLIT_NAMES)}
        ${group('lang', 'Language', LANG_NAMES)}
      </div>
      <div class="rt-ffoot">
        <button type="reset" class="btn ghost" id="fclear">Reset</button>
        <button type="button" class="btn" id="fdone">Show <span id="fdone-n">${n}</span></button>
      </div>
    </form>

    <section class="rt-results" aria-labelledby="count">
      <div class="rt-quick" role="group" aria-label="Quick picks">
        <button type="button" class="qp" data-quick="nokit" aria-pressed="false">No equipment</button>
        <button type="button" class="qp" data-quick="home" aria-pressed="false">At home</button>
        <button type="button" class="qp" data-quick="beginner" aria-pressed="false">Beginner friendly</button>
        <button type="button" class="qp" data-quick="short" aria-pressed="false">30 minutes or less</button>
      </div>
      <div class="rt-rhead">
        <h2 id="count" aria-live="polite" aria-atomic="true">${n} routines</h2>
        <div class="rt-active" id="active" role="group" aria-label="Active filters" hidden></div>
      </div>
      <ul class="rt-grid" id="grid">
${cards}
      </ul>
      <div class="rt-empty" id="empty" hidden>
        <h3>Nothing fits all of that</h3>
        <p>Loosen a filter or two, or try fewer words. Still nothing? Then the routine you want doesn't exist yet. Build it in openGym and <a href="${ctx.base}submit/">share it</a>, someone else is looking for it too.</p>
        <button type="button" class="btn ghost" id="eclear">Clear all filters</button>
      </div>
    </section>
  </div>
</div>

<section class="wrap rt-how" aria-labelledby="how2-h">
  <h2 id="how2-h">Getting one into openGym</h2>
  <div class="rt-how-cols">
    <div><h3>On your phone</h3><p>Open a routine and tap a day. openGym opens and adds it next to your own routines. Nothing you already have is touched.</p></div>
    <div><h3>The whole week</h3><p>Grab the plan file instead and import it in the app under Plan, Import plan. It brings every day and, if you want, the weekdays too.</p></div>
    <div><h3>On a computer</h3><p>Every routine has a QR code. Scan it with your phone camera or in openGym and carry on there.</p></div>
  </div>
</section>
<script type="application/json" id="rt-data">${jsonForScript({ api: ctx.api, base: ctx.base, routines: data })}</script>`
  return page(ctx, {
    title: 'Workout routines: free plans to copy into openGym',
    description: 'Free workout routines for the gym, home, a pull-up bar or a hotel room. Filter by goal, days a week, equipment and level, and copy any plan into openGym.',
    canonical: ctx.url(''),
    body, script: 'list.js', current: 'routines', bodyClass: 'rt-list',
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'openGym routines', url: ctx.url(''),
      description: 'Free workout routines to copy into openGym.',
      mainEntity: { '@type': 'ItemList', numberOfItems: routines.length, itemListElement: routines.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.url(r.slug + '/'), name: r.title })) }
    }]
  })
}

/** Exercise stills as small tiles: they are drawn on white, so they sit on a light tile on purpose. */
const stills = (ctx, ids, max) => {
  const shown = ids.slice(0, max)
  const more = ids.length - shown.length
  return `<span class="rc-stills" aria-hidden="true">${shown.map(id => `<span class="still"><img src="${ctx.base}media/${id}.webp" alt="" width="180" height="180" loading="lazy" decoding="async"></span>`).join('')}${more > 0 ? `<span class="still extra">+${more}</span>` : ''}</span>`
}

function card(ctx, r) {
  const f = r.facts
  return `<li class="rc" data-slug="${esc(r.slug)}">
  <a class="rc-link" href="${ctx.base}${esc(r.slug)}/">
    ${r.cover ? `<img class="rc-cover" src="${ctx.base}covers/${esc(r.coverFile)}" alt="" width="${r.coverW}" height="${r.coverH}" loading="lazy" decoding="async">` : ''}
    <span class="rc-head">
      <span class="rc-title" lang="${esc(r.language)}" data-hl>${esc(r.title)}</span>
      <span class="rc-by">by <span data-hl>${esc(r.author.name)}</span></span>
    </span>
    <span class="rc-tags"><span class="tag goal">${esc(GOAL_NAMES[r.goal])}</span><span class="tag">${esc(LEVEL_NAMES[r.level])}</span><span class="tag">${esc(SPLIT_NAMES[r.split])}</span>${r.language !== 'en' ? `<span class="tag">${esc(LANG_NAMES[r.language])}</span>` : ''}</span>
    <span class="rc-desc" lang="${esc(r.language)}" data-hl>${esc(r.description)}</span>
    <span class="rc-plan">
      <span class="rc-stats"><span><b>${r.days}</b> ${r.days === 1 ? 'day' : 'days'}</span><span><b>${r.duration}</b> min</span><span><b>${f.exerciseCount}</b> exercises</span></span>
      ${weekCells(r)}
    </span>
    <span class="rc-foot">
      ${stills(ctx, f.ids, 4)}
      <span class="rc-kit">${esc(kitLine(f))}</span>
    </span>
    <span class="rc-hit" data-hit hidden></span>
    <span class="rc-pop" data-pop hidden></span>
  </a>
</li>`
}

/* ------------------------------- one routine ------------------------------- */

export function routinePage(ctx, r, { cat, names, links, related = [] }) {
  const f = r.facts
  const lang = r.language
  const max = Math.max(...Object.values(f.volume), 1)
  const vol = Object.entries(f.volume).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const times = weeklyCounts(r)
  const pageUrl = ctx.url(r.slug + '/')
  const many = r.sessions.length > 1
  const days = r.sessions.map((s, i) => `
    <section class="rt-day" id="day-${i + 1}" aria-labelledby="day-${i + 1}-h" data-panel="${i}">
      <div class="rt-dayhead">
        <h3 id="day-${i + 1}-h" lang="${esc(lang)}">${esc(s.name)}</h3>
        <span class="rt-daymeta">${plural(s.exercises.length, 'exercise', 'exercises')}, ${s.exercises.reduce((n, x) => n + x.sets, 0)} sets${times[i] > 1 ? `, ${times[i]} times a week` : ''}</span>
      </div>
      ${s.note ? `<p class="rt-daynote" lang="${esc(lang)}">${esc(s.note)}</p>` : ''}
      <ol class="rt-ex">${s.exercises.map(x => `
        <li>
          <span class="still"><img src="${ctx.base}media/${x.id}.webp" alt="" width="180" height="180" loading="lazy" decoding="async"></span>
          <span class="rt-exbody">
            <span class="n" lang="${esc(lang === 'en' || names[x.id]?.[lang] ? lang : 'en')}">${esc(nameIn(x.id, lang, cat, names))}</span>
            <span class="p"><b>${esc(prescription(x))}</b> ${x.sec ? 'hold' : 'reps'}${x.rest != null ? `<span class="rest">rest ${esc(clock(x.rest))}</span>` : ''}</span>
            ${x.note ? `<span class="rt-exnote" lang="${esc(lang)}">${esc(x.note)}</span>` : ''}
          </span>
        </li>`).join('')}
      </ol>
      ${links[i] ? `<a class="rt-addday" href="${esc(links[i])}" data-copy="day">${ICON.phone}<span>Add <span lang="${esc(lang)}">${esc(s.name)}</span> to openGym</span></a>` : ''}
    </section>`).join('')
  const about = r.about ? r.about.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('') : ''
  const author = r.author.url ? `<a href="${esc(r.author.url)}" rel="noopener nofollow ugc">${esc(r.author.name)}</a>` : esc(r.author.name)
  const fileName = `${r.slug}.opengym-plan.json`
  const tabs = many ? `<div class="rt-tabs" role="tablist" aria-label="Sessions" hidden>${r.sessions.map((s, i) => `<button type="button" role="tab" id="tab-${i + 1}" aria-controls="day-${i + 1}" aria-selected="${i === 0}" data-tab="${i}" lang="${esc(lang)}">${esc(s.name)}</button>`).join('')}</div>` : ''
  const body = `
<div class="wrap rt-top"><a class="rt-back" href="${ctx.base}">All routines</a></div>
<article class="wrap rt-art" data-id="${esc(r.id)}">
  <header class="rt-head">
    <h1 lang="${esc(lang)}">${esc(r.title)}</h1>
    <p class="rt-by">by ${author}${r.source === 'starter' ? ', and built into the app' : ''}</p>
    <p class="rt-lead" lang="${esc(lang)}">${esc(r.description)}</p>
    <dl class="rt-facts">
      <div><dt>Days a week</dt><dd>${r.days}</dd></div>
      <div><dt>Per session</dt><dd>${r.duration} min</dd></div>
      <div><dt>Level</dt><dd>${esc(LEVEL_NAMES[r.level])}</dd></div>
      <div><dt>Goal</dt><dd>${esc(GOAL_NAMES[r.goal])}</dd></div>
      <div><dt>Split</dt><dd>${esc(SPLIT_NAMES[r.split])}</dd></div>
      <div><dt>Sets a week</dt><dd>${f.weekSets}</dd></div>
      ${lang !== 'en' ? `<div><dt>Language</dt><dd>${esc(LANG_NAMES[lang])}</dd></div>` : ''}
    </dl>
    ${r.tags.length ? `<ul class="rt-tags" aria-label="Tags">${r.tags.map(t => `<li lang="${esc(lang)}">${esc(t)}</li>`).join('')}</ul>` : ''}
  </header>

  ${r.cover ? `<figure class="rt-cover"><img src="${ctx.base}covers/${esc(r.coverFile)}" alt="${esc(r.coverAlt)}" width="${r.coverW}" height="${r.coverH}" fetchpriority="high"></figure>` : ''}

  <aside class="rt-copy" id="copy" aria-labelledby="copy-h">
    <h2 id="copy-h">Copy to openGym</h2>
    <p class="rt-copy-sub">Free, no account. Pick whichever suits you.</p>
    <div class="way">
      <h3>The whole week</h3>
      <a class="btn" href="${ctx.base}plans/${esc(fileName)}" download="${esc(fileName)}" data-copy="file">${ICON.down}<span>Get the plan file</span></a>
      <p class="rt-hint">${many ? `All ${r.sessions.length} days` : 'The session'}${r.schedule ? ' and the weekdays' : ''}. In the app: Plan, Import plan, pick the file.</p>
    </div>
    ${links.some(Boolean) ? `<div class="way">
      <h3>${many ? 'One day at a time' : 'Straight into the app'}</h3>
      <div class="rt-daylinks">${r.sessions.map((s, i) => (links[i] ? `<a class="dl" href="${esc(links[i])}" data-copy="day" lang="${esc(lang)}">${esc(s.name)}</a>` : '')).join('')}</div>
      <p class="rt-hint">On your phone, openGym opens and adds the day. No app yet? You land on the download.</p>
    </div>` : ''}
    <div class="way rt-qr" id="qr" hidden>
      <h3>On a computer</h3>
      <button type="button" class="btn ghost" id="qrtoggle" aria-expanded="false" aria-controls="qrbox">${ICON.qr}<span>Show a QR code</span></button>
      <div class="rt-qrbox" id="qrbox" hidden>
        <div class="rt-qrtabs" role="tablist" aria-label="What the code opens">
          <button type="button" role="tab" aria-selected="true" data-qr="${esc(pageUrl)}#copy">The whole routine</button>
          ${r.sessions.map((s, i) => (links[i] ? `<button type="button" role="tab" aria-selected="false" data-qr="${esc(links[i])}" lang="${esc(lang)}">${esc(s.name)}</button>` : '')).join('')}
        </div>
        <div class="rt-qrcard"><canvas id="qrc" width="200" height="200" role="img" aria-label="QR code"></canvas></div>
        <p class="rt-hint">Scan with your phone camera or in openGym. Got the app? It opens right there, ready to add.</p>
      </div>
    </div>
    <p class="rt-pop" data-pop role="status" hidden></p>
  </aside>

  <section class="rt-sec" aria-labelledby="week-h">
    <h2 id="week-h">The week</h2>
    ${weekStrip(r)}
  </section>

  <section class="rt-sec rt-days${many ? ' tabbed' : ''}" aria-labelledby="days-h">
    <h2 id="days-h">${many ? `The ${r.sessions.length} sessions` : 'The session'}</h2>
    ${tabs}
    <div class="rt-daygrid">${days}
    </div>
  </section>

  ${about ? `<section class="rt-sec rt-about" aria-labelledby="about-h" lang="${esc(lang)}"><h2 id="about-h" lang="en">From ${esc(r.author.name)}</h2>${about}</section>` : ''}

  <section class="rt-sec rt-vol" aria-labelledby="vol-h">
    <h2 id="vol-h">Where the work goes</h2>
    <p class="rt-hint">${f.weekSets} working sets a week, per muscle. The main muscle of an exercise counts a whole set, each helper half a set.</p>
    <ul class="rt-bars">${vol.map(([m, v]) => `<li><span class="m">${esc(cap(m))}</span><span class="bar" aria-hidden="true"><i style="--w:${(v / max * 100).toFixed(1)}%"></i></span><span class="v">${v}<span class="sr"> sets</span></span></li>`).join('')}</ul>
  </section>

  <section class="rt-sec rt-kit" aria-labelledby="kit-h">
    <h2 id="kit-h">What you need</h2>
    ${f.kit.length ? `<ul class="rt-kitlist">${f.kit.map(k => `<li>${esc(KIT_LABELS[k])}</li>`).join('')}</ul>` : '<p>Nothing but a bit of floor. Body weight only.</p>'}
  </section>

  ${related.length ? `<section class="rt-sec rt-related" aria-labelledby="rel-h">
    <h2 id="rel-h">If you like this one</h2>
    <ul class="rt-relgrid">${related.map(x => `<li><a href="${ctx.base}${esc(x.slug)}/"><span class="t" lang="${esc(x.language)}">${esc(x.title)}</span><span class="b">by ${esc(x.author.name)}</span><span class="m">${x.days} ${x.days === 1 ? 'day' : 'days'}, ${x.duration} min, ${esc(LEVEL_NAMES[x.level].toLowerCase())}</span></a></li>`).join('')}</ul>
  </section>` : ''}

  <p class="rt-credit">Routine by ${author}, ${licenceLink(r.license)}. Added ${esc(r.added)}. <a href="https://github.com/DuarteSantos8/openGym/blob/main/${esc(r.file)}" rel="noopener">See the file</a> or <a href="https://github.com/DuarteSantos8/openGym/issues/new?title=${encodeURIComponent('Routine: ' + r.title)}&labels=routines" rel="noopener">report a problem</a>.</p>
</article>
<div class="rt-sticky" id="sticky"><a class="btn" href="#copy">Copy to openGym</a></div>`

  const ld = {
    '@context': 'https://schema.org', '@type': 'ExercisePlan', name: r.title, description: r.description, url: pageUrl,
    inLanguage: lang, dateCreated: r.added, license: LICENCE_URL[r.license],
    author: { '@type': r.source === 'community' ? 'Person' : 'Organization', name: r.author.name, ...(r.author.url ? { url: r.author.url } : {}) },
    activityFrequency: `${r.days} days per week`, activityDuration: `PT${r.duration}M`,
    exerciseType: SPLIT_NAMES[r.split], workload: `${f.weekSets} sets per week`,
    ...(r.cover ? { image: ctx.abs(`covers/${r.coverFile}`) } : {}),
    keywords: [GOAL_NAMES[r.goal], LEVEL_NAMES[r.level], ...r.tags].join(', '),
    isPartOf: { '@type': 'CollectionPage', name: 'openGym routines', url: ctx.url('') }
  }
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'openGym', item: 'https://opengym.ch/' },
    { '@type': 'ListItem', position: 2, name: 'Routines', item: ctx.url('') },
    { '@type': 'ListItem', position: 3, name: r.title, item: pageUrl }
  ] }
  return page(ctx, {
    title: `${r.title} by ${r.author.name}: free ${r.days}-day routine | openGym`,
    description: `${r.description} ${r.days} days a week, ${r.duration} minutes, ${LEVEL_NAMES[r.level].toLowerCase()}. Copy it into openGym for free.`.slice(0, 300),
    canonical: pageUrl, body, script: 'routine.js', jsonld: [ld, crumbs], ogType: 'article',
    ogImage: r.cover ? ctx.abs(`covers/${r.coverFile}`) : undefined, current: 'routines', bodyClass: 'rt-one'
  })
}

/** Routines that sit closest to `r`: same goal and split first, then level, kit and days. */
export function relatedTo(r, all, n = 3) {
  const kit = new Set(r.facts.kit)
  const kitScore = x => {
    const union = new Set([...kit, ...x.facts.kit])
    return union.size ? 2 * x.facts.kit.filter(k => kit.has(k)).length / union.size : 2
  }
  const score = x => (x.goal === r.goal ? 3 : 0) + (x.split === r.split ? 2 : 0) + (x.level === r.level ? 1 : 0) + kitScore(x) - Math.abs(x.days - r.days) * 0.5
  return all.filter(x => x.id !== r.id).map(x => [x, score(x)]).sort((a, b) => b[1] - a[1] || (a[0].slug < b[0].slug ? -1 : 1)).slice(0, n).map(a => a[0])
}

const LICENCE_URL = { 'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/', 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/' }
const LICENCE_NAME = { 'CC-BY-4.0': 'CC BY 4.0', 'CC-BY-SA-4.0': 'CC BY-SA 4.0', 'CC0-1.0': 'CC0' }
const licenceLink = l => `<a href="${LICENCE_URL[l]}" rel="license noopener">${LICENCE_NAME[l]}</a>`

/* ------------------------------- submit ------------------------------- */

export function submitPage(ctx, langs) {
  const opt = (vals, labels) => vals.map(v => `<option value="${esc(v)}">${esc(labels[v])}</option>`).join('')
  const field = (name, label, input, help, wide) => `<div class="rt-field${wide ? ' wide' : ''}"><label for="f-${name}">${label}</label>${input}${help ? `<small id="h-${name}">${help}</small>` : ''}<p class="ferr" id="e-${name}" hidden></p></div>`
  const desc = name => `aria-describedby="h-${name} e-${name}"`
  const steps = ['Your routine', 'About it', 'Who made it', 'Check and send']
  const body = `
<div class="wrap rt-top"><a class="rt-back" href="${ctx.base}">All routines</a></div>
<div class="wrap rt-submit">
  <header class="rt-head">
    <h1>Share your routine</h1>
    <p class="rt-lead">Built a plan that works? Put it up here so someone else can steal it. Four short steps, and a person reads every one before it goes live, usually within a few days.</p>
  </header>
  <noscript><p class="rt-err">This form needs JavaScript to read your plan file. Or open a pull request with your routine file on GitHub, the format is in routines/README.md.</p></noscript>

  <ol class="rt-steps" id="steps" aria-label="Steps">${steps.map((t, i) => `<li data-step="${i}"${i === 0 ? ' aria-current="step"' : ''}><span class="n" aria-hidden="true">${i + 1}</span><span class="t">${t}</span></li>`).join('')}</ol>

  <form id="sub" class="rt-form" novalidate data-api="${esc(ctx.api)}" data-base="${esc(ctx.base)}">
    <section class="rt-step" data-step="0" aria-labelledby="s1">
      <h2 id="s1">Your routine</h2>
      <p class="rt-hint" id="src-hint">In openGym, open a routine and tap Share, Share with a friend, then Copy link. For a whole week with several days, use Plan, Export plan and pick the file here.</p>
      <div class="rt-src">
        <div class="rt-field"><label for="link">Paste the link</label>
          <textarea id="link" name="link" rows="2" spellcheck="false" autocomplete="off" placeholder="https://opengym.ch/r#1.d.…" aria-describedby="src-hint"></textarea></div>
        <span class="rt-or" aria-hidden="true">or</span>
        <div class="rt-field rt-file"><label for="plan">Pick a plan file</label>
          <input id="plan" name="plan" type="file" accept=".json,application/json"></div>
      </div>
      <p class="rt-err" id="src-err" role="alert" hidden></p>
      <p class="rt-reading" id="reading" hidden>Reading it…</p>
      <div class="rt-preview" id="preview" hidden aria-live="polite"></div>
      <div class="rt-nav"><button class="btn" type="button" data-next>Next: about it</button></div>
    </section>

    <section class="rt-step" data-step="1" aria-labelledby="s2">
      <h2 id="s2">About it</h2>
      <div class="rt-grid2">
        ${field('title', 'Title', `<input id="f-title" name="title" required maxlength="${LIMITS.title}" minlength="3" autocomplete="off" ${desc('title')}>`, `Up to ${LIMITS.title} characters. Say what it is.`, true)}
        ${field('description', 'Description', `<textarea id="f-description" name="description" required maxlength="${LIMITS.description}" minlength="20" rows="3" ${desc('description')}></textarea>`, `Who it's for and how it feels, in 20 to ${LIMITS.description} characters. No links. <span class="cc" data-count="description"></span>`, true)}
        ${field('about', 'A longer note, if you like', `<textarea id="f-about" name="about" maxlength="${LIMITS.about}" rows="4" ${desc('about')}></textarea>`, 'How to progress, what to swap, what you learned. Optional.', true)}
        ${field('goal', 'Goal', `<select id="f-goal" name="goal" required>${opt(GOALS, GOAL_NAMES)}</select>`)}
        ${field('level', 'Level', `<select id="f-level" name="level" required>${opt(LEVELS, LEVEL_NAMES)}</select>`)}
        ${field('split', 'Split', `<select id="f-split" name="split" required>${opt(SPLITS, SPLIT_NAMES)}</select>`)}
        ${field('duration', 'Minutes a session', `<input id="f-duration" name="duration" type="number" inputmode="numeric" min="${LIMITS.duration[0]}" max="${LIMITS.duration[1]}" value="45" required ${desc('duration')}>`, `Between ${LIMITS.duration[0]} and ${LIMITS.duration[1]}.`)}
        ${field('language', 'Written in', `<select id="f-language" name="language" required>${opt(langs, LANG_NAMES)}</select>`)}
        ${field('tags', 'Tags', `<input id="f-tags" name="tags" autocomplete="off" placeholder="home, short, pull-up bar" ${desc('tags')}>`, `Up to ${LIMITS.tags}, separated by commas.`)}
      </div>
      <div class="rt-nav"><button class="btn ghost" type="button" data-back>Back</button><button class="btn" type="button" data-next>Next: who made it</button></div>
    </section>

    <section class="rt-step" data-step="2" aria-labelledby="s3">
      <h2 id="s3">Who made it</h2>
      <div class="rt-grid2">
        ${field('author', 'Your name or nickname', `<input id="f-author" name="author" required maxlength="${LIMITS.author}" minlength="2" autocomplete="nickname" ${desc('author')}>`, 'Shown on the page as the author.')}
        ${field('authorUrl', 'A link, if you want one', `<input id="f-authorUrl" name="authorUrl" type="url" inputmode="url" maxlength="200" placeholder="https://" autocomplete="url" ${desc('authorUrl')}>`, 'Your site, Instagram or GitHub. Optional.')}
      </div>
      ${field('cover', 'A cover photo, if you have one', `<input id="f-cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp" ${desc('cover')}>`, 'JPG, PNG or WebP up to 8 MB, your own photo. We shrink it and strip the location and camera data before anyone sees it.', true)}
      <img class="rt-coverprev" id="coverprev" alt="" hidden>
      ${field('coverAlt', 'What the photo shows', `<input id="f-coverAlt" name="coverAlt" maxlength="160" placeholder="A pull-up bar in a doorway" ${desc('coverAlt')}>`, 'One sentence, for people who can\'t see it. Needed only with a photo.', true)}
      <label class="rt-hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
      <div class="rt-nav"><button class="btn ghost" type="button" data-back>Back</button><button class="btn" type="button" data-next>Next: check it</button></div>
    </section>

    <section class="rt-step" data-step="3" aria-labelledby="s4">
      <h2 id="s4">Check and send</h2>
      <p class="rt-hint">This is roughly how it will look in the library. Something off? Go back and fix it.</p>
      <div class="rt-final" id="final"></div>
      <label class="rt-check"><input type="checkbox" name="consent" id="consent" required aria-describedby="e-consent"> <span>I made this routine and the photo, and I'm happy for both to be published here and in the openGym repository under <a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">CC BY 4.0</a>, with my name as the credit.</span></label>
      <p class="ferr" id="e-consent" hidden></p>
      <p class="rt-err" id="send-err" role="alert" hidden></p>
      <div class="rt-nav"><button class="btn ghost" type="button" data-back>Back</button><button class="btn" type="submit" id="send">Send for review</button></div>
    </section>
  </form>
  <div class="rt-done" id="done" hidden tabindex="-1">
    <h2>Got it, thanks!</h2>
    <p>Your routine is in the review queue. Once it's approved it shows up in the library, with your name on it.</p>
    <p><a class="link" href="${ctx.base}">Back to the routines</a></p>
  </div>
</div>`
  return page(ctx, {
    title: 'Share your workout routine | openGym',
    description: 'Share a training plan you built in openGym. Paste the link or upload the plan file, add a few words, and it goes into the free routines library after a quick review.',
    canonical: ctx.url('submit/'), body, script: 'submit.js', current: 'routines', bodyClass: 'rt-sub'
  })
}

export const LICENCES_SHOWN = LICENSES
