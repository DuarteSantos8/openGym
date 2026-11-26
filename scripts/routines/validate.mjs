#!/usr/bin/env node
// Checks every routine in routines/ (CI runs it on every pull request that touches them):
//
//   node scripts/routines/validate.mjs
//
// One line per problem, "<file>: <what is wrong>", the same checks the submit service runs.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogue, loadAll } from './lib.mjs'
import { STARTER_PLANS } from '../../api/coach/core/starter-plans.js'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function validateRepo(root = ROOT) {
  const cat = loadCatalogue(path.join(root, 'catalogue'))
  const dir = path.join(root, 'routines')
  const library = loadAll(dir, { cat, starters: STARTER_PLANS })
  const learn = loadAll(dir, { cat, sources: ['learn'] })
  return { cat, routines: library.routines, learn: learn.routines, problems: [...library.problems, ...learn.problems] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { routines, learn, problems } = validateRepo()
  for (const p of problems) console.error(p)
  if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} in routines/. The format is in routines/README.md.`)
    process.exit(1)
  }
  console.log(`routines: ${routines.length} routines, ${learn.length} Learn sessions, all fine`)
}
