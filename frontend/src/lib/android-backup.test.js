// Android's cloud backup (Auto Backup) skips an app's whole backup once it passes 25 MB. The
// local copies of the photos and videos of custom exercises (lib/media-store-fs.js, the files
// directory's opengym-media/) would take the state mirror down with them, so both rule files
// leave that folder out of the cloud backup — and the manifest has to point at them, or neither
// applies. A device-to-device transfer keeps it. The pairing (opengym-remote.json, the session
// token for the server) stays out of both: a backup is no place for a credential.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL('../../android/app/src/main/' + p, import.meta.url), 'utf8')
const manifest = read('AndroidManifest.xml')
const legacy = read('res/xml/backup_rules.xml')
const modern = read('res/xml/data_extraction_rules.xml')
const EXCLUDE = /<exclude\s+domain="file"\s+path="opengym-media\/"\s*\/>/
const TOKEN = /<exclude\s+domain="file"\s+path="opengym-remote\.json"\s*\/>/

describe('Android backup rules', () => {
  it('the manifest names both rule files', () => {
    expect(manifest).toMatch(/android:fullBackupContent="@xml\/backup_rules"/)
    expect(manifest).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/)
    expect(manifest).toMatch(/android:allowBackup="true"/)
  })

  it('both leave the media folder out of the cloud backup', () => {
    expect(legacy).toMatch(/<full-backup-content>[\s\S]*<\/full-backup-content>/)
    expect(legacy).toMatch(EXCLUDE)
    const cloud = modern.match(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/)?.[1] || ''
    expect(cloud).toMatch(EXCLUDE)
    // An <include> would turn either list into an allowlist and drop everything else.
    expect(legacy).not.toMatch(/<include/)
    expect(modern).not.toMatch(/<include/)
    // Device transfer takes everything but the pairing and the gym reminder's places.
    const transfer = modern.match(/<device-transfer>([\s\S]*?)<\/device-transfer>/)?.[1] || ''
    expect(transfer).not.toMatch(EXCLUDE)
    expect(transfer.match(/<exclude/g)).toHaveLength(2)
  })

  it('the gym reminder\'s places (#614) never leave the phone: out of every backup and transfer', () => {
    const GYMS = /<exclude\s+domain="sharedpref"\s+path="opengym_gym_reminder\.xml"\s*\/>/
    expect(legacy).toMatch(GYMS)
    expect(modern.match(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/)?.[1]).toMatch(GYMS)
    expect(modern.match(/<device-transfer>([\s\S]*?)<\/device-transfer>/)?.[1]).toMatch(GYMS)
    // the file name the native side writes
    const java = readFileSync(new URL('../../android/app/src/main/java/ch/duartesantos/opengym/GymReminder.java', import.meta.url), 'utf8')
    expect(java).toMatch(/PREFS = "opengym_gym_reminder"/)
  })

  it('the pairing token is left out of every backup and transfer', () => {
    expect(legacy).toMatch(TOKEN)
    expect(modern.match(/<cloud-backup>([\s\S]*?)<\/cloud-backup>/)?.[1]).toMatch(TOKEN)
    expect(modern.match(/<device-transfer>([\s\S]*?)<\/device-transfer>/)?.[1]).toMatch(TOKEN)
  })

  it('no comment carries a double dash, which breaks the Android build (v1.3.6)', () => {
    for (const xml of [legacy, modern, manifest]) {
      for (const c of xml.match(/<!--([\s\S]*?)-->/g) || []) expect(c.slice(4, -3)).not.toContain('--')
    }
  })
})

// The backup-folder plugin deletes and writes only the app's own dated copies (#161): the native
// rule has to be the same one lib/mobile.js names them by, or a prune would miss its own files.
describe('BackupFolderPlugin', () => {
  const src = readFileSync(new URL('../../android/app/src/main/java/ch/duartesantos/opengym/BackupFolderPlugin.java', import.meta.url), 'utf8')
  it('names the same backup files as lib/mobile.js, and checks the folder grant before writing or pruning', () => {
    const java = /BACKUP_NAME = Pattern\.compile\("(.+)"\);/.exec(src)[1].replace(/\\\\/g, '\\')
    const js = /const AUTO_BACKUP_NAME = \/(.+)\//.exec(readFileSync(new URL('./mobile.js', import.meta.url), 'utf8'))[1]
    expect('^' + java + '$').toBe(js)
    for (const m of ['write', 'prune']) {
      const body = src.slice(src.indexOf(`public void ${m}(`), src.indexOf('io.execute', src.indexOf(`public void ${m}(`)))
      expect(body, m).toContain('held(tree)')
    }
    expect(src).not.toMatch(/Pattern\.compile\(pattern\)/)
  })
})
