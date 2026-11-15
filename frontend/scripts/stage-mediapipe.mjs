// Stages the Movement Lab's on-device pose analysis (EP10) into public/mediapipe/, so Vite ships it
// with the app and nothing is fetched from Google at run time:
//   · the WebAssembly runtime, copied from node_modules/@mediapipe/tasks-vision (Apache-2.0); only
//     the classic variant FilesetResolver.forVisionTasks() loads by default, not the ES-module one
//   · the pose landmarker "lite" model, downloaded here once and checked against a pinned SHA-256
// A good copy already in place is kept. Offline, or on a checksum mismatch, it warns and exits 0:
// the build goes on and the Lab says the model is not in this build (lib/pose-session.js 'model').
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'mediapipe')
const wasmFrom = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const RUNTIME = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']
export const MODEL = Object.freeze({
  file: 'pose_landmarker_lite.task',
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  bytes: 5777746
})
const sha = buf => createHash('sha256').update(buf).digest('hex')

mkdirSync(join(out, 'wasm'), { recursive: true })
for (const f of RUNTIME) {
  const from = join(wasmFrom, f)
  if (!existsSync(from)) { console.warn(`stage-mediapipe: ${f} missing; run npm ci. The Movement Lab will be unavailable.`); process.exit(0) }
  copyFileSync(from, join(out, 'wasm', f))
}

const modelPath = join(out, MODEL.file)
if (existsSync(modelPath) && sha(readFileSync(modelPath)) === MODEL.sha256) {
  console.log('stage-mediapipe: runtime copied, model already in place')
  process.exit(0)
}
try {
  const res = await fetch(MODEL.url, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length !== MODEL.bytes || sha(buf) !== MODEL.sha256) throw new Error('checksum mismatch')
  writeFileSync(modelPath, buf)
  console.log(`stage-mediapipe: runtime copied, model downloaded and verified (${(buf.length / 1e6).toFixed(1)} MB)`)
} catch (e) {
  console.warn(`stage-mediapipe: model not staged (${e.message}). The build continues; the Movement Lab will say the model is missing.`)
}
