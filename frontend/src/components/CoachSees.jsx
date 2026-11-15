// "What the Coach sees" (Coach menu, and the phone's Coach setup): the categories every answer is
// built from, the ones each person switches on or off (api/coach/core/categories.js
// OPTIONAL_CATEGORIES, stored in S.coach.share), and whether the Coach may search the web.
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { CATEGORY_TEXT, OPTIONAL_TEXT, emptyCoach } from '../lib/coach.js'
import { DATA_CATEGORIES, OPTIONAL_CATEGORIES, shareOf } from '../../../api/coach/core/categories.js'
import { HTTP_PROVIDERS } from '../../../api/coach/core/providers.js'
import { MOBILE } from '../lib/mobile.js'
import { Section, Row, Switch } from './ui.jsx'

/** Whether web research can be offered here, and if not, why not (null when it can). */
export function webBlocker(config, coachLocal) {
  if (MOBILE && coachLocal?.mode === 'byok') return HTTP_PROVIDERS[coachLocal.provider]?.web ? null : t('Your AI provider has no web search.')
  return config?.coach?.web ? null : t('Your server’s admin hasn’t switched this on.')
}

export function CoachSeesSection() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachLocal = useStore(s => s.coachLocal)
  const share = shareOf(S)
  const set = (id, on) => update(s => { s.coach = s.coach || emptyCoach(); s.coach.share = { ...(s.coach.share || {}), [id]: on } })
  const blocked = webBlocker(config, coachLocal)
  return <>
    <h3>{t('What the Coach sees')}</h3>
    <Section title={t('Always')} footer={t('The Coach needs these to plan anything at all.')}>
      {DATA_CATEGORIES.map(k => {
        const [title, sub] = CATEGORY_TEXT[k]?.() || [k, '']
        return <Row key={k} icon="check" iconTint="var(--acc)" title={title} subtitle={sub} />
      })}
    </Section>
    <Section title={t('You decide')} footer={t('Switched off, it is left out of every request from now on.')}>
      {OPTIONAL_CATEGORIES.map(c => {
        const [title, sub] = OPTIONAL_TEXT[c.id]?.() || [c.id, '']
        return <div key={c.id} className="row between" style={{ gap: 12, padding: '10px 12px', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{title}</div><div className="muted small">{sub}</div></div>
          <Switch checked={share[c.id]} onChange={v => set(c.id, v)} aria-label={title} />
        </div>
      })}
    </Section>
    <Section title={t('Web research')} footer={blocked || t('Your provider may charge a little per search. The pages it read are linked under its answer.')}>
      <div className="row between" style={{ gap: 12, padding: '10px 12px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{t('Search the web')}</div><div className="muted small">{t('For questions that need facts from outside your training, like a study or a product.')}</div></div>
        <Switch checked={S.coach?.web === true && !blocked} disabled={!!blocked} onChange={v => update(s => { s.coach = s.coach || emptyCoach(); s.coach.web = !!v })} aria-label={t('Search the web')} />
      </div>
    </Section>
  </>
}

/** The switchable categories as rows, for the consent screen. */
export function OptionalRows() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const share = shareOf(S)
  const set = (id, on) => update(s => { s.coach = s.coach || emptyCoach(); s.coach.share = { ...(s.coach.share || {}), [id]: on } })
  return OPTIONAL_CATEGORIES.map(c => {
    const [title, sub] = OPTIONAL_TEXT[c.id]?.() || [c.id, '']
    return <div key={c.id} className="ob-consent-opt">
      <Switch checked={share[c.id]} onChange={v => set(c.id, v)} aria-label={title} />
      <div><b>{title}</b><span>{sub}</span></div>
    </div>
  })
}
