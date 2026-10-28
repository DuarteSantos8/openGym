// Writes the synthetic fixtures (test/fixtures/synthetic-*.json) from test/synthetic.mjs, so the
// harness has something to run before any real video is recorded and keeps a few known shapes
// in the set. Re-run after changing synthetic.mjs:  node test/harness/make-synthetic.mjs

import fs from 'node:fs'
import path from 'node:path'
import { framesOf, hiitScript } from '../synthetic.mjs'
import { DIR } from './fixtures.js'

const label = name => (name == null ? null : /^rest$/i.test(name) ? 'rest' : name)
// Timeline steps given by hand (`timeline`) where the caption is not the label: a NEXT screen.
const timeline = script => script.map(([n, s]) => [label(n), s])
  .reduce((out, x) => { const l = out[out.length - 1]; if (l && l[0] === x[0] && x[0] === 'rest') l[1] += x[1]; else out.push(x); return out }, [])

const NT = { noTimer: true }
const rounds = (n, steps) => Array.from({ length: n }, () => steps).flat()

const cases = {
  'synthetic-hiit-countdown': {
    notes: 'Synthetic: warm-up of three moves with no rest between, 3 rounds × 4 at 40/20, a stretch. Countdown timer, two misread frames.',
    script: hiitScript(), opts: { noise: { 70: { name: 'ARN CIRCLES' }, 200: { name: '' } } },
    sections: [{ kind: 'warmup' }, { kind: 'interval', rounds: 3, work: 40, rest: 20 }, { kind: 'stretch' }]
  },
  'synthetic-hiit-countup': {
    notes: 'Synthetic: the same workout with a timer that counts up.',
    script: hiitScript(), opts: { timer: 'up' },
    sections: [{ kind: 'warmup' }, { kind: 'interval', rounds: 3, work: 40, rest: 20 }, { kind: 'stretch' }]
  },
  'synthetic-tabata': {
    notes: 'Synthetic: Tabata, two moves alternating 20/10 for four rounds each. Work shorter than any calibrated video.',
    script: rounds(4, [['SQUAT JUMPS', 20], ['REST', 10], ['PUSH UPS', 20], ['REST', 10]]),
    sections: [{ kind: 'interval', rounds: 4, work: 20, rest: 10 }]
  },
  'synthetic-next-screens': {
    notes: 'Synthetic: names only on the NEXT screen during each 20 s rest, nothing on screen during the 40 s work (the B7-F2UcHmqk layout).',
    script: rounds(2, ['GOBLET SQUAT', 'SUMO DEADLIFT', 'CALF RAISES'].flatMap(e => [[`NEXT: ${e}`, 20], ['', 40]])),
    timeline: rounds(2, ['GOBLET SQUAT', 'SUMO DEADLIFT', 'CALF RAISES'].flatMap(e => [['rest', 20], [e, 40]])),
    sections: [{ kind: 'interval', rounds: 2, work: 40, rest: 20 }]
  },
  'synthetic-nonstop': {
    notes: 'Synthetic: ten different 45 s moves back to back, no rests at all (an all-standing nonstop cardio).',
    script: ['MARCH', 'BUTT KICKS', 'SKATERS', 'SQUAT PULSES', 'PUNCHES', 'HIGH KNEES', 'SIDE STEPS', 'FRONT KICKS', 'JACKS', 'TOE TAPS'].map(e => [e, 45])
  },
  'synthetic-30-30-bare-rest': {
    notes: 'Synthetic: 30/30 no repeat, the name on screen during the work, the rest a bare countdown.',
    script: ['SQUATS', 'PUSH UPS', 'LUNGES', 'PLANK', 'GLUTE BRIDGE', 'SUPERMAN'].flatMap(e => [[e, 30], ['', 30]]).slice(0, -1),
    timeline: ['SQUATS', 'PUSH UPS', 'LUNGES', 'PLANK', 'GLUTE BRIDGE', 'SUPERMAN'].flatMap(e => [[e, 30], ['rest', 30]]).slice(0, -1),
    sections: [{ kind: 'interval', rounds: 1, work: 30, rest: 30 }]
  },
  'synthetic-30-30-named-rest': {
    notes: 'Synthetic: 30/30 the other way round (the _G5wIxplwB8 layout): the name over the rest before each move, the work a bare countdown.',
    script: ['SQUATS', 'PUSH UPS', 'LUNGES', 'PLANK', 'GLUTE BRIDGE', 'SUPERMAN'].flatMap(e => [[e, 30], ['', 30]]),
    timeline: ['SQUATS', 'PUSH UPS', 'LUNGES', 'PLANK', 'GLUTE BRIDGE', 'SUPERMAN'].flatMap(e => [['rest', 30], [e, 30]])
  },
  'synthetic-sides': {
    notes: 'Synthetic: per-side moves marked (R)/(L), 30 s a side, 15 s rests between moves.',
    script: [['SIDE PLANK (R)', 30], ['SIDE PLANK (L)', 30], ['REST', 15], ['CLAMSHELL (R)', 30], ['CLAMSHELL (L)', 30], ['REST', 15], ['GLUTE BRIDGE', 30], ['REST', 15], ['BIRD DOG (R)', 30], ['BIRD DOG (L)', 30]]
  },
  'synthetic-captions-only': {
    notes: 'Synthetic: no timer anywhere, captions only, REST screens between moves, two OCR slips.',
    script: rounds(2, [['BURPEES', 40, NT], ['REST', 20, NT], ['MOUNTAIN CLIMBERS', 40, NT], ['REST', 20, NT], ['PLANK', 40, NT], ['REST', 20, NT]]).slice(0, -1),
    opts: { noise: { 15: { name: 'BURPFES' }, 250: { name: '' } } },
    sections: [{ kind: 'interval', rounds: 2, work: 40, rest: 20 }]
  }
}

for (const [id, c] of Object.entries(cases)) {
  const frames = framesOf(c.script, c.opts)
  const f = {
    version: 1,
    source: { videoId: null, title: id, channel: 'synthetic', duration: frames.length },
    capture: { engine: 'synthetic', date: null },
    inputs: { hints: [], parts: [] },
    expected: { reviewed: true, timeline: c.timeline || timeline(c.script), sections: c.sections },
    notes: c.notes,
    frames
  }
  // One frame and one timeline step per line: readable diffs when a fixture is re-recorded.
  const { frames: fr, expected, ...head } = f
  const text = JSON.stringify({ ...head, expected: { ...expected, timeline: '@T' }, frames: '@F' }, null, 2)
    .replace('"@T"', '[\n' + expected.timeline.map(x => '      ' + JSON.stringify(x)).join(',\n') + '\n    ]')
    .replace('"@F"', '[\n' + fr.map(x => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]')
  fs.writeFileSync(path.join(DIR, `${id}.json`), text + '\n')
  console.log('wrote', id)
}
