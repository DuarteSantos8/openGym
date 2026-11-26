#!/usr/bin/env node
// The size gate: Huawei's lite engine refuses a file over 48 KB, so no built file may pass 45 KB.
// Clears the build's output folder, runs the release build, lists the built JS/JSON files and exits 1 if one is over the limit.
//   node watch-huawei/huawei-size.mjs            fails when a file is too big
//   node watch-huawei/huawei-size.mjs --report   the same table; still exits 1 when app.js is over (a page file over the limit does not fail it)
// Needs DevEco Studio's command line tools (JAVA_HOME and DEVECO_SDK_HOME, docs/HUAWEI_WATCH.md).
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIMIT = 46080
const here = dirname(fileURLToPath(import.meta.url))
const loaderOf = (dir) => join(dir, 'entry', 'build', 'default', 'intermediates', 'loader_out_lite')
export const outOf = (dir = here) => join(loaderOf(dir), 'default', 'js', 'MainAbility') // where a build of `dir` puts the app
const OUT = outOf()
const DEVECO = '/Applications/DevEco-Studio.app/Contents'

// [name, bytes] list -> the ones over the limit
export const overLimit = (files, limit = LIMIT) => files.filter(([, bytes]) => bytes > limit)

// app.js is the file every page shares and the tightest: it fails the gate even under --report
export const appOver = (files, limit = LIMIT) => overLimit(files, limit).filter(([n]) => /^app\.(js|bc)$/.test(n))

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])

// huawei-sim.mjs builds a copy of the project the same way, so `dir` can be another folder
export function build(dir = here) {
  rmSync(loaderOf(dir), { recursive: true, force: true }) // the build does not clean it: a deleted file must not trip or hide the gate
  const env = {
    ...process.env,
    JAVA_HOME: process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17',
    DEVECO_SDK_HOME: process.env.DEVECO_SDK_HOME || join(DEVECO, 'sdk'),
    PATH: `${join(DEVECO, 'tools', 'node', 'bin')}:${process.env.PATH}`,
  }
  execFileSync(join(DEVECO, 'tools', 'hvigor', 'bin', 'hvigorw'),
    ['assembleHap', '--mode', 'module', '-p', 'product=default', '-p', 'buildMode=release', '--no-daemon'],
    { cwd: dir, env, stdio: 'inherit' })
}

function main() {
  const report = process.argv.includes('--report')
  build()
  const files = walk(OUT).filter((f) => /\.(js|bc|json)$/.test(f))
    .map((f) => [relative(OUT, f), statSync(f).size])
    .sort((a, b) => b[1] - a[1])
  const bad = new Set(overLimit(files).map(([n]) => n))
  for (const [name, bytes] of files) console.log(`${String(bytes).padStart(8)}  ${bad.has(name) ? 'OVER' : 'ok  '}  ${name}`)
  console.log(`limit ${LIMIT} bytes, ${bad.size} file(s) over`)
  if ((bad.size && !report) || appOver(files).length) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
