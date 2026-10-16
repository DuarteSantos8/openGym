// The AI coach consent (ux-onboarding §3b 5b): what the coach sheet says before anything goes to
// the AI service. The text has one source, the hub (fitness-hub src/onboarding/consent.ts), which
// sends it with the onboarding's state as { version, reads: { one, other }, where }. The sheet shows
// what it was sent and Build my plan sends its id back ({ consent: true, consentVersion }); the hub
// stamps the time with its own clock. This app keeps no copy of the text and no id of its own.
//
// An id names the English text. A translation is keyed by that English text in each locale pack
// (src/locales, the same way as every string here), so it stands for exactly the text the id names
// and is reviewed against it. A new text from the hub is a new id with new English: until a locale
// has a translation keyed by it, the sheet shows the hub's English, never an older translation.
import { t, tn } from '../i18n.js'

/** The consent's two paragraphs, as `consent` (the hub's) says them for `days` training days. */
export const coachConsentCopy = (consent, days) => ({
  reads: tn(consent.reads.one, consent.reads.other, days),
  where: t(consent.where),
})
