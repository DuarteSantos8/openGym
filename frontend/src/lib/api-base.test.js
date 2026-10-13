// @vitest-environment happy-dom
// Issue #238: openGym behind a reverse proxy that serves it under a subpath. The assets were
// already relative; the API call was not, so it went to the proxy's own root where nothing
// answers it. The base is read from where the app is being served.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { appBase, beacon } from './api.js'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = pathname => appBase({ pathname })

describe('the app knows where it is served from', () => {
  it('is the site root for an ordinary deployment', () => {
    expect(at('/')).toBe('/')
    expect(at('/index.html')).toBe('/')
  })

  it('keeps the proxy prefix of a subpath deployment', () => {
    expect(at('/myGym/')).toBe('/myGym/')
    expect(at('/myGym/index.html')).toBe('/myGym/')
    expect(at('/a/b/c/')).toBe('/a/b/c/')
  })

  it('drops a stale deep path rather than inventing a base from it', () => {
    // nginx sends these back to the app root before React boots; this is the belt and braces.
    expect(at('/myGym/plan/r/x')).toBe('/myGym/plan/r/')
    expect(at('/plan')).toBe('/')
  })

  it('survives a missing or odd location', () => {
    expect(appBase(null)).toBe('/')
    expect(at('')).toBe('/')
  })
})

describe('the "left" beacon of the web app', () => {
  afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, '', '/') })

  it('goes to the API of the copy it was served from, as JSON', async () => {
    history.replaceState(null, '', '/myGym/')
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon })
    expect(beacon('/api/activity', { active: false })).toBe(true)
    const [url, blob] = sendBeacon.mock.calls[0]
    expect(url).toBe('/myGym/api/activity')
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await blob.text())).toEqual({ active: false })
  })

  it('a browser without sendBeacon just skips it', () => {
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined })
    expect(beacon('/api/activity', { active: false })).toBe(false)
  })
})

// What the web container does with a request, read off web/nginx.conf.template itself.
// A path, not a URL: under happy-dom `URL` is the DOM's, which node:fs will not take.
const NGINX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../web/nginx.conf.template'), 'utf8')

// Each { } block's own directives, its nested blocks left out. Comments go first, and so do
// ${VAR} placeholders, whose braces are envsubst's, not nginx's.
function blocksOf(conf) {
  const out = [], stack = ['']
  for (const ch of conf.replace(/#.*$/gm, '').replace(/\$\{\w+\}/g, 'X')) {
    if (ch === '{') stack.push('')
    else if (ch === '}') out.push(stack.pop())
    else stack[stack.length - 1] += ch
  }
  return out
}

// An image keeps for 30 days, said by one Cache-Control: the one that can carry `immutable`.
// `expires` adds a Cache-Control of its own (and an Expires header) beside it.
describe('the cache lifetime nginx gives an image', () => {
  it('is said once, by the explicit header, with no expires beside it', () => {
    expect(NGINX.replace(/#.*$/gm, '')).not.toMatch(/\bexpires\b/)
    // the exercise media's own block and every other image's
    const media = blocksOf(NGINX).filter(b => /\bimmutable\b/.test(b))
    expect(media.length).toBe(2)
    for (const b of media) expect(b).toMatch(/\badd_header\s+Cache-Control\s+"public, max-age=2592000, immutable"\s*;/)
  })
})

// The exercise media are licensed for openGym only: Cross-Origin-Resource-Policy keeps another
// site from embedding them, on every answer under /exercise-media/, at the site root and under a
// BASE_PATH alike. An add_header in a block replaces the inherited ones, so the nested block
// that sets the media's caching has to say it again.
describe('the exercise media', () => {
  const CORP = /\badd_header\s+Cross-Origin-Resource-Policy\s+"same-origin"\s+always\s*;/
  for (const base of ['', '/gym']) {
    it(`are same-origin only${base ? ' under ' + base : ''}, files and anything else in the folder`, () => {
      const conf = render(base)
      const at = conf.indexOf(`location ^~ ${base}/exercise-media/ {`)
      expect(at).toBeGreaterThan(-1)
      const blocks = blocksOf(conf.slice(at))
      const nested = blocks[0], outer = blocks[1]
      for (const b of [outer, nested]) {
        expect(b).toMatch(CORP)
        expect(b).toMatch(/\badd_header\s+X-Content-Type-Options\s+"nosniff"\s+always\s*;/)
        expect(b).toMatch(/\brewrite\s+\^\\Q/)
      }
      expect(nested).toMatch(/immutable/)
    })
  }
})

// The template as nginx gets it for a given BASE_PATH, comments left out. Its PCRE patterns are
// valid JavaScript too, apart from \Q…\E (PCRE's quotes for literal text), which `quoted` turns
// into the same text escaped. Otherwise they run here the way nginx runs them.
const render = base => NGINX.replace(/#.*$/gm, '').replace(/\$\{BASE_PATH\}/g, base).replace(/\$\{\w+\}/g, 'X')
const quoted = pattern => pattern.replace(/\\Q([\s\S]*?)(?:\\E|$)/g, (_, text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))

// A proxy that passes its prefix through (BASE_PATH=/gym) has both /api blocks matching
// /gym/api/..., but the API's routes are /api/... . The prefix used to be forwarded as-is, and
// every call under the prefix was answered 404. A map takes it off.
describe('what nginx forwards to the API', () => {
  const MAP = /\bmap\s+\$request_uri\s+\$(\w+)\s*\{\s*"~([^"]*)"\s+\$(\w+)\s*;\s*\}/
  // The target the API receives. No match: the map is empty and nginx sends the request's own.
  function forwarded(base, target) {
    const [, , pattern, group] = render(base).match(MAP)
    const m = new RegExp(quoted(pattern)).exec(target)
    return m ? m.groups[group] : target
  }

  it('both /api blocks send the mapped target, photo and video uploads included', () => {
    for (const base of ['', '/gym']) {
      const conf = render(base)
      for (const prefix of ['/api/', '/api/media/']) {
        const block = conf.match(new RegExp('location \\^~ ' + base + prefix + ' \\{([^}]*)\\}'))
        expect(block).toBeTruthy()
        expect(block[1]).toMatch(new RegExp('\\bproxy_pass\\s+\\$api_upstream\\$' + conf.match(MAP)[1] + ';'))
      }
    }
  })

  it('no block hands the API the target as it came in', () => {
    const passes = [...render('/gym').matchAll(/\bproxy_pass\s+([^;]+);/g)].map(m => m[1])
      .filter(to => to.startsWith('$api_upstream'))
    expect(passes.length).toBe(2)
    for (const to of passes) expect(to).toBe('$api_upstream$api_request_uri')
  })

  it('takes a passed-through prefix off, query and all', () => {
    expect(forwarded('/gym', '/gym/api/health')).toBe('/api/health')
    expect(forwarded('/gym', '/gym/api/login/options?x=1')).toBe('/api/login/options?x=1')
    expect(forwarded('/gym', '/gym//api/health')).toBe('//api/health')
    expect(forwarded('/gym', '/gym/api/media/missing')).toBe('/api/media/missing')
    expect(forwarded('/gym', '/gym/api/media/' + 'a'.repeat(64))).toBe('/api/media/' + 'a'.repeat(64))
    // Not the prefix as sent: forwarded untouched, and the API 404s it as before.
    expect(forwarded('/gym', '/%67ym/api/health')).toBe('/%67ym/api/health')
  })

  it('changes nothing at the site root', () => {
    for (const t of ['/api/health', '/api/health?x=1', '//api/health', '/api/%68ealth', '/api/../api/me'])
      expect(forwarded('', t)).toBe(t)
  })

  it('reads BASE_PATH as text, not as a pattern', () => {
    expect(forwarded('/g.ym', '/g.ym/api/health')).toBe('/api/health')
    // As a pattern, "." matched the X and /gXym was taken off as if it were the prefix.
    expect(forwarded('/g.ym', '/gXym/../g.ym/api/health')).toBe('/gXym/../g.ym/api/health')
    // As a pattern, "g+" never matched the "+" itself, and the prefix was left on.
    expect(forwarded('/g+ym', '/g+ym/api/health')).toBe('/api/health')
    expect(forwarded('/a/b', '/a/b/api/x?q=1')).toBe('/api/x?q=1')
    // A longer first segment is not the prefix.
    expect(forwarded('/gym', '/gymnasium/../gym/api/health')).toBe('/gymnasium/../gym/api/health')
  })
})

// Under BASE_PATH every static location takes the prefix off with a rewrite before it looks on
// disk. Read as a pattern, BASE_PATH=/g+ym never matched /g+ym itself: /g+ym/ was not found, went
// to @root, and @root sent it back to /g+ym/, forever; the assets and images 404'd.
describe('the file nginx looks for under BASE_PATH', () => {
  const REWRITE = /\brewrite\s+(\S+)\s+(\S+)\s+break\s*;/g
  // All five rewrites (the app's prefix block, the two cache blocks, and the exercise media's
  // block and its nested cache block) give the same answer.
  function onDisk(base, uri) {
    const got = [...render(base).matchAll(REWRITE)].map(([, pattern, to]) => {
      const m = new RegExp(quoted(pattern)).exec(uri)
      return m ? to.replace(/\$(\d)/g, (_, i) => m[i]) : uri
    })
    expect(got.length).toBe(5)
    expect(new Set(got).size).toBe(1)
    return got[0]
  }

  it('takes the prefix off, so the shell at the prefix is found rather than redirected to itself', () => {
    expect(onDisk('/g+ym', '/g+ym/')).toBe('/')
    expect(onDisk('/g+ym', '/g+ym/assets/index.js')).toBe('/assets/index.js')
    expect(onDisk('/g+ym', '/g+ym/icon-180.png')).toBe('/icon-180.png')
    expect(onDisk('/gym', '/gym/icon-180.png')).toBe('/icon-180.png')
    expect(onDisk('/a/b', '/a/b/index.html')).toBe('/index.html')
    expect(onDisk('/gym', '/gym/exercise-media/clip/0001.mp4')).toBe('/exercise-media/clip/0001.mp4')
  })

  it('reads BASE_PATH as text, not as a pattern', () => {
    expect(onDisk('/g.ym', '/g.ym/assets/index.js')).toBe('/assets/index.js')
    expect(onDisk('/g.ym', '/gXym/assets/index.js')).toBe('/gXym/assets/index.js')
    expect(onDisk('/gym', '/gymnasium/index.js')).toBe('/gymnasium/index.js')
  })

  it('changes nothing at the site root', () => {
    for (const uri of ['/', '/index.html', '/assets/index.js', '/icon-180.png', '//x.js'])
      expect(onDisk('', uri)).toBe(uri)
  })
})

// nginx's automatic /api -> /api/ redirect was absolute, built from its own scheme and port:
// http://host:8080/api/, unreachable behind an https proxy. Relative is set once for the whole
// server, so no location can leave it out.
describe('the redirects nginx sends', () => {
  it('carry a relative Location, for every location', () => {
    const [server] = blocksOf(NGINX).filter(b => /\blisten\b/.test(b))
    expect(server).toMatch(/\babsolute_redirect\s+off\s*;/)
    expect(NGINX.replace(/#.*$/gm, '')).not.toMatch(/\babsolute_redirect\s+on\b/)
  })
})

// A BASE_PATH of "/gym/" or "gym" renders location prefixes nginx never matches: the container
// came up and 404'd under the prefix, silently. The web image now refuses to start on one, from a
// script nginx's entrypoint runs before it renders the template. Run here with sh, as it is there.
describe('the web container refuses a BASE_PATH it cannot serve', () => {
  const WEB = join(dirname(fileURLToPath(import.meta.url)), '../../../web')
  const check = value => {
    const env = { PATH: process.env.PATH }
    if (value !== undefined) env.BASE_PATH = value
    return spawnSync('sh', [join(WEB, '05-check-base-path.sh')], { env, encoding: 'utf8' })
  }

  it.each([[undefined], [''], ['/gym'], ['/a/b'], ['/g+ym']])('starts with BASE_PATH=%s', value => {
    const r = check(value)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it.each([['/gym/', 'ends with "/"'], ['/', 'ends with "/"'], ['gym', 'does not start with "/"'], ['gym/', 'ends with "/"']])(
    'refuses BASE_PATH=%s, and says why', (value, why) => {
      const r = check(value)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(`BASE_PATH="${value}" ${why}`)
      expect(r.stderr).toContain('BASE_PATH=/gym')
    })

  it('is installed where the entrypoint runs it, and executable', () => {
    // Not executable, the entrypoint skips it with a log line and nginx starts anyway. Its 05
    // sorts before 20-envsubst-on-templates.sh, nginx's own step that renders the template.
    const dockerfile = readFileSync(join(WEB, 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/^COPY --chmod=755 web\/05-check-base-path\.sh \/docker-entrypoint\.d\/$/m)
  })

  it('runs nginx as uid 101 and still listens on port 80', () => {
    // nginx:alpine starts its master as root so it can create /var/cache/nginx, and a non-root
    // master there dies on mkdir. The unprivileged base is uid 101, but apk cannot upgrade as
    // that user, so the upgrade runs as root and 101 is the last USER — the entrypoint and the
    // master both stay there. The listen port stays 80: compose, the probes and the healthcheck
    // all address NGINX_PORT. The base image's EXPOSE 8080 is only metadata.
    const dockerfile = readFileSync(join(WEB, 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:22-alpine AS build$/m)
    expect(dockerfile).toMatch(/^FROM nginxinc\/nginx-unprivileged:alpine$/m)
    const users = [...dockerfile.matchAll(/^USER \S+$/gm)].map(m => m[0])
    expect(users.at(-1)).toBe('USER 101')
    const root = dockerfile.search(/^USER root$/m)
    const upgrade = dockerfile.search(/^RUN apk upgrade --no-cache/m)
    const finalUser = dockerfile.lastIndexOf('USER 101')
    expect(root).toBeGreaterThanOrEqual(0)
    expect(upgrade).toBeGreaterThan(root)
    expect(finalUser).toBeGreaterThan(upgrade)
    expect(dockerfile).toMatch(/^ENV NGINX_PORT=80$/m)
    expect(dockerfile).toMatch(/^COPY web\/nginx\.conf\.template \/etc\/nginx\/templates\/default\.conf\.template$/m)
  })
})
