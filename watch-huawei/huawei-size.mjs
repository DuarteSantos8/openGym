#!/usr/bin/env node
// The size gate: Huawei's lite engine refuses a file over 48 KB, so no built file may pass 45 KB.
// Runs the release build, lists the built JS/JSON files and exits 1 if one is over the limit.
//   node watch-huawei/huawei-size.mjs            fails when a file is too big
//   node watch-huawei/huawei-size.mjs --report   prints the table, never fails
// Needs DevEco Studio's command line tools (JAVA_HOME and DEVECO_SDK_HOME, docs/HUAWEI_WATCH.md).
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIMIT = 46080
const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'entry', 'build', 'default', 'intermediates', 'loader_out_lite', 'default', 'js', 'MainAbility')
const DEVECO = '/Applications/DevEco-Studio.app/Contents'

// [name, bytes] list -> the ones over the limit
export const overLimit = (files, limit = LIMIT) => files.filter(([, bytes]) => bytes > limit)

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])

function build() {
  const env = {
    ...process.env,
    JAVA_HOME: process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17',
    DEVECO_SDK_HOME: process.env.DEVECO_SDK_HOME || join(DEVECO, 'sdk'),
    PATH: `${join(DEVECO, 'tools', 'node', 'bin')}:${process.env.PATH}`,
  }
  execFileSync(join(DEVECO, 'tools', 'hvigor', 'bin', 'hvigorw'),
    ['assembleHap', '--mode', 'module', '-p', 'product=default', '-p', 'buildMode=release', '--no-daemon'],
    { cwd: here, env, stdio: 'inherit' })
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
  if (bad.size && !report) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
