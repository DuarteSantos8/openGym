// A tap on a Home Screen or Lock Screen widget opens the app with a link of its own:
//
//   opengym://home          Home
//   opengym://stats         Stats (the streak, the records, the volume)
//   opengym://weigh-in      Home with the weigh-in sheet open
//   opengym://start?r=a,b   starts the next planned workout (those routines), or goes back to
//                           the one already running
//
// iOS: the widget's widgetURL / Link (ios/App/App/WidgetViews.swift), the scheme registered in
// Info.plist. Android: the widget's PendingIntent, an explicit intent to MainActivity carrying the
// same link as its data (OpenGymWidgetProvider.java). Capacitor's App plugin hands it to the page
// as appUrlOpen, or as the launch URL when the tap started the app.
//
// Any app could open such a link too. None of them does more than a tap in the app would: a
// start only starts routines the profile has, and still goes through the weigh-in step.
import { MOBILE } from './mobile.js'

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
    case 'weigh-in': return { action: 'weigh-in' }
    case 'start': {
      const ids = (q.get('r') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8)
      return { action: 'start', ids }
    }
    default: return null
  }
}

/**
 * Does what a link asks. `deps` are the app's own flows, passed in so this file needs neither the
 * router nor the sheets: { getS, nav, navToWorkout, startFlow, bwSheet }.
 */
export function runWidgetLink (target, { getS, nav, navToWorkout, startFlow, bwSheet }) {
  if (!target) return false
  const S = getS() || {}
  if (target.to) { nav(target.to); return true }
  if (target.action === 'weigh-in') { nav('/'); bwSheet(); return true }
  if (target.action === 'start') {
    // A session already running (or a saved one open for editing) wins, as on Home's today row.
    if (S.active) { navToWorkout(); return true }
    const have = new Set((S.routines || []).map(r => r?.id))
    const ids = target.ids.filter(id => have.has(id))
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
