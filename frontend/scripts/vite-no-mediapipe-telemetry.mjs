// MediaPipe Tasks (@mediapipe/tasks-vision 1.2.3) creates an internal usage-stats logger for every
// task it builds, with no public opt-out, that POSTs to https://odml.pa.googleapis.com/v1/log every
// 60 s and on close(). openGym sends no telemetry, so this Vite plugin turns that one network call
// in the vendor bundle into a call to a no-op function, at build and dev time. If the code it expects
// is not there exactly once, the build fails: a MediaPipe upgrade has to be re-checked (and the
// real-browser smoke test re-run) instead of shipping whatever the new version sends.
const CALL = 'this.o.send({url:"https://odml.pa.googleapis.com/v1/log"'
const NOOP = '(()=>{})({url:""'
const BUNDLE = /[\\/]@mediapipe[\\/]tasks-vision[\\/]vision_bundle\.(mjs|cjs|js)$/

export function stripMediapipeTelemetry(code) {
  const n = code.split(CALL).length - 1
  if (n !== 1) throw new Error(`MediaPipe telemetry patch: expected the usage-logging call once, found ${n}. Re-check @mediapipe/tasks-vision before upgrading it.`)
  const out = code.replace(CALL, NOOP)
  if (out.includes('odml.pa.googleapis.com')) throw new Error('MediaPipe telemetry patch: the logging host is still in the bundle')
  return out
}

export function noMediapipeTelemetry() {
  return {
    name: 'opengym-no-mediapipe-telemetry',
    enforce: 'pre',
    transform(code, id) {
      if (!BUNDLE.test(id.split('?')[0])) return null
      return { code: stripMediapipeTelemetry(code), map: null }
    }
  }
}
