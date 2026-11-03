#!/usr/bin/env node
// The Apple-hosted asset packs of the exercise animations (Background Assets), from the catalogue
// metadata alone: which drawing goes into which pack, and the manifest `xcrun ba-package` takes.
//
//   node scripts/media/make-pack-manifests.mjs <out-dir> [--px 240,360,480,720,1080] [--layout pack|clip]
//
// Writes, per pack (`anim-<px>-male`, `anim-<px>-female`):
//   <out>/<packId>/ids.txt        one drawing id per line
//   <out>/<packId>/manifest.json  {"assetPackID", "downloadPolicy": {"onDemand": {}},
//                                  "fileSelectors": [{"fileSource": "<px>/<id>.webp",
//                                  "fileDestination": "<packId>/<id>.webp"}, ...], "platforms": ["iOS"]}
// and <out>/summary.json (files per pack, how many the two figures of a quality share), also
// printed. fileSource is relative to the sourceRoot ba-package is pointed at: a folder holding
// one sub-folder per quality (180/, 240/, ...) of <drawing id>.webp files.
//
// A figure's pack holds every drawing that figure shows: per catalogue exercise its drawing for
// that figure, or its own when it is drawn once (those go into both packs). The rule is
// packDrawingId in frontend/src/lib/anim-quality.js, the one the app resolves with, so a pack
// can never miss a file the app asks it for.
//
// --layout: where a file lands inside the pack. `pack` (the default) puts it under the pack's
// own id, so two packs installed together (the male and the female pack of a quality, which
// share every drawing made once, or two qualities) never claim the same path: Background Assets
// reads all of an app's downloaded packs as one tree. `clip` writes clip/<id>.webp, the same
// path in every pack.
//
// LICENCE: names only. This never opens, decodes or looks at a media file (Gym visual T&C).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXDB } from '../../frontend/src/lib/exercises-data.js'
import { PACK_QUALITIES, FIGURES, packId, packDrawingId } from '../../frontend/src/lib/anim-quality.js'

/** The drawing ids a figure shows, sorted. */
export function drawingsFor(catalogue, figure) {
  const ids = new Set()
  for (const ex of catalogue) {
    const id = packDrawingId(ex, figure)
    if (id) ids.add(id)
  }
  return [...ids].sort()
}

/** The manifest ba-package takes for one pack. */
export function packManifest(px, figure, ids, layout = 'pack') {
  const id = packId(px, figure)
  return {
    assetPackID: id,
    downloadPolicy: { onDemand: {} },
    fileSelectors: ids.map(d => ({ fileSource: `${px}/${d}.webp`, fileDestination: layout === 'clip' ? `clip/${d}.webp` : `${id}/${d}.webp` })),
    platforms: ['iOS'],
  }
}

/** Every pack: { packs: [{ id, px, figure, ids, manifest }], summary }. */
export function buildPacks(catalogue = EXDB, { qualities = PACK_QUALITIES, layout = 'pack' } = {}) {
  const byFigure = Object.fromEntries(FIGURES.map(f => [f, drawingsFor(catalogue, f)]))
  const shared = byFigure.male.filter(id => byFigure.female.includes(id)).length
  const packs = []
  for (const px of qualities) {
    for (const figure of FIGURES) {
      const ids = byFigure[figure]
      packs.push({ id: packId(px, figure), px, figure, ids, manifest: packManifest(px, figure, ids, layout) })
    }
  }
  const summary = {
    exercises: catalogue.length,
    layout,
    packs: Object.fromEntries(packs.map(p => [p.id, p.ids.length])),
    sharedPerQuality: shared,
    distinctDrawings: new Set([...byFigure.male, ...byFigure.female]).size,
  }
  return { packs, summary }
}

function main(argv) {
  const out = argv.find(a => !a.startsWith('--'))
  if (!out) {
    console.error('usage: make-pack-manifests.mjs <out-dir> [--px 240,360,...] [--layout pack|clip]')
    process.exit(2)
  }
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
  const qualities = opt('--px') ? opt('--px').split(',').map(Number) : PACK_QUALITIES
  if (qualities.some(px => !PACK_QUALITIES.includes(px))) {
    console.error(`--px: only ${PACK_QUALITIES.join(', ')}`)
    process.exit(2)
  }
  const layout = opt('--layout') || 'pack'
  if (layout !== 'pack' && layout !== 'clip') { console.error('--layout: pack or clip'); process.exit(2) }
  const { packs, summary } = buildPacks(EXDB, { qualities, layout })
  for (const p of packs) {
    const dir = path.join(out, p.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'ids.txt'), p.ids.join('\n') + '\n')
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(p.manifest, null, 2) + '\n')
  }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2))
export { main }
