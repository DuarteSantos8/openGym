// opengym.ch has two templates. The home page (index.html) is the landing page. Every other page
// (docs, API, about, privacy, brand) is a reference page: the site's 1120 px column, a sticky
// contents column on the left built from the page's own h2/h3, one reading column, and the same
// phone drawer (.side) built from the same list. All pages share one header and one footer.
//
// applyRef(html) turns a page into a reference page and is idempotent: run it again on its own
// output and nothing changes. The API page's generator (scripts/build-api-docs.mjs) calls it too,
// so its --check stays honest. applyFooter(html) only swaps the footer (the home page).
// Styles: website/ref.css. Behaviour (scrollspy, collapsing chapters): website/site.js.

export const FOOTER = `<footer><div class="wrap foot">
  <span class="c">openGym · AGPL-3.0 · © 2026 <a href="https://duarte-santos.ch" rel="noopener">Duarte Santos</a></span>
  <div class="links">
    <a href="/docs">Docs</a>
    <a href="/api">API</a>
    <a href="/about">About</a>
    <a href="/brand">Brand</a>
    <a href="/privacy">Privacy</a>
    <a href="https://github.com/DuarteSantos8/openGym" rel="noopener">GitHub</a>
    <a href="https://gitlab.com/DuarteSantos8/opengym" rel="noopener">GitLab mirror</a>
    <a href="https://discord.gg/e62jY6fwVb" rel="noopener">Discord</a>
    <a href="/#download">Download</a>
  </div>
</div></footer>`

export const REF_CSS = 'ref.css?v=1'

const MORE = [['/', 'Home'], ['/docs', 'Docs'], ['/api', 'API'], ['/about', 'About'], ['/brand', 'Brand'], ['/privacy', 'Privacy']]
const strip = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const slug = s => strip(s).toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export function applyFooter(html) {
  return html.replace(/<footer>[\s\S]*?<\/footer>/, FOOTER)
}

/** The page's chapters: [{ id, label, subs: [{ id, label }] }], adding ids to headings that lack one. */
function chapters(body) {
  const used = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))
  const out = []
  let html = body
  // A heading without an id takes the id of the <section> it opens (the API page), else a slug.
  html = html.replace(/(<section[^>]*\sid="([^"]+)"[^>]*>\s*)?<(h[23])((?:\s[^>]*)?)>([\s\S]*?)<\/\3>/g, (all, sec, secId, tag, attrs, inner) => {
    if (/\sdata-toc="no"/.test(attrs)) return all
    let id = (attrs.match(/\sid="([^"]+)"/) || [])[1]
    let add = ''
    if (!id && secId && tag === 'h2') id = secId
    if (!id) {
      let base = slug(inner) || tag, n = 1; id = base
      while (used.has(id)) id = `${base}-${++n}`
      used.add(id); add = ` id="${id}"`
    }
    const label = (attrs.match(/\sdata-toc="([^"]+)"/) || [])[1] || strip(inner)
    if (tag === 'h2') out.push({ id, label, subs: [] })
    else if (out.length) out[out.length - 1].subs.push({ id, label })
    return add ? `${sec || ''}<${tag}${attrs}${add}>${inner}</${tag}>` : all
  })
  return { html, out }
}

const esc = s => s.replace(/"/g, '&quot;')

function tocNav(list, extra) {
  return `<nav class="ref-toc" aria-label="On this page">\n` + list.map(c =>
    `  <div class="ref-toc-group"><a class="ref-toc-a" href="#${c.id}">${c.label}</a>` +
    (c.subs.length ? `<div class="ref-toc-subs">${c.subs.map(s => `<a class="ref-toc-a ref-toc-sub" href="#${s.id}">${s.label}</a>`).join('')}</div>` : '') +
    `</div>\n`).join('') + (extra || '') + `</nav>`
}

function drawer(list) {
  return `<aside class="side" id="menu" aria-label="Contents" aria-hidden="true">
  <div class="side-top">
    <p class="side-title">Contents</p>
    <button class="rail-close" aria-label="Close contents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
  </div>
  <p class="side-label">On this page</p>
` + list.map(c => `  <div class="side-group">\n    <a class="side-link" href="#${c.id}"><b>${c.label}</b></a>\n` +
    (c.subs.length ? `    <div class="side-subs">\n${c.subs.map(s => `      <a class="side-sub" href="#${s.id}">${s.label}</a>\n`).join('')}    </div>\n` : '') + `  </div>\n`).join('') +
  `  <p class="side-label">More</p>\n` + MORE.map(([h, t]) => `  <a class="side-link" href="${h}"><b>${t}</b></a>\n`).join('') + `</aside>`
}

/**
 * @param {string} html  a whole page
 * @param {{ extraClass?: string, tocExtra?: string }} [opt]  extraClass goes on the article
 *   (the API page keeps its own "api-main" rules); tocExtra is appended inside the contents column.
 */
export function applyRef(html, opt = {}) {
  const m = html.match(/<main id="main"[^>]*>([\s\S]*?)<\/main>/)
  if (!m) throw new Error('no <main id="main">')
  let body = m[1]
  // already a reference page: take the article's content back out (the toc is rebuilt)
  const art = body.match(/<article class="ref-doc[^"]*">([\s\S]*)<\/article>/)
  if (art) body = art[1]
  const { html: inner, out } = chapters(body)
  const cls = ['ref-doc', opt.extraClass || 'prose'].join(' ')
  const main = `<main id="main" class="wrap ref">\n${tocNav(out, opt.tocExtra)}\n<article class="${cls}">${inner.replace(/^\n*/, '\n')}</article>\n</main>`
  html = html.replace(m[0], main)
  html = html.replace(/<aside class="side"[^>]*>[\s\S]*?<\/aside>/, drawer(out))
  html = html.replace(/<body class="[^"]*">/, '<body class="topnav ref-page">')
  html = html.replace(/\n<link rel="stylesheet" href="[^"]*ref\.css\?v=\d+">/g, '')
  html = html.replace(/(<link rel="stylesheet" href="[^"]*styles\.css\?v=\d+">)/, `$1\n<link rel="stylesheet" href="${REF_CSS}">`)
  return applyFooter(html)
}
