#!/usr/bin/env node
// Writes sim/source/SimData.mc: the snapshot the simulator build starts with, made from
// test/snapshot.json (the watch's fixture) as the phone would send it before a workout: nothing
// running, today's routine ready with its exercises (so START on the watch starts it), two more
// routines by name, a streak kept this week. For the redesign's screens the routine also has a
// superset with a long name (the partner line, wrapping) and a timed hold (its 3-2-1, the bar), and
// the settings carry the app's accent and the RIR effort scale. It becomes a JSON resource the
// simulator build reads like the phone's message.
//   node frontend/garmin/sim/gen.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { garminSnapshot } from '../../src/lib/garmin-snapshot.js'

const here = dirname(fileURLToPath(import.meta.url))
const snap = JSON.parse(readFileSync(join(here, '..', 'test', 'snapshot.json'), 'utf8'))
const active = snap.active
// (a routine's exercises have no place in a running workout yet: no `i`)
const fresh = active.entries.map(({ i, best, ...e }) => ({ ...e, sets: e.sets.map(({ at, ...row }) => ({ ...row, done: false })) }))
const row = (w, r, sec = null) => ({ w, r, sec, done: false, warmup: false })
const extra = [
  { id: 'sim-a', name: 'Lat Pulldown', mode: 'reps', restSec: 90, last: '50×10, 50×9', step: 2.5, group: 'a', sets: [row(50, 10), row(50, 10)] },
  { id: 'sim-b', name: 'Single Arm Dumbbell Lateral Raise', mode: 'reps', restSec: 90, last: null, step: 1, group: 'a', sets: [row(8, 12), row(8, 12)] },
  { id: 'sim-p', name: 'Plank', mode: 'time', restSec: 60, last: null, sets: [row(null, null, 30), row(null, null, 30)] },
]
// SIM_LONG=40: a long day (four sets per exercise) for the memory check of a watch-only workout (sim/run.sh long).
const long = !!process.env.SIM_LONG
const longDay = n => Array.from({ length: Math.ceil(n / 4) }, (_, i) => ({
  id: 'sim-l' + i, name: ['Barbell Bench Press', 'Incline Dumbbell Press', 'Cable Fly', 'Overhead Press', 'Lateral Raise'][i % 5] + ' ' + (i + 1),
  mode: 'reps', restSec: 60, last: '60×8, 60×8, 57.5×8', step: 2.5, sets: Array.from({ length: Math.min(4, n - i * 4) }, () => row(60, 8)),
}))
const out = {
  ...snap,
  settings: { ...snap.settings, accent: '#a3e635', onAccent: '#000000', effort: 'rir' },
  active: null,
  streak: { weeks: 12, thisWeekDone: true },
  ready: {
    today: { name: active.name, routineIds: ['sim-push'], entries: long ? longDay(+process.env.SIM_LONG) : process.env.SIM_SMALL ? fresh : [fresh[0], ...extra, fresh[1]] },
    others: [{ name: 'Pull day', routineIds: ['sim-pull'] }, { name: 'Legs', routineIds: ['sim-legs'] }]
  }
}


// SIM_PHONE=1: a workout started on the phone, the way a real phone sends it (every row with its
// id, a superset, a per-side set, a hold, warm-ups, bodyweight and an assisted one), through the
// phone's own cut. sim/source/Sim.mc then plays that phone: it applies the watch's events to its
// copy of the whole workout and sends the window back, as lib/watch-sync.js does.
let sid = 0
const prow = (w, r, extra = {}) => ({ w, r, sec: null, done: false, warmup: false, sid: 'ssim' + (++sid).toString(36), ...extra })
const sides = (w, r) => ({ L: { w, r, done: false }, R: { w, r, done: false } })
const phoneDay = () => [
  { id: '0025', name: 'Barbell Bench Press', mode: 'reps', restSec: 120, last: '55×8, 57.5×6', step: 2.5, best: { w: 57.5, r: 6 },
    sets: [prow(40, 8, { warmup: true }), prow(60, 8), prow(60, 8), prow(60, 8)] },
  { id: 'sim-a', name: 'Plate Hyperextension', mode: 'reps', restSec: 90, last: '15×15', step: 1.25, group: '1', sets: [prow(15, 15), prow(15, 15), prow(15, 15)] },
  { id: 'sim-b', name: 'Captains Chair Straight Leg Raise', mode: 'reps', restSec: null, last: null, bodyweight: true, step: 2.5, group: '1', sets: [prow(0, 15), prow(0, 15), prow(0, 15)] },
  { id: 'sim-c', name: 'Dumbbell Single Arm Lateral Raise', mode: 'reps', restSec: 60, last: '8×12', step: 1, perSide: true, group: '1',
    sets: [prow(8, 24, { sides: sides(8, 12) }), prow(8, 24, { sides: sides(8, 12) }), prow(8, 24, { sides: sides(8, 12) })] },
  { id: 'sim-d', name: 'Assisted Pull-up', mode: 'reps', restSec: 90, last: '20×8', assisted: true, step: 2.5, group: '1', sets: [prow(20, 8), prow(20, 8), prow(20, 8)] },
  { id: 'sim-p', name: 'Plank', mode: 'time', restSec: 60, last: '0:45, 0:45', sets: [prow(null, null, { sec: 30 }), prow(null, null, { sec: 30 })] },
  { id: 'sim-e', name: 'Cable Fly', mode: 'reps', restSec: 60, last: '12.5×12', step: 2.5, group: '2', sets: [prow(12.5, 12), prow(12.5, 12)] },
  { id: 'sim-f', name: 'Push-up', mode: 'reps', restSec: 60, last: null, bodyweight: true, step: 2.5, group: '2', sets: [prow(0, 15), prow(0, 15)] },
  { id: 'sim-g', name: 'Treadmill', mode: 'cardio', restSec: null, last: null, sets: [prow(null, null)] },
]
const phone = process.env.SIM_PHONE === '1' ? {
  ...out,
  settings: { ...out.settings, autoHolds: !!process.env.SIM_AUTOHOLD },
  ready: { today: { name: active.name, routineIds: ['sim-push'], entries: [] }, others: out.ready.others },
  active: { id: 'w-sim-phone', name: 'Push day', start: Date.now(), unit: 'kg', cur: 0, restSec: 90, rest: null, entries: phoneDay() },
} : null

// The long day goes through the phone's own cut (4 KB, no "last time" lines), as a real phone sends it.
const sent = phone ? garminSnapshot(phone) : long ? garminSnapshot(out) : out
if (long) console.error('long day: ' + JSON.stringify(sent).length + ' bytes, today ' + (sent.ready.today.entries.length) + ' exercises')

// The snapshot as a JSON resource, read like a phone message (a literal in code would weigh on
// the memory numbers as code the store build does not have).
mkdirSync(join(here, 'resources'), { recursive: true })
// (as the phone's bridge sends it: nulls left out, GarminMessages.toMonkey)
const strip = v => (Array.isArray(v) ? v.filter(x => x != null).map(strip)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, strip(x)])) : v)
writeFileSync(join(here, 'resources', 'snap.json'), JSON.stringify(phone ? strip(sent) : sent))
// (the phone's whole workout, for Sim.mc's phone; an empty one without SIM_PHONE)
writeFileSync(join(here, 'resources', 'phone.json'), JSON.stringify(phone ? strip({ ...phone.active, entries: phone.active.entries.map((e, i) => ({ ...e, i })) }) : {}))
writeFileSync(join(here, 'resources', 'sim.xml'), '<resources>\n    <jsonData id="simSnap" filename="snap.json"/>\n    <jsonData id="simPhone" filename="phone.json"/>\n</resources>\n')
writeFileSync(join(here, 'source', 'SimData.mc'), `// Generated by sim/gen.mjs. Do not edit.
import Toybox.Application;
import Toybox.WatchUi;
import Toybox.Lang;

(:sim)
module SimData {
    function snapshot() as Dictionary {
        // WatchUi's, as the app (Ui.mc): Application.loadResource came with Connect IQ 3.1 (D2 Charlie, Approach S62).
        return WatchUi.loadResource(Rez.JsonData.simSnap) as Dictionary;
    }
    //! SIM_PHONE=1: the phone's whole workout (Sim.mc plays that phone), else an empty one.
    function phone() as Dictionary {
        return WatchUi.loadResource(Rez.JsonData.simPhone) as Dictionary;
    }
    function playsPhone() as Boolean {
        return ${process.env.SIM_PHONE ? 'true' : 'false'};
    }
    //! SIM_NONE=1: a watch that has never heard from the phone (the "Not synced yet" screen).
    function none() as Boolean {
        return ${process.env.SIM_NONE ? 'true' : 'false'};
    }
    //! SIM_PAUSE=1: the phone pauses the watch's first rest (a protocol 2 snapshot's restPaused).
    function pause() as Boolean {
        return ${process.env.SIM_PAUSE ? 'true' : 'false'};
    }
}
`)
// The phone's side (SIM_PHONE): sim/phone.mc.in, else a stub that costs the app no memory.
writeFileSync(join(here, 'source', 'SimPhone.mc'), process.env.SIM_PHONE ? readFileSync(join(here, 'phone.mc.in'), 'utf8') : `// Generated by sim/gen.mjs (no SIM_PHONE). Do not edit.
import Toybox.Lang;

(:sim)
module SimPhone {
    function first(snap) {
        return snap;
    }
    function begin() as Void {
    }
    function turn() as Void {
    }
}
`)
console.log('sim/source/SimData.mc and sim/resources/snap.json written')
