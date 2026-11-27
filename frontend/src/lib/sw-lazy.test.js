/* The code the app splits off and loads on demand (the photo and video ingest, the QR reader, the
 * local Coach) was cached only once the page had needed it with a network. The first photo added
 * offline after an update had no ingest to run. The build now lists those chunks into sw.js and
 * the install fetches them, best effort, leaving the big language packs to load as they always did. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { lazyAssets, stampSw } from '../../scripts/sw-stamp.mjs'

const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const shell = '<html><head><script src="./assets/index-new.js"></script></head></html>'

function install(sw, fetchImpl) {
  const listeners = {}
  const caches = new Map()
  const open = async n => { if (!caches.has(n)) caches.set(n, new Map()); const m = caches.get(n); return { put: async (k, v) => { m.set(String(k), v) }, add: async () => {}, match: async k => m.get(String(k)), keys: async () => [...m.keys()] } }
  const context = {
    self: { addEventListener: (t, f) => { listeners[t] = f }, skipWaiting: () => {}, clients: { claim: async () => {} }, registration: {} },
    caches: { open, keys: async () => [...caches.keys()], delete: async n => caches.delete(n), match: async () => undefined },
    fetch: fetchImpl, location: { origin: 'https://gym.example' }, URL, setTimeout, clearTimeout, console, Response,
  }
  vm.runInNewContext(sw, context)
  let done
  listeners.install({ waitUntil: p => { done = p } })
  return done.then(() => [...caches.values()][0])
}

const ok = body => ({ ok: true, status: 200, redirected: false, text: async () => body })

describe('the worker keeps the on-demand code too', () => {
  it('fetches every listed chunk at install', async () => {
    const sw = stampSw(source, { stamp: 'abc', lazy: ['./assets/index-new.js', './assets/media-ingest-x.js', './assets/jsQR-y.js'] })
    const asked = []
    const cache = await install(sw, async u => { asked.push(String(u)); return String(u) === 'index.html' ? ok(shell) : ok('') })
    expect(asked.filter(u => u === './assets/index-new.js')).toHaveLength(1)
    expect([...cache.keys()]).toEqual(expect.arrayContaining(['./assets/media-ingest-x.js', './assets/jsQR-y.js', 'index.html']))
  })

  it('a chunk that will not come is no reason to fail the install', async () => {
    const sw = stampSw(source, { stamp: 'abc', lazy: ['./assets/media-ingest-x.js', './assets/gone.js'] })
    const cache = await install(sw, async u => {
      if (String(u) === 'index.html') return ok(shell)
      if (String(u).includes('gone')) throw new TypeError('network down')
      if (String(u).includes('media-ingest')) return { ok: true, status: 200, redirected: true }
      return ok('')
    })
    expect([...cache.keys()]).toContain('index.html')
    expect([...cache.keys()]).not.toContain('./assets/media-ingest-x.js')   // a login page is not the ingest
  })

  it('an unstamped worker (dev, tests) has nothing extra to fetch', async () => {
    const asked = []
    await install(source, async u => { asked.push(String(u)); return String(u) === 'index.html' ? ok(shell) : ok('') })
    expect(asked).toEqual(['index.html', './assets/index-new.js'])
  })

  it('the build lists code and styles, not the language packs (but the English steps)', () => {
    const chunk = (...moduleIds) => ({ type: 'chunk', moduleIds })
    const bundle = {
      'assets/index-a.js': chunk('/app/frontend/src/main.jsx'),
      'assets/media-ingest-b.js': chunk('/app/frontend/src/lib/media-ingest.js'),
      'assets/de-c.js': chunk('/app/frontend/src/locales/de.js'),
      'assets/de-d.js': chunk('/app/frontend/src/instr/de.js'),
      'assets/ru-e.js': chunk('/app/frontend/src/exercise-names/ru.js'),
      'assets/index-f.css': { type: 'asset' },
      'icon-512.png': { type: 'asset' },
      // the English steps and descriptions every language falls back to: offline as well
      'assets/en-g.js': chunk('/app/frontend/src/instr/en.js'),
      'assets/en-h.js': chunk('/app/frontend/src/exercise-desc/en.js'),
      'assets/de-i.js': chunk('/app/frontend/src/exercise-desc/de.js'),
    }
    expect(lazyAssets(bundle)).toEqual(['./assets/de-i.js', './assets/en-g.js', './assets/en-h.js', './assets/index-a.js', './assets/index-f.css', './assets/media-ingest-b.js'])
  })

  it('the build stamps the worker with both', () => {
    const vite = readFileSync(fileURLToPath(new URL('../../vite.config.js', import.meta.url)), 'utf8')
    expect(vite).toMatch(/generateBundle\(_, bundle\) \{ lazy = lazyAssets\(bundle\) \}/)
    expect(vite).toMatch(/stampSw\(readFileSync\(sw, 'utf8'\), \{ stamp, lazy \}\)/)
    const sw = stampSw(source, { stamp: 'abc', lazy: ["./assets/it's.js"] })
    expect(sw).toContain("const CACHE = 'opengym-rt-abc'")
    expect(sw).not.toContain('__LAZY__')
  })
})

// The Extension Lab's heavy optional libraries (ECharts, sports-lib: about 1.2 MB between them) are
// not fetched at every install: most people never open the chart or the activity preview. They
// load on first use and the worker's cache-first fetch keeps them from then on. A chunk that mixes
// in any app code stays in the list, so the Lab page and the food diary still work offline.
describe('the optional Extension Lab libraries stay out of the install', () => {
  const chunk = moduleIds => ({ type: 'chunk', moduleIds })
  const nm = p => '/repo/frontend/node_modules/' + p
  it('drops a chunk of only ECharts (and the chart that wraps it) or only sports-lib', () => {
    const list = lazyAssets({
      'assets/AddonTrendChart-a1b2c3d4.js': chunk([nm('echarts/core.js'), nm('zrender/lib/zrender.js'), '/repo/frontend/src/components/AddonTrendChart.jsx']),
      'assets/esm-e5f6a7b8.js': chunk([nm('@sports-alliance/sports-lib/lib/esm/index.js'), nm('fit-file-parser/dist/fit.js')]),
      'assets/Addons-c9d0e1f2.js': chunk([nm('motion/dist/es/index.mjs'), '/repo/frontend/src/views/Addons.jsx', '/repo/frontend/src/components/FoodDiary.jsx']),
      'assets/media-ingest-12345678.js': chunk(['/repo/frontend/src/lib/media-ingest.js']),
      'assets/Addons-c9d0e1f2.css': { type: 'asset' },
    })
    expect(list).toEqual(['./assets/Addons-c9d0e1f2.css', './assets/Addons-c9d0e1f2.js', './assets/media-ingest-12345678.js'])
  })
  it('keeps any chunk where app code shares the bundle with them', () => {
    const list = lazyAssets({ 'assets/mixed-11111111.js': chunk([nm('echarts/core.js'), '/repo/frontend/src/views/Stats.jsx']) })
    expect(list).toEqual(['./assets/mixed-11111111.js'])
  })
})
