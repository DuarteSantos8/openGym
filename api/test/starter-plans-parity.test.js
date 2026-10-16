/* api/starter-plans.js holds the onboarding's starter plans already cut for each equipment choice,
   because the API image has no exercise catalogue to cut them with. This builds every plan from the
   frontend, the way the browser does, and compares: a change to a plan, to the catalogue or to the
   fitting fails here until the copy is regenerated (node api/scripts/print-starter-plans.mjs). Same
   setup as coach-parity.test.js: the frontend modules load under plain node. The equipment choices
   are the frontend's own (lib/starter.js STARTER_EQUIPMENT_LISTS), imported, never copied. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStarterPlan, starterPlanOptions, STARTER_EQUIPMENT_LISTS } from '../../frontend/src/lib/starter.js';
import { STARTER_EQUIPMENT, STARTER_TEMPLATES, buildStarter } from '../starter-plans.js';

test('the equipment choices are the three the onboarding offers', () => {
  assert.deepEqual([...STARTER_EQUIPMENT].sort(), Object.keys(STARTER_EQUIPMENT_LISTS).sort());
});

test('every plan is the frontend plan, fitted to each equipment choice', () => {
  const regenerate = 'regenerate with: node api/scripts/print-starter-plans.mjs';
  for (const [id, template] of Object.entries(STARTER_TEMPLATES)) {
    for (const equipment of STARTER_EQUIPMENT) {
      const built = buildStarterPlan(id, STARTER_EQUIPMENT_LISTS[equipment]);
      assert.ok(built, `${id} is a frontend plan`);
      const frontend = built.routines.map(r => [r.name, r.emoji, r.ex.map(e => [e.id, e.sets, e.reps])]);
      assert.deepEqual(template.routines[equipment], frontend, `${id} for ${equipment}: ${regenerate}`);
    }
  }
});

test('the days a plan runs on are its sessions, and the two-day plan also serves one', () => {
  const frontend = Object.fromEntries(starterPlanOptions({ all: true }).map(({ id, days }) => [id, days]));
  for (const [id, template] of Object.entries(STARTER_TEMPLATES)) {
    assert.ok(template.days.includes(frontend[id]), `${id} runs on its ${frontend[id]} days`);
    assert.equal(Math.max(...template.days), frontend[id]);
  }
  assert.deepEqual(STARTER_TEMPLATES['full-body-2'].days, [1, 2]);
});

test('a choice is built as session i on weekdays[i], and only a choice the onboarding offers', () => {
  const plan = buildStarter({ templateId: 'upper-lower', weekdays: [6, 0, 2, 4], equipment: 'gym' });
  assert.deepEqual(plan.routines.map(r => r.name), ['Upper A', 'Lower A', 'Upper B', 'Lower B']);
  assert.deepEqual(plan.schedule, [{ day: 6, routine: 0 }, { day: 0, routine: 1 }, { day: 2, routine: 2 }, { day: 4, routine: 3 }]);
  assert.deepEqual(plan.routines[0].ex[0], { id: '0025', sets: 3, reps: 8 });

  const one = buildStarter({ templateId: 'full-body-2', weekdays: [3], equipment: 'none' });
  assert.deepEqual(one.routines.map(r => r.name), ['2-Day Full Body A']);
  assert.deepEqual(one.schedule, [{ day: 3, routine: 0 }]);

  assert.equal(buildStarter({ templateId: 'upper-lower', weekdays: [1, 2, 3], equipment: 'gym' }), null, 'too few weekdays');
  assert.equal(buildStarter({ templateId: 'bro-split', weekdays: [1], equipment: 'gym' }), null);
  assert.equal(buildStarter({ templateId: 'toString', weekdays: [1], equipment: 'gym' }), null, 'an inherited name is not a plan');
  assert.equal(buildStarter({ templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'cables' }), null);
});
