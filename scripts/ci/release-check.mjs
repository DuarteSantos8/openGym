#!/usr/bin/env node
// Does everything that carries a version say the same one? A release whose tag says 1.4.2 while
// the api reports 1.4.1, or whose APK still calls itself 1.4.1, tells the in-app update check
// the wrong thing and leaves self-hosters on a "new" version forever.
//
//   node scripts/ci/release-check.mjs v1.4.2   strict: errors fail (exit 1)
//   node scripts/ci/release-check.mjs          report only: prints the table
//
// Errors (with a tag): frontend + api package.json, the CHANGELOG section. Warnings: Android
// versionName and the iOS marketing version, which the store builds may legitimately bump on
// their own schedule (they are built and signed on the release machine).
import { appendFileSync, readFileSync } from 'node:fs'

const tag = process.argv[2]
const want = tag ? tag.replace(/^v/, '') : null
const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const found = {
  'frontend/package.json': JSON.parse(read('frontend/package.json') || '{}').version,
  'api/package.json': JSON.parse(read('api/package.json') || '{}').version,
  'Android versionName': /versionName\s+"([^"]+)"/.exec(read('frontend/android/app/build.gradle'))?.[1],
  'Android versionCode': /versionCode\s+(\d+)/.exec(read('frontend/android/app/build.gradle'))?.[1],
  'iOS MARKETING_VERSION': [...new Set([...read('frontend/ios/App/App.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]))].join(', '),
  'iOS build number': [...new Set([...read('frontend/ios/App/App.xcodeproj/project.pbxproj').matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1]))].join(', '),
}
const changelog = read('CHANGELOG.md')
const section = want ? new RegExp(`^## v${want.replace(/\./g, '\\.')}([^0-9.]|$)`, 'm').test(changelog) : null

const errors = [], warnings = []
if (want) {
  for (const k of ['frontend/package.json', 'api/package.json']) if (found[k] !== want) errors.push(`${k} says ${found[k]}, the tag says ${want}`)
  if (!section) errors.push(`CHANGELOG.md has no "## v${want}" section (the release notes come from there)`)
  if (found['Android versionName'] !== want) warnings.push(`Android versionName is ${found['Android versionName']}`)
  if (found['iOS MARKETING_VERSION'] !== want) warnings.push(`iOS MARKETING_VERSION is ${found['iOS MARKETING_VERSION']}`)
}
const md = [`### Versions${tag ? ` for ${tag}` : ''}`, '', '| Where | Version |', '|---|---|',
  ...Object.entries(found).map(([k, v]) => `| ${k} | ${v ?? '–'} |`),
  ...(want ? [`| CHANGELOG "## ${tag}" | ${section ? 'present' : 'MISSING'} |`] : []),
  '', ...errors.map((e) => `- ❌ ${e}`), ...warnings.map((w) => `- ⚠️ ${w}`), ''].join('\n')
console.log(md)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
for (const w of warnings) console.log(`::warning::${w}`)
for (const e of errors) console.log(`::error::${e}`)
process.exit(errors.length ? 1 : 0)
