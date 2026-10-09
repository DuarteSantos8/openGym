import {POLICY_NAME} from '../lib/progression.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button } from './ui.jsx'
import { programmeWeekMode } from '../lib/programmes.js'

export const COLOUR_CSS = {
  lime: 'var(--green)', sky: 'var(--blue)', orange: 'var(--orange)', gold: 'var(--yellow)',
  violet: 'var(--purple)', pink: 'var(--pink)', teal: 'var(--teal)',
}
const modeLabel = mode => mode === 'deload' ? t('Deload') : mode === 'rest' ? t('Rest') : t('Normal')

export function ReadyProgrammeRow({ definition, onStart, onOpen }) {
  const sessions = (definition.weeks || []).reduce((total, week) => total + (week.days || []).reduce((sum, day) => sum + (day.sessions || []).length, 0), 0)
  return <div className="item programme-ready-row" data-testid="ready-programme-row">
    <button type="button" className="programme-ready-open" onClick={onOpen} aria-label={t('View programme') + ': ' + definition.name}>
      <span className="lrow-i" style={{ background: 'var(--surface-2)', color: COLOUR_CSS[definition.colour] || 'var(--acc)' }}><Icon name={glyphOf(definition.emoji)} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="tt">{definition.name}</span>
        <span className="ss">{t('{0} weeks', definition.lengthWeeks || definition.weeks?.length || 1)}{sessions ? ' · ' + t('{0} planned sessions', sessions) : ''} · {t('Progression: {0}', t(POLICY_NAME[definition.progression] || definition.progression))}</span>
      </span>
    </button>
    <Button size="xs" variant="tinted" icon="play" onClick={onStart}>{t('Start')}</Button>
    <Icon name="chevronRight" className="chev" />
  </div>
}

export function ProgrammeWeekStrip({ cycle, projection }) {
  const weeks = cycle.snapshot?.weeks || cycle.programmeSnapshot?.weeks || []
  const current = projection?.currentWeek || 1
  const colours = { done: 'var(--acc)', current: 'var(--acc)', deload: 'var(--orange)', rest: 'var(--red)', normal: 'var(--surface-3)' }
  return <div className="programme-week-strip" role="list" aria-label={t('Programme weeks')}
    style={{ display: 'flex', gap: 5, padding: '10px 0 0' }}>
    {Array.from({ length: cycle.lengthWeeks || weeks.length || 1 }, (_, index) => {
      const week = index + 1, mode = programmeWeekMode(weeks[index]?.mode)
      const progress = projection?.weekProgress?.[index]
      const done = progress?.total > 0 && progress.completed === progress.total
      const kind = done ? 'done' : week === current ? 'current' : mode
      const label = t('Week {0}: {1}', week, done ? t('Completed') : modeLabel(mode))
      return <span key={week} role="listitem" data-week-state={kind} aria-label={label} title={label}
        aria-current={week === current ? 'step' : undefined}
        style={{ flex: 1, minWidth: 0, height: 7, borderRadius: 4, background: colours[kind],
          opacity: kind === 'normal' && week > current ? .55 : 1,
          outline: week === current ? '2px solid color-mix(in srgb,var(--acc) 38%,transparent)' : undefined, outlineOffset: 1 }} />
    })}
  </div>
}

export function ActiveProgrammeCard({ cycle, projection, onOpen }) {
  const currentWeek = Math.max(1, projection?.currentWeek || 1)
  return <article className="card programme-card" data-testid="active-programme-card">
    <div className="row" style={{ alignItems: 'center', gap: 10 }}>
      <span className="lrow-i" style={{ background: 'var(--surface-2)', color: COLOUR_CSS[cycle.colour] || 'var(--acc)', fontSize: 22 }}><Icon name={glyphOf(cycle.emoji || cycle.snapshot?.emoji || 'dumbbell')} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="tt">{cycle.name}</span><span className="tag acc">{t('Active')}</span>
          <span className="tag">{t('Week {0} of {1}', currentWeek, cycle.lengthWeeks)}</span>
        </div>
        <div className="ss">{t('Progression: {0}', t(POLICY_NAME[cycle.progression] || cycle.progression))}</div>
      </div>
    </div>
    <ProgrammeWeekStrip cycle={cycle} projection={projection} />
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
      {onOpen && <Button size="sm" variant="tinted" trailingIcon="chevronRight" onClick={onOpen}>{t('View programme')}</Button>}
    </div>
  </article>
}
