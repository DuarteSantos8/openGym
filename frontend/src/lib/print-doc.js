// The paper side of openGym: one page shell every printout shares (the weekly plan, one routine,
// one workout, the performance report), and the one way to send it to a printer or a PDF.
//
// What every printout gets from here:
//  - the openGym logo top left, the title, a line of facts, and who it is for and when;
//  - page numbers and opengym.ch in the bottom margin (CSS @page margin boxes: Chrome, Android's
//    WebView, desktop Chrome/Edge; the iOS app draws the same line natively, PrintPlugin.swift).
//    Desktop Firefox (checked with 158) and Safari drop margin boxes, so there the line is left
//    out on purpose: nothing else changes, and their own "Headers and footers" print option (on
//    by default in Firefox) adds "Page 1 of 3". Our own running footer would have to be a fixed
//    element inside the page area (Firefox clips anything placed in the margin), sitting on the
//    last lines of each page, and page numbers would need our own pagination guessing where the
//    browser breaks pages. A wrong page number is worse than none;
//  - a white, ink-light page: thin rules, grey text, the lime accent only as a small mark;
//  - the page-break rules: anything marked .keep stays on one page, a heading is printed inside
//    the same .keep as the first block under it so it can never be left alone at a page bottom,
//    and long tables repeat their header row on the next page. All of it in plain block layout,
//    because WebKit (the iPhone's print path) does not split flex or grid containers cleanly.
//
// The `probe` option adds invisible marks at the top and bottom of every .keep block (and on
// headings), which scripts/pdf/check-pdf.py reads back out of a rendered PDF to prove no block
// was cut across a page. Never set in the app.
//
// Nothing here bundles a PDF library: the browser's print dialog or the phone's print sheet
// renders the PDF.
import { t, getLang, RTL_LANGS, dateLocale } from './i18n-core.js'
import { MOBILE, printHtml } from './mobile.js'

export const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A CSS string literal: for the page-number line in @page, which is CSS, not HTML.
const cssStr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ') + '"'

/**
 * Probe marks for the layout check. `m.s(id)` / `m.e(id)` open and close a block that must stay on
 * one page, `m.h(id)` marks a heading that belongs with block `id`. All empty strings unless
 * `probe` is on, so the app's printouts never carry them.
 */
export function probeMarks(probe) {
  if (!probe) return { s: () => '', e: () => '', h: () => '' }
  const mark = (k, id) => `<i class="probe">~${k}:${String(id).replace(/[^A-Za-z0-9_.-]/g, '_')}~</i>`
  return { s: id => mark('s', id), e: id => mark('e', id), h: id => mark('h', id) }
}

// The app icon (frontend/resources/icon.svg), drawn small: the lime dumbbell on its dark tile.
export const LOGO_SVG = '<svg class="logo-mark" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#0c0e12"/>'
  + '<g fill="#a3e635"><rect x="80" y="242" width="352" height="28"/><rect x="80" y="199" width="36" height="114"/>'
  + '<rect x="131" y="169" width="47" height="174"/><rect x="334" y="169" width="47" height="174"/>'
  + '<rect x="396" y="199" width="36" height="114"/></g></svg>'

// "Page {0} of {1}" in the reader's language, as the content of an @page margin box: the text
// around the two numbers comes from the translation, the numbers from CSS counters.
export function pageNumberContent() {
  const parts = t('Page {0} of {1}').split(/(\{0\}|\{1\})/)
  return parts.filter(p => p !== '').map(p => p === '{0}' ? 'counter(page)' : p === '{1}' ? 'counter(pages)' : cssStr(p)).join(' ')
}

// A day as people write it on paper, in the reader's language: "15 Oct 2026".
export function paperDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

// The shared look. Sizes in pt so the page reads the same on A4 and Letter; colours are print
// colours (no dark mode on paper).
export const PRINT_CSS = `
  @page {
    size: auto;
    margin: 15mm 14mm 17mm;
    @bottom-left { content: "opengym.ch"; font: 7.5pt/1 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #9aa0ad; }
    @bottom-right { font: 7.5pt/1 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #9aa0ad; }
  }
  :root {
    --ink: #15171c; --ink-2: #3b404b; --muted: #6b7180; --faint: #9aa0ad;
    --rule: #e3e6ec; --rule-soft: #eff1f5; --tint: #f6f7f9;
    --lime: #a3e635; --lime-ink: #4d7c0f; --lime-soft: #f1f9e1;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: var(--ink); background: #fff;
    font: 9.5pt/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Noto Sans", Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
    -webkit-text-size-adjust: 100%;
  }
  .doc { max-width: 182mm; margin: 0 auto; }
  /* Screen preview only (a browser that shows the page before its print dialog): a sheet. */
  @media screen { body { background: #f2f3f6; padding: 24px 12px; } .doc { background: #fff; padding: 18mm 15mm; box-shadow: 0 1px 4px rgba(0,0,0,.08); } }

  .keep { break-inside: avoid; page-break-inside: avoid; }
  .probe { display: block; height: 0; overflow: visible; font: 2px/0 sans-serif; color: #fff; font-style: normal; }

  /* ---- masthead ---- */
  .mast { display: block; border-bottom: 1.5px solid var(--ink); padding-bottom: 9pt; margin-bottom: 14pt; }
  .mast-top { display: flex; align-items: center; justify-content: space-between; gap: 12pt; margin-bottom: 11pt; }
  .brand { display: flex; align-items: center; gap: 6pt; font-weight: 650; font-size: 11pt; letter-spacing: -.01em; color: var(--ink); white-space: nowrap; }
  .logo-mark { width: 18pt; height: 18pt; flex: none; }
  .mast-meta { font-size: 8pt; color: var(--muted); text-align: end; line-height: 1.35; }
  .mast-meta b { color: var(--ink-2); font-weight: 600; }
  .kicker { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--lime-ink); font-weight: 700; margin-bottom: 2pt; }
  h1 { font-size: 19pt; line-height: 1.15; letter-spacing: -.02em; margin: 0; font-weight: 700; overflow-wrap: anywhere; }
  .facts { color: var(--muted); font-size: 9pt; margin-top: 4pt; }
  .facts .dot { color: var(--faint); padding: 0 4pt; }

  /* ---- sections ---- */
  .sec-h { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 700;
    margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid var(--rule); }
  .keep > .sec-h:first-child, .sec-h.first { margin-top: 4pt; }
  .muted { color: var(--muted); }
  .faint { color: var(--faint); }
  .small { font-size: 8pt; }
  .none { color: var(--faint); padding: 6pt 0; }

  /* ---- tables (repeat their header row when they continue on the next page) ---- */
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { text-align: start; font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); font-weight: 700; padding: 3pt 6pt 3pt 0; border-bottom: 1px solid var(--rule); }
  td { padding: 4pt 6pt 4pt 0; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  td.num, th.num { text-align: end; padding-inline-end: 0; white-space: nowrap; }

  .end { margin-top: 18pt; padding-top: 7pt; border-top: 1px solid var(--rule); color: var(--faint); font-size: 7.5pt; text-align: center; }

  [dir="rtl"] .facts .dot { display: inline-block; }
`

/**
 * One printable page, complete and self-contained (inline styles, no fetches): the masthead
 * with logo, title and facts, then `body`, then a closing line.
 *  - `title`   the big heading, also the document title (a saved PDF's default file name)
 *  - `kicker`  small line above the title ("Performance report")
 *  - `facts`   short strings under the title, joined with dots
 *  - `owner`   who it is for (optional); `date` the day it was made (ISO, default today)
 */
export function printShell({ title, kicker = '', facts = [], owner = '', date, body, css = '' }) {
  const lang = getLang()
  const made = paperDate(date || new Date().toISOString().slice(0, 10))
  const meta = [owner ? `<b>${esc(owner)}</b>` : '', esc(made)].filter(Boolean).join('<br>')
  const factLine = facts.filter(Boolean).map(esc).join('<span class="dot">·</span>')
  return `<!doctype html><html lang="${esc(lang)}" dir="${RTL_LANGS.has(lang) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${PRINT_CSS}
  @page { @bottom-right { content: ${pageNumberContent()}; } }
${css}</style></head>
<body><div class="doc">
  <header class="mast keep">
    <div class="mast-top"><div class="brand">${LOGO_SVG}<span>openGym</span></div><div class="mast-meta">${meta}</div></div>
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${factLine ? `<div class="facts">${factLine}</div>` : ''}
  </header>
  ${body}
  <div class="end keep">${esc(t('Made with openGym'))} · opengym.ch</div>
</div></body></html>`
}

// Letter paper where people use it (the US, Canada, Mexico, the Philippines, parts of Latin
// America), A4 everywhere else: only a hint for the phone's print sheet, which lets you change it.
const LETTER = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO', 'PR', 'SV', 'NI'])
export function paperFor(locale) {
  const region = String(locale || '').split(/[-_]/)[1]?.toUpperCase()
  return region && LETTER.has(region) ? 'letter' : 'a4'
}

/** What the phone's print sheet needs besides the page: the paper it starts on and the footer
 * the iOS plugin draws (lib/mobile.js printHtml). */
export function printOptions() {
  let locale = ''
  try { locale = navigator.language || '' } catch (e) { /* */ }
  return { paper: paperFor(locale), footer: { left: 'opengym.ch', page: t('Page {0} of {1}') } }
}

// The web: a hidden iframe and the browser's own print dialog (→ Save as PDF), so we never
// navigate away or trip a popup blocker.
function printInFrame(html) {
  const ifr = document.createElement('iframe')
  ifr.setAttribute('aria-hidden', 'true')
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
  document.body.appendChild(ifr)
  const cleanup = () => { try { ifr.remove() } catch (e) { /* */ } }
  const run = () => {
    const w = ifr.contentWindow
    if (!w) { cleanup(); return }
    w.onafterprint = cleanup
    setTimeout(cleanup, 60000)   // safety net if afterprint never fires
    w.focus()
    try { w.print() } catch (e) { cleanup() }
  }
  const doc = ifr.contentWindow.document
  doc.open(); doc.write(html); doc.close()
  // Give the iframe a tick to lay out (and its fonts to load) before printing.
  const go = () => setTimeout(run, 150)
  if (doc.readyState === 'complete') go()
  else ifr.onload = go
}

/**
 * Print `html` (a printShell page): the browser's print dialog on the web, the phone's print
 * sheet in the app (Android's WebView has no window.print()). `name` names the print job and the
 * suggested PDF file; Android refuses a job without one.
 */
export function printDocument(html, name) {
  if (MOBILE) return printHtml(html, name || 'openGym', printOptions()).catch(() => { /* dismissed */ })
  printInFrame(html)
  return Promise.resolve()
}
