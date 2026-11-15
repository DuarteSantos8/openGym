// The community library inside an exercise's sheet: where your copy came from ("From Anna, taken
// 5 Nov"), and tips other people on your server wrote about this exercise, each one a tap from
// your own note. Nothing at all without a library on the server or with the Community module off.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { isOn } from '../lib/modules.js'
import { libraryOn, listShared, importShared, sharedError } from '../lib/shared-api.js'
import { originOf, originLine, applyImport, bylineOf } from '../lib/shared-items.js'
import Icon from './Icon.jsx'

const day = ms => fmtDate(isoOf(new Date(ms || 0)))

export default function CommunityBits({ ex }) {
  const on = useStore(s => libraryOn(s.config, s.user) && isOn(s.S, 'community'))
  const origin = originOf(ex)
  const [tips, setTips] = useState(null)
  useEffect(() => {
    if (!on || !ex?.id || ex.missing) return
    let live = true
    listShared({ type: 'tip', ex: ex.id, sort: 'popular' }).then(r => live && setTips(r.items.filter(i => !i.mine).slice(0, 5))).catch(() => live && setTips([]))
    return () => { live = false }
  }, [on, ex?.id])
  const take = item => importShared(item.id).then(res => {
    let msg = ''
    useStore.getState().update(s => { msg = applyImport(s, res, { exId: ex.id }) })
    useUI.getState().toast(msg)
  }).catch(e => useUI.getState().toast(sharedError(e)))
  return <>
    {origin && <p className="small dim com-origin"><Icon name="globe" /> {originLine(origin, day)}</p>}
    {on && tips?.length > 0 && <>
      <h4 className="sec">{t('Tips from your gym')}</h4>
      <div className="com-tips">{tips.map(tip => <div key={tip.id} className="com-tip">
        <p>{tip.payload?.text}</p>
        <div className="row between" style={{ gap: 8 }}>
          <span className="small dim">{bylineOf(tip, day)}</span>
          <button type="button" className="chip nocap" onClick={() => take(tip)}>{t('Add to my note')}</button>
        </div>
      </div>)}</div>
    </>}
  </>
}
