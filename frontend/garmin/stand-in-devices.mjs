#!/usr/bin/env node
// Stand-in Connect IQ device files, for compile checks without a Garmin login (docs/GARMIN.md,
// "Compile checks without a Garmin login"). The SDK zip downloads without an account and its
// bin/monkeybrains.jar carries a devices.xml with every watch's screen, colours, palette, Connect IQ
// version and languages, but not its memory limits. This writes <out>/<id>/compiler.json for the
// watches in manifest.xml (or the ids given), enough for monkeyc to compile, type-check and package.
// The memory limits are rough guesses: it proves the code compiles, not that it fits. The store
// package is built with the SDK Manager's real device files.
//
//   node frontend/garmin/stand-in-devices.mjs <SDK> <out> [device ids…]
//   _JAVA_OPTIONS=-Duser.home=<home> monkeyc …    with <out> = <home>/.Garmin/ConnectIQ/Devices
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [sdk, out, ...given] = process.argv.slice(2)
if (!sdk || !out) { console.error('usage: stand-in-devices.mjs <SDK> <out> [device ids…]'); process.exit(2) }
const xml = execFileSync('unzip', ['-p', join(sdk, 'bin', 'monkeybrains.jar'), 'com/garmin/monkeybrains/devices/devices.xml'], { encoding: 'utf8', maxBuffer: 256 << 20 })
const ids = given.length ? given : [...readFileSync(join(here, 'manifest.xml'), 'utf8').matchAll(/<iq:product id="([a-z0-9_]+)"\/>/g)].map(m => m[1])

// Guesses, small enough to be careful: the older and black-and-white watches give a watch app less.
const memoryFor = (bpp, ciq) => (bpp <= 4 || ciq < '3.4' ? 131072 : 786432)
let missing = 0
for (const id of ids) {
  const m = xml.match(new RegExp(`<device [^>]*\\bid="${id}"[\\s\\S]*?</device>`))
  if (!m) { console.error(`${id}: not in the SDK's devices.xml`); missing++; continue }
  const d = m[0]
  const head = d.slice(0, d.indexOf('>'))
  const attr = (s, k) => (s.match(new RegExp(`\\b${k}="([^"]+)"`)) || [])[1]
  const size = tag => { const t = (d.match(new RegExp(`<${tag} [^>]*>`)) || [''])[0]; return { width: +attr(t, 'width'), height: +attr(t, 'height') } }
  const partNumbers = [...d.matchAll(/<part_number ([^>]*)>([\s\S]*?)<\/part_number>/g)].map(p => ({
    number: attr(p[1], 'number'),
    firmwareVersion: +(attr(p[1], 'firmwareVersion') || 0),
    connectIQVersion: attr(p[1], 'connectIQVersion'),
    languages: [...p[2].matchAll(/<language font_set="([^"]+)">(\w+)</g)].map(l => ({ code: l[2], fontSet: l[1] })),
  }))
  const bpp = +(d.match(/<bpp>(\d+)</) || [])[1]
  const ciq = partNumbers[0]?.connectIQVersion || '0'
  const limit = memoryFor(bpp, ciq)
  const c = {
    deviceId: id,
    displayName: attr(head, 'name'),
    deviceFamily: attr(head, 'family'),
    worldWidePartNumber: attr(head, 'part_number'),
    partNumbers,
    bitsPerPixel: bpp,
    orientation: 0,
    resolution: size('resolution'),
    launcherIcon: size('launcher_icon'),
    appTypes: ['watchApp', 'widget', 'datafield', 'watchFace', 'background', 'glance'].map(type => ({ type, memoryLimit: limit })),
    imageFormats: [...d.matchAll(/<format name="(\w+)"/g)].map(f => f[1]),
    alphaBlendingSupport: /<alpha_blending_support>TRUE/.test(d),
    gpuSupport: /<gpu_support>TRUE/.test(d),
    deviceVersion: 'stand-in',
  }
  const pal = d.match(/<palette( resourcePalette="TRUE")?>([\s\S]*?)<\/palette>/)
  if (pal) c.palette = { isResourcePalette: !!pal[1], colors: [...pal[2].matchAll(/<color>(\w+)</g)].map(x => x[1]) }
  if (!partNumbers.some(p => p.number === c.worldWidePartNumber)) c.worldWidePartNumber = partNumbers[0]?.number
  mkdirSync(join(out, id), { recursive: true })
  writeFileSync(join(out, id, 'compiler.json'), JSON.stringify(c, null, 2) + '\n')
}
console.log(`stand-in devices: ${ids.length - missing} written to ${out}${missing ? `, ${missing} missing` : ''}`)
