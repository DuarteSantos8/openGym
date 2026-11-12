// opengym.ch failover. Normally this Worker is NOT in front of opengym.ch at all: every request
// goes straight through the Cloudflare Tunnel to the homelab and costs no Worker requests.
//
// scheduled(): once a minute (Cron Trigger) it checks the homelab four times, 15 s apart.
//   Two failed checks in a row → it adds the route opengym.ch/* so this Worker serves the
//   static copy (cloudflare/build.sh). Two good checks in a row → it removes the route again.
//   Needs the secret CF_API_TOKEN (Zone → Workers Routes → Edit, zone opengym.ch).
//
// fetch(): only runs while the route exists (an outage). It still asks the homelab first, so
//   visitors get the real site the moment it is back, even before the timer removes the route.
const DOWN = new Set([502, 503, 504, 530])
const FALLBACK_HEADER = 'x-served-by'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // On *.workers.dev there is no homelab behind it: serve the copy directly (for testing)
    if (!url.hostname.endsWith('.workers.dev')) {
      try {
        const res = await fetch(request, { signal: AbortSignal.timeout(4000) })
        // a 404 can be Traefik with no route to the container: serve the copy if it has the file
        if (res.status === 404 && (request.method === 'GET' || request.method === 'HEAD')) {
          const copy = await env.ASSETS.fetch(request)
          if (copy.ok) return fallback(copy)
          return res
        }
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

    return fallback(await env.ASSETS.fetch(request))
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(failover(env))
  },
}

function fallback(res) {
  const out = new Response(res.body, res)
  out.headers.set(FALLBACK_HEADER, 'cloudflare-fallback')
  out.headers.set('cache-control', 'no-store') // so nothing sticks once the homelab is back
  return out
}

// true = the homelab answered with the real homepage (a 404 on / is Traefik without the container). A response from this Worker's own copy counts as down.
export async function homelabUp(origin, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${origin}/?failover-check=${Date.now()}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    })
    if (DOWN.has(res.status) || res.status === 404) return false
    if (res.headers.get(FALLBACK_HEADER) === 'cloudflare-fallback') return false
    return true
  } catch {
    return false
  }
}

export async function failover(env, deps = {}) {
  const fetchImpl = deps.fetch || fetch
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)))
  const checks = deps.checks || 4
  const gap = deps.gap ?? 15000
  const pattern = env.ROUTE_PATTERN || 'opengym.ch/*'
  const script = env.SCRIPT_NAME || 'opengym'
  const origin = env.ORIGIN || 'https://opengym.ch'
  if (!env.CF_API_TOKEN || !env.ZONE_ID) {
    console.log('failover: CF_API_TOKEN or ZONE_ID missing, doing nothing')
    return 'unconfigured'
  }
  const api = `https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/workers/routes`
  const auth = { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' }
  const call = async (url, init, what) => {
    const j = await (await fetchImpl(url, { headers: auth, ...init })).json()
    if (!j.success) throw new Error(`${what}: ${JSON.stringify(j.errors)}`)
    return j.result
  }

  let route = (await call(api, {}, 'list routes')).find(x => x.pattern === pattern) || null
  let streak = 0 // checks in a row that say the current state is wrong
  for (let i = 0; i < checks; i++) {
    if (i) await sleep(gap)
    const up = await homelabUp(origin, fetchImpl)
    const wrong = up === !!route // route on while the homelab is up, or off while it is down
    streak = wrong ? streak + 1 : 0
    if (streak < 2) continue
    streak = 0
    if (route) {
      await call(`${api}/${route.id}`, { method: 'DELETE' }, 'remove route')
      route = null
      console.log('failover: homelab back, route removed')
    } else {
      route = await call(api, { method: 'POST', body: JSON.stringify({ pattern, script }) }, 'add route')
      console.log('failover: homelab down, serving the Cloudflare copy')
    }
  }
  return route ? 'fallback' : 'homelab'
}
