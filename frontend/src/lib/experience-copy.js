// The experience levels' names (lib/experience.js), as literals inside t() so
// check-source-strings.mjs finds them: lib/experience.js itself stays free of imports, like
// lib/modules.js and its modules-copy.js. The third level is 'advanced' in the data and
// "Experienced" on screen, because "Advanced" is already a Settings word with its own meaning.
import { t } from './i18n-core.js'

const COPY = {
  beginner: () => t('Beginner'),
  intermediate: () => t('Intermediate'),
  advanced: () => t('Experienced'),
}

/** A level's name in the language on screen, or '' for anything that is not a level. */
export const levelName = level => COPY[level]?.() || ''
