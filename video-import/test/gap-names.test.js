import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voteName, usableText, otherSide } from '../src/gap-names.js'

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

test('the other side of a move is spelled like the first', () => {
  assert.equal(otherSide("HALF CHILD'S POSE (right)"), "HALF CHILD'S POSE (left)")
  assert.equal(otherSide('Hip flexor (R)'), 'Hip flexor (L)')
  assert.equal(otherSide('Glute bridge (L)'), 'Glute bridge (R)')
  assert.equal(otherSide('Quad stretch right'), 'Quad stretch (left)')
})

test('usableText drops what is not a move name', () => {
  assert.equal(usableText(l('NEXT LATERAL RAISES')), 'LATERAL RAISES')
  assert.equal(usableText(l('SWITCH SIDES')), null)
  assert.equal(usableText(l('LINK BELOW')), null)
  assert.equal(usableText(l('THE COOL DOWN')), null)
  assert.equal(usableText(null), null)
})

test('a stretch of the move before is still the move before', () => {
  // recorded: J3Wv3Els3fk, the 60 s rests after "Bulgarian Split Squat" and "High Plank To Low Plank (Controlled)"
  assert.equal(voteName([l('SPLIT SQUAT'), l('SPLIT SQUAT'), l('SPLIT SQUAT')], { exclude: ['Bulgarian Split Squat'] }), null)
  assert.equal(voteName([l('TO LOW PLANK,'), l('TO LOW PLANK,')], { exclude: ['High Plank To Low Plank (Controlled)'] }), null)
  assert.equal(voteName([l('TABLE TOP ROW'), l('TABLE TOP ROW')], { exclude: ['Plank'] }).text, 'TABLE TOP ROW')
})

test('the move before is recognised when its words come back in another order', () => {
  assert.equal(voteName([l('EACH SPLIT SIDE) SQUAT... anes'), l('EACH SPLIT SIDE) SQUAT... anes')], { exclude: ['Bulgarian Split Squat (each side)'] }), null)
  // two moves that share two words are two moves
  assert.equal(voteName([l('SIDE PLANK DIPS'), l('SIDE PLANK DIPS')], { exclude: ['Side Plank Hold'] }).text, 'SIDE PLANK DIPS')
})
