// Where health readings come from besides the user's own hand. A source is a provider: an object
// with the shape below, registered here, and nothing in the health area knows any more about it
// than this. Apple Health is the first (apple-health.js); Health Connect reading on Android, or a
// smart scale, is another object of the same shape added to PROVIDERS — the screens, the import,
// the deduplication and the sync merge stay as they are.
//
// interface HealthDataProvider {
//   id: string                    the `src` its records carry ('apple-health')
//   label: string                 its name on screen (an English key for t())
//   isAvailable(): Promise<bool>  whether it can run on this device at all
//   getAvailableDataTypes(): string[]
//                                 the metrics (lib/health/metrics.js) it can read
//   requestPermissions(types): Promise<{ asked: bool }>
//                                 asks the user for read access to `types` only. A source that
//                                 cannot tell whether read access was granted (HealthKit, by
//                                 design) answers { asked: true } and an empty fetch is the sign
//   fetchMeasurements({ types, since, until }): Promise<reading[]>
//                                 readings of `types` between two ms times, each shaped for
//                                 lib/health/records.js makeRecord: { type, v, t, d?, sid, src,
//                                 lo?, hi? } — `sid` the source's own id for the reading, so the
//                                 next fetch of the same reading is recognised (importRecords)
//   manageHint: string            how the user takes access back (an English key for t())
// }
//
// sync(), which the brief names next to these, is the same for every source and lives in
// lib/health/sync.js: it calls fetchMeasurements and folds the result in.
import { appleHealth } from './apple-health.js'

export const PROVIDERS = [appleHealth]

export const providerById = id => PROVIDERS.find(p => p.id === id) || null

/** The label of a record's source: a provider's, 'Manual' for the user's own entries. */
export const sourceLabel = src => (src === 'manual' || !src ? 'Manual' : providerById(src)?.label || src)
