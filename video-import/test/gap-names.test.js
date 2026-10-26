import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voteName } from '../src/gap-names.js'

const l = (text, conf = 80) => ({ text, conf })

test('the caption most of the moments show is the name, spelling slips and all', () => {
  const r = voteName([l('ACTIVE HAMSTRING STRETCH'), null, l('ACTIVE HAMSTRING STRETCH'), l('ACTIVE HAMSTRING STRETC'), l('NEXT')])
  assert.equal(r.text, 'ACTIVE HAMSTRING STRETCH')
  assert.equal(r.votes, 3)
})

test('a caption seen once is noise: no name is better than a wrong one', () => {
  assert.equal(voteName([l('GLUTE BRIDGE'), null, null, l('SNOW ANGELS'), null]), null)
})

test('two captions with the same number of votes are not a name', () => {
  assert.equal(voteName([l('GLUTE BRIDGE'), l('GLUTE BRIDGE'), l('SNOW ANGELS'), l('SNOW ANGELS')]), null)
})

test('the move before, still on screen, and a section title are not the name', () => {
  const lines = [l('PLANK JACKS'), l('PLANK JACKS'), l('THE COOL DOWN'), l('THE COOL DOWN'), l('THE COOL DOWN')]
  assert.equal(voteName(lines, { exclude: ['Plank Jacks'] }), null)
})

test('the NEXT label in front of a caption is not part of it', () => {
  assert.equal(voteName([l('NEXT SNOW ANGELS'), l('NEXT SNOW ANGELS')]).text, 'SNOW ANGELS')
})

test('the move before is recognised through OCR noise and a note after its name', () => {
  // recorded: J3Wv3Els3fk, a 60 s rest after "High Plank To Low Plank (Controlled)"
  const lines = [l('HIGHIPLANK TO LOW PLANK,', 82), l('HIGHIPLANK TO LOW PLANK,', 82), l('HIGHIPLANK TO LOW PLANK,', 82)]
  assert.equal(voteName(lines, { exclude: ['High Plank To Low Plank (Controlled)'] }), null)
})
