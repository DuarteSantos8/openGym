import assert from 'node:assert/strict'
export const key = 'nutritionEntries'
const rec = (id, fields = {}, t = 10) => ({ id, schemaVersion: 1, ...fields, _ts: t,
  _f: Object.fromEntries(['schemaVersion', ...Object.keys(fields)].map(k => [k, t])) })
const doc = (rows, deleted) => ({ unit: 'kg', workouts: [], _ts: 100, [key]: rows, ...(deleted ? { deleted: { [key]: deleted } } : {}) })
const permutations = xs => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map(p => [x, ...p])) : [[]]
export function collectionCases(test, merge, visible) {
  const rows = s => s[key]
  const a = rec('a', { name: 'Apple', grams: 100 })
  test('add/add keeps both ids', () => assert.deepEqual(rows(merge(doc([a]), doc([rec('b')]))).map(x => x.id), ['a', 'b']))
  test('add/edit keeps independent records and the edit', () => {
    const b = rec('b'), changed = { ...a, grams: 150, _ts: 20, _f: { ...a._f, grams: 20 } }
    assert.deepEqual(rows(merge(doc([a, b]), doc([changed]))), [changed, b])
  })
  test('different-field edits both survive', () => {
    const x = { ...a, grams: 150, _ts: 20, _f: { ...a._f, grams: 20 } }
    const y = { ...a, name: 'Pear', _ts: 30, _f: { ...a._f, name: 30 } }
    assert.equal(rows(merge(doc([x]), doc([y])))[0].grams, 150)
    assert.equal(rows(merge(doc([x]), doc([y])))[0].name, 'Pear')
  })
  test('edit/delete retains merge evidence but hides a deleted record', () => {
    const out = merge(doc([{ ...a, grams: 150, _ts: 20, _f: { ...a._f, grams: 20 } }]), doc([a], { a: 30 }))
    assert.equal(rows(out)[0].grams, 150)
    assert.equal(out.deleted[key].a, 30)
    assert.deepEqual(visible(out, key), [])
  })
  test('delete/re-add uses the existing negative tombstone convention', () => {
    const out = merge(doc([a], { a: 30 }), doc([a], { a: -40 }))
    assert.deepEqual(visible(out, key), [a])
    assert.equal(out.deleted[key].a, -40)
  })
  test('deletion replay cannot resurrect an entry or remove a later re-add', () => {
    const gone = doc([a], { a: 30 }), live = doc([a], { a: -40 })
    assert.deepEqual(visible(merge(gone, doc([a])), key), [])
    assert.deepEqual(visible(merge(merge(gone, live), gone), key), [a])
  })
  test('same change replay is idempotent', () => {
    const out = merge(doc([a]), doc([rec('b')]))
    assert.deepEqual(merge(out, out)[key], out[key])
  })
  test('equal timestamps and id collisions resolve per field, independent of argument order', () => {
    const x = doc([rec('a', { name: 'A', grams: 500 }, 20)])
    const y = doc([rec('a', { name: 'Z', grams: 100 }, 20)])
    assert.deepEqual(rows(merge(x, y)), rows(merge(y, x)))
    assert.equal(rows(merge(x, y)).length, 1)
  })
  test('field deletion wins an equal-stamp tie and replay preserves it', () => {
    const x = doc([{ ...a, _ts: 20, _f: { ...a._f, name: 20 } }])
    const removed = { ...a, _ts: 20, _f: { ...a._f, name: 20 } }; delete removed.name
    const y = doc([removed])
    assert.equal('name' in rows(merge(x, y))[0], false)
    assert.deepEqual(rows(merge(x, y)), rows(merge(y, x)))
  })
  test('all three-device permutations and groupings converge, including edit/delete', () => {
    const devices = [doc([a], { a: 25 }), doc([{ ...a, grams: 200, _ts: 20, _f: { ...a._f, grams: 20 } }]),
      doc([{ ...a, name: 'Pear', _ts: 30, _f: { ...a._f, name: 30 } }], { a: -30 })]
    const want = merge(merge(devices[0], devices[1]), devices[2])
    for (const [x, y, z] of permutations(devices)) for (const out of [merge(merge(x, y), z), merge(x, merge(y, z))]) {
      assert.deepEqual(rows(out), rows(want))
      assert.deepEqual(out.deleted, want.deleted)
      assert.deepEqual(visible(out, key), visible(want, key))
    }
  })
  test('older record missing a field cannot erase a stamped newer field', () => {
    const older = rec('a', { name: 'Apple' }, 5)
    assert.equal(rows(merge(doc([older]), doc([a])))[0].grams, 100)
  })
  test('older backup replay respects deletion unless explicitly restored', () => {
    assert.deepEqual(visible(merge(doc([a], { a: 30 }), doc([a])), key), [])
    assert.deepEqual(visible(merge(doc([a], { a: 30 }), doc([a], { a: -40 })), key), [a])
  })
}

export function boundaryCases(test, merge, visible) {
  const a = rec('a', { name: 'Apple' })
  test('resetAt/resetIds hides only reset entries, without losing tombstone evidence', () => {
    const reset = { ...doc([]), resetAt: 40, resetIds: { [key]: ['a'] } }
    const out = merge(doc([a, rec('b', { name: 'Pear' })]), reset)
    assert.deepEqual(visible(out, key).map(x => x.id), ['b'])
    assert.equal(out.deleted[key].a, 40)
    assert.deepEqual(visible(merge(out, doc([a])), key).map(x => x.id), ['b'])
  })
  test('a legacy reset without resetIds suppresses older optional records', () => {
    const out = merge(doc([a]), { ...doc([]), resetAt: 40 })
    assert.deepEqual(visible(out, key), [])
  })
  test('invalid optional records are ignored safely', () => {
    const out = merge(doc([null, 7, 'text', [], {}, { id: '__proto__' }, a]), doc([]))
    assert.deepEqual(visible(out, key), [a])
  })
  test('deletion replay after a third-device merge remains hidden', () => {
    const gone = doc([a], { a: 40 }), edited = doc([rec('a', { name: 'Pear' }, 30)]), third = doc([rec('b')])
    const out = merge(merge(gone, edited), third)
    assert.deepEqual(visible(merge(out, doc([a])), key).map(x => x.id), ['b'])
  })
}

// Independent review regressions F2/F4. Realistic profile clocks cover all entry clocks.
export function reviewCases(test, sync, merge) {
  for (const key of ['nutritionEntries', 'activities', 'providerLinks']) {
    const row = id => ({ id, name: id, _ts: 10, _f: { name: 10 } })
    test(`F2 ${key}: same-epoch reset expansion hides learned ids and survives stale replay`, () => {
      const server = { workouts: [], _ts: 220, resetAt: 200, resetIds: { [key]: ['a'] },
        [key]: [row('a'), row('b'), { ...row('new'), _ts: 205, _f: { name: 205 } }], deleted: { [key]: { a: 200 } } }
      const device = { workouts: [], _ts: 230, resetAt: 200, resetIds: { [key]: ['a', 'b'] } }
      for (const [a, b] of [[server, device], [device, server]]) {
        const out = merge(a, b)
        assert.equal(out.deleted[key].b, 200)
        assert.deepEqual(sync.visibleOptionalEntries(out, key).map(x => x.id), ['new'])
        const replay = merge(out, { workouts: [], _ts: 20, [key]: [row('a'), row('b')] })
        assert.deepEqual(sync.visibleOptionalEntries(replay, key).map(x => x.id), ['new'])
        const readd = merge(out, { ...device, deleted: { [key]: { b: -240 } } })
        assert.deepEqual(sync.visibleOptionalEntries(readd, key).map(x => x.id), ['b', 'new'])
      }
    })
    test(`F2 ${key}: nonpreferred same-epoch reset cannot erase preferred records`, () => {
      const account = { workouts: [], _ts: 220, resetAt: 200, resetIds: { [key]: ['a'] }, [key]: [row('b')] }
      const guest = { workouts: [], _ts: 230, resetAt: 200, resetIds: { [key]: ['a', 'b'] } }
      for (const [a, b, prefer] of [[account, guest, 'a'], [guest, account, 'b']]) {
        const outputs = [sync.mergeOptionalCollections(a, b, {}, { prefer })]
        if (sync.mergeStates) outputs.push(sync.mergeStates(a, b, { prefer }))
        for (const out of outputs) assert.deepEqual(sync.visibleOptionalEntries(out, key).map(x => x.id), ['b'])
      }
    })
    test(`F4 ${key}: unchanged partial stamps survive replay and a third-device edit`, () => {
      const cur = { _ts: 400, [key]: [{ id: 'a', distanceM: 3, _ts: 286, _f: { distanceM: 286 } }] }
      const next = { _ts: 500, [key]: [{ id: 'a', distanceM: 3, note: 'x', _ts: 495, _f: { note: 495 } }] }
      const first = sync.stampOptionalCollections(cur, structuredClone(next), 501)
      const second = sync.stampOptionalCollections(first, structuredClone(next), 502)
      assert.equal(first[key][0]._f.distanceM, 286)
      assert.equal(second[key][0]._f.distanceM, 286)
      const third = [{ id: 'a', distanceM: 9, _ts: 300, _f: { distanceM: 300 } }]
      for (const state of [first, second]) assert.equal(sync.mergeOptionalEntries(state[key], third)[0].distanceM, 9)
    })
  }
}
