// One video through the whole pipeline, from the command line — for trying a channel before
// pointing anyone at it, and for seeing why one reads badly. Not used by the server.
//
//   docker compose --profile video-import run --rm -v "$PWD/out:/out" video-import \
//     node src/cli.js <youtube-url> [--video] [--name x,y,w,h[;x,y,w,h]] [--timer x,y,w,h] [--out /out]
//
// Without --name/--timer it uses the suggested boxes. With --out it writes the ROI stills there
// and the full result as result.json, so the boxes can be checked by eye, and every second's raw
// reading as frames.json.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonicalYouTube } from './url.js'
import { metadata, download } from './youtube.js'
import { metadataDraft, sourceOf } from './metadata.js'
import { classify } from './classify.js'
import { analyse, roiSetup } from './pipeline.js'
import { probe } from './frames.js'
import { cleanBox } from './roi-suggest.js'

const args = process.argv.slice(2)
const flag = k => args.includes(k)
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const one = s => { const [x, y, w, h] = s.split(',').map(Number); return cleanBox({ x, y, w, h }) }
// "--name a,b,c,d;e,f,g,h": several places the names appear.
const box = s => { if (!s) return null; const list = s.split(';').map(one).filter(Boolean); return list.length > 1 ? list : list[0] || null }
const url = args.find(a => !a.startsWith('--') && canonicalYouTube(a))
if (!url) { console.error('usage: node src/cli.js <youtube-url> [--video] [--name x,y,w,h[;x,y,w,h]] [--timer x,y,w,h] [--out dir]'); process.exit(2) }
const out = opt('--out')
const log = (...a) => console.error('·', ...a)

const yt = canonicalYouTube(url)
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogvi-cli-'))
try {
  const t0 = Date.now()
  const info = await metadata(yt.url)
  const source = sourceOf(info, yt.url)
  log(`"${source.title}" by ${source.channel} (${source.channelId}), ${Math.round(source.duration / 60)} min`)
  const meta = metadataDraft(info)
  log(`chapters/description: ${meta.blocks.length} blocks from ${meta.source}, usable=${meta.usable}`)
  let result
  if (meta.usable && !flag('--video')) {
    result = { source, method: meta.source, draft: classify(meta.blocks, { hints: meta.hints }) }
  } else {
    let last = -1
    const file = await download(yt.url, workDir, { onProgress: f => { const p = Math.floor(f * 10); if (p !== last) { last = p; log(`download ${p * 10}%`) } } })
    const dims = await probe(file)
    log(`video ${dims.width}x${dims.height}, ${Math.round(dims.duration)} s, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`)
    const setup = await roiSetup(file, { workDir, dims })
    log('suggested boxes', JSON.stringify(setup.suggest))
    const roi = { name: box(opt('--name')) || setup.suggest.name, timer: box(opt('--timer')) || setup.suggest.timer }
    if (out) {
      fs.mkdirSync(out, { recursive: true })
      setup.samples.forEach((s, i) => fs.writeFileSync(path.join(out, `sample-${i}-${Math.round(s.t)}s.jpg`), Buffer.from(s.src.split(',')[1], 'base64')))
    }
    if (!roi.name) { log('no name box: pass --name x,y,w,h (fractions of the frame); look at the samples in --out'); process.exit(1) }
    log('using boxes', JSON.stringify(roi))
    const stages = new Set()
    const res = await analyse(file, roi, { workDir, dims, hints: meta.hints, parts: meta.parts, progress: s => { if (!stages.has(s)) { stages.add(s); log(s) } } })
    log('stats', JSON.stringify(res.stats))
    result = { source, method: 'video', roi, draft: res.draft, blocks: res.blocks }
    // Every second's raw reading, for tuning the segmentation offline without reading the video again.
    if (out) fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(res.frames))
  }
  log(`done in ${Math.round((Date.now() - t0) / 1000)} s`)
  if (out) fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1))
  for (const b of result.blocks || []) console.log(`  ${String(b.start).padStart(5)}s ${String(b.dur).padStart(4)}s ${b.kind.padEnd(4)} ${b.text} (${b.conf})`)
  for (const s of result.draft.sections) {
    console.log(`\n[${s.kind}]${s.kind === 'interval' ? ` rounds=${s.rounds} work=${s.work} rest=${s.rest}${s.roundRest ? ` roundRest=${s.roundRest}` : ''}` : ''}`)
    for (const r of s.rows) console.log(`  ${r.name.padEnd(32)} ${String(r.sec).padStart(4)}s rest ${String(r.rest).padStart(3)}s ×${r.rounds}${r.side ? ' per side' : ''}  conf ${r.conf}`)
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
