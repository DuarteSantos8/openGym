import { test } from 'node:test'
import * as sync from '../sync-stamps.js'
import { collectionCases } from '../../frontend/src/lib/__fixtures__/contracts/merge-cases.mjs'
collectionCases(test, (a, b) => sync.stampPut(a, structuredClone(b), { stamped: true, now: 100 }),
  (s, k) => sync.visibleOptionalEntries(s, k))
