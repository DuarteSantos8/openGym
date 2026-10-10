#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const origin = 'https://opengym.ch'
const routes = [
  { file: 'website/index.html', url: '/', lang: 'en', translated: true },
  { file: 'website/docs.html', url: '/docs.html', lang: 'en', translated: true },
  { file: 'website/about.html', url: '/about.html', lang: 'en', translated: true },
  { file: 'website/api.html', url: '/api.html', lang: 'en', translated: false },
  { file: 'website/it/index.html', url: '/it/', lang: 'it', translated: true },
  { file: 'website/it/docs.html', url: '/it/docs.html', lang: 'it', translated: true },
  { file: 'website/it/about.html', url: '/it/about.html', lang: 'it', translated: true },
]
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const tag = (html, pattern, label, file) => {
  const match = html.match(pattern)
  assert.ok(match?.[1]?.trim(), `${file}: missing ${label}`)
  return match[1]
}
for (const route of routes) {
  assert.ok(fs.existsSync(path.join(root, route.file)), `missing route ${route.url}`)
  const html = read(route.file)
  assert.equal(tag(html, /<html\s+lang="([^"]+)"/, 'html lang', route.file), route.lang)
  tag(html, /<title>([^<]+)<\/title>/, 'title', route.file)
  tag(html, /<meta name="description" content="([^"]+)"/, 'description', route.file)
  tag(html, /<meta property="og:title" content="([^"]+)"/, 'og:title', route.file)
  tag(html, /<meta property="og:description" content="([^"]+)"/, 'og:description', route.file)
  tag(html, /<meta property="og:image" content="([^"]+)"/, 'og:image', route.file)
  assert.equal(tag(html, /<meta property="og:url" content="([^"]+)"/, 'og:url', route.file), origin + route.url)
  assert.equal(tag(html, /<link rel="canonical" href="([^"]+)"/, 'canonical', route.file), origin + route.url)
  tag(html, /<meta name="twitter:title" content="([^"]+)"/, 'twitter:title', route.file)
  tag(html, /<meta name="twitter:description" content="([^"]+)"/, 'twitter:description', route.file)
  tag(html, /<meta name="twitter:image" content="([^"]+)"/, 'twitter:image', route.file)
  if (route.translated) {
    const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\s*\/?\s*>/g)]
      .map(([, lang, href]) => [lang, href])
    for (const [lang, href] of [['en', origin + (route.lang === 'it' ? route.url.replace(/^\/it/, '') || '/' : route.url)], ['it', origin + (route.lang === 'it' ? route.url : `/it${route.url === '/' ? '/' : route.url}`)], ['x-default', origin + (route.lang === 'it' ? route.url.replace(/^\/it/, '') || '/' : route.url)]]) {
      assert.ok(alternates.some(item => item[0] === lang && item[1] === href), `${route.file}: missing ${lang} alternate ${href}`)
    }
  } else {
    assert.ok(!/hreflang="it"/.test(html), `${route.file}: API must not claim an Italian translation`)
  }
}
const italianDocs = read('website/it/docs.html')
assert.match(italianDocs, /Documentazione non ancora tradotta/)
assert.match(italianDocs, /API.*solo in inglese/)
assert.match(italianDocs, /href="\/docs\.html" lang="en"/)
const englishPages = ['website/index.html', 'website/docs.html', 'website/about.html', 'website/api.html']
for (const file of englishPages) assert.match(read(file), /href="(?:https:\/\/opengym\.ch)?\/it\//, `${file}: no Italian navigation path or fallback`)
for (const file of ['website/it/index.html', 'website/it/docs.html', 'website/it/about.html']) {
  const html = read(file)
  for (const href of ['/it/', '/it/docs.html', '/it/about.html', '/api.html']) {
    assert.ok(html.includes(`href=\"${href}`), `${file}: navigation missing ${href}`)
  }
}
const localeFallbacks = [
  ['website/it/index.html', '/'],
  ['website/it/docs.html', '/docs.html'],
  ['website/it/about.html', '/about.html'],
]
for (const [file, href] of localeFallbacks) {
  assert.match(read(file), new RegExp(`<a(?=[^>]*href=\"${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\")(?=[^>]*lang=\"en\")[^>]*>`), `${file}: missing English fallback ${href}`)
}
assert.match(read('website/it/docs.html'), /<a(?=[^>]*href=\"\/api\.html\")(?=[^>]*lang=\"en\")[^>]*>/)
const sitemap = read('website/sitemap.xml')
for (const route of routes) assert.ok(sitemap.includes(`<loc>${origin}${route.url}</loc>`), `sitemap missing ${route.url}`)
console.log(`Website i18n check passed for ${routes.length} public routes and locale metadata.`)
