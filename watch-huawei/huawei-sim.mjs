#!/usr/bin/env node
// Simulator smoke: builds a TEMP COPY of the app in release mode with a fake phone and a timed driver added, runs it in Huawei's
// lite-wearable simulator and drives a workout through the page's own handlers (the simulator ignores taps). Prints the heap
// peak and saves a shot per step. Exit 1 on JS HEAP OOM, Eval JS file failed or JS REF LIMIT (or if the app never ran).
//   node watch-huawei/huawei-sim.mjs [--hs BYTES|none] [--out DIR] [--from DIR]
//   --hs   the simulator's JS heap in bytes, default 196608 (192 KB); `none` runs with the simulator's own heap
//   --from reuse a copy (kept: no copy, no build); --out where the shots and logs go (default: <copy>-shots beside it)
//   --keep keep the ~17 MB copy after the run (it is removed otherwise, the shots stay)
// The debug phone (sim/debugphone.js) never reaches the product: it lives outside entry/, only this script copies it, and
// only into the temp copy. A test (test/sim.test.js) checks entry/ has no trace of it; grep the product build to prove it.
// Needs DevEco Studio (JAVA_HOME and DEVECO_SDK_HOME, docs/HUAWEI_WATCH.md). One simulator at a time: it is killed at the end.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, outOf } from './huawei-size.mjs'
import { STEPS } from './sim/debugphone.js'

const here = dirname(fileURLToPath(import.meta.url))
const PREVIEWER = (process.env.DEVECO_SDK_HOME || '/Applications/DevEco-Studio.app/Contents/sdk') + '/default/hms/previewer/liteWearable'
const WS = 'ws://127.0.0.1:40003' // the simulator's picture socket: a client must stay connected or its timers stop
const BAD = /JS HEAP OOM|Eval JS file failed|JS REF LIMIT/
const PAGES = 'entry/src/main/js/MainAbility/pages/'

export const badLines = (log) => log.split('\n').filter((l) => BAD.test(l))
// what a run failed on; "never ran" only when no bad line explains it
export const failures = ({ fed, answered, bad, died }) => [
  ...(died ? ['FAIL the simulator exited before the run finished (' + died + ')'] : []),
  ...(!fed && !bad.length ? ['FAIL the app never ran its workout (no OGSMOKE feed in the simulator log)'] : []),
  ...(fed && !answered && !bad.length ? ['FAIL the fake phone never answered the start (no OGSMOKE answered in the simulator log)'] : []),
  ...bad.map((l) => 'FAIL ' + l.slice(0, 160))]
// the simulator reports memoryUsage on the pipe as JSON ending in a NUL byte
export const heapPeak = (pipe) => Math.max(0, ...[...pipe.matchAll(/"peakAllocBytes":\s*(\d+)/g)].map((m) => +m[1]))

// every page copy tells the driver which page is up (A.pg), because the workout switches pages and a tap goes to the one showing
export function hook(src) {
  const at = 'attach(G.init());'
  const end = 'onDestroy: function () { G.destroy() }'
  if (!src.includes(at) || !src.includes(end)) throw new Error('hook: anchor not found in the page, update huawei-sim.mjs')
  // a page that is gone is let go: a kept reference would hold its whole module in the heap, which the real app does not
  return src.replace(at, at + ' G.A.pg = this;').replace(end, 'onDestroy: function () { G.destroy(); if (G.A.pg === this) G.A.pg = null }')
}
// hook the debug phone into the app.js copy, right after a core is made: in a page, its timers would keep that page in the heap
export function inject(src) {
  const made = '}, stored)\n'
  if (!src.includes(made)) throw new Error('inject: anchor not found in app.js, update huawei-sim.mjs')
  return "import drive from './common/debugphone.js'\n" + src.replace(made, made + '  drive(A, K)\n')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function prepare(dir) {
  cpSync(here, dir, { recursive: true, filter: (f) => !/\/(entry\/build|\.hvigor|file_system|node_modules|test|sim)$/.test(f) })
  copyFileSync(join(here, 'sim', 'debugphone.js'), join(dir, 'entry/src/main/js/MainAbility/common/debugphone.js'))
  const edit = (name, fn) => { const f = join(dir, PAGES, name, 'index.js'); writeFileSync(f, fn(readFileSync(f, 'utf8'))) }
  const app = join(dir, PAGES, '..', 'app.js')
  writeFileSync(app, inject(readFileSync(app, 'utf8')))
  edit('index', hook)
  edit('lift', hook)
  edit('rest', hook)
  edit('over', hook)
}

// the simulator draws text only when it runs from a folder with `config` beside its binary
function simulatorDir(dir) {
  const bin = join(dir, 'lw', 'bin')
  mkdirSync(bin, { recursive: true })
  if (!existsSync(join(bin, 'Simulator'))) copyFileSync(join(PREVIEWER, 'bin', 'Simulator'), join(bin, 'Simulator'))
  for (const d of [bin, join(bin, '..')]) if (!existsSync(join(d, 'config'))) symlinkSync(join(PREVIEWER, 'config'), join(d, 'config'))
  return bin
}

async function run(dir, out, hs) {
  mkdirSync(out, { recursive: true })
  const bin = simulatorDir(dir)
  const sock = '/private/tmp/ogsmoke_commandPipe' // the simulator is the client of this pipe
  try { unlinkSync(sock) } catch (e) { /* none yet */ }
  let pipe = ''
  const srv = net.createServer((c) => c.on('data', (d) => { pipe += d.toString() }))
  await new Promise((r) => srv.listen(sock, r)) // the simulator must find the socket when it starts
  const logPath = join(out, 'sim.log')
  const args = ['-j', outOf(dir), '-n', 'opengym', '-device', 'liteWearable', '-shape', 'circle', '-or', '466', '466', '-cr', '466', '466',
    '-lws', '40003', '-s', 'ogsmoke', '-url', 'pages/index/index'] // no -l: the lite simulator stays zh-CN whatever it is given
  if (hs) args.push('-hs', String(hs))
  const sim = spawn(join(bin, 'Simulator'), args, { cwd: bin, stdio: ['ignore', openSync(logPath, 'w'), openSync(join(out, 'sim.err'), 'w')] })
  // an exit nobody asked for is a failed run, whatever the log says; the kill in `finally` is not one
  let died = null
  let ending = false
  sim.on('exit', (code, signal) => { if (!ending) died = signal ? 'signal ' + signal : 'code ' + code })
  let ws
  try { // whatever happens, the simulator dies with the run: it is heavy for an 8 GB Mac
    await sleep(1500)
    let last = null
    ws = new WebSocket(WS)
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (e) => { const b = Buffer.from(e.data); const j = b.indexOf(Buffer.from([0xff, 0xd8, 0xff])); if (j >= 0) last = b.subarray(j) }
    ws.onerror = () => {}
    const log = () => readFileSync(logPath, 'utf8')
    // wait for the driver's first line, then take a shot 800 ms after each step
    let fed = false
    for (let i = 0; i < 150 && !fed && !died && !badLines(log()).length; i++) { await sleep(200); fed = log().includes('OGSMOKE feed') }
    const t0 = Date.now()
    if (fed) {
      for (const [ms, name] of STEPS) {
        await sleep(ms + 800 - (Date.now() - t0))
        if (last) writeFileSync(join(out, `${String(ms).padStart(5, '0')}-${name}.jpg`), last)
        if (died || badLines(log()).length) break // an OOM mid-run: no point waiting out the rest of the steps
      }
      await sleep(2000)
    }
    writeFileSync(join(out, 'pipe.txt'), pipe) // the simulator's memoryUsage reports, in order: the heap per step
    return { fed, answered: log().includes('OGSMOKE answered'), bad: badLines(log()), died, peak: heapPeak(pipe), out }
  } finally {
    ending = true
    sim.kill(); if (ws) ws.close(); srv.close()
  }
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1] }
  const hsArg = arg('--hs') || '196608'
  const hs = hsArg === 'none' ? 0 : +hsArg
  let dir = arg('--from') && resolve(arg('--from')) // it is a working directory below: an absolute path, whatever it was given as
  const made = !dir
  if (made) dir = mkdtempSync(join(tmpdir(), 'opengym-sim-'))
  let r
  try {
    if (made) { prepare(dir); build(dir) }
    r = await run(dir, arg('--out') || dir + '-shots', hs)
  } finally {
    if (made && !process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true }) // ~17 MB each; the shots stay
  }
  console.log(made && !process.argv.includes('--keep') ? 'copy removed' : `copy ${dir} (kept)`)
  console.log(`heap limit ${hs || 'simulator default'}, peak ${r.peak ? r.peak + ' bytes' : 'not reported (the simulator died or gave none)'}, shots in ${r.out}`)
  const fails = failures(r)
  fails.forEach((l) => console.log(l))
  if (fails.length) process.exit(1)
  console.log('ok')
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
