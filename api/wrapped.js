// "Your year in openGym" (frontend lib/wrapped.js): the one December web push for people who use
// openGym in a browser against this server. The phones plan a local notification of their own
// (frontend lib/wrapped-notify.js) and say so in the profile (S.wrapped.phone), so nobody gets both.
//
// THE RULE. On Dec 1, from 18:00 to the end of the day on the server's clock, every user who
//   - has a push subscription (sendPush has somewhere to send it),
//   - has not switched it off (S.wrappedNotify !== false, Settings → Notifications),
//   - logged at least one workout that year,
//   - and has no phone that planned its own for that year,
// gets one push, once: `user.wrappedPush` in db.json holds the year it went out for, so a restart,
// a second tick or a redeploy that evening sends nothing more. A server down all evening sends
// none that year; the in-app card on Home is there either way.
//
// Nothing here reads more than it needs or keeps more than a few numbers: the summary holds a
// flag, a year and at most a few years with workouts, whatever the state file says.
import { WRAPPED_COPY } from './wrapped-copy.js';

export const WRAPPED_HOUR = 18;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// The years kept per user in the summary: the newest few are all the push ever asks about.
const MAX_YEARS = 3;

/** The year the push is due for at `now` (server local time), or null outside Dec 1 18:00–23:59. */
export function wrappedPushYear(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  return now.getMonth() === 11 && now.getDate() === 1 && now.getHours() >= WRAPPED_HOUR ? now.getFullYear() : null;
}

/** The few facts about a state the push needs, small whatever the state holds. */
export function wrappedSummary(S) {
  const years = new Set();
  const list = Array.isArray(S?.workouts) ? S.workouts : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i]?.d;
    if (typeof d === 'string' && ISO.test(d)) years.add(Number(d.slice(0, 4)));
  }
  const phone = S?.wrapped && typeof S.wrapped === 'object' && Number.isInteger(S.wrapped.phone) ? S.wrapped.phone : null;
  const lang = typeof S?.lang === 'string' && /^[A-Za-z-]{2,10}$/.test(S.lang) ? S.lang : 'en';
  return {
    notify: S?.wrappedNotify !== false,
    phone,
    lang,
    years: [...years].sort((a, b) => b - a).slice(0, MAX_YEARS),
  };
}

/** Whether `user` is owed the push for `year`, given their state's summary. */
export function wrappedPushOwed(user, sum, year) {
  if (!year || !user || user.disabled || !sum) return false;
  if (user.wrappedPush === year) return false;
  if (!sum.notify || sum.phone === year) return false;
  return sum.years.includes(year);
}

// de-CH is de with ß written ss, as in the frontend (lib/i18n-core.js DERIVED_LOCALES).
const copyFor = lang => {
  if (lang === 'de-CH') {
    const de = WRAPPED_COPY.de || WRAPPED_COPY.en;
    return { title: de.title.replace(/ß/g, 'ss'), body: de.body.replace(/ß/g, 'ss') };
  }
  return WRAPPED_COPY[lang] || WRAPPED_COPY.en;
};
/** The push itself: a fixed title and body with the year in, nothing from the profile. */
export function wrappedPush(lang, year) {
  const c = copyFor(lang);
  return { title: c.title.replace('{0}', () => String(year)), body: c.body, tag: 'wrapped' };
}
