// What a member is told when something happens between them and a trainer or a gym: the push
// notification and the in-app notice say the same words. English here, translated in the locale
// packs like every t() string; api/scripts/build-trainer-copy.mjs copies them into the server
// (api/trainers/push-copy.js), which cannot import the frontend. {0} is the trainer or gym, {1} a
// second name (the gym a trainer left). A comment's text is the trainer's own words, never translated.
export const TRAINER_PUSH = {
  connected: { title: '{0} is now your trainer', body: 'They see what you shared, nothing more. Change it any time in Trainer & gym.' },
  scopes: { title: 'Your sharing changed', body: 'What {0} sees just changed. Not you? Check Trainer & gym.' },
  joined: { title: 'Welcome to {0}', body: 'Your gym lead sees only what you ticked.' },
  change: { title: '{0} updated your training', body: 'Have a look. If it is not for you, undo is one tap in Trainer & gym.' },
  suggest: { title: '{0} has an idea for you', body: 'Take it or leave it in Trainer & gym.' },
  comment: { title: '{0} left you a note', body: '' },
  offer: { title: '{0} left {1}', body: 'Keep training together privately? You have 30 days to decide.' },
}
export const NOTICE_KINDS = Object.keys(TRAINER_PUSH)
