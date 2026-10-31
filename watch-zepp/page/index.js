// openGym on a Zepp OS watch: one page that draws one screen at a time, picked from the state
// (lib/session.js, the Wear OS SessionCore's port). The screens mirror the Wear OS app's:
//
//   start    today's routine with one tap, Quick start, a few more; the week streak on top
//   set      the exercise, set k of n, weight and reps as two big tiles; the crown (or + and -)
//            turns the lime-outlined one, Done logs the set with its heart rate
//   rest     a ring that empties, the countdown, the next set, +15 and Skip; a nudge ten seconds
//            before the end, a clear buzz at the end
//   menu     skip a set, finish, discard (two taps); a tap on the exercise name opens it
//   finish   Finish and save, Continue, Discard
//   summary  time, sets, volume, heart rate and the PRs; "Ended on your phone" when it was
//
// Everything reaches the phone as the Apple Watch's events, through the Side Service and the
// user's own server (app-side/index.js, docs/ZEPP_OS.md). No exercise media: text and numbers only.
import { BasePage } from '@zeppos/zml/base-page'
import { createWidget, deleteWidget, widget, prop, align, text_style, event } from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { LocalStorage } from '@zos/storage'
import { getText } from '@zos/i18n'
import { onDigitalCrown, offDigitalCrown, onKey, offKey, KEY_HOME, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from '@zos/interaction'
import { HeartRate, Vibrator, VIBRATOR_SCENE_SHORT_STRONG, VIBRATOR_SCENE_STRONG_REMINDER } from '@zos/sensor'
import { setPageBrightTime, resetPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff, setWakeUpRelaunch } from '@zos/display'
import * as S from '../lib/session.js'
import { createStore, syncOnce } from '../lib/store.js'
import { t, setLang } from '../lib/i18n.js'
import { fmt, clock, short } from '../lib/fmt.js'
import { C, T, TAP } from '../lib/theme.js'

const POLL_MS = 15000
// The crown: this many degrees turn the value one step (a notch on most Zepp watches is ~15°).
const CROWN_STEP_DEG = 15

const { width: W, height: H } = getDeviceInfo()
const ROUND = Math.abs(W - H) < 4
const k = W / 480
const u = n => Math.round(n * k)
const cy = Math.round(H / 2)

/* ---------- drawing ---------- */

let widgets = []
const add = (type, props) => { const w = createWidget(type, props); widgets.push(w); return w }
function clearAll () { for (const w of widgets) { try { deleteWidget(w) } catch (e) { /* gone */ } } widgets = [] }

// The width of the round screen at a given y, so text and buttons stay inside it.
function chord (y, pad = 16) {
  if (!ROUND) return W - u(pad) * 2
  const r = W / 2, dy = Math.min(Math.abs(y - cy), r)
  return Math.max(u(120), Math.round(2 * Math.sqrt(r * r - dy * dy)) - u(pad) * 2)
}

function label (text, y, { size = T.label, color = C.quiet, h = u(size * 1.4), w = null, x = null, wrap = false, alignH = align.CENTER_H } = {}) {
  const ww = w || chord(y + h / 2)
  return add(widget.TEXT, {
    x: x == null ? Math.round((W - ww) / 2) : x, y, w: ww, h,
    text, text_size: u(size), color,
    align_h: alignH, align_v: align.CENTER_V,
    text_style: wrap ? text_style.WRAP : text_style.ELLIPSIS,
  })
}

function button (text, y, onClick, { w = null, h = u(TAP + 16), x = null, primary = false, danger = false, size = T.body, onLong = null } = {}) {
  const ww = w || Math.min(u(300), chord(y + h / 2, 28))
  const props = {
    x: x == null ? Math.round((W - ww) / 2) : x, y, w: ww, h,
    text, text_size: u(size), radius: Math.round(h / 2),
    color: primary ? C.onLime : danger ? C.red : C.text,
    normal_color: primary ? C.lime : C.tile,
    press_color: primary ? C.limePress : C.tileHi,
    click_func: () => onClick(),
  }
  if (onLong) props.longpress_func = () => onLong()
  return add(widget.BUTTON, props)
}

function tap (w, fn) { try { w.addEventListener(event.CLICK_UP, fn) } catch (e) { /* not tappable */ } }

/* ---------- haptics ---------- */

let vib = null
function buzz (mode) {
  try {
    if (!vib) vib = new Vibrator()
    vib.stop()
    vib.setMode({ mode })
    vib.start()
  } catch (e) { /* no motor */ }
}

/* ---------- the page ---------- */

Page(
  BasePage({
    state: {
      screen: 'start',
      focus: 'r',        // the tile the crown turns: 'w' or 'r' (or 's' for a hold)
      draft: null,       // { ei, si, side, w, r, sec }
      rest: null,        // { endsAt, total, ei, si }
      hold: null,        // { startedAt }
      summary: null,
      discardArmed: false,
      crownAcc: 0,
    },

    onInit () {
      this.store = createStore(new LocalStorage())
      const own = getText('lang')
      setLang((this.store.state.settings && this.store.state.settings.lang) || (own !== 'lang' ? own : 'en'))
      // Back to openGym when the wrist comes up, not the watch face, while a workout runs.
      try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* older firmware */ }
      this.hrSamples = []
      this.hrAll = []
      this.hrNow = 0
      this.startHeart()
    },

    build () {
      this.go(this.store.state.workout ? 'set' : 'start')
      this.syncNow()
      this.poll = setInterval(() => this.syncNow(), POLL_MS)
    },

    onDestroy () {
      clearInterval(this.poll)
      clearInterval(this.tickTm)
      this.stopHeart()
      this.unbindInputs()
      try { resetPageBrightTime() } catch (e) { /* none set */ }
      try { resetDropWristScreenOff() } catch (e) { /* none set */ }
    },

    /* ---------- the link ---------- */

    async syncNow () {
      // One at a time; an event made meanwhile goes right after, not with the next poll.
      if (this.syncing) { this.again = true; return }
      this.syncing = true
      this.again = false
      const before = this.store.state.workout
      let deviceName = ''
      try { deviceName = getDeviceInfo().deviceName || '' } catch (e) { deviceName = '' }
      const r = await syncOnce(this.store, opts => this.request(opts), { now: Date.now(), name: deviceName })
      this.syncing = false
      if (this.again) setTimeout(() => this.syncNow(), 0)
      const s = this.store.state
      if (s.settings && s.settings.lang) setLang(s.settings.lang)
      // What changed on the phone decides whether the screen does.
      if (this.state.screen === 'start') return this.go('start')
      if (before && !s.workout && ['set', 'rest', 'menu', 'finish'].includes(this.state.screen)) {
        // Finished or discarded on the phone while the watch had it.
        this.state.summary = S.summary(before, Date.now(), { endedOnPhone: true, hr: S.hrOf(this.hrAll) })
        return this.go('summary')
      }
      if (this.state.screen === 'set' && s.workout && r === 'ok') {
        // A rest started on the phone runs here too.
        const rest = s.workout.rest
        if (rest && rest.endsAt > Date.now() + 1500 && (!this.state.rest || Math.abs(this.state.rest.endsAt - rest.endsAt) > 1500)) {
          const [ei] = this.current()
          this.state.rest = { endsAt: rest.endsAt, total: Math.max(1, (rest.endsAt - Date.now()) / 1000), ei, si: S.setIndex(s, ei) }
          return this.go('rest')
        }
        const d = this.state.draft
        const row = d && s.workout.entries[d.ei] && s.workout.entries[d.ei].sets[d.si]
        // The set on screen was ticked on the phone: on to the next.
        if (!row || row.done) this.go('set')
      }
    },

    /** A change made here, saved, its event queued and sent at once. */
    commit (next, ev) {
      this.store.commit(next, ev)
      if (ev) this.syncNow()
    },

    /* ---------- heart rate ---------- */

    startHeart () {
      if (this.hr) return
      try {
        this.hr = new HeartRate()
        this.hrCb = () => {
          const v = this.hr.getCurrent()
          if (!(v > 30 && v < 240)) return
          this.hrNow = v
          if (this.store.state.workout) { this.hrSamples.push(v); this.hrAll.push(v); if (this.hrAll.length > 4000) this.hrAll.shift() }
          if (this.hrText) { try { this.hrText.setProperty(prop.TEXT, v + ' bpm') } catch (e) { /* redrawn */ } }
        }
        this.hr.onCurrentChange(this.hrCb)
      } catch (e) { this.hr = null }
    },
    stopHeart () { try { if (this.hr) this.hr.offCurrentChange(this.hrCb) } catch (e) { /* off */ } this.hr = null },

    /* ---------- inputs ---------- */

    bindInputs (turn) {
      this.unbindInputs()
      this.state.crownAcc = 0
      try {
        onDigitalCrown({
          callback: (key, degree) => {
            if (key !== KEY_HOME) return
            this.state.crownAcc += degree
            const steps = Math.trunc(this.state.crownAcc / CROWN_STEP_DEG)
            if (!steps) return
            this.state.crownAcc -= steps * CROWN_STEP_DEG
            // Counter-clockwise is positive on Zepp OS: clockwise (negative) turns the value up.
            turn(-steps)
          },
        })
        this.crownOn = true
      } catch (e) { this.crownOn = false }
      // Watches with buttons instead of a crown (T-Rex, Active Edge): up and down step it.
      try {
        onKey({
          callback: (key, ev) => {
            if (ev !== KEY_EVENT_CLICK) return false
            if (key === KEY_UP) { turn(1); return true }
            if (key === KEY_DOWN) { turn(-1); return true }
            return false
          },
        })
        this.keysOn = true
      } catch (e) { this.keysOn = false }
    },
    unbindInputs () {
      if (this.crownOn) { try { offDigitalCrown() } catch (e) { /* off */ } this.crownOn = false }
      if (this.keysOn) { try { offKey() } catch (e) { /* off */ } this.keysOn = false }
    },

    keepAwake (on) {
      try {
        if (on) { setPageBrightTime({ brightTime: 60000 }); pauseDropWristScreenOff({ duration: 60000 }) } else { resetPageBrightTime(); resetDropWristScreenOff() }
      } catch (e) { /* firmware without it */ }
    },

    /* ---------- where things are ---------- */

    /** The exercise and set up now: [ei, si], si null on the finish page. */
    current () {
      const s = this.store.state
      const w = s.workout
      if (!w) return [0, null]
      const n = w.entries.length
      let ei = Math.max(0, Math.min(n, s.entryIndex))
      for (let i = 0; i < n; i++) {
        const at = (ei + i) % n
        const si = S.setIndex(s, at)
        if (si != null) return [at, si]
      }
      return [n, null]
    },

    go (screen) {
      clearInterval(this.tickTm)
      this.unbindInputs()
      this.hrText = null
      clearAll()
      this.state.screen = screen
      this.state.discardArmed = false
      add(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg })
      this.keepAwake(screen === 'set' || screen === 'rest')
      const draw = { start: this.drawStart, set: this.drawSet, rest: this.drawRest, menu: this.drawMenu, finish: this.drawFinish, summary: this.drawSummary }[screen]
      draw.call(this)
    },

    /* ---------- start ---------- */

    drawStart () {
      const s = this.store.state
      const link = this.store.link
      if (s.workout) {
        const [done, all] = S.progress(s)
        label(t('workout'), cy - u(150))
        label(s.workout.name || t('workout'), cy - u(110), { size: T.title, color: C.text, h: u(90), wrap: true })
        label(t('sets_of', done, all), cy - u(10))
        button(t('continue_workout'), cy + u(50), () => this.go('set'), { primary: true })
        return
      }
      if (link.paired === false) {
        label('openGym', cy - u(110), { size: T.title, color: C.lime })
        label(t('not_paired'), cy - u(60), { size: T.body, color: C.text, h: u(150), wrap: true })
        return
      }
      if (!s.synced) {
        label('openGym', cy - u(110), { size: T.title, color: C.lime })
        label(link.away ? t('phone_away') : t('syncing'), cy - u(50), { size: T.body, color: C.text, h: u(110), wrap: true })
        label(t('open_phone_once'), cy + u(70), { h: u(100), wrap: true })
        return
      }
      // The streak, big, lime once this week has a workout (the Wear OS Tile's rule).
      const st = s.streak || { weeks: 0, thisWeekDone: false }
      label(String(st.weeks), cy - u(200), { size: T.number, color: st.thisWeekDone ? C.lime : C.text, h: u(84) })
      label(t('week_streak'), cy - u(118))
      const ready = s.ready || { today: null, others: [] }
      const others = (ready.others || []).filter(r => r.entries.length)
      let y = cy - u(70)
      if (ready.today && ready.today.entries.length) {
        label(t('today'), y)
        button(ready.today.name || t('start_workout'), y + u(36), () => this.startSession(ready.today), { primary: true })
        y += u(126)
      } else {
        label(t('rest_day'), y, { h: u(40) })
        if (others[0]) { button(t('quick_start'), y + u(44), () => this.startSession(others[0]), { primary: true }); y += u(134) } else y += u(60)
      }
      if (!ready.today && !others.length) { label(t('start_on_phone'), y, { h: u(90), wrap: true }); return }
      // A few more, as quiet tiles, as many as fit the round screen.
      for (const r of (ready.today ? others : others.slice(1)).slice(0, 2)) {
        if (y + u(64) > H - u(30)) break
        button(r.name, y, () => this.startSession(r), { h: u(64), size: T.label })
        y += u(76)
      }
      if (link.away) label(t('phone_away'), H - u(70), { size: 20, h: u(40) })
    },

    startSession (session) {
      const now = Date.now()
      const [next, ev] = S.start(this.store.state, session, { wid: S.makeId('watch', now), at: now, id: S.makeId('ev', now) })
      this.hrAll = []
      this.commit(next, ev)
      this.go('set')
    },

    /* ---------- set ---------- */

    drawSet () {
      const s = this.store.state
      const w = s.workout
      if (!w) return this.go('start')
      const [ei, si] = this.current()
      if (si == null) return this.go('finish')
      if (ei !== s.entryIndex) this.store.commit({ ...s, entryIndex: ei })
      const e = w.entries[ei]
      const row = e.sets[si]
      const side = S.sideUp(row)
      const d0 = this.state.draft
      if (!d0 || d0.ei !== ei || d0.si !== si || d0.side !== side) {
        const src = side && row.sides ? row.sides[side] : row
        this.state.draft = { ei, si, side, w: src.w != null ? src.w : row.w || 0, r: src.r != null ? src.r : row.r || 0, sec: row.sec || 0 }
        this.state.focus = S.isTimed(e) ? 's' : 'r'
        this.hrSamples = []
      }
      const d = this.state.draft
      const unit = S.weightUnit(e, w.unit)
      const work = e.sets.filter(x => !x.warmup)
      const wi = work.indexOf(row)

      // The header: set k of n with its tag, the exercise name (a tap opens the menu).
      const tag = row.warmup ? t('warmup') : side ? (side === 'L' ? t('left') : t('right')) : e.group ? t('superset') : ''
      label(row.warmup ? tag : t('set_of', wi + 1, work.length) + (tag ? '  ' + tag : ''), cy - u(205), { size: T.label, color: row.warmup ? C.warm : C.quiet, h: u(34) })
      const name = label(e.name, cy - u(172), { size: T.title, color: C.text, h: u(84), wrap: true })
      tap(name, () => this.go('menu'))
      if (s.settings.show.hr && this.hrNow) this.hrText = label(this.hrNow + ' bpm', cy - u(86), { size: T.label, color: C.red, h: u(30) })

      if (S.isCardio(e)) {
        label(t('log_on_phone'), cy - u(40), { size: T.body, color: C.text, h: u(100), wrap: true })
        button(t('skip'), cy + u(90), () => this.skipSet(), { primary: true })
        return
      }

      const turn = steps => {
        const dd = this.state.draft
        if (this.state.focus === 'w') dd.w = S.stepWeight(dd.w, S.stepOf(e, w.unit), steps)
        else if (this.state.focus === 's') dd.sec = Math.max(0, Math.min(3600, (dd.sec || 0) + steps * 5))
        else dd.r = S.stepReps(dd.r, steps)
        this.refreshTiles()
        buzz(VIBRATOR_SCENE_SHORT_STRONG)
      }
      this.bindInputs(turn)

      // The tiles: two numbers (one for a hold), the one the crown turns outlined in lime.
      const tileW = u(178), tileH = u(132), gap = u(16), ty = cy - u(56)
      const tiles = S.isTimed(e) ? [['s', t('hold'), 's']] : [['w', e.bodyweight ? t('added_weight') : unit, 'w'], ['r', t('reps'), 'r']]
      const total = tiles.length * tileW + (tiles.length - 1) * gap
      this.tiles = {}
      tiles.forEach(([key, unitLabel], i) => {
        const x = Math.round((W - total) / 2) + i * (tileW + gap)
        const bg = add(widget.FILL_RECT, { x, y: ty, w: tileW, h: tileH, radius: u(28), color: C.tile })
        const ring = add(widget.STROKE_RECT, { x, y: ty, w: tileW, h: tileH, radius: u(28), line_width: u(4), color: this.state.focus === key ? C.lime : C.tile })
        const value = add(widget.TEXT, { x, y: ty + u(8), w: tileW, h: u(84), text: '', text_size: u(T.number), color: C.text, align_h: align.CENTER_H, align_v: align.CENTER_V, text_style: text_style.NONE })
        const unitT = add(widget.TEXT, { x, y: ty + u(88), w: tileW, h: u(34), text: unitLabel, text_size: u(T.label - 2), color: C.quiet, align_h: align.CENTER_H, align_v: align.CENTER_V, text_style: text_style.ELLIPSIS })
        const pick = () => { this.state.focus = key; this.refreshTiles() }
        for (const x2 of [bg, ring, value, unitT]) tap(x2, pick)
        this.tiles[key] = { ring, value }
      })
      this.refreshTiles()

      // − and + for watches without a crown (and for anyone who prefers a tap).
      const by = ty + tileH + u(14), bw = u(96), bh = u(TAP)
      button('−', by, () => turn(-1), { x: Math.round(W / 2 - bw - u(8)), w: bw, h: bh, size: T.title })
      button('+', by, () => turn(1), { x: Math.round(W / 2 + u(8)), w: bw, h: bh, size: T.title })

      if (s.settings.show.last && e.last) label(t('last_time', e.last), by + bh + u(6), { size: 20, h: u(30) })

      const doneY = Math.min(H - u(TAP + 16) - u(ROUND ? 22 : 12), by + bh + u(40))
      if (S.isTimed(e)) button(t('start_hold'), doneY, () => this.startHold(), { primary: true })
      else button(t('done'), doneY, () => this.done(), { primary: true, onLong: () => this.skipSet() })
    },

    refreshTiles () {
      const d = this.state.draft
      if (!d || !this.tiles) return
      for (const [key, w] of Object.entries(this.tiles)) {
        const v = key === 'w' ? fmt(d.w) : key === 's' ? clock(d.sec) : fmt(d.r)
        try {
          w.value.setProperty(prop.TEXT, v)
          w.ring.setProperty(prop.MORE, { color: this.state.focus === key ? C.lime : C.tile })
        } catch (e) { /* redrawn next time */ }
      }
    },

    done (secOverride = null) {
      const s = this.store.state
      const d = this.state.draft
      if (!d) return
      const e = s.workout.entries[d.ei]
      const now = Date.now()
      const timed = S.isTimed(e)
      const [next, ev] = S.tick(s, {
        ei: d.ei, si: d.si, side: d.side,
        w: timed ? null : d.w, r: timed ? null : d.r, sec: timed ? (secOverride != null ? secOverride : d.sec) : null,
        at: now, id: S.makeId('ev', now), hr: S.hrOf(this.hrSamples),
      })
      if (!ev) return
      buzz(VIBRATOR_SCENE_SHORT_STRONG)
      const [ni, rest] = S.next(next, d.ei, d.si)
      this.commit({ ...next, entryIndex: ni }, ev)
      this.state.draft = null
      const restSec = e.restSec || next.workout.restSec || next.restSec || 0
      if (rest && restSec > 0 && ni < next.workout.entries.length) {
        this.state.rest = { endsAt: now + restSec * 1000, total: restSec, ei: ni, si: S.setIndex(next, ni) }
        return this.go('rest')
      }
      this.go(ni >= next.workout.entries.length ? 'finish' : 'set')
    },

    skipSet () {
      const d = this.state.draft
      const s = this.store.state
      if (!d || !s.workout) return
      const skipped = S.skip(s, d.ei, d.si)
      const [ni] = S.next(skipped, d.ei, d.si)
      this.store.commit({ ...skipped, entryIndex: ni })
      this.state.draft = null
      this.go(ni >= skipped.workout.entries.length ? 'finish' : 'set')
    },

    // A hold: the seconds count up on the tile, Stop logs them.
    startHold () {
      const startedAt = Date.now()
      clearAll()
      this.unbindInputs()
      add(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg })
      label(t('hold'), cy - u(150))
      const big = label('0:00', cy - u(100), { size: T.hero, color: C.lime, h: u(140) })
      button(t('stop'), cy + u(80), () => { clearInterval(this.tickTm); this.done(Math.round((Date.now() - startedAt) / 1000)) }, { primary: true })
      this.tickTm = setInterval(() => { try { big.setProperty(prop.TEXT, clock((Date.now() - startedAt) / 1000)) } catch (e) { /* gone */ } }, 1000)
    },

    /* ---------- rest ---------- */

    drawRest () {
      const r = this.state.rest
      const s = this.store.state
      if (!r || !s.workout) return this.go('set')
      const ringW = Math.min(W, H) - u(24)
      const x = Math.round((W - ringW) / 2), y = Math.round((H - ringW) / 2)
      const line = u(14)
      add(widget.ARC, { x, y, w: ringW, h: ringW, start_angle: -90, end_angle: 270, color: C.track, line_width: line })
      const arc = add(widget.ARC, { x, y, w: ringW, h: ringW, start_angle: -90, end_angle: 270, color: C.lime, line_width: line })
      label(t('rest'), cy - u(130))
      const big = label('', cy - u(96), { size: T.hero, color: C.text, h: u(130) })
      const e = s.workout.entries[r.ei]
      if (s.settings.show.next && e && r.si != null) label(t('next_set', e.name, r.si + 1), cy + u(38), { h: u(64), wrap: true, size: 22 })
      if (s.settings.show.hr && this.hrNow) this.hrText = label(this.hrNow + ' bpm', cy + u(100), { size: 22, color: C.red, h: u(30) })
      const bw = u(120), bh = u(TAP + 8), by = cy + u(140)
      button('+15', by, () => { r.endsAt += 15000; r.total += 15; this.warned = false }, { x: Math.round(W / 2 - bw - u(8)), w: bw, h: bh })
      button(t('skip'), by, () => this.endRest(false), { x: Math.round(W / 2 + u(8)), w: bw, h: bh, primary: true })
      this.warned = false
      const tickRest = () => {
        const left = (r.endsAt - Date.now()) / 1000
        if (left <= 0) return this.endRest(true)
        try {
          big.setProperty(prop.TEXT, clock(Math.ceil(left)))
          arc.setProperty(prop.MORE, { start_angle: -90, end_angle: -90 + Math.round(360 * Math.max(0, Math.min(1, left / r.total))) })
        } catch (err) { /* redrawn */ }
        // A nudge ten seconds before the end (once), the strong buzz at the end.
        if (left <= 10 && !this.warned && r.total > 20) { this.warned = true; if (s.settings.restHaptics) buzz(VIBRATOR_SCENE_SHORT_STRONG) }
      }
      tickRest()
      this.tickTm = setInterval(tickRest, 250)
    },

    endRest (timeUp) {
      clearInterval(this.tickTm)
      if (timeUp && this.store.state.settings.restHaptics) buzz(VIBRATOR_SCENE_STRONG_REMINDER)
      this.state.rest = null
      this.hrSamples = []
      this.go('set')
    },

    /* ---------- menu ---------- */

    drawMenu () {
      label(t('workout'), cy - u(190))
      button(t('skip_set'), cy - u(140), () => this.skipSet())
      button(t('finish_workout'), cy - u(60), () => this.go('finish'))
      const discard = button(t('discard_workout'), cy + u(20), () => {
        if (!this.state.discardArmed) {
          this.state.discardArmed = true
          try { discard.setProperty(prop.MORE, { text: t('discard_confirm') }) } catch (e) { /* redrawn */ }
          return
        }
        this.end(true)
      }, { danger: true })
      button(t('cancel'), cy + u(100), () => this.go('set'), { primary: true })
    },

    /* ---------- finish ---------- */

    drawFinish () {
      const s = this.store.state
      if (!s.workout) return this.go('start')
      const [done, all] = S.progress(s)
      label(done >= all ? t('all_sets_done') : t('finish_workout_q'), cy - u(170), { size: T.title, color: C.text, h: u(50) })
      label(t('sets_of', done, all), cy - u(118))
      button(t('finish_and_save'), cy - u(70), () => this.end(false), { primary: true })
      button(t('continue_workout'), cy + u(14), () => this.go('set'))
      const discard = button(t('discard_workout'), cy + u(98), () => {
        if (!this.state.discardArmed) {
          this.state.discardArmed = true
          try { discard.setProperty(prop.MORE, { text: t('discard_confirm') }) } catch (e) { /* redrawn */ }
          return
        }
        this.end(true)
      }, { danger: true, h: u(64), size: T.label })
    },

    end (discard) {
      const s = this.store.state
      const w = s.workout
      if (!w) return this.go('start')
      const now = Date.now()
      const [next, ev] = S.finish(s, { at: now, id: S.makeId('ev', now), discard })
      this.commit(next, ev)
      if (discard) return this.go('start')
      this.state.summary = S.summary(w, now, { hr: S.hrOf(this.hrAll) })
      buzz(VIBRATOR_SCENE_SHORT_STRONG)
      this.go('summary')
    },

    /* ---------- summary ---------- */

    drawSummary () {
      const m = this.state.summary
      if (!m) return this.go('start')
      label(m.endedOnPhone ? t('ended_on_phone') : t('workout_saved'), cy - u(196), { size: T.label, color: C.lime, h: u(34) })
      label(m.name || t('workout'), cy - u(160), { size: T.title, color: C.text, h: u(50) })
      // Three numbers in a row: time, sets, volume; the labels small under them.
      const cols = [[m.duration != null ? clock(m.duration) : '0:00', t('time')], [String(m.sets), t('sets')], [short(m.volume), m.unit]]
      const cw = Math.round(chord(cy - u(60)) / 3)
      const x0 = Math.round((W - cw * 3) / 2)
      cols.forEach(([v, l], i) => {
        label(v, cy - u(100), { x: x0 + i * cw, w: cw, size: 40, color: C.text, h: u(56) })
        label(l, cy - u(44), { x: x0 + i * cw, w: cw, size: 20, h: u(28) })
      })
      let y = cy + u(2)
      if (m.hrAvg) { label(t('heart_rate') + ': ' + m.hrAvg + ' / ' + m.hrMax, y, { size: 22, color: C.red, h: u(32) }); y += u(36) }
      if (m.prs.length) { label(t('prs') + ': ' + m.prs.slice(0, 2).join(', ') + (m.prs.length > 2 ? ' +' + (m.prs.length - 2) : ''), y, { size: 22, color: C.lime, h: u(56), wrap: true }); y += u(60) }
      button(t('done'), Math.max(y + u(8), cy + u(110)), () => { this.state.summary = null; this.go('start') }, { primary: true })
    },
  }),
)

