import { useLocation, useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { Page } from '../components/layout.jsx'
import { TabSection } from '../components/tab-kit.jsx'
import { Segmented } from '../components/ui.jsx'
import BodyWeight from '../components/BodyWeight.jsx'
import Measurements from './Measurements.jsx'
import ProgressPhotos from './ProgressPhotos.jsx'

// The segments and the address each keeps (ux-redesign-tabs §5 item 3): the routes the three
// pages had, so a link to measurements or photos still lands on them.
const SEGMENTS = [
  { value: 'weight', path: '/progress/body', label: () => t('Weight') },
  { value: 'measurements', path: '/progress/body/measurements', label: () => t('Measurements') },
  { value: 'photos', path: '/progress/body/photos', label: () => t('Photos') },
]

// Progress › Body (ux-redesign-tabs §4.3, ui-redesign-components §4): one page, three segments,
// each with its own action row. A segment is switched in place (replace), so back always goes to
// Progress whichever segment it ends on; the query (?range=) rides along.
export default function Body({ segment = 'weight' }) {
  const nav = useNavigate()
  const { search } = useLocation()
  const go = value => nav(SEGMENTS.find(s => s.value === value).path + search, { replace: true })
  return <Page title={t('Body')}>
    <TabSection>
      <Segmented tone="strong" size="lg" ariaLabel={t('Body')} value={segment} onChange={go}
        options={SEGMENTS.map(s => ({ value: s.value, label: s.label() }))} />
    </TabSection>
    {segment === 'measurements' ? <Measurements /> : segment === 'photos' ? <ProgressPhotos /> : <BodyWeight />}
  </Page>
}
