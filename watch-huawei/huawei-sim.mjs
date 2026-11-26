#!/usr/bin/env node
// Simulator smoke: builds a TEMP COPY of the app in release mode with a fake phone and a timed driver added, runs it in Huawei's
// lite-wearable simulator and drives a workout through the page's own handlers (the simulator ignores taps). Prints the heap
// peak and saves a shot per step. Exit 1 on JS HEAP OOM, Eval JS file failed or JS REF LIMIT (or if the app never ran).
//   node watch-huawei/huawei-sim.mjs [--hs BYTES|none] [--out DIR] [--from DIR]
//   --hs   the simulator's JS heap in bytes, default 196608 (192 KB); `none` runs with the simulator's own heap
//   --from reuse the copy a run printed (it stays in the temp folder; no copy, no build); --out where the shots and logs go (default: the copy)
// The debug phone (sim/debugphone.js) never reaches the product: it lives outside entry/, only this script copies it, and
// only into the temp copy. A test (test/sim.test.js) checks entry/ has no trace of it; grep the product build to prove it.
// Needs DevEco Studio (JAVA_HOME and DEVECO_SDK_HOME, docs/HUAWEI_WATCH.md). One simulator at a time: it is killed at the end.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, outOf } from './huawei-size.mjs'
import { STEPS } from './sim/debugphone.js'

const here = dirname(fileURLToPath(import.meta.url))
const PREVIEWER = (process.env.DEVECO_SDK_HOME || '/Applications/DevEco-Studio.app/Contents/sdk') + '/default/hms/previewer/liteWearable'
const WS = 'ws://127.0.0.1:40003' // the simulator's picture socket: a client must stay connected or its timers stop
const BAD = /JS HEAP OOM|Eval JS file failed|JS REF LIMIT/
const PAGE = 'entry/src/main/js/MainAbility/pages/index/index.js'

export const badLines = (log) => log.split('\n').filter((l) => BAD.test(l))
// the simulator reports memoryUsage on the pipe as JSON ending in a NUL byte
export const heapPeak = (pipe) => Math.max(0, ...[...pipe.matchAll(/"peakAllocBytes":\s*(\d+)/g)].map((m) => +m[1]))

// hook the debug phone into the page copy: the import, and a call right after the core is made
export function inject(src) {
  const imp = "import { blank,"
  const make = 'A.make(stored)'
  if (!src.includes(imp) || !src.includes(make)) throw new Error('inject: anchor not found in the page, update huawei-sim.mjs')
  return src.replace(imp, "import drive from '../../common/debugphone.js'\n" + imp).replace(make, 'A.make(stored); drive(page, A, K)')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function prepare(dir) {
  cpSync(here, dir, { recursive: true, filter: (f) => !/\/(entry\/build|\.hvigor|file_system|node_modules|test|sim)$/.test(f) })
  copyFileSync(join(here, 'sim', 'debugphone.js'), join(dir, 'entry/src/main/js/MainAbility/common/debugphone.js'))
  const page = join(dir, PAGE)
  writeFileSync(page, inject(readFileSync(page, 'utf8')))
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
    '-lws', '40003', '-s', 'ogsmoke', '-url', 'pages/index/index', '-l', 'en_US']
  if (hs) args.push('-hs', String(hs))
  const sim = spawn(join(bin, 'Simulator'), args, { cwd: bin, stdio: ['ignore', openSync(logPath, 'w'), openSync(join(out, 'sim.err'), 'w')] })
  await sleep(1500)
  let last = null
  const ws = new WebSocket(WS)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (e) => { const b = Buffer.from(e.data); const j = b.indexOf(Buffer.from([0xff, 0xd8, 0xff])); if (j >= 0) last = b.subarray(j) }
  ws.onerror = () => {}
  const log = () => readFileSync(logPath, 'utf8')
  // wait for the driver's first line, then take a shot 800 ms after each step
  let fed = false
  for (let i = 0; i < 150 && !fed && !badLines(log()).length; i++) { await sleep(200); fed = log().includes('OGSMOKE feed') }
  const t0 = Date.now()
  if (fed) {
    for (const [ms, name] of STEPS) {
      await sleep(ms + 800 - (Date.now() - t0))
      if (last) writeFileSync(join(out, `${String(ms).padStart(5, '0')}-${name}.jpg`), last)
    }
    await sleep(2000)
  }
  const bad = badLines(log())
  const peak = heapPeak(pipe)
  sim.kill(); ws.close(); srv.close()
  return { fed, bad, peak, out }
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1] }
  const hsArg = arg('--hs') || '196608'
  const hs = hsArg === 'none' ? 0 : +hsArg
  let dir = arg('--from')
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'opengym-sim-'))
    prepare(dir)
    build(dir)
  }
  const r = await run(dir, arg('--out') || join(dir, 'shots'), hs)
  console.log(`copy ${dir}`)
  console.log(`heap limit ${hs || 'simulator default'}, peak ${r.peak ? r.peak + ' bytes' : 'not reported (the simulator died or gave none)'}, shots in ${r.out}`)
  if (!r.fed) console.log('FAIL the app never ran its workout (no OGSMOKE feed in the simulator log)')
  for (const l of r.bad) console.log('FAIL ' + l.slice(0, 160))
  if (!r.fed || r.bad.length) process.exit(1)
  console.log('ok')
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
