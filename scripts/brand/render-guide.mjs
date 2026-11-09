// Prints the brand guide (guide.py) to PDF with headless Chrome.
//   CHROME=… ROBOTO=… PUPPETEER_FROM=… node scripts/brand/render-guide.mjs website/brand/kit
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.PUPPETEER_FROM || path.join(here, '../../frontend/package.json'))
const puppeteer = require('puppeteer-core')
const kit = path.resolve(process.argv[2] || 'website/brand/kit')
const html = path.join(kit, '.guide.html')
fs.writeFileSync(html, execFileSync('python3', [path.join(here, 'guide.py'), kit], { env: process.env, maxBuffer: 1 << 26 }))
const b = await puppeteer.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--disable-gpu'] })
const p = await b.newPage()
await p.goto('file://' + html, { waitUntil: 'load' })
await p.evaluate(() => document.fonts.ready)
await p.pdf({ path: path.join(kit, 'opengym-brand-guide.pdf'), preferCSSPageSize: true, printBackground: true })
await b.close(); fs.unlinkSync(html)
console.log('opengym-brand-guide.pdf written')
