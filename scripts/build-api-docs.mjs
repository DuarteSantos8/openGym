#!/usr/bin/env node
// Builds website/api.html — the static API reference — from api/openapi.yaml.
//
//   node scripts/build-api-docs.mjs
//
// Deterministic: the same spec always produces byte-identical output (no
// timestamps), so re-running it only dirties the file when the spec changed.
// The page is plain HTML in the site's own design (styles.css + site.js) with
// native <details> cards per endpoint — no Swagger UI, no runtime rendering.
//
// js-yaml lives in the repo-root package.json (devDependency, build-time only).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const specPath = path.join(root, 'api', 'openapi.yaml')
const outPath = path.join(root, 'website', 'api.html')
const spec = yaml.load(fs.readFileSync(specPath, 'utf8'))

/* ------------------------------------------------------------------ helpers */

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The subset of markdown the spec actually uses: `code`, **bold**, *italic*, links.
const mdInline = s => esc(String(s).trim())
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[\s(—>])\*([^*\n]+)\*(?=[\s.,;:)—]|$)/g, '$1<i>$2</i>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')

// One description onto one line (for table cells and card subtitles).
const mdCell = s => mdInline(String(s).replace(/\s*\n\s*/g, ' '))

// Block markdown: paragraphs and "- " lists (with wrapped continuation lines).
function mdBlock (src) {
  const out = []
  let para = [], list = null
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => {
    if (list) { out.push(`<ul>${list.map(li => `<li>${mdInline(li)}</li>`).join('')}</ul>`); list = null }
  }
  for (const raw of String(src).split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushPara(); flushList(); continue }
    if (/^- /.test(line.trim()) && !para.length) {
      flushPara()
      list = list || []
      list.push(line.trim().slice(2))
    } else if (list && /^\s/.test(raw)) {
      list[list.length - 1] += ' ' + line.trim()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara(); flushList()
  return out.join('\n')
}

const refName = ref => ref.split('/').pop()
const schemaLink = ref => `<a href="#schema-${refName(ref)}">${esc(refName(ref))}</a>`

// A compact, human type for one JSON-schema node.
function fmtType (s) {
  if (!s) return 'any'
  if (s.$ref) return schemaLink(s.$ref)
  if (s.oneOf) return s.oneOf.map(fmtType).join(' | ')
  if (s.enum) return s.enum.map(v => esc(JSON.stringify(v))).join(' | ')
  if (s.const !== undefined) return `always ${esc(JSON.stringify(s.const))}`
  if (s.type === 'array') {
    const it = s.items ? fmtType(s.items) : 'any'
    return (/[ |]/.test(it.replace(/<[^>]*>/g, '')) ? `(${it})` : it) + '[]'
  }
  let t = Array.isArray(s.type) ? s.type.join(' | ') : (s.type || 'object')
  const bits = []
  if (s.format) bits.push(s.format)
  if (s.maxLength) bits.push(`&le; ${s.maxLength} chars`)
  if (s.minimum !== undefined || s.maximum !== undefined) bits.push(`${s.minimum ?? ''}&ndash;${s.maximum ?? ''}`)
  if (s.default !== undefined) bits.push(`default ${esc(JSON.stringify(s.default))}`)
  return esc(t) + (bits.length ? ` <span class="p-hint">(${bits.join(', ')})</span>` : '')
}

// One-line shape signature for a response body: { user: SessionUser }
function fmtSig (s) {
  if (!s) return ''
  if (s.$ref) return schemaLink(s.$ref)
  if (s.properties) {
    return '{ ' + Object.entries(s.properties)
      .map(([k, v]) => `${esc(k)}: ${fmtType(v)}`).join(', ') + ' }'
  }
  return fmtType(s)
}

// Rows for a property table, nesting one level into objects and object arrays.
function * propRows (schema, prefix = '', depth = 0) {
  const req = new Set(schema.required || [])
  for (const [k, v] of Object.entries(schema.properties || {})) {
    yield { name: prefix + k, required: req.has(k), type: fmtType(v), desc: v.description || '' }
    if (depth < 2) {
      if (v.type === 'object' && v.properties) yield * propRows(v, `${prefix}${k}.`, depth + 1)
      else if (v.type === 'array' && v.items && v.items.properties) yield * propRows(v.items, `${prefix}${k}[].`, depth + 1)
    }
  }
}

function ptab (rows) {
  if (!rows.length) return ''
  return `<div class="ptab">` + rows.map(r => `
  <div class="prow">
    <span class="p-name">${esc(r.name)}${r.required ? '<em class="p-req" title="required">required</em>' : ''}</span>
    <span class="p-type">${r.type}</span>
    <span class="p-desc">${r.desc ? mdCell(r.desc) : ''}</span>
  </div>`).join('') + `\n</div>`
}

/* ------------------------------------------------------------ endpoint cards */

const TAGS = {
  meta: { title: 'Meta', side: 'Health &amp; public config' },
  auth: { title: 'Auth', side: 'Passkeys &amp; sessions' },
  pairing: { title: 'Pairing', side: 'Connect the mobile app' },
  data: { title: 'Data', side: 'State sync' },
  push: { title: 'Push', side: 'Notifications &amp; rest timer' },
  activity: { title: 'Activity', side: 'Live presence' },
  admin: { title: 'Admin', side: 'Users, invites, audit log' }
}

// "Admin: list all users" → "List all users": the section heading and the ADMIN
// chip already say who may call it, so the prefix is noise on every admin card.
const sumText = s => {
  const t = String(s || '').replace(/^Admin:\s*/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function authOf (op, tag) {
  if (Array.isArray(op.security) && op.security.length === 0) {
    return { chip: 'public', line: 'Public — no authentication required.' }
  }
  if (tag === 'admin') {
    return {
      chip: 'admin',
      line: 'Admin only — a signed-in session whose user is an admin (<code>ADMIN_UIDS</code> or <code>admin:true</code>), as the session cookie or a Bearer token.'
    }
  }
  return {
    chip: null,
    line: 'Requires a session — the cookie set at sign-in, or <code>Authorization: Bearer &lt;token&gt;</code> from mobile-app pairing.'
  }
}

function responseRows (op) {
  return Object.entries(op.responses || {}).map(([code, r]) => {
    if (r.$ref) r = spec.components.responses[refName(r.$ref)]
    const cls = 's' + code[0]
    const content = r.content && r.content['application/json']
    const extras = []
    if (code.startsWith('2')) {
      if (content && content.schema) extras.push(fmtSig(content.schema))
      if (r.headers) extras.push(`sets <code>${Object.keys(r.headers).map(esc).join('</code>, <code>')}</code>`)
    } else if (content) {
      const exs = []
      if (content.example) exs.push(content.example)
      if (content.examples) for (const e of Object.values(content.examples)) exs.push(e.value)
      if (content.schema && content.schema.example) exs.push(content.schema.example)
      for (const e of exs) if (e && e.error) extras.push(`<code>${esc(JSON.stringify({ error: e.error }))}</code>`)
    }
    return `
  <div class="prow rrow">
    <span class="r-code ${cls}">${esc(code)}</span>
    <span class="p-desc">${mdCell(r.description || '')}${extras.length ? `<span class="r-sig">${extras.join(' &middot; ')}</span>` : ''}</span>
  </div>`
  }).join('')
}

function endpointCard (pathKey, method, op) {
  const tag = (op.tags || [])[0] || 'meta'
  const auth = authOf(op, tag)
  const body = op.requestBody
  const bodySchema = body && body.content && body.content['application/json'] && body.content['application/json'].schema
  const example = bodySchema && (bodySchema.example ?? (body.content['application/json'].example))

  let bodyHtml = ''
  if (bodySchema) {
    const optional = body.required === false ? ' <span class="p-hint">(optional)</span>' : ''
    if (bodySchema.$ref) {
      bodyHtml = `<p class="ep-h">Request body${optional}</p><p class="p-desc">${schemaLink(bodySchema.$ref)}</p>`
    } else {
      bodyHtml = `<p class="ep-h">Request body <span class="p-hint">(JSON)</span>${optional}</p>` +
        ptab([...propRows(bodySchema)])
    }
    if (example) {
      bodyHtml += `\n<pre><code>${esc(JSON.stringify(example, null, 2))}</code></pre>`
    }
  }

  const params = (op.parameters || []).map(p => ({
    name: p.name + (p.in && p.in !== 'query' ? ` <span class="p-hint">(${esc(p.in)})</span>` : ''),
    required: !!p.required,
    type: fmtType(p.schema),
    desc: p.description || ''
  }))
  // p.name may contain markup now; ptab escapes r.name — build rows pre-escaped instead:
  const paramTab = params.length
    ? `<p class="ep-h">Query parameters</p><div class="ptab">` + params.map(r => `
  <div class="prow">
    <span class="p-name">${r.name}${r.required ? '<em class="p-req" title="required">required</em>' : ''}</span>
    <span class="p-type">${r.type}</span>
    <span class="p-desc">${r.desc ? mdCell(r.desc) : ''}</span>
  </div>`).join('') + `\n</div>`
    : ''

  return `
<details class="ep" id="op-${esc(op.operationId)}">
  <summary>
    <span class="m ${method}">${method.toUpperCase()}</span>
    <span class="ep-path"><code>${esc(pathKey)}</code>${auth.chip ? `<span class="ep-chip ${auth.chip}">${auth.chip}</span>` : ''}</span>
    <span class="ep-chev" aria-hidden="true"></span>
    <span class="ep-sum">${mdCell(sumText(op.summary))}</span>
  </summary>
  <div class="ep-body">
${mdBlock(op.description || '')}
    <p class="ep-auth">${lockSvg}<span>${auth.line}</span></p>
${paramTab}
${bodyHtml}
    <p class="ep-h">Responses</p>
    <div class="ptab">${responseRows(op)}
    </div>
  </div>
</details>`
}

/* -------------------------------------------------------------- schema cards */

// A schema has no summary of its own, so the collapsed row borrows the first
// sentence of its description — and the body then starts at the second, rather
// than repeating what the reader just read on the way in.
function schemaCard (name, s) {
  const desc = (s.description || '').trim()
  const flat = desc.replace(/\s*\n\s*/g, ' ')
  const m = flat.match(/^(.+?[.!?])(\s|$)/)
  const lead = m ? m[1] : flat
  const rest = m ? flat.slice(m[0].length).trim() : ''
  const rows = [...propRows(s)]
  return `
<details class="ep sch" id="schema-${esc(name)}">
  <summary>
    <span class="sch-name"><code>${esc(name)}</code></span>
    <span class="ep-chev" aria-hidden="true"></span>
    <span class="ep-sum">${lead ? mdCell(lead) : ''}</span>
  </summary>
  <div class="ep-body">
${rest ? mdBlock(rest) : ''}
${rows.length ? ptab(rows) : '<p class="p-desc">Free-form object.</p>'}
  </div>
</details>`
}

/* ----------------------------------------------------------------- overview */

// The spec's info.description carries "### Heading" sections — each becomes a card.
const infoParts = spec.info.description.split(/^### /m).slice(1).map(chunk => {
  const nl = chunk.indexOf('\n')
  return { title: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1) }
})

const serversHtml = spec.servers.map(s => `
  <div class="srv-row"><code>${esc(s.url)}</code><span>${mdCell(s.description || '')}</span></div>`).join('')

const overviewCards = infoParts.map(p => `
  <div class="ov">
    <h3>${esc(p.title)}</h3>
${mdBlock(p.body)}
  </div>`).join('')

/* ---------------------------------------------------------------- assemble */

const lockSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'

const ops = []
for (const [p, methods] of Object.entries(spec.paths)) {
  for (const [m, op] of Object.entries(methods)) ops.push({ path: p, method: m, op })
}

const tagSections = Object.keys(TAGS).map(tag => {
  const t = spec.tags.find(x => x.name === tag) || {}
  const cards = ops.filter(o => (o.op.tags || [])[0] === tag)
    .map(o => endpointCard(o.path, o.method, o.op)).join('\n')
  return `
<section class="api-sec" id="${tag}">
  <h2>${TAGS[tag].title}</h2>
  <p class="sub">${mdCell(t.description || '')}</p>
  <div class="eps">
${cards}
  </div>
</section>`
}).join('\n')

const schemaCards = Object.entries(spec.components.schemas)
  .map(([n, s]) => schemaCard(n, s)).join('\n')

const railTags = Object.keys(TAGS).map(tag =>
  `  <a class="side-link" href="#${tag}"><b>${TAGS[tag].title}</b><span>${TAGS[tag].side}</span></a>`
).join('\n')

const css = `
/* ------------------------------------------------------------- API reference
   Generated page — the reference itself is static HTML in the site's design.
   Layout: one 880px column of per-endpoint <details> cards. */
main.api-main { max-width: 880px; margin: 0 auto; padding: clamp(44px, 7vw, 72px) var(--pad) 0; }
main.api-main h1 { font-size: clamp(36px, 6.5vw, 60px); letter-spacing: -.03em; }
main.api-main .lead { color: var(--fg-2); max-width: 58ch; margin: 14px 0 0; font-size: clamp(16.5px, 2vw, 19px); }
.api-actions { margin-top: 26px; }
.api-actions .btn svg { width: 17px; height: 17px; }
.api-facts { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 20px; color: var(--fg-3); font-size: 13.5px; }
.api-facts span::after { content: "·"; margin-left: 10px; color: var(--fg-3); }
.api-facts span:last-child::after { content: ""; margin-left: 0; }

.api-sec { padding: 0; margin-top: clamp(46px, 7vw, 68px); }
.api-sec h2 { font-size: clamp(24px, 3.4vw, 32px); scroll-margin-top: 76px; }
.api-sec .sub { color: var(--fg-2); font-size: 15.5px; margin-top: 6px; max-width: 62ch; }
.api-sec .sub code, .ov code, .ep-auth code {
  background: var(--surface-2); border-radius: 5px; padding: 1.5px 5px; font-size: .85em; color: #e4e4e8;
}

/* base URLs */
.srv { margin-top: 20px; border: 1px solid var(--hair-soft); border-radius: var(--r-s); background: var(--surface); overflow: hidden; }
.srv-row { display: flex; flex-wrap: wrap; gap: 2px 16px; align-items: baseline; padding: 12px 16px; }
.srv-row + .srv-row { border-top: 1px solid var(--hair-soft); }
.srv-row > code { font-size: 13.5px; color: var(--acc); }
.srv-row > span { color: var(--fg-3); font-size: 13.5px; }

/* overview cards (from the spec's info sections) */
/* align-items:start, so a short card stops at its own last line instead of
   stretching to its neighbour's height and showing a panel of empty background. */
.ov-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; margin-top: 18px; }
.ov { background: var(--surface); border: 1px solid var(--hair-soft); border-radius: var(--r-m); padding: 20px 22px; }
.ov h3 { font-size: 15.5px; margin-bottom: 8px; }
.ov p, .ov li { color: var(--fg-2); font-size: 14px; line-height: 1.55; }
.ov p + p, .ov p + ul { margin-top: 8px; }
.ov ul { padding-left: 18px; margin: 0; }
.ov li { margin: 5px 0; }
.ov li::marker { color: var(--fg-3); }
.ov:last-child:nth-child(odd) { grid-column: 1 / -1; }
@media (max-width: 720px) { .ov-grid { grid-template-columns: 1fr; } }

/* expand / collapse all */
.xall { display: flex; gap: 16px; justify-content: flex-end; margin: 30px 0 -34px; }
.xall button { color: var(--fg-3); font-size: 13px; cursor: pointer; padding: 4px 0; transition: color .2s var(--ease); }
.xall button:hover { color: var(--fg); }

/* endpoint + schema cards */
.eps { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
.ep { background: var(--surface); border: 1px solid var(--hair-soft); border-radius: var(--r-s); scroll-margin-top: 70px; transition: border-color .25s var(--ease); }
.ep:hover, .ep[open] { border-color: var(--hair); }
.ep > summary { list-style: none; cursor: pointer; padding: 12px 16px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px; row-gap: 2px; align-items: center; }
.ep > summary::-webkit-details-marker { display: none; }
.m { justify-self: start; min-width: 52px; text-align: center; padding: 3px 8px; border-radius: 7px; font-size: 11px; font-weight: 700; letter-spacing: .05em; font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; }
.m.get { color: #6cb2ff; background: rgba(108, 178, 255, .12); }
.m.post { color: var(--acc); background: var(--acc-soft); }
.m.put { color: #ffb340; background: rgba(255, 159, 10, .14); }
.m.delete, .m.patch { color: #ff6b5e; background: rgba(255, 80, 60, .12); }
.ep-path { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.ep-path code, .sch-name code { font-size: 13.5px; color: var(--fg); word-break: break-all; }
.ep-chip { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 6px; }
.ep-chip.public { color: var(--fg-2); background: rgba(255, 255, 255, .07); }
.ep-chip.admin { color: #ffb340; background: rgba(255, 159, 10, .12); }
.ep-chev { width: 8px; height: 8px; border-right: 1.6px solid var(--fg-3); border-bottom: 1.6px solid var(--fg-3); transform: rotate(45deg) translate(-1px, -1px); transition: transform .25s var(--ease); }
.ep[open] > summary .ep-chev { transform: rotate(225deg); }
.ep-sum { grid-column: 2 / -1; color: var(--fg-3); font-size: 13.5px; line-height: 1.45; }
.ep-body { border-top: 1px solid var(--hair-soft); padding: 16px 16px 18px; }
/* WebAuthn type names run to 34 characters. On a phone they are wider than the
   card, so every prose block in here is allowed to break inside a word. */
.ep-body > p, .ep-body > ul li, .ov p, .ov li, .p-desc, .api-sec .sub, .ep-auth,
.ep-path code, .sch-name code, .p-name, .p-type { overflow-wrap: break-word; }
.ep-body > p { color: var(--fg-2); font-size: 14.5px; line-height: 1.65; margin: 0 0 10px; max-width: 74ch; }
.ep-body > ul { margin: 0 0 10px; padding-left: 20px; }
.ep-body > ul li { color: var(--fg-2); font-size: 14.5px; line-height: 1.65; margin: 4px 0; }
/* Identifiers are half of every sentence in an API description: as full chips they
   turn a paragraph into confetti, so here they are monospace with a hairline tint. */
.ep-body p code, .ep-body li code, .ov p code, .ov li code, .api-sec .sub code,
.ep-auth code, .p-desc code {
  background: rgba(255, 255, 255, .05); border-radius: 4px; padding: 0 3px;
  font-size: .9em; line-height: inherit; color: #d8dee2;
}
/* Grid, not flex: the sentence wraps around code chips, and a flex row would
   centre the whole wrapped block against the padlock and stagger the lines. */
.ep-auth { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 8px; color: var(--fg-3); font-size: 13px; line-height: 1.6; margin: 14px 0 0 !important; }
.ep-auth svg { width: 13px; height: 13px; margin-top: 3px; }
.ep-h { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-3); margin: 18px 0 8px !important; }
.p-hint { color: var(--fg-3); font-weight: 400; text-transform: none; letter-spacing: 0; }

/* parameter / response tables */
.ptab { border: 1px solid var(--hair-soft); border-radius: 10px; overflow: hidden; }
.prow { display: grid; grid-template-columns: minmax(140px, 220px) minmax(110px, 200px) 1fr; gap: 3px 14px; padding: 10px 14px; font-size: 13.5px; }
.prow + .prow { border-top: 1px solid var(--hair-soft); }
.p-name { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; color: var(--fg); word-break: break-all; }
.p-req { font-style: normal; color: #ffb340; font-size: 10.5px; margin-left: 7px; letter-spacing: .04em; }
.p-type { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--fg-3); word-break: break-word; }
.p-type a, .r-sig a, .p-desc a { color: var(--acc); }
.p-desc { color: var(--fg-2); line-height: 1.5; }
.rrow { grid-template-columns: 44px 1fr; }
.r-code { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; font-weight: 600; }
.r-code.s2 { color: var(--acc); } .r-code.s3 { color: #6cb2ff; }
.r-code.s4 { color: #ffb340; } .r-code.s5 { color: #ff6b5e; }
.r-sig { display: block; margin-top: 4px; font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: var(--fg-3); word-break: break-word; line-height: 1.6; }
.r-sig code, .p-type code { background: none; padding: 0; color: inherit; font-size: inherit; }
.ep-body pre { margin: 8px 0 2px; padding: 12px 14px; font-size: 12.5px; }
@media (max-width: 680px) {
  .prow { grid-template-columns: minmax(0, 1fr) auto; }
  .prow .p-desc { grid-column: 1 / -1; margin-top: 1px; }
  .rrow { grid-template-columns: 44px 1fr; }
  .rrow .p-desc { grid-column: auto; margin-top: 0; }
}

/* schema cards */
.sch > summary { grid-template-columns: minmax(0, 1fr) auto; }
.sch .ep-sum { grid-column: 1 / -1; }

/* The header, the navigation sheet and the contents drawer belong to the site, not
   to this page: .navsheet, .toc-btn, .side and .rail-close live in styles.css and
   site.js and behave identically here, on the docs page and on the home page. This
   file deliberately adds nothing of its own to them — one implementation is the
   only way the two rail pages can feel like the same rail. */
`

const js = `
/* Jumping to an anchor inside a collapsed card opens the card — and re-aligns, since
   the browser scrolled to where the target was while it was still collapsed. */
;(() => {
  const openTo = id => {
    const el = id && document.getElementById(id)
    if (!el) return
    let opened = false
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (!d.open) { d.open = true; opened = true }
    }
    // 'instant' on purpose: html has scroll-behavior:smooth, and an animated
    // re-align races the jump the browser already started.
    if (opened) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
  }
  addEventListener('hashchange', () => openTo(location.hash.slice(1)))
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]')
    if (a) openTo(a.getAttribute('href').slice(1))
  })
  openTo(location.hash.slice(1))
})()

/* Expand / collapse every card at once. */
document.querySelectorAll('[data-xall]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('details.ep').forEach(d => { d.open = b.dataset.xall === '1' })
}))
`

const html = `<!DOCTYPE html>
<!-- GENERATED FILE - do not edit by hand.
     Built by scripts/build-api-docs.mjs from api/openapi.yaml (openGym API v${spec.info.version}).
     Regenerate with: node scripts/build-api-docs.mjs -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>API — openGym</title>
<meta name="description" content="The complete openGym HTTP API, documented as an OpenAPI spec: passkey auth, state sync, push notifications, pairing and admin routes.">
<meta name="theme-color" content="#000000">
<meta property="og:title" content="openGym API reference">
<meta property="og:description" content="The complete openGym HTTP API as an OpenAPI spec: passkey auth, state sync, push notifications, pairing and admin routes.">
<meta property="og:image" content="https://opengym.duarte-santos.ch/img/banner.png">
<meta property="og:url" content="https://opengym.duarte-santos.ch/api.html">
<meta property="og:type" content="website">
<meta property="og:site_name" content="openGym">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="openGym API reference">
<meta name="twitter:image" content="https://opengym.duarte-santos.ch/img/banner.png">
<link rel="canonical" href="https://opengym.duarte-santos.ch/api.html">
<link rel="icon" type="image/png" sizes="512x512" href="icon-512.png">
<link rel="icon" type="image/png" sizes="180x180" href="icon-180.png">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="stylesheet" href="styles.css?v=16">
<script>document.documentElement.className += ' js'</script>
<!-- Umami web analytics for opengym.duarte-santos.ch (self-hosted, cookieless). -->
<script defer src="https://stats.duarte-santos.ch/script.js" data-website-id="db36019e-50f4-453c-9c56-d0588aefe233"></script>
<style>${css}</style>
</head>
<body class="topnav">

<nav><div class="wrap nav-in">
  <a class="brand" href="/">
    <img src="icon-180.png" alt="" width="24" height="24">
    openGym
  </a>
  <div class="nav-quick">
    <a class="ql site" href="/#features">Features</a>
    <a class="ql site" href="/#screens">Screenshots</a>
    <a class="ql site" href="/#demo">Demo</a>
    <a class="ql site" href="/docs.html">Docs</a>
    <a class="ql site" href="/api.html">API</a>
    <a class="ql site" href="/about.html">About</a>
    <a class="ql" href="https://gitlab.com/DuarteSantos8/opengym" rel="noopener">GitLab <span data-gh="stars"></span></a>
    <a class="ql" href="https://discord.gg/e62jY6fwVb" rel="noopener">Discord <span data-dc="members"></span></a>
    <a class="ql coffee" href="https://buymeacoffee.com/duartesantos" rel="noopener" aria-label="Buy me a coffee"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.159 1.737.212 2.48.226 5.002.19 7.472-.14.45-.06.899-.13 1.345-.21.399-.072.84-.206 1.08.206.166.281.188.657.162.974a.544.544 0 01-.169.364zm-6.159 3.9c-.862.37-1.84.788-3.109.788a5.884 5.884 0 01-1.569-.217l.877 9.004c.065.78.717 1.38 1.5 1.38 0 0 1.243.065 1.658.065.447 0 1.786-.065 1.786-.065.783 0 1.434-.6 1.499-1.38l.94-9.95a3.996 3.996 0 00-1.322-.238c-.826 0-1.491.284-2.26.613z"/></svg><span>Buy me a coffee!</span></a>
    <a class="cta" href="/#download">Download</a>
  </div>
  <button class="nav-toggle" id="navtoggle" aria-expanded="false" aria-controls="sitemenu" aria-label="Menu">
    <span></span><span></span>
  </button>
</div></nav>

<!-- The navigation sheet: the header's links again, for the widths where the bar has
     room only for the brand and the download. Byte-identical on every page, like the
     bar above it — nothing is ever dropped because of which page you are on. -->
<div class="navsheet" id="sitemenu" role="navigation" aria-label="Site" aria-hidden="true">
  <div class="nl-rows">
    <a class="nl" href="/#features">Features</a>
    <a class="nl" href="/#screens">Screenshots</a>
    <a class="nl" href="/#demo">Demo</a>
    <a class="nl" href="/docs.html">Docs</a>
    <a class="nl" href="/api.html">API</a>
    <a class="nl" href="/about.html">About</a>
    <a class="nl" href="https://gitlab.com/DuarteSantos8/opengym" rel="noopener">GitLab <span data-gh="stars"></span></a>
    <a class="nl" href="https://discord.gg/e62jY6fwVb" rel="noopener">Discord <span data-dc="members"></span></a>
    <a class="nl coffee" href="https://buymeacoffee.com/duartesantos" rel="noopener">Buy me a coffee! <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.159 1.737.212 2.48.226 5.002.19 7.472-.14.45-.06.899-.13 1.345-.21.399-.072.84-.206 1.08.206.166.281.188.657.162.974a.544.544 0 01-.169.364zm-6.159 3.9c-.862.37-1.84.788-3.109.788a5.884 5.884 0 01-1.569-.217l.877 9.004c.065.78.717 1.38 1.5 1.38 0 0 1.243.065 1.658.065.447 0 1.786-.065 1.786-.065.783 0 1.434-.6 1.499-1.38l.94-9.95a3.996 3.996 0 00-1.322-.238c-.826 0-1.491.284-2.26.613z"/></svg></a>
  </div>
</div>

<!-- The one control that opens the contents, at every width. The drawer it opens is
     closed in CSS, so it is shut on first paint whether or not the script runs. -->
<button class="toc-btn" id="tocbtn" aria-expanded="false" aria-controls="menu">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>
  Contents
</button>

<!-- The contents drawer: one list, one way in, one way out. Closed by default at
     every width, and no preference is remembered — see .side in styles.css. -->
<aside class="side" id="menu" aria-label="Contents" aria-hidden="true">
  <div class="side-top">
    <p class="side-title">Contents</p>
    <button class="rail-close" aria-label="Close contents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
  </div>
  <p class="side-label">On this page</p>
  <a class="side-link" href="#overview"><b>Overview</b><span>Auth model, sessions, conventions</span></a>
${railTags}
  <a class="side-link" href="#schemas"><b>Schemas</b><span>The state blob, the error shape &amp; co.</span></a>
  <p class="side-label">More</p>
  <a class="side-link" href="/"><b>Home</b><span>The tour, the demo, the download</span></a>
  <a class="side-link" href="/docs.html"><b>Docs</b><span>Install, self-host, import</span></a>
  <a class="side-link" href="/about.html"><b>About</b><span>The story and the milestones</span></a>
</aside>

<main class="api-main">
  <h1>API</h1>
  <p class="lead">Every route the openGym backend serves — passkey auth, state sync,
     push, pairing, admin — as one hand-written
     OpenAPI&nbsp;spec. The same file lives
     <a href="https://gitlab.com/DuarteSantos8/opengym/-/blob/main/api/openapi.yaml" rel="noopener">in the repository</a>
     at <code>api/openapi.yaml</code>, next to the one server file it documents.</p>
  <div class="actions api-actions">
    <a class="btn" href="openapi.yaml" download>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 19h16"/></svg>
      Download openapi.yaml</a>
  </div>
  <p class="api-facts">
    <span>OpenAPI ${esc(spec.openapi)}</span>
    <span>openGym v${esc(spec.info.version)}</span>
    <span>${ops.length} endpoints</span>
    <span>${esc(spec.info.license.name)}</span>
  </p>

  <section class="api-sec" id="overview">
    <h2>Overview</h2>
    <p class="sub">${mdCell(spec.info.summary)}. One Node file, no framework, JSON-file
       storage, HMAC-signed session cookies.</p>
    <div class="srv">${serversHtml}
    </div>
    <div class="ov-grid">${overviewCards}
    </div>
  </section>

  <div class="xall" aria-label="Card controls">
    <button data-xall="1">Expand all</button>
    <button data-xall="0">Collapse all</button>
  </div>
${tagSections}

  <section class="api-sec" id="schemas">
    <h2>Schemas</h2>
    <p class="sub">The named shapes the endpoints above link to. The <code>State</code> blob
       is <b>representative, not enforced</b> — the server stores it opaquely and the app
       grows it over time.</p>
    <div class="eps">
${schemaCards}
    </div>
  </section>
</main>

<footer><div class="wrap foot">
  <span class="c">openGym · AGPL-3.0 · © 2026 <a href="https://duarte-santos.ch" rel="noopener">Duarte Santos</a></span>
  <div class="links">
    <a href="docs.html">Docs</a>
    <a href="about.html">About</a>
    <a href="https://gitlab.com/DuarteSantos8/opengym" rel="noopener">GitLab</a>
    <a href="https://discord.gg/e62jY6fwVb" rel="noopener">Discord</a>
    <a href="/#download">Download</a>
  </div>
</div></footer>

<script src="site.js?v=16" defer></script>
<script>${js}</script>
</body>
</html>
`

fs.writeFileSync(outPath, html)
console.log(`wrote ${path.relative(root, outPath)} — ${ops.length} endpoints, ${Object.keys(spec.components.schemas).length} schemas, ${(html.length / 1024).toFixed(1)} KB`)
