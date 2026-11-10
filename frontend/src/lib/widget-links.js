// A tap on a Home Screen or Lock Screen widget opens the app with a link of its own:
//
//   opengym://home          Home
//   opengym://stats         Stats (the streak, the records, the volume)
//   opengym://weigh-in      Home with the weigh-in sheet open
//   opengym://start?r=a,b   starts the next planned workout (those routines), or goes back to
//                           the one already running
//   opengym://weigh-in?w=78.2[&u=kg]   the weigh-in sheet with that weight in (Assistant, lib/voice.js)
//   opengym://start?today=1 today's plan as the app has it (Siri, Assistant, the long-press shortcut)
//
// iOS: the widget's widgetURL / Link (ios/App/App/WidgetViews.swift), the scheme registered in
// Info.plist. Android: the widget's PendingIntent, an explicit intent to MainActivity carrying the
// same link as its data (OpenGymWidgetProvider.java). Capacitor's App plugin hands it to the page
// as appUrlOpen, or as the launch URL when the tap started the app.
//
// Any app could open such a link too. None of them does more than a tap in the app would: a
// start only starts routines the profile has, and still goes through the weigh-in step, and a
// weigh-in link only fills the sheet in, saved by a tap on Save.
import { MOBILE } from './mobile.js'
import { parseSpokenWeight, convertWeight, weightInRange } from './voice.js'

export const WIDGET_SCHEME = 'opengym'

/** What a link asks for, or null for anything that is not one of ours. */
export function parseWidgetLink (url) {
  if (typeof url !== 'string') return null
  const m = /^opengym:\/\/([a-z-]+)\/?(?:\?(.*))?$/i.exec(url.trim())
  if (!m) return null
  const what = m[1].toLowerCase()
  const q = new URLSearchParams(m[2] || '')
  switch (what) {
    case 'home': return { to: '/' }
    case 'stats': return { to: '/stats' }
    case 'weigh-in': {
      const w = parseSpokenWeight(q.get('w') || '')
      if (!w) return { action: 'weigh-in' }
      const u = (q.get('u') || '').toLowerCase()
      return { action: 'weigh-in', w: w.w, unit: w.unit || (u === 'lb' || u === 'lbs' ? 'lb' : u === 'kg' ? 'kg' : null) }
    }
    case 'start': {
      const ids = (q.get('r') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8)
      return q.get('today') === '1' && !ids.length ? { action: 'start', ids, today: true } : { action: 'start', ids }
    }
    default: return null
  }
}

/**
 * Does what a link asks. `deps` are the app's own flows, passed in so this file needs neither the
 * router nor the sheets: { getS, nav, navToWorkout, startFlow, bwSheet, todayIds }.
 */
export function runWidgetLink (target, { getS, nav, navToWorkout, startFlow, bwSheet, todayIds }) {
  if (!target) return false
  const S = getS() || {}
  if (target.to) { nav(target.to); return true }
  if (target.action === 'weigh-in') {
    nav('/')
    // A number from the assistant, in the profile's unit, fills the sheet in; one that cannot be
    // a body weight opens it as a tap would.
    const unit = S.unit === 'lb' ? 'lb' : 'kg'
    const w = target.w == null ? NaN : convertWeight(target.w, target.unit || unit, unit)
    bwSheet(weightInRange(w, unit) ? { initial: w } : undefined)
    return true
  }
  if (target.action === 'start') {
    // A session already running (or a saved one open for editing) wins, as on Home's today row.
    if (S.active) { navToWorkout(); return true }
    const have = new Set((S.routines || []).map(r => r?.id))
    const asked = target.today && todayIds ? todayIds(S) : target.ids
    const ids = asked.filter(id => have.has(id))
    nav('/')
    if (ids.length) startFlow(ids)
    return true
  }
  return false
}

/** Listens for widget links (phone app only). Resolves with the stop function. */
export async function startWidgetLinks (deps) {
  if (!MOBILE) return () => {}
  const { App } = await import('@capacitor/app')
  const run = url => { try { runWidgetLink(parseWidgetLink(url), deps) } catch { /* a link that cannot run now is dropped */ } }
  const h = await App.addListener('appUrlOpen', e => run(e?.url))
  try { const launch = await App.getLaunchUrl(); if (launch?.url) run(launch.url) } catch { /* no launch URL */ }
  return () => { try { h?.remove() } catch { /* gone already */ } }
}
