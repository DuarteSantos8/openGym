// Print HTML files to PDF with a headless Chrome over the DevTools protocol: the same engine
// as Android's WebView print and desktop Chrome's "Save as PDF". One browser for the whole run,
// one tab at a time, nothing fetched from the network. Needs Node 22+ (global WebSocket).
//
//   const chrome = await launchChrome()
//   await chrome.print('file:///…/page.html', 'out.pdf', { paper: 'A4' })
//   await chrome.close()
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Paper in inches, as printToPDF takes it.
export const PAPER = { A4: { w: 8.27, h: 11.69 }, Letter: { w: 8.5, h: 11 } }

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const base = join(process.env.HOME || '/root', '.cache/puppeteer/chrome')
  if (existsSync(base)) {
    const dirs = readdirSync(base).sort().reverse()
    for (const d of dirs) {
      const bin = join(base, d, 'chrome-linux64/chrome')
      if (existsSync(bin)) return bin
    }
  }
  for (const bin of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (existsSync(bin)) return bin
  throw new Error('No Chrome found. Set CHROME=/path/to/chrome.')
}

export async function launchChrome() {
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'og-pdf-'))
  const proc = spawn(findChrome(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', d => { stderr += d })
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100))
  if (!existsSync(portFile)) { proc.kill('SIGKILL'); throw new Error('Chrome did not start:\n' + stderr.slice(-2000)) }
  const [port] = readFileSync(portFile, 'utf8').split('\n')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let seq = 0
  const pending = new Map()
  const waiters = []
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    } else if (msg.method) {
      for (const w of waiters.slice()) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.res(msg.params) }
    }
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
  const once = method => new Promise(res => waiters.push({ method, res }))
  await send('Page.enable')
  await send('Runtime.enable')

  return {
    send,
    /** Load `url`, wait for it and its fonts, and write a PDF of it to `out`. */
    async print(url, out, { paper = 'A4' } = {}) {
      const loaded = once('Page.loadEventFired')
      await send('Page.navigate', { url })
      await loaded
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
      const size = PAPER[paper]
      // The document's own @page margins win; these are only Chrome's fallback.
      const { data } = await send('Page.printToPDF', {
        paperWidth: size.w, paperHeight: size.h, printBackground: true,
        displayHeaderFooter: false, preferCSSPageSize: false,
        marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
      })
      writeFileSync(out, Buffer.from(data, 'base64'))
      return out
    },
    async close() {
      try { ws.close() } catch { /* */ }
      proc.kill('SIGTERM')
      await new Promise(r => setTimeout(r, 300))
      try { proc.kill('SIGKILL') } catch { /* */ }
      rmSync(profile, { recursive: true, force: true })
    },
  }
}
