import { queueView } from '../lib/queue.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Home's progress row for a coach week (S.queue) — it stands in for the seven weekday dots
// while a planner-written queue runs the week, because its sessions have no weekday: they are done in
// order, on whatever days you train. One chip per session in slot order; the next undone one
// is lit, and any undone chip starts its own routine, in whatever order the day calls for. A
// done chip is inert: that session is logged. Reads through queueView so the words here and
// the today row (effectiveRoutineIds → queueNext) can never disagree about which is next.
export default function QueueRow({ S, today, onStart }) {
  const v = queueView(S, today)
  if (!v) return null
  const word = { done: t('Done'), next: t('Up next'), later: t('Later') }
  const next = v.items.find(i => i.state === 'next')
  // "today" only when the today row really offers it: a 'rest' or routine override for today
  // wins over the queue there (effectiveRoutineIds), and this line must not contradict it.
  const shownToday = !!next && effectiveRoutineIds(S, today, today).includes(next.id)
  const status = v.complete ? t('Week complete, ask the coach')
    : v.waiting ? t('Next week starts {0}', fmtDate(v.startsOn, true))
    : shownToday ? t('Next: {0}, today', next.name) : t('Next: {0}', next.name)
  return <div className="queue">
    <div className="row between" style={{ marginBottom: 8 }}>
      <div className="small muted" style={{ fontWeight: 500 }}>{v.label}</div>
      <div className="small muted">{v.items.length - v.remaining.length} / {v.items.length}</div>
    </div>
    {/* three chips do not fit one phone row and .chips hides its scrollbar — wrap instead */}
    <div className="chips" style={{ flexWrap: 'wrap' }}>
      {v.items.map((i, n) => <button key={n} className={'chip' + (i.state === 'next' ? ' on' : '')}
        disabled={i.state === 'done'} onClick={() => onStart(i.id)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: i.state === 'done' ? 0.55 : undefined }}>
        {i.state === 'done' && <Icon name="check" />}{i.name}<span className="dim">{word[i.state]}</span>
      </button>)}
    </div>
    <div className="small muted queue-status" style={{ marginTop: 8 }}>{status}</div>
  </div>
}
