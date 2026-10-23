import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActiveProgrammeCard, ReadyProgrammeRow } from './ProgrammeCard.jsx'

const definition = { id: 'p1', name: 'Strength block', colour: 'sky', progression: 'linear', lengthWeeks: 2, weeks: [
  { mode: 'deload', days: [{ weekday: 1, sessions: [{ id: 'a', routineSnapshot: { name: 'Push' } }, { id: 'b', routineSnapshot: { name: 'Pull' } }] }] },
  { mode: 'rest', days: [] },
] }
const cycle = { id: 'c1', programmeId: 'p1', name: 'Strength block', colour: 'sky', progression: 'linear', status: 'active', lengthWeeks: 2,
  snapshot: { weeks: definition.weeks } }
const due = { cycleId: 'c1', instanceId: 'c1:s1', weekIndex: 2, status: 'due', routineSnapshot: { name: 'Push' } }

describe('Programme lifecycle cards', () => {
  it('shows reusable definition details and actions', () => {
    const html = renderToStaticMarkup(<ReadyProgrammeRow definition={definition} />)
    for (const text of ['Strength block', '2 weeks', 'Progression: Linear', '2 planned sessions', 'Start']) expect(html).toContain(text)
    expect(html).toContain('aria-label="View programme: Strength block"')
  })

  it('keeps the overview compact with status, week and detail actions', () => {
    const html = renderToStaticMarkup(<ActiveProgrammeCard cycle={cycle} projection={{ currentWeek: 2, items: [due] }} onOpen={() => {}} />)
    for (const text of ['Week 2 of 2', 'Active', 'View programme']) expect(html).toContain(text)
    expect(html).not.toContain('Complete early')
    expect(html).not.toContain('Today')
    expect(html).not.toContain('>Edit<')
  })

  it('renders unknown colours neutrally without rewriting or exposing them as styles', () => {
    const html = renderToStaticMarkup(<ReadyProgrammeRow definition={{ ...definition, colour: 'future-colour' }} />)
    expect(html).not.toContain('data-programme-colour')
    expect(html).not.toContain('future-colour')
  })
})

it('renders one progress chunk per week with completed, current, deload and rest states',()=>{
 const c={...cycle,lengthWeeks:4,snapshot:{weeks:[{}, {}, {mode:'deload'}, {mode:'rest'}]}};
 const html=renderToStaticMarkup(<ActiveProgrammeCard cycle={c} projection={{currentWeek:2,items:[],weekProgress:[{total:2,completed:2},{total:1,completed:0}]}}/>);
 expect(html).toContain('programme-week-strip');
 for(const state of ['done','current','deload','rest'])expect(html).toContain('data-week-state="'+state+'"');
 expect(html).toContain('aria-current="step"');
});
