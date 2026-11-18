// Imports a user's activity file entirely in this browser for preview only.
// It never writes into the openGym workout log or uploads the file.
const LIMIT = 15 * 1024 * 1024
const KINDS = new Set(['gpx', 'tcx', 'fit'])

export function fileProblem(file) {
  const name = String(file?.name || '')
  const extension = name.split('.').pop().toLowerCase()
  if (!KINDS.has(extension)) return 'Choose a GPX, TCX or FIT activity file'
  if (!Number.isFinite(file?.size) || file.size === 0) return 'The activity file is empty'
  if (file.size > LIMIT) return 'Choose a file no larger than 15 MB'
  return null
}

const metric = value => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const amount = (activity, method) => {
  try { return metric(activity?.[method]?.()?.getValue?.()) } catch { return null }
}
const round = (v, places) => v == null ? null : +v.toFixed(places)

export async function previewActivityFile(file, {
  loadLibrary = () => import('@sports-alliance/sports-lib'),
  DOMParserCtor = globalThis.DOMParser
} = {}) {
  const problem = fileProblem(file)
  if (problem) throw new Error(problem)
  if (!DOMParserCtor) throw new Error('XML parser unavailable on this device')
  const { SportsLib } = await loadLibrary()
  const kind = file.name.split('.').pop().toUpperCase()
  let event
  if (kind === 'GPX') event = await SportsLib.importFromGPX(await file.text(), DOMParserCtor)
  else if (kind === 'TCX') {
    const doc = new DOMParserCtor().parseFromString(await file.text(), 'application/xml')
    if (doc.querySelector?.('parsererror')) throw new Error('Invalid activity XML')
    event = await SportsLib.importFromTCX(doc)
  } else event = await SportsLib.importFromFit(await file.arrayBuffer())
  const activity = event?.getFirstActivity?.()
  if (!activity) throw new Error('No completed activity found in this file')
  const distanceM = amount(activity, 'getDistance')
  const seconds = amount(activity, 'getDuration')
  if (distanceM == null && seconds == null) throw new Error('No usable distance or duration in this activity')
  return {
    kind, filename: String(file.name).slice(0, 120),
    distanceKm: round(distanceM == null ? null : distanceM / 1000, 2),
    durationMinutes: round(seconds == null ? null : seconds / 60, 1),
    localOnly: true
  }
}
