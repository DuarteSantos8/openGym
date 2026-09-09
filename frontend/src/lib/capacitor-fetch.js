// A fetch for the phone that does not go through the WebView.
//
// The Coach's HTTP adapters take an injectable `fetch`. In the native app the WebView's origin
// is capacitor://localhost, and a provider that has no CORS story for that origin would refuse
// the preflight before a single byte of the request went out. CapacitorHttp.request() makes
// the call from native code instead, where CORS does not exist.
//
// Deliberately an explicit shim rather than the `plugins.CapacitorHttp.enabled` switch: that
// flag replaces window.fetch for the whole app, which would silently reroute every api() call
// a paired phone makes to its own server as well. Only the Coach's provider calls go this way.
//
// Only the subset the adapters use is implemented: method, headers, a JSON body, an abort
// signal, and a response with ok/status/text()/json().
export async function nativeFetch(url, init = {}) {
  let cap = null
  try { cap = await import('@capacitor/core') } catch { /* not a Capacitor build */ }
  if (!cap || !cap.Capacitor || !cap.Capacitor.isNativePlatform()) return fetch(url, init)

  const headers = { ...(init.headers || {}) }
  let data = init.body
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { /* send as-is */ } }

  const request = cap.CapacitorHttp.request({
    url, method: init.method || 'GET', headers, data,
    // The read timeout is not the job timeout: that is the AbortSignal's job (see abortOf),
    // and coach-local.js derives it from the provider. This only has to be longer than any
    // job may legitimately run, so a local model on a laptop is never cut off by the transport.
    responseType: 'text', connectTimeout: 30000, readTimeout: 40 * 60000
  })
  const res = init.signal ? await Promise.race([request, abortOf(init.signal)]) : await request
  const text = typeof res.data === 'string' ? res.data : res.data == null ? '' : JSON.stringify(res.data)
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    text: async () => text,
    json: async () => JSON.parse(text)
  }
}

function abortOf(signal) {
  return new Promise((_, reject) => {
    const err = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    if (signal.aborted) return err()
    signal.addEventListener('abort', err, { once: true })
  })
}
