// The shortcut card (app widget) in the watch's widget list: the week streak, big, lime once this
// week has a workout, and today's plan or a rest day; while a workout runs, its sets so far.
// A tap opens the app. It reads what the app saved last (lib/store.js), nothing more.
import * as ui from '@zos/ui'
import { push } from '@zos/router'
import { LocalStorage } from '@zos/storage'
import { getText } from '@zos/i18n'
import * as S from '../lib/session.js'
import { t, setLang } from '../lib/i18n.js'
import { C } from '../lib/theme.js'

function size () {
  try { if (typeof ui.getAppWidgetSize === 'function') return ui.getAppWidgetSize() } catch (e) { /* older firmware */ }
  return { w: 416, h: 200, margin: 32, radius: 32 }
}

AppWidget({
  build () {
    let s = S.emptyState()
    try { const raw = new LocalStorage().getItem('og_state'); s = S.stateOf(raw ? JSON.parse(raw) : null) } catch (e) { /* nothing saved yet */ }
    const own = getText('lang')
    setLang((s.settings && s.settings.lang) || (own !== 'lang' ? own : 'en'))
    const { w, h, margin, radius } = size()
    const bg = ui.createWidget(ui.widget.FILL_RECT, { x: margin, y: 0, w, h, radius, color: C.tile })
    const open = () => { try { push({ url: 'page/index' }) } catch (e) { /* the app opens from the list */ } }
    bg.addEventListener(ui.event.CLICK_UP, open)
    const pad = Math.round(h * 0.12)
    let big, small, line
    if (s.workout) {
      const [done, all] = S.progress(s)
      big = done + '/' + all
      small = t('sets')
      line = s.workout.name || t('workout')
    } else {
      const st = s.streak || { weeks: 0, thisWeekDone: false }
      big = String(st.weeks)
      small = t('week_streak')
      const today = s.ready && s.ready.today
      line = !s.synced ? t('open_phone_once') : today ? t('today') + ': ' + (today.name || t('workout')) : t('rest_day')
    }
    const lime = s.workout || (s.streak && s.streak.thisWeekDone)
    const left = margin + pad
    const numW = Math.round(w * 0.34)
    ui.createWidget(ui.widget.TEXT, { x: left, y: pad, w: numW, h: Math.round(h * 0.5), text: big, text_size: Math.round(h * 0.36), color: lime ? C.lime : C.text, align_h: ui.align.LEFT, align_v: ui.align.CENTER_V, text_style: ui.text_style.NONE })
    ui.createWidget(ui.widget.TEXT, { x: left, y: Math.round(h * 0.58), w: numW, h: Math.round(h * 0.26), text: small, text_size: Math.round(h * 0.13), color: C.quiet, align_h: ui.align.LEFT, align_v: ui.align.CENTER_V, text_style: ui.text_style.ELLIPSIS })
    const tx = left + numW + pad
    ui.createWidget(ui.widget.TEXT, { x: tx, y: pad, w: margin + w - pad - tx, h: h - pad * 2, text: line, text_size: Math.round(h * 0.15), color: C.text, align_h: ui.align.LEFT, align_v: ui.align.CENTER_V, text_style: ui.text_style.WRAP })
  },
})
