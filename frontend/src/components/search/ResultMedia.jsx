import { dateLocale } from '../../lib/i18n.js'
import Icon from '../Icon.jsx'
import { Thumb } from '../Media.jsx'

// A result row's 48px media slot, one shape for every type (ui-search.md §7): a neutral glyph
// plate, the exercise's licensed thumbnail, a food's photo, or a date block (weekday over day).
export default function ResultMedia({ media, size }) {
  const cls = 'sr-media' + (size === 'lg' ? ' lg' : '')
  if (media?.kind === 'thumb') return <span className={cls + ' thumb'} aria-hidden="true"><Thumb ex={media.ex} /></span>
  if (media?.kind === 'photo') return <span className={cls + ' photo'} aria-hidden="true"><img src={media.src} alt="" loading="lazy" /></span>
  if (media?.kind === 'date' && media.iso) {
    const d = new Date(media.iso + 'T12:00:00')
    return <span className={cls + ' date'} aria-hidden="true">
      <span className="sr-wd">{d.toLocaleDateString(dateLocale(), { weekday: 'short' })}</span>
      <span className="sr-dn">{d.getDate()}</span>
    </span>
  }
  return <span className={cls} aria-hidden="true"><Icon name={media?.glyph || 'magnifier'} /></span>
}
