// The watch page and the shortcut card, run in node against stand-ins for the Zepp OS modules
// (test/fakes/zos.js): every screen draws, a routine starts from the wrist, the crown turns the
// weight, Done logs the set with its heart rate and starts the rest, the finish sends the phone's
// events, and nothing drawn leaves the round screen. Bundled the way zeus bundles it (esbuild).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fake = join(root, 'test', 'fakes', 'zos.js')
const zos = { name: 'zos', setup (b) { b.onResolve({ filter: /^(@zos\/|@zeppos\/zml)/ }, () => ({ path: fake })) } }
async function load (entry) {
  const out = await build({ entryPoints: [join(root, entry)], bundle: true, write: false, format: 'iife', plugins: [zos], logLevel: 'silent' })
  let def = null
  const run = new Function('Page', 'AppWidget', out.outputFiles[0].text)
  run(o => { def = o }, o => { def = o })
  return def
}
const Z = () => globalThis.__zepp
// A fresh watch of this size, before the page is loaded (it reads the screen as it loads).
const fresh = (device = { width: 480, height: 480 }) => { globalThis.__zepp = { widgets: [], crown: null, key: null, storage: new Map(), device, request: null, buzzes: 0 } }
// The first sync runs on its own from build(): let it land.
const settle = () => new Promise(r => setTimeout(r, 5))
const texts = () => Z().widgets.filter(w => w.type === 'TEXT' || w.type === 'BUTTON').map(w => w.props.text)
const buttonOf = text => Z().widgets.find(w => w.type === 'BUTTON' && w.props.text === text)
const snapshot = {
  v: 1, unit: 'kg', restSec: 90, active: null,
  ready: { today: { routineIds: ['r-push'], name: 'Push day', entries: [{ id: '0025', name: 'Barbell Bench Press', mode: 'reps', restSec: 60, last: '55×8', step: 2.5, sets: [{ w: 60, r: 8, done: false, warmup: false }] }] }, others: [] },
  settings: { lang: 'en', restHaptics: true, show: { hr: true, last: true, next: true } }, streak: { weeks: 4, thisWeekDone: true },
}

function inside (w) {
  const { width: W, height: H } = Z().device
  const p = w.props
  if (p.x < 0 || p.y < 0 || p.x + p.w > W + 1 || p.y + p.h > H + 1) return false
  if (w.type !== 'BUTTON' || W !== H) return true
  // a button's corners on a round screen: inside the circle (with its rounded ends)
  const r = W / 2, cx = W / 2, cy = H / 2
  const rr = Math.min(p.h / 2, p.radius || 0)
  for (const [x, y] of [[p.x + rr, p.y], [p.x + p.w - rr, p.y], [p.x + rr, p.y + p.h], [p.x + p.w - rr, p.y + p.h]]) if (Math.hypot(x - cx, y - cy) > r + 2) return false
  return true
}

for (const device of [{ width: 480, height: 480 }, { width: 466, height: 466 }, { width: 360, height: 360 }, { width: 390, height: 450 }, { width: 320, height: 380 }]) {
  test(`a workout from the wrist, start to summary (${device.width}x${device.height})`, async () => {
    fresh(device)
    const p = await load('page/index.js')
    const sent = []
    Z().request = async ({ params }) => { sent.push(...params.events); return { accepted: params.events.map(e => e.id), json: JSON.stringify(snapshot) } }
    p.onInit()
    p.build()
    await settle()
    assert.ok(texts().includes('Push day'), 'today\'s routine on the start screen')
    assert.ok(texts().includes('4'), 'the streak')
    for (const w of Z().widgets) assert.ok(inside(w), `${w.type} "${w.props.text || ''}" leaves the screen`)

    buttonOf('Push day').props.click_func()
    assert.equal(p.state.screen, 'set')
    assert.ok(texts().includes('Barbell Bench Press'))
    assert.ok(texts().includes('Last time: 55×8'))
    for (const w of Z().widgets) assert.ok(inside(w), `${w.type} "${w.props.text || ''}" leaves the screen`)
    // the weight tile, then the crown clockwise two notches: 60 → 65
    const weightTile = Z().widgets.find(w => w.type === 'TEXT' && w.props.text === '60')
    weightTile.listeners.up()
    Z().crown(1, -30)
    assert.ok(texts().includes('65'))
    Z().hr()
    buttonOf('Done').props.click_func()
    assert.equal(p.state.screen, 'finish', 'one set only: straight to the finish')
    await settle()
    const tick = sent.find(e => e.type === 'setDone')
    assert.equal(tick.w, 65)
    assert.equal(tick.r, 8)
    assert.deepEqual(tick.hr, { avg: 120, max: 120 })
    buttonOf('Finish and save').props.click_func()
    assert.equal(p.state.screen, 'summary')
    assert.ok(texts().includes('Workout saved'))
    for (const w of Z().widgets) assert.ok(inside(w), `${w.type} "${w.props.text || ''}" leaves the screen`)
    await settle()
    assert.deepEqual(sent.map(e => e.type), ['start', 'setDone', 'finish'])
    assert.equal(sent[0].routineIds[0], 'r-push')
    p.onDestroy()
  })
}

test('the rest: a ring, the countdown, +15 and Skip; menu and discard take two taps', async () => {
  fresh()
  const p = await load('page/index.js')
  const two = JSON.parse(JSON.stringify(snapshot))
  two.ready.today.entries[0].sets.push({ w: 60, r: 8, done: false, warmup: false })
  const sent = []
  Z().request = async ({ params }) => { sent.push(...params.events); return { accepted: params.events.map(e => e.id), json: JSON.stringify(two) } }
  p.onInit(); p.build(); await settle()
  buttonOf('Push day').props.click_func()
  buttonOf('Done').props.click_func()
  assert.equal(p.state.screen, 'rest')
  assert.ok(Z().widgets.some(w => w.type === 'ARC'))
  assert.ok(texts().some(x => /^0:(59|60)|^1:00$/.test(x)), 'the countdown')
  buttonOf('+15').props.click_func()
  buttonOf('Skip').props.click_func()
  assert.equal(p.state.screen, 'set')
  // the exercise name opens the menu
  Z().widgets.find(w => w.props.text === 'Barbell Bench Press').listeners.up()
  assert.equal(p.state.screen, 'menu')
  buttonOf('Discard workout').props.click_func()
  assert.equal(p.state.screen, 'menu', 'one tap only arms it')
  buttonOf('Tap again to discard').props.click_func()
  assert.equal(p.state.screen, 'start')
  await settle()
  assert.equal(sent.at(-1).type, 'discard')
  p.onDestroy()
})

test('unpaired, the watch says how to pair', async () => {
  fresh()
  const p = await load('page/index.js')
  Z().request = async () => ({ unpaired: true })
  p.onInit(); p.build(); await settle()
  assert.ok(texts().some(x => /Pair me first/.test(x)))
  p.onDestroy()
})

test('the shortcut card: the streak and today\'s plan', async () => {
  fresh()
  const card0 = await load('app-widget/index.js')
  const state = { synced: true, streak: { weeks: 7, thisWeekDone: true }, ready: { today: { name: 'Legs', entries: [] }, others: [] }, settings: { lang: 'de' } }
  Z().storage.set('og_state', JSON.stringify(state))
  card0.build()
  assert.ok(texts().includes('7'))
  assert.ok(texts().includes('Heute: Legs'))
})
