import { t } from '../../lib/i18n.js'
import { sourceSnapshot } from '../../lib/nutrition/food-source.js'
import { NUTRIENTS } from '../../lib/nutrition/entry.js'
import { formatNutrition } from '../../lib/nutrition/format.js'
import { nutrientLabels } from './DiarySummary.jsx'

export default function SourceSnapshot({ value }) {
  let p
  try { p = sourceSnapshot(value) } catch { return <p className="ss">{t('Source details could not be read. The saved entry is unchanged.')}</p> }
  const labels = nutrientLabels()
  return <section className="nutrition-source">
    <h3>{p.label}</h3>
    {(p.brand || p.quantityText) && <p className="ss">{[p.brand, p.quantityText].filter(Boolean).join(' · ')}</p>}
    <p><strong>{p.per100.basis === 'g' ? t('Per 100 g') : t('Per 100 mL')}</strong></p>
    <dl className="nutrition-source-values">{NUTRIENTS.map(k => <div key={k}><dt>{labels[k]}</dt><dd>{p.per100[k] === undefined ? t('Unknown') : formatNutrition(p.per100[k])}</dd></div>)}</dl>
    {p.per100.energyConversion && <p className="ss">{t('Energy converted from kJ using 4.184 kJ per kcal.')}</p>}
    <p className="ss">{t('Fetched: {0}', new Date(p.fetchedAt).toLocaleString())}</p>
    <p className="ss">{p.attribution.text} <a href={p.attribution.url} target="_blank" rel="noopener noreferrer">Open Food Facts</a>{' · '}<a href={p.attribution.licenseUrl} target="_blank" rel="noopener noreferrer">ODbL-1.0</a></p>
  </section>
}
