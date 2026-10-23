import { CATALOGUE, EXIDX, drawingIdOf, figureOf, isCustomEx } from './exercises.js'

const indices = new WeakMap()
function clipsOf(manifest) {
  if (!manifest || typeof manifest !== 'object') return new Map()
  if (!indices.has(manifest)) indices.set(manifest, new Map((manifest.assets || [])
    .filter(a => a.kind === 'clip').map(a => [a.drawingId, a])))
  return indices.get(manifest)
}

export function catalogueClipAsset(ex, figure, manifest) {
  if (!ex || isCustomEx(ex) || !ex.gif) return null
  return clipsOf(manifest).get(drawingIdOf(ex, figure)) || null
}

/** A click captures IDs only, never a reference to a mutable plan or favourite list. */
export function selectCatalogueAssets({ state, scope, exerciseIds = [], manifest }) {
  let exercises
  if (scope === 'all') exercises = CATALOGUE
  else {
    let ids
    if (scope === 'exercise') ids = exerciseIds
    else if (scope === 'favourites') ids = state?.favEx || []
    else if (scope === 'plan') ids = [
      ...(state?.routines || []).flatMap(r => (r?.ex || []).map(e => e?.id)),
      ...(state?.active?.entries || []).map(e => e?.id),
    ]
    else return []
    exercises = ids.map(id => EXIDX[id]).filter(Boolean)
  }
  const figure = figureOf(state)
  return [...new Set(exercises.map(ex => catalogueClipAsset(ex, figure, manifest)?.assetId).filter(Boolean))].sort()
}
