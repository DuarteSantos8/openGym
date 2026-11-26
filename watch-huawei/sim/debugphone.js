// SMOKE TEST ONLY. A fake phone and a timed driver for the simulator, which cannot tap. huawei-sim.mjs copies this file into a
// temp copy of the project and hooks it into that copy's app.js; it is never under entry/, so the product build cannot include it.
// It imports nothing (app.js carries the core: K comes from it). It runs from app.js, not a page: its timers would keep that page
// in the heap for the whole run, which the real app does not do.
const SETTINGS = { lang: 'en', effort: 'rpe', restHaptics: true, weighIn: false, show: { hr: true, last: true, next: true }, crown: 'reps' }
const ent = (id, name, i, sets, extra) => Object.assign({ id: id, name: name, i: i, sets: sets, mode: 'reps', restSec: 90, step: 2.5 }, extra || {})
const row = (w, r) => ({ w: w, r: r, sec: null, done: false, warmup: false })
const today = () => ({ routineIds: ['r1'], name: 'Push day', entries: [ent('0025', 'Bench Press', 0, [row(60, 8), row(60, 8), row(60, 8)], { last: '55x8, 57.5x6' }), ent('0099', 'Row', 1, [row(40, 10)])] })
const base = extra => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: SETTINGS, streak: { weeks: 3, thisWeekDone: false }, active: null, ready: null }, extra)
const active = () => base({ active: { id: 'w1', name: 'Push day', start: Date.now() - 120000, unit: 'kg', cur: 0, restSec: 90, count: 2, entries: today().entries } })

// A.pg is the page that is up (huawei-sim.mjs hooks each page copy): the workout goes home -> lift -> home, so a tap goes to the one showing.
// [ms after the first snapshot, page handler or swipe]: start, set done, an effort chip, the Metrics pages and back, finish, confirm
export const STEPS = [[2000, 'start'], [8000, 'done'], [10000, 'chip2'], [12000, 'L'], [15000, 'L'], [18000, 'L'], [21000, 'L'], [24000, 'R'], [24500, 'R'], [25000, 'R'], [25500, 'R'], [26000, 'menu'], [29000, 'mOver'], [32000, 'ovBack'], [35000, 'menu'], [38000, 'mFinish'], [41000, 'yes']]

// The page's own radio: 'start' is answered with an active workout. In a function of its own, so the driver's timers do not
// hold the page's transmit (and with it the page) after the page is gone.
function answerStart (A, K) {
  const radio = A.radio
  const real = radio.transmit
  radio.transmit = function (m, l) {
    real.call(radio, m, l)
    if (((m && m.events) || []).some(function (e) { return e.type === 'start' })) setTimeout(function () { K.onPhone(A.c, active()) }, 500)
  }
}

export default function drive (A, K) {
  answerStart(A, K)
  setTimeout(function () {
    K.onPhone(A.c, base({ ready: { today: today(), others: [] } }))
    console.log('OGSMOKE feed')
    STEPS.forEach(function (st) {
      setTimeout(function () {
        console.log('OGSMOKE step ' + st[1])
        try { const now = A.pg; if (st[1] === 'L' || st[1] === 'R') now.swipe({ direction: st[1] === 'L' ? 'left' : 'right' }); else now[st[1]]() } catch (e) { console.log('OGSMOKE steperr ' + e) }
      }, st[0])
    })
  }, 1500)
}
