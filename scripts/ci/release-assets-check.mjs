#!/usr/bin/env node
// Does the GitHub release carry everything the in-app updater on Android needs? v1.4.5 was
// published with its APKs and the combined SHA256SUMS but without the per-APK .sha256 files, and
// every sideloaded phone answered "Checksum not available, so not installing" for a day.
//
//   node scripts/ci/release-assets-check.mjs v1.4.6            the release with this tag
//   node scripts/ci/release-assets-check.mjs v1.4.6 --draft    also looks among the drafts
//
// Run it on the DRAFT before publishing (needs GH_TOKEN or GITHUB_TOKEN, drafts are private), and
// release-assets.yml runs it again the moment a release is published. It fails (exit 1) when:
//   - one of the three kinds the updater picks (Standard, Plus, HD) has no APK,
//   - an APK has no `<apk>.sha256` next to it, or that file is not "<64 hex>  <apk name>",
//   - SHA256SUMS is missing, lacks an APK, or disagrees with a .sha256 file,
//   - GitHub's own digest of an APK (when the API gives one) disagrees with its .sha256,
//   - a file the previous release had is gone (same name with the version swapped).
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REPO = process.env.GITHUB_REPOSITORY || 'DuarteSantos8/openGym'
const HEX = /^[0-9a-f]{64}$/
const kindOf = (name) => (/(^|[-_.])hd([-_.]|$)/i.test(name) ? 'hd' : /(^|[-_.])plus([-_.]|$)/i.test(name) ? 'plus' : 'standard')
// The kinds a phone can be on that update themselves (frontend/src/lib/update.js, pickApk). The
// other APKs (Offline, FDroid, Wear) are not picked by the updater's Standard rule.
const OTHER = /(^|[-_.])(offline|fdroid|wear)([-_.]|$)/i

/**
 * The problems of a release as a list of sentences; empty means fine. `texts` maps an asset name
 * to its content (the .sha256 files and SHA256SUMS). `previous` is the release before it, or null.
 */
export function problems(release, texts, previous = null) {
  const out = []
  const version = String(release.tag_name || '').replace(/^v/, '')
  const names = release.assets.map((a) => a.name)
  const apks = release.assets.filter((a) => /\.apk$/i.test(a.name))
  if (!apks.length) return ['the release has no APK at all']

  for (const kind of ['standard', 'plus', 'hd']) {
    if (!apks.some((a) => !OTHER.test(a.name) && kindOf(a.name) === kind)) out.push(`no ${kind} APK: phones on that kind cannot update`)
  }

  const sums = new Map()
  if (!names.includes('SHA256SUMS')) out.push('SHA256SUMS is missing')
  else for (const line of String(texts.SHA256SUMS || '').split('\n')) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$/)
    if (m) sums.set(m[2], m[1].toLowerCase())
  }

  for (const apk of apks) {
    const hashName = `${apk.name}.sha256`
    if (!names.includes(hashName)) { out.push(`${hashName} is missing: the updater refuses to install ${apk.name} without it`); continue }
    const [hex, file] = String(texts[hashName] || '').trim().split(/\s+/)
    if (!HEX.test((hex || '').toLowerCase())) { out.push(`${hashName} does not start with a SHA-256`); continue }
    if (file && file.replace(/^\*/, '') !== apk.name) out.push(`${hashName} names ${file}, not ${apk.name}`)
    if (names.includes('SHA256SUMS')) {
      if (!sums.has(apk.name)) out.push(`SHA256SUMS has no line for ${apk.name}`)
      else if (sums.get(apk.name) !== hex.toLowerCase()) out.push(`SHA256SUMS and ${hashName} disagree`)
    }
    const digest = /^sha256:([0-9a-f]{64})$/i.exec(apk.digest || '')?.[1]
    if (digest && digest.toLowerCase() !== hex.toLowerCase()) out.push(`${hashName} is not the hash of the uploaded ${apk.name} (GitHub says ${digest.slice(0, 12)}…)`)
    if (!(apk.size > 1_000_000)) out.push(`${apk.name} is only ${apk.size} bytes`)
    if (apk.state && apk.state !== 'uploaded') out.push(`${apk.name} is not fully uploaded (${apk.state})`)
  }

  if (previous) {
    const before = String(previous.tag_name || '').replace(/^v/, '')
    for (const a of previous.assets) {
      const expected = a.name.split(before).join(version)
      if (!names.includes(expected)) out.push(`${expected} is missing (${previous.tag_name} had ${a.name})`)
    }
  }
  return out
}

async function gh(path, accept = 'application/vnd.github+json') {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const res = await fetch(path.startsWith('http') ? path : `https://api.github.com/repos/${REPO}${path}`, {
    headers: { Accept: accept, 'User-Agent': 'release-assets-check', ...(token && { Authorization: `Bearer ${token}` }) },
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return accept.includes('json') ? res.json() : res.text()
}

async function main() {
  const tag = process.argv[2]
  if (!tag) { console.error('usage: release-assets-check.mjs <tag> [--draft]'); process.exit(2) }
  const all = await gh('/releases?per_page=30')
  const release = all.find((r) => r.tag_name === tag && (process.argv.includes('--draft') || !r.draft))
  if (!release) { console.error(`no release for ${tag} (drafts need --draft and a token)`); process.exit(1) }
  const previous = all.find((r) => !r.draft && !r.prerelease && r.tag_name !== tag && Date.parse(r.published_at) < Date.parse(release.published_at || Date.now())) || null

  const texts = {}
  for (const a of release.assets) {
    if (a.name === 'SHA256SUMS' || /\.sha256$/.test(a.name)) texts[a.name] = await gh(a.url, 'application/octet-stream')
  }
  const found = problems(release, texts, previous)
  const head = `${tag}${release.draft ? ' (draft)' : ''}: ${release.assets.length} files, compared with ${previous?.tag_name || 'nothing'}`
  const lines = found.length ? found.map((p) => `- ${p}`) : ['- every APK has its checksum, and nothing the last release had is missing']
  console.log([head, ...lines].join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release files\n${head}\n${lines.join('\n')}\n`)
  for (const p of found) console.log(`::error::${p}`)
  process.exit(found.length ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e.message); process.exit(1) })
