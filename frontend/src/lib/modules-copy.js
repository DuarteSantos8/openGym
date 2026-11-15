// The words of Settings → Modules (lib/modules.js), each written inside t() so that
// scripts/check-source-strings.mjs finds them: a key handed over in a variable is invisible to it
// and would quietly stay English. modules.js keeps the same English, which the settings search
// matches on; modules-copy.test.js holds the two together.
import { t } from './i18n.js'

export const moduleCopy = () => ({
  effort: [t('Effort'), t('Rate each set in RIR or RPE, and see in Stats how hard you really push.')],
  plates: [t('Plates and warm-ups'), t('The plates to load under every set, and warm-ups that build themselves.')],
  strength: [t('Strength levels'), t('Beginner to Elite for your main lifts, measured against your body weight.')],
  videos: [t('Form videos'), t('Film a set and watch it back right under the row.')],
  exercise: [t('Exercise settings'), t('Progression, plate loading, set types and units in an exercise’s settings.')],
  watch: [t('Watch'), t('Log sets from your wrist on an Apple Watch, Wear OS, Garmin or Zepp watch.')],
  checkin: [t('Gym check-in'), t('Your membership codes on Home, and NFC stickers that start a workout.')],
  body: [t('Body'), t('Weigh-ins, measurements, progress photos and your weight goal.')],
  health: [t('Health'), t('Apple Health or Health Connect, heart rate and recovery tips.')],
  motivation: [t('Motivation'), t('Streaks, challenges, badges, recaps and your year in openGym.')],
  coach: [t('AI Coach'), t('Reviews your training and suggests changes. You still say yes or no.')],
  integrations: [t('Integrations'), t('Webhooks for Home Assistant and friends, and the MCP server.')],
  community: [t('Community'), t('Exercises, plans and sounds people on your server shared, and a way to share yours.')],
  seasonal: [t('Seasonal themes'), t('Halloween and friends, little extras for the time of year. All optional.')],
})

export const groupCopy = () => ({
  training: t('Training'),
  body: t('Body and health'),
  extras: t('Extras'),
})

export const presetCopy = () => ({
  training: [t('Just training'), t('Log, plan, progress. Nothing else on the screen.')],
  body: [t('Training and body'), t('Plus weigh-ins, measurements, photos and your health apps.')],
  all: [t('Everything'), t('Streaks, the Coach, themes, the lot.')],
})

/* The parts of a module (PARTS in lib/modules.js), keyed 'module.part'. */
export const partCopy = () => ({
  'strength.details': [t('In an exercise’s details'), t('Your level on a main lift, beside its records.')],
  'strength.list': [t('Strength levels in Stats'), t('Every main lift with its level, in one card.')],
  'exercise.progression': [t('Progression'), t('The rule that moves the weight or the reps up.')],
  'exercise.plates': [t('Plate loading'), t('The bar, the plates and the weight stack of an exercise.')],
  'exercise.intensity': [t('Drop-sets, rest-pause and pyramids'), t('Sets that change shape, and the last set to failure.')],
  'exercise.units': [t('Weight unit and dumbbells'), t('An exercise’s own kg or lb, and what a dumbbell weight means.')],
  'body.weight': [t('Body weight'), t('The Home card, the weigh-in before a workout, your goal and the weight chart.')],
  'body.measurements': [t('Body measurements'), t('Circumferences and your own fields.')],
  'body.photos': [t('Progress photos'), t('Photos of you over time, side by side.')],
  'motivation.streak': [t('Week streak'), t('Your streak on Home, in Stats, in the calendar and on the watch.')],
  'motivation.challenges': [t('Monthly challenges'), t('Three goals a month and the trophy shelf, on Home and in Stats.')],
  'motivation.recaps': [t('Week and month recap'), t('Your week and Your month, once one is over.')],
  'motivation.year': [t('Your year in openGym'), t('Your year in December and January, and its notification.')],
  'motivation.share': [t('Share as image'), t('A finished workout or a recap as a picture to send.')],
})
