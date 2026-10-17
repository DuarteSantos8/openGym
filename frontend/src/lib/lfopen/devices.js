// Life Fitness model ids → kind of machine → the openGym exercise its data lands on.
//
// A result code names the console by model id (`t`); over Bluetooth the last three digits of the
// device name are the same id. The table is LFconnect's own (ed/b0.java in the decompiled app):
// model id → equipment family, read here as the six kinds of machine openGym tells apart.
import { EXIDX } from '../exercises.js'

// family code (LFconnect) → model ids
const FAMILY_MODELS = {
  1000: [23, 41, 49, 53, 64, 68, 79, 80, 86, 94, 99, 105, 110, 117, 121, 128, 137, 145, 165, 166, 172, 173, 176, 180, 184, 190, 194, 212, 213, 221, 222],
  1001: [16, 24, 25, 26, 43, 50, 54, 65, 69, 74, 75, 76, 89, 106, 111, 122, 129, 138, 146, 162, 169, 179, 183, 187, 191, 195, 216, 227, 228],
  1002: [30, 31, 32, 52, 56, 67, 71, 78, 85, 91, 97, 104, 113, 119, 124, 131, 140, 148, 164, 171, 178, 182, 186, 193, 197, 215, 225, 226, 267, 268],
  1003: [27, 28, 29, 42, 51, 55, 66, 70, 77, 84, 90, 96, 103, 112, 118, 123, 130, 139, 147, 163, 170, 177, 181, 185, 192, 196, 214, 223, 224],
  1004: [261], 1005: [262], 1006: [266], 1007: [260], 1009: [10, 20, 45], 1010: [13, 44], 1011: [265],
  1012: [57, 58, 59, 72, 81, 87, 92, 116, 127, 134, 141, 149],
  1013: [60, 61, 62, 63, 73, 82, 95, 108, 109, 114, 125, 132, 142, 150, 167, 174, 189, 211, 217, 218],
  1014: [83, 93, 143, 151], 1016: [264], 1017: [263],
  1019: [88, 98, 100, 101, 102, 107, 115, 120, 126, 133, 135, 136, 144, 152, 168, 175, 188, 210, 219, 220],
  1020: [160, 161, 198, 199],
}
// family code → kind: treadmills (T3, T5, F1, F3 included), the elliptical family (cross trainer,
// Summit, FlexStrider, GSC, Arc Trainer), the two bikes (Lifecycle and ICG are uprights), stairs
// (stair climber, PowerMill), rower.
const FAMILY_KIND = {
  1000: 'treadmill', 1005: 'treadmill', 1006: 'treadmill', 1008: 'treadmill', 1011: 'treadmill',
  1001: 'crossTrainer', 1007: 'crossTrainer', 1017: 'crossTrainer', 1009: 'crossTrainer', 1012: 'crossTrainer', 1014: 'crossTrainer', 1019: 'crossTrainer',
  1002: 'recumbent',
  1003: 'upright', 1004: 'upright', 1016: 'upright', 1020: 'upright', 1021: 'upright',
  1010: 'stairs', 1013: 'stairs',
  1015: 'rower',
}
const MODEL_FAMILY = new Map()
for (const [fam, ids] of Object.entries(FAMILY_MODELS)) for (const id of ids) MODEL_FAMILY.set(id, Number(fam))

/*
 * Per kind: its English name (shown through t()), the names someone's own exercise for it is
 * likely to have (an earlier Life Fitness import made "Upright Bike" a custom exercise), and the
 * catalogue entry used when there is none. The catalogue has no plain "upright bike": the
 * stationary bike entry the CSV import already maps "stationary bike" to stands in for it.
 */
export const KINDS = {
  treadmill: { label: 'Treadmill', names: ['treadmill', 'walking on treadmill', 'laufband'], exId: '2259' },
  crossTrainer: { label: 'Cross trainer', names: ['cross trainer', 'crosstrainer', 'elliptical', 'walk elliptical cross trainer'], exId: '2141' },
  upright: { label: 'Upright bike', names: ['upright bike', 'upright bicycle', 'fahrrad', 'ergometer'], exId: '2138' },
  recumbent: { label: 'Recumbent bike', names: ['recumbent bike', 'liegerad'], exId: '2193' },
  stairs: { label: 'Stair climber', names: ['stair climber', 'stepper', 'powermill', 'walking on stepmill'], exId: '2311' },
  rower: { label: 'Rower', names: ['rower', 'rowing machine', 'rudergerät', 'rowing (with rowing machine)'], exId: '1161' },
}

/** The kind of machine a model id is, or null when LFconnect's table does not know it. */
export function kindOfModel(modelId) {
  const fam = MODEL_FAMILY.get(Number(modelId))
  return (fam && FAMILY_KIND[fam]) || null
}

/** Stair climbers and PowerMills report steps or floors where others report climbed height. */
export const isStepsModel = modelId => [44, 45, 60, 61, 62, 63].includes(Number(modelId))

/** The model id in a Bluetooth device name: its last three digits (names are 18 characters). */
export function modelFromDeviceName(name) {
  const m = /(\d{3})$/.exec(String(name ?? '').trim())
  return m ? Number(m[1]) : null
}

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The exercise a kind of machine's data goes to: one of your own named for it first (case and
 * spacing aside), else the catalogue's. Null for an unknown kind: the caller asks.
 */
export function exerciseForKind(kind, customEx = []) {
  const k = KINDS[kind]
  if (!k) return null
  const names = new Set(k.names.map(norm))
  const own = (customEx || []).find(c => c && names.has(norm(c.n)))
  if (own) return own.id
  return EXIDX[k.exId] ? k.exId : null
}
