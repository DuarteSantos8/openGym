#!/usr/bin/env node
// Writes the AltStore source for the iPhone app: the JSON file AltStore (and SideStore) read when
// a user adds openGym as a source, and then check for updates. One app, its versions newest
// first, each with where its .ipa is, how big it is and its SHA-256, plus what it asks for — the
// entitlements and the privacy texts from Info.plist — which AltStore shows before installing.
// See docs/MOBILE.md ("iPhone — AltStore").
//
//   node scripts/altstore-source.mjs --ipa openGym-1.4.0.ipa --version 1.4.0 --build 140 \
//     --url 'https://example.org/opengym-ios/%v/%f' --out altstore.json [--previous altstore.json]
//
// In --url, %v is the version and %f the .ipa's file name. Without --url it is the GitLab package
// registry of the upstream project, where build:ios uploads every tagged build. --previous keeps
// the versions an earlier source listed (at most KEEP), so AltStore can still offer them.
// No dependencies: node's own crypto and fs.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BUNDLE_ID = 'ch.duartesantos.opengym'
export const MIN_OS = '15.5'
export const KEEP = 10
export const DEFAULT_URL = 'https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-ios/%v/%f'

/** The privacy texts an Info.plist carries (NS…UsageDescription), as AltStore lists them. */
export function privacyOf(plistXml) {
  const out = {}
  const re = /<key>(NS\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g
  let m
  while ((m = re.exec(String(plistXml)))) out[m[1]] = unescapeXml(m[2])
  return out
}

/** The entitlements an .entitlements file switches on (the keys set to <true/>). */
export function entitlementsOf(plistXml) {
  const out = []
  const re = /<key>([^<]+)<\/key>\s*<true\s*\/>/g
  let m
  while ((m = re.exec(String(plistXml)))) out.push(m[1])
  return out
}

const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** `template` with %v the version and %f the file name. */
export const fillUrl = (template, version, file) => template.split('%v').join(version).split('%f').join(encodeURIComponent(file))

/**
 * The source. `version` is { version, buildVersion, date, downloadURL, size, sha256 }; a version
 * `previous` already lists under the same number is replaced, the rest kept behind it, newest
 * first, at most KEEP.
 */
export function altstoreSource({ version, privacy = {}, entitlements = [], previous = null, notes = '' }) {
  if (!version?.version || !version.downloadURL) throw new Error('version and downloadURL are required')
  const entry = {
    version: String(version.version),
    buildVersion: String(version.buildVersion || version.version),
    date: version.date,
    localizedDescription: notes || `openGym ${version.version}`,
    downloadURL: version.downloadURL,
    size: Number(version.size) || 0,
    ...(version.sha256 ? { sha256: version.sha256 } : {}),
    minOSVersion: MIN_OS,
  }
  const before = (previous?.apps || []).find(a => a?.bundleIdentifier === BUNDLE_ID)?.versions || []
  const versions = [entry, ...before.filter(v => v?.version !== entry.version)].slice(0, KEEP)
  return {
    name: 'openGym',
    identifier: 'ch.opengym.altstore',
    subtitle: 'Self-hosted gym & body-weight tracker',
    website: 'https://opengym.ch',
    iconURL: 'https://opengym.ch/icon-512.png',
    tintColor: '#30d158',
    apps: [{
      name: 'openGym',
      bundleIdentifier: BUNDLE_ID,
      developerName: 'openGym',
      subtitle: 'Gym & body-weight tracker',
      localizedDescription: 'Log workouts, follow a progression plan and track your body weight — on the phone only, or synced with your own openGym server. Writes workouts to Apple Health where the signing Apple ID allows it, and comes with an Apple Watch app for the next set and the rest.',
      iconURL: 'https://opengym.ch/icon-512.png',
      tintColor: '#30d158',
      category: 'lifestyle',
      versions,
      appPermissions: { entitlements, privacy },
    }],
    news: [],
  }
}

function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
  }
  return out
}

function main() {
  const a = args(process.argv.slice(2))
  const here = dirname(fileURLToPath(import.meta.url))
  const ios = join(here, '..', 'ios', 'App', 'App')
  if (!a.ipa || !a.version || !a.out) {
    console.error('usage: altstore-source.mjs --ipa FILE --version X.Y.Z [--build N] [--url TEMPLATE] [--notes TEXT] [--previous FILE] --out FILE')
    process.exit(2)
  }
  const ipa = readFileSync(a.ipa)
  const previous = a.previous && existsSync(a.previous) ? JSON.parse(readFileSync(a.previous, 'utf8')) : null
  const source = altstoreSource({
    version: {
      version: a.version,
      buildVersion: a.build,
      date: a.date || new Date().toISOString().slice(0, 10),
      downloadURL: fillUrl(a.url || DEFAULT_URL, a.version, basename(a.ipa)),
      size: statSync(a.ipa).size,
      sha256: createHash('sha256').update(ipa).digest('hex'),
    },
    privacy: privacyOf(readFileSync(a['info-plist'] || join(ios, 'Info.plist'), 'utf8')),
    entitlements: a['no-entitlements'] ? [] : entitlementsOf(readFileSync(a.entitlements || join(ios, 'App.healthkit.entitlements'), 'utf8')),
    previous,
    notes: typeof a.notes === 'string' ? a.notes : '',
  })
  writeFileSync(a.out, JSON.stringify(source, null, 2) + '\n')
  console.log(`${a.out}: openGym ${a.version}, ${source.apps[0].versions.length} version(s), ${source.apps[0].versions[0].downloadURL}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
