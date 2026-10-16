#!/usr/bin/env node
/* Prints the `routines` of every plan in api/starter-plans.js as the frontend builds them today
 * (lib/starter.js buildStarterPlan, fitted to each equipment choice). Paste the output over the
 * matching entries when test/starter-plans-parity.test.js says the copy has drifted. The `days`
 * of each plan are not printed: they are a decision, not a derivation.
 *
 *   node api/scripts/print-starter-plans.mjs
 */
import { buildStarterPlan, STARTER_EQUIPMENT_LISTS } from '../../frontend/src/lib/starter.js';
import { STARTER_TEMPLATES } from '../starter-plans.js';

for (const id of Object.keys(STARTER_TEMPLATES)) {
  console.log(`  '${id}': {`);
  for (const [equipment, list] of Object.entries(STARTER_EQUIPMENT_LISTS)) {
    console.log(`    ${equipment}: [`);
    for (const r of buildStarterPlan(id, list).routines) {
      const ex = r.ex.map(e => `['${e.id}', ${e.sets}, ${e.reps}]`).join(', ');
      console.log(`      ['${r.name}', '${r.emoji}', [${ex}]],`);
    }
    console.log('    ],');
  }
  console.log('  },');
}
