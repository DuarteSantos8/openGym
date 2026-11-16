// Applies the two opengym.ch templates to the hand-written pages (see ref-template.mjs):
//   node scripts/site/apply-template.mjs           rewrite website/*.html in place
//   node scripts/site/apply-template.mjs --check   fail if a page is not up to date (CI)
// The API page is built by scripts/build-api-docs.mjs, which applies the same template itself.
// The brand page is built by scripts/brand/page.py; run that first, then this.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyRef, applyFooter } from './ref-template.mjs'

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'website')
const check = process.argv.includes('--check')
const BRAND_DL = `  <div class="ref-toc-dl"><a class="ref-btn" href="brand/kit/opengym-brand-kit.zip" download>Download the kit</a><a class="ref-more" href="brand/kit/opengym-brand-guidelines.pdf">Guidelines as PDF</a></div>\n`
const PAGES = {
  'index.html': html => applyFooter(html),
  'docs.html': html => applyRef(html),
  'about.html': html => applyRef(html),
  'privacy.html': html => applyRef(html),
  'brand.html': html => applyRef(html, { extraClass: 'brand-doc', tocExtra: BRAND_DL }),
}
let stale = 0
for (const [name, fn] of Object.entries(PAGES)) {
  const f = path.join(web, name)
  const before = fs.readFileSync(f, 'utf8')
  const after = fn(before)
  if (after === before) continue
  if (check) { console.error(`${name} is not up to date: node scripts/site/apply-template.mjs`); stale++ } else { fs.writeFileSync(f, after); console.log(`${name} updated`) }
}
if (stale) process.exit(1)
