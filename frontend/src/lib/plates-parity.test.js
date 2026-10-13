// The standard plate sets must load exactly as they did before plates of any weight existed
// (flexible-plate-sizes): every weight from 0 to 150 per side in quarter steps, against the
// quarter-unit plateStack it replaced, on the default sets and on a sparse home inventory.
import { describe, expect, test } from 'vitest'
import { plateStack, PLATE_SIZES, inventoryFor } from './plates.js'

function quarterStack(weight, inv) {
  const Q = 4, q = w => Math.round(w * Q)
  const requested = Math.max(0, Number(weight) || 0)
  const target = Math.floor(requested * Q)
  if (target === 0) return { plates: [], missing: requested }
  const items = (inv || []).filter(p => p.w > 0 && p.n > 0).sort((a, b) => b.w - a.w)
  const greedy = []
  let left = target
  for (const p of items) { const u = q(p.w); let k = Math.min(p.n, Math.floor(left / u)); while (k-- > 0) { greedy.push(p.w); left -= u } }
  const all = items.reduce((s, p) => s + q(p.w) * p.n, 0)
  if (left === 0 || target >= all) return { plates: greedy, missing: requested - (target - left) / Q }
  const n = items.length, INF = 1e9
  const f = Array.from({ length: n + 1 }, () => new Int32Array(target + 1).fill(INF))
  f[n][0] = 0
  for (let i = n - 1; i >= 0; i--) {
    const u = q(items[i].w), cap = items[i].n
    for (let s = 0; s <= target; s++) {
      let best = f[i + 1][s]
      for (let k = 1; k <= cap && k * u <= s; k++) { const v = f[i + 1][s - k * u]; if (v + k < best) best = v + k }
      f[i][s] = best
    }
  }
  let sum = target
  while (sum > 0 && f[0][sum] >= INF) sum--
  const plates = []
  let s = sum
  for (let i = 0; i < n; i++) {
    const u = q(items[i].w), cap = items[i].n
    for (let k = Math.min(cap, Math.floor(s / u)); k >= 0; k--) {
      if (f[i + 1][s - k * u] + k === f[i][s]) { for (let j = 0; j < k; j++) plates.push(items[i].w); s -= k * u; break }
    }
  }
  return { plates, missing: requested - sum / Q }
}

describe('standard plates load as before', () => {
  const sets = {
    'default kg': inventoryFor({ unit: 'kg' }),
    'default lb': inventoryFor({ unit: 'lb' }),
    'every kg size, one pair': PLATE_SIZES.kg.map(w => ({ w, n: 1 })),
    'every lb size, one pair': PLATE_SIZES.lb.map(w => ({ w, n: 1 })),
    'lb rack, ten pairs': [45, 35, 25, 15, 10, 5, 2.5, 1.25].map(w => ({ w, n: 10 })),
    'home gym': [{ w: 20, n: 1 }, { w: 10, n: 2 }, { w: 2.5, n: 1 }, { w: 1.25, n: 2 }],
  }
  for (const [name, inv] of Object.entries(sets)) {
    test(name, () => {
      for (let i = 0; i <= 2000; i++) {
        const w = i / 4
        expect(plateStack(w, inv), `${name} @ ${w}`).toEqual(quarterStack(w, inv))
      }
    })
  }
})
