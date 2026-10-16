/* The starter plans the first-run onboarding offers (frontend lib/starter.js), for the API to build
 * into a profile from the choice alone: { templateId, weekdays, equipment }. The browser sends no
 * routines; the hub passes the choice on (sync-seed.js `starter`), and the routines are cut here.
 *
 * Free of I/O, like sync-seed.js. The plans are data copied from the frontend, because the API
 * image carries nothing of the frontend: its 1.1 MB exercise catalogue is what fits a plan to
 * the equipment (buildStarterPlan swaps an exercise the equipment rules out for its closest match),
 * so each plan is held already fitted, once per equipment choice the onboarding offers.
 * test/starter-plans-parity.test.js builds every plan from the frontend and compares, so a change
 * to the catalogue, a plan or the fitting fails there until this file is regenerated
 * (api/scripts/print-starter-plans.mjs prints it). */

// What the equipment choices stand for in lib/starter.js buildStarterPlan: a full gym (the plan as
// written), dumbbells only, or nothing (body weight).
export const STARTER_EQUIPMENT = ['gym', 'dumbbells', 'none'];

// A routine is [name, icon, [[exerciseId, sets, reps], …]], in session order: session i goes on
// weekdays[i]. `days` is how many sessions a week the plan can be run at: the two-day plan also
// serves a single day, with its first session.
export const STARTER_TEMPLATES = {
  'full-body-2': {
    days: [1, 2],
    routines: {
      gym: [
        ['2-Day Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 2, 12], ['0426', 2, 10], ['0031', 2, 12], ['0605', 2, 15]]],
        ['2-Day Full Body B', 'figureStrength', [['0085', 3, 8], ['0047', 3, 8], ['0027', 3, 10], ['0739', 3, 10], ['0334', 2, 12], ['0241', 2, 12], ['0585', 2, 12]]]
      ],
      dumbbells: [
        ['2-Day Full Body A', 'figureStrength', [['0413', 3, 8], ['0340', 3, 8], ['4425', 3, 10], ['6161', 2, 12], ['0426', 2, 10], ['0313', 2, 12], ['1178', 2, 15]]],
        ['2-Day Full Body B', 'figureStrength', [['1459', 3, 8], ['3452', 3, 8], ['0293', 3, 10], ['0411', 3, 10], ['0334', 2, 12], ['0373', 2, 12], ['0882', 2, 12]]]
      ],
      none: [
        ['2-Day Full Body A', 'figureStrength', [['0514', 3, 8], ['8618', 3, 8], ['3382', 3, 10], ['10534', 2, 12], ['4613', 2, 10], ['1770', 2, 12], ['3018', 2, 15]]],
        ['2-Day Full Body B', 'figureStrength', [['0614', 3, 8], ['5077', 3, 8], ['2300', 3, 10], ['1476', 3, 10], ['3741', 2, 12], ['2763', 2, 12], ['3533', 2, 12]]]
      ]
    }
  },
  'full-body': {
    days: [3],
    routines: {
      gym: [
        ['Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 3, 12], ['0334', 2, 12], ['0031', 2, 12]]],
        ['Full Body B', 'figureStrength', [['0085', 3, 8], ['0047', 3, 10], ['1323', 3, 10], ['0585', 3, 12], ['0334', 2, 12], ['0241', 2, 12]]],
        ['Full Body C', 'figureStrength', [['0739', 3, 10], ['0025', 2, 10], ['0027', 3, 10], ['0426', 2, 10], ['0586', 3, 12], ['0605', 3, 15]]]
      ],
      dumbbells: [
        ['Full Body A', 'figureStrength', [['0413', 3, 8], ['0340', 3, 8], ['4425', 3, 10], ['6161', 3, 12], ['0334', 2, 12], ['0313', 2, 12]]],
        ['Full Body B', 'figureStrength', [['1459', 3, 8], ['3452', 3, 10], ['0293', 3, 10], ['0882', 3, 12], ['0334', 2, 12], ['0373', 2, 12]]],
        ['Full Body C', 'figureStrength', [['0411', 3, 10], ['0340', 2, 10], ['0293', 3, 10], ['0426', 2, 10], ['6161', 3, 12], ['1178', 3, 15]]]
      ],
      none: [
        ['Full Body A', 'figureStrength', [['0514', 3, 8], ['8618', 3, 8], ['3382', 3, 10], ['10534', 3, 12], ['3741', 2, 12], ['1770', 2, 12]]],
        ['Full Body B', 'figureStrength', [['0614', 3, 8], ['5077', 3, 10], ['0499', 3, 10], ['3533', 3, 12], ['3741', 2, 12], ['2763', 2, 12]]],
        ['Full Body C', 'figureStrength', [['1476', 3, 10], ['8618', 2, 10], ['2300', 3, 10], ['4613', 2, 10], ['10534', 3, 12], ['3018', 3, 15]]]
      ]
    }
  },
  'upper-lower': {
    days: [4],
    routines: {
      gym: [
        ['Upper A', 'barbell', [['0025', 3, 8], ['2330', 3, 10], ['0047', 2, 10], ['1323', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
        ['Lower A', 'legs', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
        ['Upper B', 'barbell', [['0047', 3, 8], ['0027', 3, 8], ['0426', 2, 10], ['2330', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0313', 2, 12]]],
        ['Lower B', 'legs', [['0739', 3, 10], ['0085', 2, 10], ['0585', 2, 12], ['0586', 3, 12], ['0605', 3, 15]]]
      ],
      dumbbells: [
        ['Upper A', 'barbell', [['0340', 3, 8], ['4425', 3, 10], ['3452', 2, 10], ['0293', 2, 10], ['0334', 2, 12], ['0373', 2, 12], ['0313', 2, 12]]],
        ['Lower A', 'legs', [['0413', 3, 8], ['1459', 3, 8], ['0411', 2, 10], ['6161', 2, 12], ['1178', 3, 15]]],
        ['Upper B', 'barbell', [['3452', 3, 8], ['0293', 3, 8], ['0426', 2, 10], ['4425', 2, 10], ['0334', 2, 12], ['0373', 2, 12], ['0313', 2, 12]]],
        ['Lower B', 'legs', [['0411', 3, 10], ['1459', 2, 10], ['0882', 2, 12], ['6161', 3, 12], ['1178', 3, 15]]]
      ],
      none: [
        ['Upper A', 'barbell', [['8618', 3, 8], ['3382', 3, 10], ['5077', 2, 10], ['0499', 2, 10], ['3741', 2, 12], ['2763', 2, 12], ['1770', 2, 12]]],
        ['Lower A', 'legs', [['0514', 3, 8], ['0614', 3, 8], ['1476', 2, 10], ['10534', 2, 12], ['3018', 3, 15]]],
        ['Upper B', 'barbell', [['5077', 3, 8], ['2300', 3, 8], ['4613', 2, 10], ['3382', 2, 10], ['3741', 2, 12], ['2763', 2, 12], ['1770', 2, 12]]],
        ['Lower B', 'legs', [['1476', 3, 10], ['0614', 2, 10], ['3533', 2, 12], ['10534', 3, 12], ['3018', 3, 15]]]
      ]
    }
  },
  'upper-lower-ppl': {
    days: [5],
    routines: {
      gym: [
        ['Upper', 'barbell', [['0025', 3, 8], ['0027', 3, 8], ['0426', 3, 10], ['2330', 3, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
        ['Lower', 'legs', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
        ['Push', 'barbell', [['0047', 3, 8], ['0289', 3, 10], ['0405', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 2, 10]]],
        ['Pull', 'pullup', [['0198', 3, 10], ['0293', 3, 10], ['1323', 3, 10], ['5609', 3, 15], ['0313', 3, 12]]],
        ['Legs', 'legs', [['0739', 3, 10], ['1060', 3, 10], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
      ],
      dumbbells: [
        ['Upper', 'barbell', [['0340', 3, 8], ['0293', 3, 8], ['0426', 3, 10], ['4425', 3, 10], ['0334', 2, 12], ['0373', 2, 12], ['0313', 2, 12]]],
        ['Lower', 'legs', [['0413', 3, 8], ['1459', 3, 8], ['0411', 2, 10], ['6161', 2, 12], ['1178', 3, 15]]],
        ['Push', 'barbell', [['3452', 3, 8], ['0340', 3, 10], ['0405', 3, 10], ['0334', 3, 12], ['0373', 3, 12], ['0251', 2, 10]]],
        ['Pull', 'pullup', [['4425', 3, 10], ['0293', 3, 10], ['2327', 3, 10], ['5665', 3, 15], ['0313', 3, 12]]],
        ['Legs', 'legs', [['0411', 3, 10], ['4742', 3, 10], ['0882', 3, 12], ['6161', 3, 12], ['1178', 4, 15]]]
      ],
      none: [
        ['Upper', 'barbell', [['8618', 3, 8], ['2300', 3, 8], ['4613', 3, 10], ['3382', 3, 10], ['3741', 2, 12], ['2763', 2, 12], ['1770', 2, 12]]],
        ['Lower', 'legs', [['0514', 3, 8], ['0614', 3, 8], ['1476', 2, 10], ['10534', 2, 12], ['3018', 3, 15]]],
        ['Push', 'barbell', [['5077', 3, 8], ['8618', 3, 10], ['4613', 3, 10], ['3741', 3, 12], ['2763', 3, 12], ['0251', 2, 10]]],
        ['Pull', 'pullup', [['3537', 3, 10], ['2300', 3, 10], ['0499', 3, 10], ['7745', 3, 15], ['1770', 3, 12]]],
        ['Legs', 'legs', [['1476', 3, 10], ['4669', 3, 10], ['3533', 3, 12], ['10534', 3, 12], ['3018', 4, 15]]]
      ]
    }
  },
  'ppl-6': {
    days: [6],
    routines: {
      gym: [
        ['Push A', 'barbell', [['0025', 4, 8], ['0426', 3, 10], ['0314', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 2, 10]]],
        ['Pull A', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['5609', 3, 15], ['0031', 3, 10]]],
        ['Legs A', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
        ['Push B', 'barbell', [['0047', 4, 8], ['0405', 3, 10], ['0289', 3, 10], ['0178', 3, 15], ['0241', 3, 12]]],
        ['Pull B', 'pullup', [['1326', 3, 8], ['0293', 3, 10], ['0861', 3, 10], ['0313', 3, 12], ['0031', 2, 12]]],
        ['Legs B', 'legs', [['0032', 3, 5], ['1992', 3, 10], ['1060', 3, 10], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
      ],
      dumbbells: [
        ['Push A', 'barbell', [['0340', 4, 8], ['0426', 3, 10], ['3452', 3, 10], ['0334', 3, 12], ['0373', 3, 12], ['0251', 2, 10]]],
        ['Pull A', 'pullup', [['4425', 4, 10], ['0293', 4, 8], ['2327', 3, 10], ['5665', 3, 15], ['0313', 3, 10]]],
        ['Legs A', 'legs', [['0413', 4, 8], ['1459', 3, 10], ['0411', 3, 12], ['6161', 3, 12], ['1178', 4, 15]]],
        ['Push B', 'barbell', [['3452', 4, 8], ['0405', 3, 10], ['0340', 3, 10], ['0334', 3, 15], ['0373', 3, 12]]],
        ['Pull B', 'pullup', [['3537', 3, 8], ['0293', 3, 10], ['2327', 3, 10], ['0313', 3, 12], ['0294', 2, 12]]],
        ['Legs B', 'legs', [['0295', 3, 5], ['7566', 3, 10], ['4742', 3, 10], ['0882', 3, 12], ['6161', 3, 12], ['1178', 4, 15]]]
      ],
      none: [
        ['Push A', 'barbell', [['8618', 4, 8], ['4613', 3, 10], ['5077', 3, 10], ['3741', 3, 12], ['2763', 3, 12], ['0251', 2, 10]]],
        ['Pull A', 'pullup', [['3382', 4, 10], ['2300', 4, 8], ['0499', 3, 10], ['7745', 3, 15], ['1770', 3, 10]]],
        ['Legs A', 'legs', [['0514', 4, 8], ['0614', 3, 10], ['1476', 3, 12], ['10534', 3, 12], ['3018', 4, 15]]],
        ['Push B', 'barbell', [['5077', 4, 8], ['4613', 3, 10], ['8618', 3, 10], ['3741', 3, 15], ['2763', 3, 12]]],
        ['Pull B', 'pullup', [['3537', 3, 8], ['2300', 3, 10], ['0499', 3, 10], ['1770', 3, 12], ['1769', 2, 12]]],
        ['Legs B', 'legs', [['5881', 3, 5], ['0781', 3, 10], ['4669', 3, 10], ['3533', 3, 12], ['10534', 3, 12], ['3018', 4, 15]]]
      ]
    }
  }
};

/**
 * The plan a choice stands for, as the seed's `plan` ({ routines, schedule }), or null when the
 * choice is not one the onboarding offers. Session i is routine i, on weekdays[i] (0 = Sunday).
 * The caller has checked the shape; this only refuses a template that cannot run on that many
 * days, so a plan is never half-built.
 */
export function buildStarter({ templateId, weekdays, equipment }) {
  const template = Object.hasOwn(STARTER_TEMPLATES, templateId) ? STARTER_TEMPLATES[templateId] : null;
  if (!template || !STARTER_EQUIPMENT.includes(equipment)) return null;
  if (!template.days.includes(weekdays.length)) return null;
  const sessions = template.routines[equipment].slice(0, weekdays.length);
  return {
    routines: sessions.map(([name, emoji, list]) => ({ name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps })) })),
    schedule: weekdays.map((day, routine) => ({ day, routine }))
  };
}
