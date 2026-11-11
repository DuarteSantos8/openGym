// The Garmin wire contract, checked across the three languages that share it (docs/GARMIN.md):
// the watch (Monkey C, frontend/garmin/source), the phone's bridges (Java and Swift) and the page
// (lib/watch-sync.js, lib/garmin-snapshot.js). Nobody can run all of them together without a real
// Garmin, so this reads the sources: a field renamed, a type the phone does not know, an app id
// that is not the manifest's or a URL scheme missing from Info.plist fails here, not on a wrist.
// It also keeps garmin/test/watch-model.mjs (the watch as JavaScript, for the end-to-end tests in
// garmin-link.e2e.test.js) honest against the Monkey C it is a port of.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EV_KEYS, BATCH, MAX, HARD, RETRY_UNSENT_MS, RETRY_UNACKED_MS, GIVE_UP_MS, HELLO_EVERY_MS, emptyState } from '../../garmin/test/watch-model.mjs'
import { garminSnapshot, GARMIN_MAX_BYTES, GARMIN_ACKED_MAX } from './garmin-snapshot.js'
import { GARMIN_STORE_ID } from './garmin-view.js'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p) => readFileSync(join(frontend, ...p), 'utf8')
// Monkey C without its comments (a key named in a comment is not read by the watch)
const mc = f => read('garmin', 'source', f).replace(/\/\/.*$/gm, '')
const core = mc('Core.mc')
const app = mc('App.mc')
const watchSources = ['Core.mc', 'App.mc', 'Actions.mc', 'Views.mc', 'Ui.mc', 'Nav.mc'].map(mc).join('\n')
const java = read('android', 'app', 'src', 'ciq', 'java', 'ch', 'duartesantos', 'opengym', 'GarminLink.java')
const javaMessages = read('android', 'app', 'src', 'main', 'java', 'ch', 'duartesantos', 'opengym', 'GarminMessages.java')
const swift = read('ios', 'App', 'App', 'GarminLink.swift')
const watchSync = read('src', 'lib', 'watch-sync.js')
const snapshotJs = read('src', 'lib', 'garmin-snapshot.js')
const manifest = read('garmin', 'manifest.xml')
// (a plain yes or no, so a failure names the line here instead of printing a whole source file)
const has = (text, re) => re.test(text)

describe('the watch model is the Monkey C', () => {
  it('packs events in the same order', () => {
    const m = core.match(/const EV_KEYS = \[([^\]]+)\]/)
    expect(m[1].split(',').map(s => s.trim().replace(/"/g, ''))).toEqual(EV_KEYS)
    // hr is the one packed as [avg, max]: unpack knows it by its place
    expect(EV_KEYS[11]).toBe('hr')
    expect(has(core, /if \(i == 11\) \{ v = \{ "avg" => v\[0\], "max" => v\[1\] \}; \}/)).toBe(true)
  })

  it('has the same state', () => {
    const m = core.match(/function emptyState\(\) \{\s*return \{([\s\S]*?)\};/)
    const keys = [...m[1].matchAll(/"(\w+)" =>/g)].map(x => x[1])
    expect(keys.sort()).toEqual(Object.keys(emptyState()).sort())
  })

  it('sends, retries and gives up on the same clock', () => {
    expect(has(app, new RegExp(`const MAX = ${MAX};`))).toBe(true)
    expect(has(app, new RegExp(`const HARD = ${HARD};`))).toBe(true)
    expect(has(app, new RegExp(`ob\\.size\\(\\) - from > ${BATCH} \\? ${BATCH} :`))).toBe(true)
    expect(has(app, new RegExp(`Core\\.unsent\\(G\\.state\\) > 0 && since > ${RETRY_UNSENT_MS}`))).toBe(true)
    expect(has(app, new RegExp(`Core\\.unsent\\(G\\.state\\) == 0 && since > ${RETRY_UNACKED_MS}`))).toBe(true)
    expect(has(app, new RegExp(`busy && now - began > ${GIVE_UP_MS}`))).toBe(true)
    expect(has(app, new RegExp(`ask && now - began > ${HELLO_EVERY_MS}`))).toBe(true)
    expect(has(app, /Core\.room\(G\.state, MAX, HARD\)/)).toBe(true)
  })
})

describe('watch → phone: the events', () => {
  // every dictionary literal with a "type" in the watch's sources is an event
  const literals = [...watchSources.matchAll(/\{[^{}]*"type" => [^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)].map(m => m[0])
  const typeOf = l => (l.match(/"type" => (?:discard \? )?"(\w+)"/) || [])[1]

  it('the watch makes the events the docs list, with fields the outbox can carry', () => {
    const types = new Set(literals.map(typeOf))
    expect([...types].sort()).toEqual(['discard', 'hello', 'setDone', 'start', 'stillHere'])
    // (finish and discard share one literal: discard ? "discard" : "finish")
    expect(has(core, /"type" => discard \? "discard" : "finish"/)).toBe(true)
    for (const l of literals) {
      for (const [, k] of l.matchAll(/"(\w+)" =>/g)) expect(EV_KEYS, `${k} in ${l.slice(0, 60)}`).toContain(k)
    }
    // the optional fields of a set are added one by one
    for (const k of ['w', 'r', 'sec', 'side', 'hr']) expect(has(core, new RegExp(`ev\\["${k}"\\] = `))).toBe(true)
    // the effort goes under its kind's name: "rir" or "rpe", as the page reads it (effortFrom)
    expect(has(core, /ev\[eff\[0\]\] = eff\[1\]/)).toBe(true)
    expect(has(mc('Actions.mc'), /\[kind, v\]/)).toBe(true)
    expect(has(core, /same\(kind, "rpe"\)/)).toBe(true)
  })

  it('every field has a reader on the page, every type a branch', () => {
    // (the effort is read by its kind's name: effortFrom loops over 'rpe' and 'rir')
    const unread = EV_KEYS.filter(k => !new RegExp(`ev\\.${k}\\b`).test(watchSync) && !(['rir', 'rpe'].includes(k) && /for \(const k of \['rpe', 'rir'\]\)/.test(watchSync)))
    expect(unread).toEqual([])
    expect(['start', 'setDone', 'finish', 'discard', 'stillHere'].filter(t => !watchSync.includes(`ev.type === '${t}'`))).toEqual([])
    // hello never reaches the page: both bridges answer it themselves with the last snapshot
    expect(watchSync.includes("'hello'")).toBe(false)
    expect(has(javaMessages, /"hello"\.equals\(new JSONObject\(eventJson\)\.optString\("type"\)\)/)).toBe(true)
    expect(has(swift, /\(ev\["type"\] as\? String\) == "hello"/)).toBe(true)
  })

  it('goes out as { events: [...] } and both bridges read exactly that', () => {
    expect(app.match(/Communications\.transmit\(\{ "events" => /g)).toHaveLength(2)
    expect(has(javaMessages, /\.get\("events"\)/)).toBe(true)
    expect(has(swift, /dict\["events"\] as\? \[Any\]/)).toBe(true)
    // times are whole milliseconds as a Long (a Float would lose the seconds)
    expect(has(core, /Time\.now\(\)\.value\(\)\.toLong\(\) \* 1000l/)).toBe(true)
    expect(has(javaMessages, /optLong\("at", 0\)/)).toBe(true)
  })
})

describe('phone → watch: the snapshot', () => {
  const stateKeys = [...Object.keys(emptyState()), 'eo', 'of']
  // what the watch makes itself: its summary, its events, a heart rate pair, a side
  const own = ['dur', 'vol', 'ended', 'avg', 'max', 'type', 'side', 'L', 'R', 'routineIds']
  const read1 = [...new Set([...watchSources.matchAll(/\["(\w+)"\]/g)].map(m => m[1]))].filter(k => !stateKeys.includes(k) && !own.includes(k))

  it('every key the watch reads is one the page sends', () => {
    const fixture = JSON.parse(read('garmin', 'test', 'snapshot.json'))
    const sent = new Set()
    const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { sent.add(k); walk(x) } }
    walk(fixture)
    const missing = read1.filter(k => !sent.has(k) && !new RegExp(`\\b${k}\\b`).test(watchSync + snapshotJs))
    expect(missing).toEqual([])
    // and the ones this watch alone gets are made by garminSnapshot
    const g = garminSnapshot({ unit: 'kg', restSec: 90, acked: ['a'], discarded: ['w0'], settings: { accent: '#A3E635', onAccent: '#000000', crown: 'weight', effort: 'rir', autoHolds: true, forgotten: { askMin: 20 } }, active: { id: 'w', cur: 0, entries: [{ id: 'e', mode: 'reps', sets: [{ w: 1, r: 1, done: true }] }] }, ready: { today: { name: 'A', routineIds: ['r'], entries: [] }, others: [] } })
    expect(Object.keys(g.settings).sort()).toEqual(['accent', 'askMin', 'autoHolds', 'crown', 'effort', 'lang', 'onAccent', 'restHaptics', 'show'])
    expect(g.active).toMatchObject({ count: 1, progress: [1, 1], volume: 1 })
    expect(g.active.entries[0].i).toBe(0)
    expect(g).toMatchObject({ acked: ['a'], discarded: ['w0'] })
    for (const k of ['acked', 'discarded', 'ready', 'today', 'others', 'active', 'settings', 'streak', 'count', 'progress', 'volume', 'i']) expect(read1).toContain(k)
  })

  it('arrives as a dictionary: both bridges turn the JSON into maps and lists, nulls left out', () => {
    expect(has(javaMessages, /if \(v != null\) out\.put\(k, v\)/)).toBe(true)
    expect(has(swift, /if v is NSNull \{ return nil \}/)).toBe(true)
    // the watch reads a missing key as null everywhere: no key is required by hasKey
    expect(watchSources.match(/snap\.hasKey|nx\.hasKey|row\.hasKey/g)).toBe(null)
    // a yes may arrive as the number 1 (NSNumber on the iPhone): the watch takes both
    expect(has(core, /function isTrue\(v\) \{\s*if \(v instanceof Lang\.Boolean\) \{ return v; \}\s*return \(v instanceof Lang\.Number/)).toBe(true)
    // (the one plain comparison left is the watch's own setting, never the phone's)
    expect(watchSources.match(/(==|!=) (true|false)\b/g)).toEqual(['== true'])
    expect(has(app, /getValue\("recordGc"\);\s*return v == null \|\| v == true;/)).toBe(true)
  })

  it('stays under what a watch and Garmin Connect take', () => {
    // 4 KB of JSON from the page; the Android SDK refuses a message over 16384 bytes serialized
    expect(GARMIN_MAX_BYTES).toBeLessThanOrEqual(4096)
    expect(GARMIN_ACKED_MAX).toBeGreaterThanOrEqual(BATCH * 2)
  })
})

describe('the ids both ends find each other by', () => {
  const appId = manifest.match(/<iq:application id="([0-9a-f]{32})"/)[1]

  it('the watch app id is the same in the manifest, the Android bridge and the iPhone bridge', () => {
    expect(has(java, new RegExp(`APP_ID = "${appId}"`))).toBe(true)
    const dashed = swift.match(/appId = UUID\(uuidString: "([0-9a-fA-F-]{36})"\)/)[1]
    expect(dashed.replace(/-/g, '').toLowerCase()).toBe(appId)
  })

  it('the store id is the same wherever "Get openGym for Garmin" goes', () => {
    expect(GARMIN_STORE_ID).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    expect(has(java, new RegExp(`STORE_ID = "${GARMIN_STORE_ID}"`))).toBe(true)
    expect(has(swift, new RegExp(`storeId: UUID\\? = UUID\\(uuidString: "${GARMIN_STORE_ID}"\\)`))).toBe(true)
    expect(read('..', 'docs', 'GARMIN.md')).toContain(GARMIN_STORE_ID)
  })

  it('the watch app asks for what it uses', () => {
    for (const p of ['Communications', 'Fit', 'Sensor']) expect(manifest).toContain(`<iq:uses-permission id="${p}"/>`)
    expect(has(manifest, /type="watch-app"/)).toBe(true)
  })
})

describe('the iPhone app is set up for Garmin Connect', () => {
  const plist = read('ios', 'App', 'App', 'Info.plist')
  const scheme = swift.match(/static let urlScheme = "([a-z-]+)"/)[1]

  it('Garmin Connect can come back with the picked watches', () => {
    expect(has(plist, new RegExp(`<key>CFBundleURLSchemes</key>\\s*<array>\\s*<string>${scheme}</string>`))).toBe(true)
    expect(has(swift, /initialize\(withUrlScheme: GarminLink\.urlScheme, uiOverrideDelegate: self/)).toBe(true)
    for (const f of ['SceneDelegate.swift', 'AppDelegate.swift']) expect(read('ios', 'App', 'App', f), f).toMatch(/GarminLink\.shared\.(handle|start)\(/)
    expect(read('ios', 'App', 'App', 'SceneDelegate.swift').match(/GarminLink\.shared\.handle\(url\)/g)).toHaveLength(2)
  })

  it('may ask whether Garmin Connect is installed, and use Bluetooth, also in the pocket', () => {
    expect(has(plist, /<key>LSApplicationQueriesSchemes<\/key>\s*<array>\s*<string>gcm-ciq<\/string>/)).toBe(true)
    expect(plist).toContain('<key>NSBluetoothAlwaysUsageDescription</key>')
    expect(has(plist, /<key>UIBackgroundModes<\/key>[\s\S]*?<string>bluetooth-central<\/string>/)).toBe(true)
  })

  it('keeps the picked watches across launches, registers them at launch, and waits until a watch is ready', () => {
    expect(has(swift, /func start\(\) \{[\s\S]*?let saved = loadDevices\(\)[\s\S]*?startSDK\(\)\s*use\(saved\)/)).toBe(true)
    expect(has(swift, /saveDevices\(picked\)\s*use\(picked\)/)).toBe(true)
    expect(has(swift, /ciq\.register\(forDeviceEvents: d, delegate: self\)\s*ciq\.register\(forAppMessages: app\(for: d\), delegate: self\)/)).toBe(true)
    // "connected" is not "ready to talk to" (Garmin's header): asked and sent again once it is
    expect(has(swift, /func deviceCharacteristicsDiscovered\(_ device: IQDevice\)/)).toBe(true)
    // no answer about the app is not "not installed"
    expect(has(swift, /guard let self, let st else \{ return \}/)).toBe(true)
  })
})

describe('the Android app is set up for Garmin Connect', () => {
  const gradle = read('android', 'app', 'build.gradle')

  it('the SDK is in the APK and Play builds only, and the F-Droid build says it has none', () => {
    expect(has(gradle, /sideloadImplementation "com\.garmin\.connectiq:ciq-companion-app-sdk:/)).toBe(true)
    expect(has(gradle, /playImplementation "com\.garmin\.connectiq:ciq-companion-app-sdk:/)).toBe(true)
    expect(has(gradle, /fdroidImplementation "com\.garmin/)).toBe(false)
    expect(has(gradle, /^\s*implementation "com\.garmin/m)).toBe(false)
    const fdroid = read('android', 'app', 'src', 'fdroid', 'java', 'ch', 'duartesantos', 'opengym', 'WatchBridgePlugin.java')
    expect(has(fdroid, /out\.put\("state", "build"\)/)).toBe(true)
    expect(has(fdroid, /import com\.garmin/)).toBe(false)
  })

  it('nothing of the SDK is used before it is ready, and everything is registered again when it comes back', () => {
    // every call into the SDK sits behind the "ready" state or inside refresh (which checks it)
    expect(has(java, /if \(!"ready"\.equals\(state\) \|\| ciq == null\) return;/)).toBe(true)
    expect(has(java, /if \(snap == null \|\| ciq == null \|\| !"ready"\.equals\(state\)\) return;/)).toBe(true)
    expect(java.match(/if \(ciq == null \|\| !"ready"\.equals\(state\)/g).length).toBeGreaterThanOrEqual(2)
    // Garmin Connect forgets what was registered when it goes away: onSdkReady registers anew
    expect(has(java, /public void onSdkReady\(\) \{[\s\S]*?registered\.clear\(\);\s*refresh\(\);/)).toBe(true)
    expect(has(java, /public void onSdkShutDown\(\) \{[\s\S]*?revive\(\)/)).toBe(true)
    // Garmin Connect missing is found before the SDK is touched
    expect(has(java, /if \(!gcmInstalled\(\)\) \{ state = "no-gcm"; WatchBridgePlugin\.notifyState\(\); return; \}/)).toBe(true)
    // the SDK is started and called on the main thread (it makes a Handler there)
    expect(has(java, /instance\.main\.post\(instance::start\)/)).toBe(true)
  })
})
