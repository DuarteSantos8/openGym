#!/usr/bin/env node

import { createHash } from 'node:crypto'
import pt from '../src/locales/pt.js'
import { PT_BR_OVERRIDES } from '../src/locales/pt-BR.js'

const inherited = Object.entries(pt)
  .filter(([key]) => !(key in PT_BR_OVERRIDES))
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const fingerprint = createHash('sha256').update(JSON.stringify(inherited)).digest('hex')

console.log(JSON.stringify({
  overrides: Object.keys(PT_BR_OVERRIDES).length,
  inherited: inherited.length,
  fingerprint,
  ...(process.argv.includes('--list') ? { entries: inherited } : {})
}, null, 2))
