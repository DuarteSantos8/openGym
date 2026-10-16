import { t } from '../lib/i18n.js'
import { searchErrorText } from '../lib/nutrition/foods.js'
import { InlineNote } from './blocks.jsx'
import ResultRow from './search/ResultRow.jsx'
import { SkeletonRows } from './search/SourceStatus.jsx'
import { Button } from './ui.jsx'

// What stands in for Open Food Facts rows in a food picker while they are not rows (ui-search.md
// §7, §9), inside the source's card: skeleton rows while it searches, a quiet note when it is
// paused or offline, a note with Retry when it failed, and, only when a search has to be asked
// for (after a 429 pause, or below the auto-run threshold), the one row that asks. `online` is
// what useFoodSearch / useOnlineSearch return; `query` is the trimmed text. Nothing for the other
// statuses, which are rows or the caller's own line.
export default function OnlineStatus({ online, query }) {
  const { status } = online
  let body = null
  if (status === 'loading') body = <>
    <SkeletonRows />
    <span className="vh" role="status">{t('Searching Open Food Facts…')}</span>
  </>
  else if (status === 'tap') body = <ResultRow standalone onOpen={online.ask}
    r={{ type: 'action', key: 'online-ask', title: t('Search Open Food Facts for “{0}”', query), media: { kind: 'glyph', glyph: 'globe' } }} />
  else if (status === 'paused') body = <InlineNote icon="hourglass" className="sr-note" role="status">
    {t('{0} paused · back in', t('Open Food Facts'))} <b className="sr-count">{t('{0} s', online.seconds)}</b>
  </InlineNote>
  else if (status === 'offline') body = <InlineNote icon="cloudSlash" className="sr-note">{t('Online results come back when you reconnect')}</InlineNote>
  else if (status === 'error') body = <div className="sr-note-row">
    <InlineNote icon="warning" className="sr-note err" role="alert">{searchErrorText(online.error)}</InlineNote>
    <Button size="sm" variant="plain" onClick={online.ask}>{t('Retry')}</Button>
  </div>
  return body && <div className="sr-card">{body}</div>
}
