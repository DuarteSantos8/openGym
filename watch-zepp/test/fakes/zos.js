// Stand-ins for the Zepp OS modules (@zos/*) and zml, so the page and the shortcut card run in node
// (test/page.test.js). Every widget made is kept with its properties; taps are called by hand.
const g = globalThis.__zepp || (globalThis.__zepp = { widgets: [], crown: null, key: null, storage: new Map(), device: { width: 480, height: 480 }, request: null, buzzes: 0 })
export const widget = { TEXT: 'TEXT', BUTTON: 'BUTTON', FILL_RECT: 'FILL_RECT', STROKE_RECT: 'STROKE_RECT', ARC: 'ARC', CIRCLE: 'CIRCLE' }
export const prop = { TEXT: 'text', MORE: 'more' }
export const align = { CENTER_H: 'ch', CENTER_V: 'cv', LEFT: 'l', RIGHT: 'r' }
export const text_style = { WRAP: 'wrap', ELLIPSIS: 'ellipsis', NONE: 'none' }
export const event = { CLICK_UP: 'up', CLICK_DOWN: 'down' }
export function createWidget (type, props) {
  const w = { type, props: { ...props }, listeners: {}, alive: true,
    setProperty (p, v) { if (p === 'text') this.props.text = v; else Object.assign(this.props, v) },
    addEventListener (ev, fn) { this.listeners[ev] = fn } }
  g.widgets.push(w)
  return w
}
export function deleteWidget (w) { w.alive = false; g.widgets = g.widgets.filter(x => x !== w) }
export function getAppWidgetSize () { return { w: 416, h: 180, margin: 32, radius: 32 } }
export function getDeviceInfo () { return { ...g.device, deviceName: 'Amazfit Test' } }
export class LocalStorage { getItem (k) { return g.storage.get(k) } setItem (k, v) { g.storage.set(k, v) } }
export function getText (k) { return k === 'lang' ? 'en' : k }
export const KEY_HOME = 1, KEY_UP = 2, KEY_DOWN = 3, KEY_EVENT_CLICK = 1
export function onDigitalCrown ({ callback }) { g.crown = callback }
export function offDigitalCrown () { g.crown = null }
export function onKey ({ callback }) { g.key = callback }
export function offKey () { g.key = null }
export const VIBRATOR_SCENE_SHORT_STRONG = 1, VIBRATOR_SCENE_STRONG_REMINDER = 2
export class Vibrator { stop () {} setMode () {} start () { g.buzzes++ } }
export class HeartRate { getCurrent () { return 120 } onCurrentChange (fn) { g.hr = fn } offCurrentChange () { g.hr = null } }
export function setPageBrightTime () {} export function resetPageBrightTime () {}
export function pauseDropWristScreenOff () {} export function resetDropWristScreenOff () {} export function setWakeUpRelaunch () {}
export function push () {}
export const BasePage = opts => ({ ...opts, request (o) { return g.request(o) } })
