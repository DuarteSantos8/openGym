import { Row } from './ui.jsx'
import { durationSheet } from './DurationWheel.jsx'
import { fmtRest } from '../lib/duration.js'
import { t } from '../lib/i18n.js'

export default function IntervalSettings({ value, onChange }) {
  return <div className="list">{[
    ['work', 'Work time', 1], ['intervalRest', 'Rest between exercises', 0],
    ['roundRest', 'Rest after each round', 0], ['prep', 'Preparation before starting', 0],
  ].map(([key, title, min]) => <Row key={key} icon="timer" title={t(title)} value={fmtRest(value[key])} accessory="chevron"
    onClick={() => durationSheet({ title: t(title), value: value[key], min, max: 900, onDone: seconds => onChange({ ...value, [key]: seconds }) })} />)}</div>
}
export const intervalDefaults = (meta, seconds = 30) => ({ work: meta.work ?? (Number(seconds) > 0 ? Number(seconds) : 30), intervalRest: meta.intervalRest ?? 15, roundRest: meta.roundRest ?? (meta.rest > 0 ? meta.rest : meta.intervalRest ?? 15), prep: meta.prep ?? 10 })
