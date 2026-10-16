import { t } from '../../lib/i18n.js'
import { useSearch } from '../../lib/search/session.js'
import { cx } from '../../lib/ui-kit.js'
import Icon from '../Icon.jsx'
import { InlineNote, Skeleton } from '../blocks.jsx'
import OptionButton from './OptionButton.jsx'
import { rowId } from './ResultRow.jsx'

// A slow source's place while it is not rows (ui-search.md §9): two skeleton rows on the rows' own
// geometry, so nothing below moves when they land, or one quiet line saying why there are none.
export function SkeletonRows() {
  return <div className="sr-skel" aria-hidden="true">
    {[[58, 34], [46, 40]].map(([title, sub], i) => (
      <div key={i} className="sr-skel-row">
        <Skeleton w={48} h={48} r={8} />
        <span className="sr-skel-t"><Skeleton w={title + '%'} h={12} /><Skeleton w={sub + '%'} h={10} /></span>
        <Skeleton w={36} h={12} />
      </div>
    ))}
  </div>
}

// A line that only says something, as a disabled option of the listbox: the arrow keys still
// land on it and it is read out, and Enter does nothing.
function NoteOption({ id, children }) {
  const active = useSearch(s => s.active === id)
  return <div role="option" id={id} aria-selected={active} aria-disabled="true" data-search-row="" className={cx('sr-note-opt', active && 'sr-on')}>{children}</div>
}

/**
 * kind: 'paused' (`seconds` left: "Open Food Facts paused · back in 12 s"), 'error' (`onRetry`),
 * 'offline' (Online: back when you reconnect), 'offline-days' (Days: a connection the first time),
 * 'indexing' (Days still loading the first time, searchable over what landed). `place` names the
 * group it stands in, for its option's id. The error line is one option: activating it retries.
 */
export function SourceNote({ kind, seconds, onRetry, source, place = kind }) {
  const id = rowId('note:' + place)
  if (kind === 'paused') {
    return <NoteOption id={id}>
      <InlineNote icon="hourglass" className="sr-note">
        {t('{0} paused · back in', source)} <b className="sr-count">{t('{0} s', seconds)}</b>
      </InlineNote>
    </NoteOption>
  }
  if (kind === 'error') {
    return <OptionButton id={id} className="sr-note-row" onClick={onRetry} aria-label={[t('Couldn’t reach {0}', source), t('Retry')].join(', ')}>
      {/* InlineNote's markup in spans: a <p> cannot sit in a button. */}
      <span className="inote sr-note err"><Icon name="warning" /><span>{t('Couldn’t reach {0}', source)}</span></span>
      <span className="btn plain sm"><span>{t('Retry')}</span></span>
    </OptionButton>
  }
  if (kind === 'offline') return <NoteOption id={id}><InlineNote icon="cloudSlash" className="sr-note">{t('Online results come back when you reconnect')}</InlineNote></NoteOption>
  if (kind === 'offline-days') return <NoteOption id={id}><InlineNote icon="cloudSlash" className="sr-note">{t('Days need a connection the first time')}</InlineNote></NoteOption>
  if (kind === 'indexing') return <NoteOption id={id}><InlineNote icon="hourglass" className="sr-note">{t('Still indexing your diary')}</InlineNote></NoteOption>
  return null
}
