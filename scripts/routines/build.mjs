#!/usr/bin/env node
// Builds opengym.ch/routines from routines/: the list, a page per routine, the submit page, the
// app's index.json, plan files, the search names and the sitemap. Static files only.
//
//   node scripts/routines/build.mjs --out <dir> [--base /routines/] [--origin https://opengym.ch]
//                                   [--api /routines/api/] [--staging] [--lite <file>]
//
// --staging marks every page noindex and shows a banner. --lite also writes the catalogue the
// submit service validates against (service/server.mjs). The exercise stills copied into media/
// are the licensed 180 px ones, and only those a page shows (NOTICE.md).
import fs from 'node:fs'
import path from 'node:path'
import { validateRepo, ROOT } from './validate.mjs'
import { factsOf, indexEntry, planFile, dayLink, loadNames, imageInfo, liteJSON, LANGS } from './lib.mjs'
import { listPage, routinePage, submitPage, relatedTo, esc } from './render.mjs'

export function parseArgs(argv) {
  const o = { base: '/routines/', origin: 'https://opengym.ch', staging: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--staging') o.staging = true
    else if (['--out', '--base', '--origin', '--api', '--lite'].includes(a)) o[a.slice(2)] = argv[++i]
    else throw new Error(`unknown option ${a}`)
  }
  if (!o.out) throw new Error('--out <dir> is required')
  if (!/^\/([a-z0-9-]+\/)*$/.test(o.base)) throw new Error('--base is a path like /routines/')
  o.api ||= o.base + 'api/'
  return o
}

/** The site's header from website/index.html, byte for byte, with Routines added to both menus. */
export function navFrom(html, base) {
  const start = html.indexOf('<nav>')
  const sheet = html.indexOf('<div class="navsheet"')
  const end = html.indexOf('</div>\n</div>', sheet)
  if (start < 0 || sheet < 0 || end < 0) throw new Error('website/index.html: could not find the header')
  const nav = html.slice(start, end + '</div>\n</div>'.length)
  const cur = current => (current === 'routines' ? ' aria-current="page"' : '')
  // The site header links to /routines/ itself; a staging build points that link at its own base.
  if (nav.includes('href="/routines/"')) {
    return current => nav
      .replace(/src="icon-180\.png"/g, 'src="/icon-180.png"')
      .replace(/(<a class="(?:ql site|nl)") href="\/routines\/">/g, (_, a) => `${a} href="${base}"${cur(current)}>`)
  }
  return current => nav
    .replace(/src="icon-180\.png"/g, 'src="/icon-180.png"')
    .replace('<a class="ql site" href="/docs.html">', `<a class="ql site" href="${base}"${cur(current)}>Routines</a>\n    <a class="ql site" href="/docs.html">`)
    .replace('<a class="nl" href="/docs.html">', `<a class="nl" href="${base}"${cur(current)}>Routines</a>\n    <a class="nl" href="/docs.html">`)
}

export function build(opts, root = ROOT) {
  const { routines, problems, cat } = validateRepo(root)
  if (problems.length) throw Object.assign(new Error(problems.join('\n')), { problems })
  const out = path.resolve(opts.out)
  const siteHtml = fs.readFileSync(path.join(root, 'website/index.html'), 'utf8')
  const siteV = (/styles\.css\?v=(\d+)/.exec(siteHtml) || [])[1] || '1'
  const ctx = {
    base: opts.base, api: opts.api, staging: opts.staging, noindex: opts.staging, siteV, v: '',
    url: p => opts.origin + opts.base + p,
    abs: p => opts.origin + opts.base + p,
    nav: navFrom(siteHtml, opts.base)
  }
  const assets = path.join(root, 'website/routines')
  // Cache-busting stamp: the assets' total size and newest change, so a new build gets new URLs.
  const assetFiles = fs.readdirSync(assets).filter(f => /\.(css|js|mjs)$/.test(f))
  ctx.v = assetFiles.reduce((h, f) => (h * 31 + fs.readFileSync(path.join(assets, f)).reduce((a, b) => (a * 33 + b) >>> 0, 7)) >>> 0, 17).toString(36)

  fs.rmSync(out, { recursive: true, force: true })
  for (const d of ['', 'assets', 'media', 'covers', 'plans', 'submit']) fs.mkdirSync(path.join(out, d), { recursive: true })
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true }); fs.writeFileSync(path.join(out, p), text) }

  // Newest first: what the list shows without script.
  routines.sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : a.source === b.source ? (a.title < b.title ? -1 : 1) : SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]))
  const allIds = new Set()
  for (const r of routines) {
    r.facts = factsOf(r, cat)
    r.facts.ids.forEach(id => allIds.add(id))
    if (r.cover) {
      const src = path.join(root, 'routines', r.source, r.cover)
      const buf = fs.readFileSync(src)
      const info = imageInfo(buf)
      r.coverFile = r.cover
      r.coverW = info.width
      r.coverH = info.height
      fs.copyFileSync(src, path.join(out, 'covers', r.cover))
    }
  }
  const names = loadNames(path.join(root, 'catalogue'), [...allIds])

  // The licensed stills: 180 px, only the ones these pages show, and the notice beside them.
  for (const id of allIds) fs.copyFileSync(path.join(root, 'catalogue/media/still', id + '.webp'), path.join(out, 'media', id + '.webp'))
  fs.copyFileSync(path.join(root, 'catalogue/media/NOTICE.md'), path.join(out, 'media/NOTICE.md'))

  // Module imports carry the same stamp as the pages' own links, so a new build is never half cached.
  for (const f of assetFiles) {
    const text = fs.readFileSync(path.join(assets, f), 'utf8').replace(/(['"])\.\/([a-z-]+\.mjs)\1/g, `$1./$2?v=${ctx.v}$1`)
    fs.writeFileSync(path.join(out, 'assets', f), text)
  }

  write('index.html', listPage(ctx, routines))
  write('submit/index.html', submitPage(ctx, LANGS))
  for (const r of routines) {
    const links = r.sessions.map((_, i) => dayLink(r, i, cat))
    write(`${r.slug}/index.html`, routinePage(ctx, r, { cat, names, links, related: relatedTo(r, routines) }))
    write(`plans/${r.slug}.opengym-plan.json`, JSON.stringify(planFile(r, cat), null, 2) + '\n')
  }

  // The app's index: everything except the starter plans, which every app already has built in.
  const updated = routines.reduce((d, r) => (r.added > d ? r.added : d), '2026-01-01')
  const entries = routines.filter(r => r.source !== 'starter').map(r => indexEntry(r, cat, ctx.url(r.slug + '/')))
  write('index.json', JSON.stringify({ format: 'opengym-routines', version: 1, updated, routines: entries }) + '\n')

  // Search: every name an exercise has, in one lowercase string, fetched on the first keystroke.
  const search = {}
  for (const id of allIds) search[id] = [cat.get(id).n, ...Object.values(names[id] || {})].join(' | ').toLowerCase()
  write('names.json', JSON.stringify(search) + '\n')
  write('routines.json', JSON.stringify(routines.map(r => ({ id: r.id, slug: r.slug }))) + '\n')

  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(ctx.url(''))}</loc><lastmod>${updated}</lastmod></url>
  <url><loc>${esc(ctx.url('submit/'))}</loc></url>
${routines.map(r => `  <url><loc>${esc(ctx.url(r.slug + '/'))}</loc><lastmod>${r.added}</lastmod></url>`).join('\n')}
</urlset>
`)
  if (opts.lite) fs.writeFileSync(opts.lite, liteJSON(cat))
  return { routines, out, entries, media: allIds.size }
}
const SOURCE_ORDER = { community: 0, opengym: 1, starter: 2 }

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = build(parseArgs(process.argv.slice(2)))
    console.log(`routines: ${r.routines.length} pages, ${r.entries.length} in index.json, ${r.media} stills → ${r.out}`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
