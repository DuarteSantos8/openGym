import { describe, it, expect } from 'vitest'
import {
  QR_PREFIX, QR_PRINT_MM, normalizeQr, newExerciseQr, isOpenGymQr, shortQrLabel, qrCodesFor,
  withExQr, withoutExQr, moveExQr, withoutExercise, exercisesForCode, othersWithCode, resolveScan,
  scanTargetRoutineId, exerciseQrPrintHTML,
} from './exercise-qr.js'

const set = done => ({ w: 50, r: 10, done })
const entry = (id, done = [false, false], extra = {}) => ({ id, sets: done.map(set), ...extra })

describe('codes', () => {
  it('trims what the scanner read and treats nothing as empty', () => {
    expect(normalizeQr('  ABC-1 \n')).toBe('ABC-1')
    expect(normalizeQr(null)).toBe('')
    expect(normalizeQr(undefined)).toBe('')
    expect(normalizeQr(42)).toBe('42')
  })

  it('makes a fresh code of its own every time, recognisable as ours', () => {
    const a = newExerciseQr(), b = newExerciseQr()
    expect(a.startsWith(QR_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
    expect(isOpenGymQr(a)).toBe(true)
    expect(isOpenGymQr('https://gym.example/machine/12')).toBe(false)
  })

  it('labels our own codes by their last characters and shortens long foreign ones', () => {
    expect(shortQrLabel(QR_PREFIX + 'lq2x9abcd')).toMatch(/ · ABCD$/)
    expect(shortQrLabel('M-12')).toBe('M-12')
    const long = 'x'.repeat(50)
    expect(shortQrLabel(long)).toHaveLength(31)
    expect(shortQrLabel(long).endsWith('…')).toBe(true)
  })
})

describe('the exercise → codes map', () => {
  it('adds a code once and leaves the given map alone', () => {
    const before = { a: ['one'] }
    const after = withExQr(withExQr(before, 'a', ' two '), 'a', 'two')
    expect(after).toEqual({ a: ['one', 'two'] })
    expect(before).toEqual({ a: ['one'] })
  })

  it('ignores an empty code and a missing map', () => {
    expect(withExQr(undefined, 'a', '   ')).toEqual({})
    expect(withExQr(null, 'a', 'x')).toEqual({ a: ['x'] })
    expect(qrCodesFor({ a: 'not a list' }, 'a')).toEqual([])
  })

  it('lets one code stand for several exercises', () => {
    let m = withExQr({}, 'cable-row', 'TOWER-3')
    m = withExQr(m, 'face-pull', 'TOWER-3')
    expect(exercisesForCode(m, 'TOWER-3')).toEqual(['cable-row', 'face-pull'])
    expect(exercisesForCode(m, ' TOWER-3 ')).toEqual(['cable-row', 'face-pull'])
    expect(exercisesForCode(m, 'nope')).toEqual([])
    expect(exercisesForCode(m, '')).toEqual([])
  })

  it('reads an alias id as the exercise it now stands for', () => {
    expect(exercisesForCode({ 1019: ['R'] }, 'R')).toEqual(['3841'])
    expect(exercisesForCode({ 1019: ['R'], 3841: ['R'] }, 'R')).toEqual(['3841'])
  })
})

describe('unassociating a code', () => {
  it('keeps a code shared with other exercises, and it still finds them', () => {
    const m = { a: ['SHARED', 'own'], b: ['SHARED'] }
    expect(othersWithCode(m, 'a', 'SHARED')).toEqual(['b'])
    const after = withoutExQr(m, 'a', 'SHARED')
    expect(after).toEqual({ a: ['own'], b: ['SHARED'] })
    expect(exercisesForCode(after, 'SHARED')).toEqual(['b'])
    expect(resolveScan({ entries: [entry('a')], cur: 0 }, after, 'SHARED')).toEqual({ kind: 'notInWorkout', exIds: ['b'] })
  })

  it('deletes a code nothing else holds: a scan of it no longer finds anything', () => {
    const m = { a: ['ONLY'] }
    expect(othersWithCode(m, 'a', 'ONLY')).toEqual([])
    const after = withoutExQr(m, 'a', 'ONLY')
    expect(after).toEqual({})
    expect(exercisesForCode(after, 'ONLY')).toEqual([])
    expect(resolveScan({ entries: [entry('a')], cur: 0 }, after, 'ONLY')).toEqual({ kind: 'unknown' })
  })

  it('does nothing for an exercise without the code', () => {
    expect(withoutExQr({ a: ['x'] }, 'b', 'x')).toEqual({ a: ['x'] })
    expect(withoutExQr({ a: ['x'] }, 'a', 'y')).toEqual({ a: ['x'] })
  })

  it('moves a code to one exercise alone', () => {
    const m = { a: ['T', 'own'], b: ['T'], c: ['other'] }
    expect(moveExQr(m, 'c', ' T ')).toEqual({ a: ['own'], c: ['other', 'T'] })
    expect(moveExQr(m, 'a', 'T')).toEqual({ a: ['T', 'own'], c: ['other'] })
    expect(moveExQr(m, 'a', '')).toEqual(m)
  })

  it('drops everything on a deleted exercise', () => {
    expect(withoutExercise({ a: ['x'], b: ['y'] }, 'a')).toEqual({ b: ['y'] })
  })
})

describe('resolveScan', () => {
  const map = { bench: ['B'], squat: ['S'], row: ['T'], pulldown: ['T'], curl: ['C'] }

  it('knows when no exercise has the code', () => {
    expect(resolveScan({ entries: [entry('bench')], cur: 0 }, map, 'X')).toEqual({ kind: 'unknown' })
    expect(resolveScan({ entries: [entry('bench')], cur: 0 }, {}, 'B')).toEqual({ kind: 'unknown' })
  })

  it('goes to the exercise of the session that has the code', () => {
    const active = { entries: [entry('bench'), entry('squat')], cur: 0 }
    expect(resolveScan(active, map, 'S')).toEqual({ kind: 'inWorkout', idx: 1, exId: 'squat' })
  })

  it('names the exercises the session does not hold', () => {
    const active = { entries: [entry('bench')], cur: 0 }
    expect(resolveScan(active, map, 'T')).toEqual({ kind: 'notInWorkout', exIds: ['row', 'pulldown'] })
  })

  it('prefers an exercise of the session over one it does not hold', () => {
    const active = { entries: [entry('bench'), entry('pulldown')], cur: 0 }
    expect(resolveScan(active, map, 'T')).toEqual({ kind: 'inWorkout', idx: 1, exId: 'pulldown' })
  })

  it('of the same exercise twice, takes the one with sets left, from the current one on', () => {
    const active = { entries: [entry('bench', [true, true]), entry('curl'), entry('bench', [true, false]), entry('bench')], cur: 1 }
    expect(resolveScan(active, map, 'B')).toEqual({ kind: 'inWorkout', idx: 2, exId: 'bench' })
    // Past the end it starts over at the top.
    const wrap = { entries: [entry('bench'), entry('curl'), entry('bench', [true, true])], cur: 2 }
    expect(resolveScan(wrap, map, 'B').idx).toBe(0)
  })

  it('goes to the first one from the current exercise when they are all done', () => {
    const active = { entries: [entry('bench', [true]), entry('curl'), entry('bench', [true])], cur: 1 }
    expect(resolveScan(active, map, 'B').idx).toBe(2)
  })

  it('finds a superset member like any other exercise', () => {
    const active = { entries: [entry('bench', [false], { sg: 'g1' }), entry('squat', [false], { sg: 'g1' })], cur: 0 }
    expect(resolveScan(active, map, 'S')).toEqual({ kind: 'inWorkout', idx: 1, exId: 'squat' })
  })

  it('copes with an empty session or a current index out of range', () => {
    expect(resolveScan({ entries: [], cur: 0 }, map, 'B')).toEqual({ kind: 'notInWorkout', exIds: ['bench'] })
    expect(resolveScan(null, map, 'B')).toEqual({ kind: 'notInWorkout', exIds: ['bench'] })
    expect(resolveScan({ entries: [entry('bench')], cur: 9 }, map, 'B').idx).toBe(0)
  })
})

describe('scanTargetRoutineId', () => {
  const routines = [{ id: 'r1' }, { id: 'r2' }]

  it('joins the routine of the current exercise', () => {
    const active = { routineIds: ['r1', 'r2'], entries: [entry('a', [false], { rid: 'r1' }), entry('b', [false], { rid: 'r2' })], cur: 1 }
    expect(scanTargetRoutineId(active, routines)).toBe('r2')
  })

  it('falls back to the first routine of the session that still exists', () => {
    expect(scanTargetRoutineId({ routineIds: ['gone', 'r2'], entries: [entry('a')], cur: 0 }, routines)).toBe('r2')
    expect(scanTargetRoutineId({ routineIds: ['r1'], entries: [entry('a', [false], { rid: 'gone' })], cur: 0 }, routines)).toBe('r1')
  })

  it('has none in a freestyle session', () => {
    expect(scanTargetRoutineId({ routineIds: [], entries: [entry('a')], cur: 0 }, routines)).toBeNull()
    expect(scanTargetRoutineId({ entries: [], cur: 0 }, [])).toBeNull()
  })
})

describe('exerciseQrPrintHTML', () => {
  const qr = 'data:image/png;base64,QUJD'
  const pic = 'data:image/jpeg;base64,REVG'

  it('prints the code at 3 × 3 cm beside the exercise’s name, picture, tags, description and steps', () => {
    const html = exerciseQrPrintHTML({
      name: 'Bench Press', qrDataUrl: qr, imageUrl: pic, description: 'Press the bar.',
      tags: ['Chest', 'Barbell'], steps: ['Lie down.', 'Press.'],
    })
    expect(QR_PRINT_MM).toBe(30)
    expect(html).toContain('width: 30mm; height: 30mm')
    expect(html).toContain(`<img src="${qr}"`)
    expect(html).toContain(`<img src="${pic}" alt="Bench Press">`)
    expect(html).toContain('<h1>Bench Press</h1>')
    expect(html).toContain('Chest · Barbell')
    expect(html).toContain('<p class="desc">Press the bar.</p>')
    expect(html).toContain('<li>Lie down.</li><li>Press.</li>')
    expect(html).toContain('size: A4')
  })

  it('escapes every text', () => {
    const html = exerciseQrPrintHTML({ name: '<b>x</b> & "y"', qrDataUrl: qr, description: '<script>1</script>', tags: ['<i>'], steps: ['a<b'] })
    expect(html).not.toContain('<b>x</b>')
    expect(html).not.toContain('<script>1')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
    expect(html).toContain('&lt;i&gt;')
    expect(html).toContain('<li>a&lt;b</li>')
  })

  it('leaves out what the exercise does not have', () => {
    const html = exerciseQrPrintHTML({ name: 'Mystery', qrDataUrl: qr })
    expect(html).not.toContain('class="pic"')
    expect(html).not.toContain('class="desc"')
    expect(html).not.toContain('<ol>')
    expect(html).not.toContain('class="tags"')
    expect(html).toContain('class="qr"')
  })

  it('takes a data: image as the code, and a data: image or web address as the picture', () => {
    const bad = exerciseQrPrintHTML({ name: 'x', qrDataUrl: 'https://cdn.example/qr.png', imageUrl: 'javascript:alert(1)' })
    expect(bad).not.toContain('javascript:')
    expect(bad).not.toContain('cdn.example')
    expect(bad).not.toContain('class="qr"')
    expect(bad).not.toContain('class="pic"')
    const web = exerciseQrPrintHTML({ name: 'x', qrDataUrl: qr, imageUrl: 'https://cdn.example/img/1.webp?a=1&b="2"' })
    expect(web).toContain('<img src="https://cdn.example/img/1.webp?a=1&amp;b=&quot;2&quot;"')
  })
})
