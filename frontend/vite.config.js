import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { lazyAssets, stampSw } from './scripts/sw-stamp.mjs'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
// The API refuses a state-changing request that a browser sent from anywhere other than its own
// ORIGIN (the CSRF guard in api/server.js). The dev server is on a different port, so the page's
// real Origin is not ORIGIN — modern browsers get through on Sec-Fetch-Site: same-origin, and
// presenting the expected Origin here covers the ones that don't send it. Match your .env if you
// changed ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:8080'
// Exercise media: served straight from catalogue/media in dev (see catalogueMedia below), or
// proxied to a server of your choice with MEDIA_TARGET.
const media = process.env.MEDIA_TARGET
const catalogueMedia = {
  name: 'opengym-catalogue-media',
  configureServer(server) {
    if (media) return
    const dirs = { '/exercise-media/still/': ['still', '.webp'], '/exercise-media/clip/': ['clip', '.mp4'] }
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../catalogue/media')
    server.middlewares.use((req, res, next) => {
      const prefix = Object.keys(dirs).find(p => req.url.startsWith(p))
      if (!prefix) return next()
      const [dir, ext] = dirs[prefix]
      const name = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
      const file = join(root, dir, name)
      if (!/^\d{4,5}\.(webp|mp4)$/.test(name) || !name.endsWith(ext) || !existsSync(file)) { res.statusCode = 404; return res.end() }
      res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'image/webp')
      res.end(readFileSync(file))
    })
  }
}

// Optional web analytics (Umami). Injected only when BOTH vars are set at build time,
// so a plain `npm run build` — and every self-hosted install — stays telemetry-free.
// Set for the public instance: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'opengym-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

// The service worker's cache is named after the build (public/sw.js carries a `__BUILD__`
// placeholder): a deploy is then a new worker with its own cache, and the previous build's
// shell and chunks are dropped on activate instead of piling up under one fixed name. The
// stamp is a hash of the built index.html — it changes exactly when the bundle does.
// The directory is the one this build wrote to (`--outDir` included), not a fixed ./dist/: a
// build into a private outDir left `__BUILD__` unstamped in its sw.js.
// The worker also gets the build's code that loads on demand (`__LAZY__`, scripts/sw-stamp.mjs),
// so it is there offline before the page has ever needed it.
let outDir = fileURLToPath(new URL('./dist/', import.meta.url))
let lazy = []
const swStamp = {
  name: 'opengym-sw-stamp',
  apply: 'build',
  configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
  generateBundle(_, bundle) { lazy = lazyAssets(bundle) },
  closeBundle() {
    const html = join(outDir, 'index.html'), sw = join(outDir, 'sw.js')
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, stampSw(readFileSync(sw, 'utf8'), { stamp, lazy }))
  }
}

// The phone flavour says so in its index.html. A web build that ran into the same dist/ between
// the mobile build and `cap sync` (two builds in one worktree) shipped the web shell inside an
// APK: no Android-only settings, a service worker, the passkey login. scripts/check-mobile-bundle.mjs
// reads this tag in the synced copy after `cap sync` and fails the build without it.
const flavor = {
  name: 'opengym-flavor',
  transformIndexHtml() {
    if (process.env.VITE_MOBILE !== '1') return
    return [{ tag: 'meta', attrs: { name: 'opengym-flavor', content: 'mobile' }, injectTo: 'head' }]
  }
}

// The version people are asked for in #install-help and on every bug report. Read from
// package.json so it cannot drift from the release it was built in, and inlined at build
// time so no runtime fetch is involved.
//
// APP_BUILD, when the build sets it, is appended as "1.3.8+<build>". A packaged build carries a
// version its package.json cannot know — every image built between two releases reports the same
// number, so the one question a bug report turns on, "which build were you running?", had no
// answer from inside the app. Unset (the ordinary case, and every upstream build) it changes
// nothing: the string is exactly package.json's version.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appVersion = process.env.APP_BUILD ? `${pkgVersion}+${process.env.APP_BUILD}` : pkgVersion

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // A few tests import the whole app (Workout, the store) inside the test; with every core busy that outruns vitest's 5 s.
  test: { testTimeout: 20000 },
  plugins: [react(), umami, flavor, swStamp, catalogueMedia],
  base: './',
  server: {
    // The Coach's core (payload, validator, prompts, HTTP adapters) lives in ../api/coach/core
    // and the training engine in ../api/engine; the phone build imports both. vite build and
    // vitest already reach them; the dev server needs to be told the workspace is wider than
    // frontend/.
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      ...(media ? {
        '/exercise-media': { target: media, changeOrigin: true }
      } : {})
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
