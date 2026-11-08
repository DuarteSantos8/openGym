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

export const MEDIA_NOTICE = 'Exercise pictures © Aliaksandr Makatserchyk, Gym visual, gymvisual.com. Media licensed for use in openGym only; see'

/** The exercise name a routine in `lang` shows: the catalogue's translation, else English. */
export const nameIn = (id, lang, cat, names) => (lang !== 'en' && names[id]?.[lang]) || cap(cat.get(id)?.n || id)

export function prescription(x) {
  const amount = x.sec ? clock(x.sec) : x.repsMin ? `${x.repsMin}-${x.reps}` : String(x.reps)
  return `${x.sets} × ${amount}`
}

/* ------------------------------- the shell ------------------------------- */

export function page(ctx, { title, description, canonical, body, script, robots, jsonld = [], ogImage, ogType = 'website', lang = 'en', current = '' }) {
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
<body class="topnav rt-page">
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

function weekStrip(r, { compact = false } = {}) {
  const at = new Map((r.schedule || []).map(([d, i]) => [d, i]))
  if (!at.size) {
    return compact ? '' : `<p class="rt-week-none">No fixed weekdays: train the ${r.sessions.length === 1 ? 'session' : `${r.sessions.length} sessions`} in order, ${r.days} ${r.days === 1 ? 'day' : 'days'} a week, whenever suits you.</p>`
  }
  if (compact) {
    return `<span class="rc-week" role="img" aria-label="Trains ${esc(WEEK.filter(([d]) => at.has(d)).map(([d]) => LONG_DAY[d]).join(', '))}">${WEEK.map(([d, n]) => `<i class="${at.has(d) ? 'on' : ''}" title="${n}"></i>`).join('')}</span>`
  }
  return `<ol class="rt-week" aria-label="The week">${WEEK.map(([d, n]) => {
    const i = at.get(d)
    return `<li class="${i == null ? 'rest' : 'on'}"><span class="d" aria-hidden="true">${n}</span><span class="sr">${LONG_DAY[d]}: </span><span class="s">${i == null ? 'Rest' : esc(r.sessions[i].name)}</span></li>`
  }).join('')}</ol>`
}

const metaLine = r => [`${r.days} ${r.days === 1 ? 'day' : 'days'}`, `${r.duration} min`, LEVEL_NAMES[r.level]].join(' · ')
const kitLine = f => (f.kit.length ? f.kit.map(k => KIT_NAMES[k]).join(', ') : 'No equipment')

/* ------------------------------- the list ------------------------------- */

export function listPage(ctx, routines) {
  const cards = routines.map(r => card(ctx, r)).join('\n')
  const data = routines.map(r => ({
    s: r.slug, id: r.id, t: r.title, d: r.description, a: r.author.name, g: r.goal, l: r.level, sp: r.split,
    n: r.days, m: r.duration, k: r.facts.kit, f: r.facts.focus, lang: r.language, tags: r.tags, at: r.added,
    src: r.source, ex: r.facts.ids, sn: r.sessions.map(s => s.name)
  }))
  const langs = [...new Set(routines.map(r => r.language))].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a < b ? -1 : 1))
  const chips = (name, values, labels, type = 'checkbox') => values.map(v => `<label class="chip"><input type="${type}" name="${name}" value="${esc(v)}"><span>${esc(labels[v] ?? v)}<b class="ct" data-ct></b></span></label>`).join('')
  const body = `
<header class="wrap rt-hero">
  <h1>Routines worth stealing</h1>
  <p class="lead">Free training plans from openGym and the people who use it. Find one that fits your week and your kit, copy it into the app, or share the plan you swear by.</p>
  <div class="actions">
    <a class="btn" href="${ctx.base}submit/">Share your routine</a>
    <a class="link" href="#how">How copying works</a>
  </div>
</header>

<div class="wrap rt-browse">
  <div class="rt-bar">
    <label class="rt-search">
      <span class="sr">Search routines</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
      <input id="q" type="search" name="q" placeholder="Search titles, authors, exercises" autocomplete="off" enterkeyhint="search">
    </label>
    <button class="btn ghost rt-fbtn" id="fopen" type="button" aria-controls="filters" aria-expanded="false">Filters <span class="ct" id="fcount" hidden></span></button>
    <label class="rt-sort"><span class="sr">Sort by</span>
      <select id="sort" name="sort">
        <option value="new">Newest</option>
        <option value="popular">Most copied</option>
        <option value="name">A to Z</option>
        <option value="short">Shortest sessions</option>
      </select>
    </label>
  </div>

  <div class="rt-cols">
    <form class="rt-filters" id="filters" aria-label="Filters" role="search">
      <div class="rt-fhead">
        <h2>Filters</h2>
        <button type="button" class="rt-fclose" id="fclose" aria-label="Close filters"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="rt-fscroll">
        <fieldset><legend>Goal</legend><div class="chips">${chips('goal', GOALS, GOAL_NAMES)}</div></fieldset>
        <fieldset><legend>Days a week</legend><div class="chips days">${chips('days', ['1', '2', '3', '4', '5', '6', '7'], {})}</div></fieldset>
        <fieldset><legend>Session length</legend><div class="chips">${chips('len', ['30', '45', '60', '61'], { 30: 'Up to 30 min', 45: 'Up to 45 min', 60: 'Up to an hour', 61: 'Longer' }, 'radio')}</div></fieldset>
        <fieldset><legend>What you have</legend><p class="fhint" id="kit-hint">Routines that need nothing else.</p><div class="chips" aria-describedby="kit-hint">${chips('kit', KIT, KIT_NAMES)}</div></fieldset>
        <fieldset><legend>Level</legend><div class="chips">${chips('level', LEVELS, LEVEL_NAMES)}</div></fieldset>
        <fieldset><legend>Muscle focus</legend><div class="chips">${chips('focus', GROUPS, GROUP_NAMES)}</div></fieldset>
        <fieldset><legend>Split</legend><div class="chips">${chips('split', SPLITS, SPLIT_NAMES)}</div></fieldset>
        <fieldset><legend>Language</legend><div class="chips">${chips('lang', langs, LANG_NAMES)}</div></fieldset>
      </div>
      <div class="rt-ffoot">
        <button type="reset" class="btn ghost" id="fclear">Clear all</button>
        <button type="button" class="btn" id="fdone"><span>Show <span id="fdone-n">${routines.length}</span> routines</span></button>
      </div>
    </form>

    <section class="rt-results" aria-labelledby="count">
      <div class="rt-rhead">
        <h2 id="count" aria-live="polite">${routines.length} routines</h2>
        <button type="button" class="rt-clear" id="rclear" hidden>Clear filters</button>
      </div>
      <ul class="rt-grid" id="grid">
${cards}
      </ul>
      <div class="rt-empty" id="empty" hidden>
        <h3>Nothing fits all of that</h3>
        <p>Loosen a filter or two. Or write the routine you were looking for and <a href="${ctx.base}submit/">share it</a>, someone else is looking too.</p>
      </div>
    </section>
  </div>
</div>

<section class="wrap rt-how" id="how" aria-labelledby="how-h">
  <h2 id="how-h">How copying works</h2>
  <div class="rt-how-cols">
    <div><h3>On your phone</h3><p>Open a routine and tap a day. openGym opens and adds it next to your own routines. Nothing you already have is touched.</p></div>
    <div><h3>The whole week</h3><p>Grab the plan file instead and import it in the app under Plan, Import plan. It brings every day and, if you want, the weekdays too.</p></div>
    <div><h3>On a computer</h3><p>Every routine has a QR code. Point your phone's camera at it and carry on there.</p></div>
  </div>
</section>
<script type="application/json" id="rt-data">${jsonForScript({ api: ctx.api, base: ctx.base, routines: data })}</script>`
  return page(ctx, {
    title: 'Workout routines: free plans to copy into openGym',
    description: 'Free workout routines for the gym, home, a pull-up bar or a hotel room. Filter by goal, days a week, equipment and level, and copy any plan into openGym.',
    canonical: ctx.url(''),
    body, script: 'list.js', current: 'routines',
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'openGym routines', url: ctx.url(''),
      description: 'Free workout routines to copy into openGym.',
      mainEntity: { '@type': 'ItemList', numberOfItems: routines.length, itemListElement: routines.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.url(r.slug + '/'), name: r.title })) }
    }]
  })
}

function card(ctx, r) {
  const f = r.facts
  const thumbs = r.cover
    ? `<img class="rc-cover" src="${ctx.base}covers/${esc(r.coverFile)}" alt="" width="${r.coverW}" height="${r.coverH}" loading="lazy" decoding="async">`
    : `<span class="rc-stills" aria-hidden="true">${f.ids.slice(0, 4).map(id => `<img src="${ctx.base}media/${id}.webp" alt="" width="180" height="180" loading="lazy" decoding="async">`).join('')}</span>`
  return `<li class="rc" data-slug="${esc(r.slug)}" lang="${esc(r.language)}">
  <a class="rc-link" href="${ctx.base}${esc(r.slug)}/">
    ${thumbs}
    <span class="rc-body">
      <span class="rc-title">${esc(r.title)}</span>
      <span class="rc-by" lang="en">by ${esc(r.author.name)}</span>
      <span class="rc-desc">${esc(r.description)}</span>
      <span class="rc-meta" lang="en"><span>${esc(metaLine(r))}</span>${weekStrip(r, { compact: true })}</span>
      <span class="rc-kit" lang="en">${esc(kitLine(f))}<span class="rc-pop" data-pop hidden></span></span>
    </span>
  </a>
</li>`
}

/* ------------------------------- one routine ------------------------------- */

export function routinePage(ctx, r, { cat, names, links }) {
  const f = r.facts
  const lang = r.language
  const max = Math.max(...Object.values(f.volume), 1)
  const vol = Object.entries(f.volume).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const times = weeklyCounts(r)
  const pageUrl = ctx.url(r.slug + '/')
  const days = r.sessions.map((s, i) => `
    <section class="rt-day" id="day-${i + 1}" aria-labelledby="day-${i + 1}-h">
      <div class="rt-dayhead">
        <h3 id="day-${i + 1}-h" lang="${esc(lang)}">${esc(s.name)}</h3>
        <span class="rt-daymeta">${s.exercises.length} exercises · ${s.exercises.reduce((n, x) => n + x.sets, 0)} sets${times[i] > 1 ? ` · ${times[i]}× a week` : ''}</span>
      </div>
      ${s.note ? `<p class="rt-daynote" lang="${esc(lang)}">${esc(s.note)}</p>` : ''}
      <ol class="rt-ex">${s.exercises.map(x => `
        <li>
          <img src="${ctx.base}media/${x.id}.webp" alt="" width="180" height="180" loading="lazy" decoding="async">
          <span class="rt-exbody">
            <span class="n" lang="${esc(lang === 'en' || names[x.id]?.[lang] ? lang : 'en')}">${esc(nameIn(x.id, lang, cat, names))}</span>
            <span class="p"><b>${esc(prescription(x))}</b>${x.sec ? ' hold' : ' reps'}${x.rest != null ? ` <span class="rest">· rest ${esc(clock(x.rest))}</span>` : ''}</span>
            ${x.note ? `<span class="rt-exnote" lang="${esc(lang)}">${esc(x.note)}</span>` : ''}
          </span>
        </li>`).join('')}
      </ol>
      ${links[i] ? `<a class="rt-addday" href="${esc(links[i])}" data-copy="day">Add “${esc(s.name)}” to openGym</a>` : ''}
    </section>`).join('')
  const about = r.about ? r.about.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('') : ''
  const author = r.author.url ? `<a href="${esc(r.author.url)}" rel="noopener nofollow ugc">${esc(r.author.name)}</a>` : esc(r.author.name)
  const fileName = `${r.slug}.opengym-plan.json`
  const body = `
<div class="wrap rt-top"><a class="rt-back" href="${ctx.base}">All routines</a></div>
<article class="wrap rt-art" data-id="${esc(r.id)}">
  <header class="rt-head">
    <h1 lang="${esc(lang)}">${esc(r.title)}</h1>
    <p class="rt-by">by ${author}${r.source === 'starter' ? ' · built into the app' : ''}</p>
    <p class="rt-lead" lang="${esc(lang)}">${esc(r.description)}</p>
    <ul class="rt-facts">
      <li><b>${r.days}</b> ${r.days === 1 ? 'day' : 'days'} a week</li>
      <li><b>${r.duration}</b> min a session</li>
      <li><b>${esc(LEVEL_NAMES[r.level])}</b></li>
      <li><b>${esc(GOAL_NAMES[r.goal])}</b></li>
      <li><b>${esc(SPLIT_NAMES[r.split])}</b></li>
      ${lang !== 'en' ? `<li><b>${esc(LANG_NAMES[lang])}</b></li>` : ''}
    </ul>
    ${r.tags.length ? `<ul class="rt-tags" aria-label="Tags">${r.tags.map(t => `<li lang="${esc(lang)}">${esc(t)}</li>`).join('')}</ul>` : ''}
  </header>

  ${r.cover ? `<figure class="rt-cover"><img src="${ctx.base}covers/${esc(r.coverFile)}" alt="${esc(r.coverAlt)}" width="${r.coverW}" height="${r.coverH}" fetchpriority="high"></figure>` : ''}

  <aside class="rt-copy" id="copy" aria-labelledby="copy-h">
    <h2 id="copy-h">Copy to openGym</h2>
    <a class="btn" href="${ctx.base}plans/${esc(fileName)}" download="${esc(fileName)}" data-copy="file">Get the plan file</a>
    <p class="rt-hint">All ${r.sessions.length === 1 ? 'of it' : `${r.sessions.length} days`}${r.schedule ? ' and the weekdays' : ''}. In the app: Plan, Import plan, pick the file.</p>
    ${links.some(Boolean) ? `<div class="rt-daylinks">
      <p class="rt-hint">Or one day at a time, straight into the app:</p>
      ${r.sessions.map((s, i) => (links[i] ? `<a class="btn ghost" href="${esc(links[i])}" data-copy="day" lang="${esc(lang)}">${esc(s.name)}</a>` : '')).join('')}
    </div>` : ''}
    <div class="rt-qr" id="qr" hidden>
      <p class="rt-hint">On a computer? Scan this with your phone.</p>
      <div class="rt-qrtabs" role="tablist" aria-label="What the code opens">
        <button type="button" role="tab" aria-selected="true" data-qr="${esc(pageUrl)}#copy">This page</button>
        ${r.sessions.map((s, i) => (links[i] ? `<button type="button" role="tab" aria-selected="false" data-qr="${esc(links[i])}" lang="${esc(lang)}">${esc(s.name)}</button>` : '')).join('')}
      </div>
      <canvas id="qrc" width="232" height="232" role="img" aria-label="QR code"></canvas>
    </div>
    <p class="rt-pop" data-pop hidden></p>
  </aside>

  <section class="rt-sec" aria-labelledby="week-h">
    <h2 id="week-h">The week</h2>
    ${weekStrip(r)}
  </section>

  <section class="rt-sec rt-days" aria-labelledby="days-h">
    <h2 id="days-h">${r.sessions.length === 1 ? 'The session' : `The ${r.sessions.length} sessions`}</h2>
    ${days}
  </section>

  ${about ? `<section class="rt-sec rt-about" aria-labelledby="about-h" lang="${esc(lang)}"><h2 id="about-h" lang="en">From the author</h2>${about}</section>` : ''}

  <section class="rt-sec rt-vol" aria-labelledby="vol-h">
    <h2 id="vol-h">Weekly sets per muscle</h2>
    <p class="rt-hint">${f.weekSets} working sets a week. The main muscle of an exercise counts a whole set, each helper half a set.</p>
    <ul class="rt-bars">${vol.map(([m, v]) => `<li><span class="m">${esc(cap(m))}</span><span class="bar" aria-hidden="true"><i style="--w:${(v / max * 100).toFixed(1)}%"></i></span><span class="v">${v} ${v === 1 ? 'set' : 'sets'}</span></li>`).join('')}</ul>
  </section>

  <section class="rt-sec rt-kit" aria-labelledby="kit-h">
    <h2 id="kit-h">What you need</h2>
    ${f.kit.length ? `<ul class="rt-kitlist">${f.kit.map(k => `<li>${esc(KIT_NAMES[k])}</li>`).join('')}</ul>` : '<p>Nothing but a bit of floor. Body weight only.</p>'}
  </section>

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
    ogImage: r.cover ? ctx.abs(`covers/${r.coverFile}`) : undefined, current: 'routines'
  })
}
const LICENCE_URL = { 'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/', 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/' }
const LICENCE_NAME = { 'CC-BY-4.0': 'CC BY 4.0', 'CC-BY-SA-4.0': 'CC BY-SA 4.0', 'CC0-1.0': 'CC0' }
const licenceLink = l => `<a href="${LICENCE_URL[l]}" rel="license noopener">${LICENCE_NAME[l]}</a>`

/* ------------------------------- submit ------------------------------- */

export function submitPage(ctx, langs) {
  const opt = (vals, labels) => vals.map(v => `<option value="${esc(v)}">${esc(labels[v])}</option>`).join('')
  const body = `
<div class="wrap rt-top"><a class="rt-back" href="${ctx.base}">All routines</a></div>
<div class="wrap rt-submit">
  <header class="rt-head">
    <h1>Share your routine</h1>
    <p class="rt-lead">Built a plan that works? Put it up here so someone else can steal it. We read every one before it goes live, usually within a few days.</p>
  </header>
  <noscript><p class="rt-err">This form needs JavaScript to read your plan file. Or open a pull request with your routine file on GitHub, the format is in routines/README.md.</p></noscript>

  <form id="sub" class="rt-form" novalidate data-api="${esc(ctx.api)}" data-base="${esc(ctx.base)}">
    <section class="rt-step" aria-labelledby="s1">
      <h2 id="s1">Your routine</h2>
      <p class="rt-hint" id="src-hint">In openGym, open a routine and tap Share, Share with a friend, then Copy link. For a whole week with several days, use Plan, Export plan and pick the file here.</p>
      <div class="rt-src">
        <label class="rt-field"><span>Paste the link</span>
          <textarea id="link" name="link" rows="2" spellcheck="false" autocomplete="off" placeholder="https://opengym.ch/r#1.d.…" aria-describedby="src-hint"></textarea></label>
        <span class="rt-or" aria-hidden="true">or</span>
        <label class="rt-field rt-file"><span>Pick a plan file</span>
          <input id="plan" name="plan" type="file" accept=".json,application/json"></label>
      </div>
      <p class="rt-err" id="src-err" role="alert" hidden></p>
      <div class="rt-preview" id="preview" hidden aria-live="polite"></div>
    </section>

    <section class="rt-step" aria-labelledby="s2" id="step2">
      <h2 id="s2">About it</h2>
      <div class="rt-grid2">
        <label class="rt-field wide"><span>Title</span><input name="title" required maxlength="${LIMITS.title}" minlength="3" autocomplete="off"><small>Up to ${LIMITS.title} characters. Make it say what it is.</small></label>
        <label class="rt-field wide"><span>Description</span><textarea name="description" required maxlength="${LIMITS.description}" minlength="20" rows="3"></textarea><small>Who it's for and how it feels, in 20 to ${LIMITS.description} characters. No links.</small></label>
        <label class="rt-field wide"><span>A longer note, if you like</span><textarea name="about" maxlength="${LIMITS.about}" rows="4"></textarea><small>How to progress, what to swap, what you learned. Optional.</small></label>
        <label class="rt-field"><span>Goal</span><select name="goal" required>${opt(GOALS, GOAL_NAMES)}</select></label>
        <label class="rt-field"><span>Level</span><select name="level" required>${opt(LEVELS, LEVEL_NAMES)}</select></label>
        <label class="rt-field"><span>Split</span><select name="split" required>${opt(SPLITS, SPLIT_NAMES)}</select></label>
        <label class="rt-field"><span>Minutes a session</span><input name="duration" type="number" inputmode="numeric" min="${LIMITS.duration[0]}" max="${LIMITS.duration[1]}" value="45" required></label>
        <label class="rt-field"><span>Written in</span><select name="language" required>${opt(langs, LANG_NAMES)}</select></label>
        <label class="rt-field"><span>Tags</span><input name="tags" autocomplete="off" placeholder="home, short, pull-up bar"><small>Up to ${LIMITS.tags}, separated by commas.</small></label>
      </div>
    </section>

    <section class="rt-step" aria-labelledby="s3">
      <h2 id="s3">Who made it</h2>
      <div class="rt-grid2">
        <label class="rt-field"><span>Your name or nickname</span><input name="author" required maxlength="${LIMITS.author}" minlength="2" autocomplete="nickname"><small>Shown on the page as the author.</small></label>
        <label class="rt-field"><span>A link, if you want one</span><input name="authorUrl" type="url" inputmode="url" maxlength="200" placeholder="https://" autocomplete="url"><small>Your site, Instagram or GitHub. Optional.</small></label>
      </div>
      <label class="rt-field rt-photo"><span>A cover photo, if you have one</span>
        <input name="cover" id="cover" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="cover-hint">
        <small id="cover-hint">JPG, PNG or WebP up to 8 MB, your own photo. We shrink it and strip the location and camera data before anyone sees it.</small></label>
      <img class="rt-coverprev" id="coverprev" alt="" hidden>
      <label class="rt-field"><span>What the photo shows</span><input name="coverAlt" maxlength="160" placeholder="A pull-up bar in a doorway"><small>One sentence, for people who can't see it.</small></label>
      <label class="rt-hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
    </section>

    <section class="rt-step" aria-labelledby="s4">
      <h2 id="s4">Send it</h2>
      <label class="rt-check"><input type="checkbox" name="consent" required> <span>I made this routine and the photo, and I'm happy for both to be published here and in the openGym repository under <a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">CC BY 4.0</a>, with my name as the credit.</span></label>
      <p class="rt-err" id="send-err" role="alert" hidden></p>
      <div class="actions"><button class="btn" type="submit" id="send">Send for review</button></div>
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
    canonical: ctx.url('submit/'), body, script: 'submit.js', current: 'routines'
  })
}

export const LICENCES_SHOWN = LICENSES
