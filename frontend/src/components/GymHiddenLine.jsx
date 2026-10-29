import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// A search filtered by an equipment profile says how many matches the profile hid, so an
// exercise you know exists doesn't just look missing, and one tap shows all equipment.
// `count` is how many the search found that the profile leaves out; nothing shows at 0.
export default function GymHiddenLine({ count, profile, onShowAll }) {
  if (!(count > 0) || !profile) return null
  return <div className="small dim row" style={{ margin: '10px 4px', gap: 6, alignItems: 'center' }}>
    <span>{t('Not in "{0}": {1} more', profile.name, fmtNum(count))}</span>
    <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={onShowAll}>
      {t('Show all equipment')}
    </button>
  </div>
}
