// The status pill on top of Settings → Apple Watch and → Wear OS watch: paired, openGym on the
// watch, in reach, every routine there (lib/watch-settings.js watchPill). One calm line when all
// is well; on trouble it turns orange and the page's next step shows under it. Not a button.
import { Fragment } from 'react'
import { t } from '../lib/i18n.js'
import { watchPill } from '../lib/watch-settings.js'
import { fmtAgo, routineCount } from '../lib/format.js'
import Icon from './Icon.jsx'

const WORDS = { connected: 'Connected', syncing: 'Syncing', away: 'Not in reach', setup: 'Not set up', update: 'Update watch app', checking: 'Checking…' }
// The three marks: paired, the app on the watch, the routines. Each badge has its own shape, not only a colour.
const MARKS = ['link', 'grid', 'list']
const BADGE = {
  ok: <path d="M5.5 12.8l4.2 4.2L18.5 7.6" />,
  warn: <path d="M12 6.4v7M12 17.6v.1" />,
  sync: <path d="M19 12a7 7 0 1 1-2.2-5.1M19.2 4.6v3.8h-3.8" />,
  idle: <path d="M6 12h.1M12 12h.1M18 12h.1" />,
}

// The watch: an Apple Watch is a rounded square, a Wear OS watch round. Its screen is lit when all
// is well, carries a "!" on trouble and a clock while it waits.
function Sign ({ tone, round }) {
  return <span className={'wpill-sign ' + tone} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="24" height="24">
      {round ? <circle cx="12" cy="12" r="5.8" /> : <rect x="6.6" y="6.4" width="10.8" height="11.2" rx="3" />}
      <path d={round ? 'M9.4 6.8l.5-3.4h4.2l.5 3.4M9.4 17.2l.5 3.4h4.2l.5-3.4' : 'M9 6.4l.6-3h4.8l.6 3M9 17.6l.6 3h4.8l.6-3'} />
      {tone === 'ok' ? (round ? <circle className="lit" cx="12" cy="12" r="3.6" /> : <rect className="lit" x="8.6" y="8.4" width="6.8" height="7.2" rx="1.5" />)
        : tone === 'warn' ? <path d="M12 9.5v2.6M12 14.3v.1" /> : <path d="M12 10.2V12l1.1.8" />}
    </svg>
  </span>
}

/**
 * `link`: the page's link state (watchLinkState's words), `routines`: routinesSync's answer,
 * `count`: the routines sent, `heardAt`: when the watch was last heard from, `todo`: the page's
 * next step, shown only on trouble, `round`: a Wear OS watch.
 */
export default function WatchPill ({ link, routines, count = 0, heardAt = 0, todo = '', round = false }) {
  const p = watchPill(link, routines)
  const detail = [
    routines === 'synced' && count ? routineCount(count) : '',
    (link === 'live' || link === 'away') && heardAt ? t('Last heard {0}', fmtAgo(heardAt)) : '',
  ].filter(Boolean)
  return <div className="wpill-w" data-watch-pill={p.word} aria-live="polite">
    <div className={'wpill ' + p.tone}>
      <Sign tone={p.tone} round={round} />
      <span className="wpill-tx"><b>{t(WORDS[p.word])}</b>{detail.length > 0 && <span>{detail.map((d, i) => <Fragment key={i}>{i ? ' · ' : ''}<i>{d}</i></Fragment>)}</span>}</span>
      <span className="wpill-marks" aria-hidden="true">
        {p.chips.map((k, i) => <span key={i} className={'wpill-m ' + k}>
          <Icon name={MARKS[i]} size={16} />
          <i><svg viewBox="0 0 24 24" width="8" height="8">{BADGE[k]}</svg></i>
        </span>)}
      </span>
    </div>
    {p.tone !== 'ok' && todo && <p className="wpill-todo">{todo}</p>}
  </div>
}
