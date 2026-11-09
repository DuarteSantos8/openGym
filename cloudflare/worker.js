// opengym.ch — normally every request goes straight through to the homelab
// (Cloudflare Tunnel → Traefik). If the homelab can't answer (530 = tunnel down,
// 502/503/504 = Traefik or the container down, or a timeout), GET/HEAD are served
// from the static copy uploaded with this Worker (cloudflare/build.sh).
const DOWN = new Set([502, 503, 504, 530])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // On *.workers.dev there is no homelab behind it: serve the copy directly (for testing)
    if (!url.hostname.endsWith('.workers.dev')) {
      try {
        const res = await fetch(request, { signal: AbortSignal.timeout(8000) })
        if (!DOWN.has(res.status)) return res
      } catch {
        // timeout or connection error → fallback
      }
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('openGym is offline right now, try again in a few minutes.', {
        status: 503,
        headers: { 'retry-after': '120' },
      })
    }

    const res = await env.ASSETS.fetch(request)
    const out = new Response(res.body, res)
    out.headers.set('x-served-by', 'cloudflare-fallback')
    out.headers.set('cache-control', 'no-store') // so nothing sticks once the homelab is back
    return out
  },
}
