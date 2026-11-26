// Form guidance per exercise (EP23): what to think about, what usually goes wrong and how to fix
// it, where you should feel it, how to breathe, and an easier and a harder version. This is what
// a first-time lifter otherwise leaves the app to look up.
//
// WHICH EXERCISES
//   Every exercise a starter plan uses (api/coach/core/starter-plans.js), so every plan that
//   Find my plan can hand out is covered from its first session. lib/exercise-guide.test.js
//   fails when a starter plan gains an exercise without a guide.
//
// WHAT THIS IS, AND IS NOT (docs/next/adr/0012-health-content.md)
//   General coaching cues for healthy adults, the kind printed on a gym wall. Not a diagnosis,
//   not rehab, nothing about pain or injury beyond "stop". Every entry is `review: 'draft'`
//   until a named person has read it: then it becomes
//   `review: 'reviewed', reviewer: '<name>', reviewed: '<YYYY-MM-DD>'`, and only then does the
//   screen say it was reviewed.
//
// SHAPE
//   id: {
//     level:    'beginner' | 'intermediate' | 'advanced'   how much practice it asks for
//     pattern:  one of PATTERNS                             the movement family
//     cues:     3 or 4 short things to do
//     mistakes: [[what goes wrong, the fix], …]             2 or 3
//     feel:     where the work should be felt
//     breathing: one sentence
//     easier?:  catalogue id of a simpler version
//     harder?:  catalogue id of the next step
//     sources?: print citations for the coaching cues
//     review:   'draft' | 'reviewed' (+ reviewer, reviewed)
//   }
//
// TRANSLATION: English data shown through t(variable), like content/learn.js.

export const PATTERNS = ['squat', 'lunge', 'hinge', 'push-h', 'push-v', 'pull-h', 'pull-v', 'core', 'isolation']

const BREATHE_DOWN_UP = 'Breathe in on the way down, out as you come up.'
const BREATHE_PUSH = 'Breathe in as you lower, out as you push.'
const BREATHE_PULL = 'Breathe out as you pull, in as you let it back.'
const BREATHE_LIFT = 'Breathe out as you lift, in as you lower.'

const draft = g => ({ ...g, review: 'draft' })

export const EXERCISE_GUIDES = {
  // ───────────────────────────── squat ─────────────────────────────
  1197: draft({
    level: 'beginner', pattern: 'squat',
    cues: ['Feet about shoulder width, toes turned out a little.', 'Sit down between your heels, as if onto a low chair.', 'Keep your whole foot on the floor and your chest up.', 'Stand up by pushing the floor away.'],
    mistakes: [['Heels lifting off the floor.', 'Do not go as deep for now, and sit back a little more.'], ['Knees falling inwards.', 'Push them out so they point the same way as your toes.']],
    feel: 'Front of the thighs and the glutes.', breathing: BREATHE_DOWN_UP, harder: '1760',
  }),
  1760: draft({
    level: 'beginner', pattern: 'squat',
    cues: ['Hold one dumbbell upright against your chest, elbows tucked under it.', 'Sit down between your heels with your chest tall.', 'Go as low as you can while your heels stay down.', 'Push the floor away to stand.'],
    mistakes: [['The weight drifting away from your chest and pulling you forward.', 'Keep it touching your breastbone the whole time.'], ['Knees falling inwards on the way up.', 'Push them out over your toes.']],
    feel: 'Front of the thighs and the glutes, with your middle working to keep you upright.', breathing: BREATHE_DOWN_UP, easier: '1197', harder: '0043',
  }),
  1004: draft({
    level: 'beginner', pattern: 'squat',
    cues: ['Stand on the middle of the band, feet shoulder width.', 'Hold the ends at your shoulders so the band is already tight at the bottom.', 'Sit down between your heels, chest up.', 'Stand up against the band without locking your knees hard.'],
    mistakes: [['The band is slack at the bottom, so only the top is hard.', 'Shorten your grip on it or stand wider on it.'], ['Rising onto your toes.', 'Keep your heels heavy on the band.']],
    feel: 'Front of the thighs and the glutes, hardest near the top.', breathing: BREATHE_DOWN_UP, easier: '1197', harder: '1760',
  }),
  '0043': draft({
    level: 'intermediate', pattern: 'squat',
    cues: ['Bar on the muscle of your upper back, not on your neck. Hands just outside your shoulders.', 'Take a breath and tighten your middle before every rep.', 'Hips and knees bend together. Sit down between your heels.', 'Drive up with the bar staying over the middle of your foot.'],
    mistakes: [['Hips shooting up first so the chest drops.', 'Lower the weight and think "chest and hips rise together".'], ['Knees caving in as you stand.', 'Push them out, and use a weight you can keep them out with.'], ['Squatting without safety bars or a spotter.', 'Set the safeties just below your lowest position, every time.']],
    feel: 'Thighs and glutes, with your whole trunk braced.', breathing: 'Breathe in and brace at the top, hold it on the way down, breathe out near the top of the way up.', easier: '1760',
  }),
  '0739': draft({
    level: 'beginner', pattern: 'squat',
    cues: ['Feet in the middle of the plate, about shoulder width.', 'Lower back and hips stay pressed into the pad.', 'Lower until your knees are well bent, then push evenly through both feet.', 'Stop just short of locking your knees.'],
    mistakes: [['Hips rolling up off the pad at the bottom.', 'Do not lower quite as far.'], ['Snapping the knees straight at the top.', 'Leave a small bend.'], ['Hands pushing on your knees.', 'Hold the handles.']],
    feel: 'Front of the thighs and the glutes.', breathing: BREATHE_PUSH,
  }),
  '0585': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Set the seat so your knees line up with the machine\'s pivot.', 'Pad on the front of your ankles, back against the seat.', 'Straighten your legs smoothly and pause for a moment.', 'Lower slowly. The way down is half the exercise.'],
    mistakes: [['Kicking the weight up.', 'Take weight off until you can lift it without a swing.'], ['Hips lifting off the seat.', 'Hold the handles and stay sat down.']],
    feel: 'Front of the thighs.', breathing: BREATHE_LIFT,
  }),
  '0586': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Lie with your knees just off the edge of the pad, in line with the pivot.', 'Roller on the back of your ankles, hips pressed down.', 'Curl your heels towards you smoothly.', 'Lower slowly all the way.'],
    mistakes: [['Hips lifting as you curl.', 'Use less weight and keep them pressed into the pad.'], ['Letting the weight drop.', 'Count two seconds on the way down.']],
    feel: 'Back of the thighs.', breathing: BREATHE_LIFT,
  }),
  '0605': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Balls of your feet on the edge, heels hanging off.', 'Rise as high as you can and pause for a second.', 'Lower slowly until you feel a stretch in your calves.', 'Legs straight but not locked.'],
    mistakes: [['Bouncing at the bottom.', 'Pause for a second in the stretch.'], ['Tiny, fast reps.', 'Use the full range, slowly, with less weight.']],
    feel: 'Calves.', breathing: BREATHE_LIFT, easier: '1373',
  }),

  // ───────────────────────────── lunge ─────────────────────────────
  '0781': draft({
    level: 'beginner', pattern: 'lunge',
    cues: ['One foot forward, one back, hip width apart as if on train tracks.', 'Lower straight down until your back knee is just above the floor.', 'Most of your weight is on the whole front foot.', 'Push the floor away to come up. Finish one side, then swap.'],
    mistakes: [['Feet in one line, so you wobble.', 'Step the feet wider apart, side to side.'], ['Pushing forward off the back foot.', 'Think "down and up", like a lift, not forward and back.']],
    feel: 'Thigh and glute of the front leg.', breathing: BREATHE_DOWN_UP, easier: '1197', harder: '2960',
  }),
  2960: draft({
    level: 'beginner', pattern: 'lunge',
    cues: ['A dumbbell in each hand, arms hanging at your sides.', 'Feet apart front to back and hip width side to side.', 'Lower straight down, back knee towards the floor.', 'Drive up through the whole front foot.'],
    mistakes: [['Leaning far forward over the front leg.', 'Stay tall, or take a slightly shorter step.'], ['The front heel lifting.', 'Move the front foot a little further forward.']],
    feel: 'Thigh and glute of the front leg.', breathing: BREATHE_DOWN_UP, easier: '0781', harder: '2290',
  }),
  '0909': draft({
    level: 'beginner', pattern: 'lunge',
    cues: ['Front foot on the middle of the band, ends held at your shoulders.', 'Step the other foot well back.', 'Lower straight down, then stand up against the band.', 'Finish one side, then swap.'],
    mistakes: [['The band slipping from under your foot.', 'Stand on it with the arch of your foot, and check it before each set.'], ['Wobbling from side to side.', 'Put your feet hip width apart, not in one line.']],
    feel: 'Thigh and glute of the front leg.', breathing: BREATHE_DOWN_UP, easier: '0781',
  }),
  '0612': draft({
    level: 'beginner', pattern: 'lunge',
    cues: ['Step forward onto your whole foot.', 'Bend both knees to lower your body.', 'Push through your front foot to step back.'],
    mistakes: [['Front knee turning inward', 'Point your knee in the same direction as your toes.'], ['Feet landing on a single line', 'Leave room between your feet from side to side.']],
    feel: 'Front thigh and glutes of the leading leg.', breathing: 'Breathe in as you lower and out as you stand.',
    easier: '0781', sources: ['American Council on Exercise, Forward Lunge (exercise library 94).'],
  }),

  // ───────────────────────────── hinge ─────────────────────────────
  2471: draft({
    level: 'beginner', pattern: 'hinge',
    cues: ['Lie on your back, knees bent, feet flat and hip width apart.', 'Push through your heels and lift your hips until shoulders, hips and knees are in a line.', 'Squeeze your glutes at the top for a second.', 'Lower slowly.'],
    mistakes: [['Arching the lower back to get higher.', 'Stop at a straight line, ribs down.'], ['Feeling it mostly in the back of the thighs.', 'Bring your feet a little closer to your hips.']],
    feel: 'Glutes, with the back of the thighs helping.', breathing: BREATHE_LIFT, harder: '0726',
  }),
  '0726': draft({
    level: 'beginner', pattern: 'hinge',
    cues: ['Set up as for a glute bridge, then lift one foot off the floor.', 'Push through the heel that is down and lift your hips.', 'Keep both hip bones level, like a tray you must not tip.', 'Lower slowly. Finish one side, then swap.'],
    mistakes: [['The hip of the lifted leg dropping.', 'Do not lift quite as high, and tighten your middle.'], ['Cramp in the back of the thigh.', 'Bring the foot closer to your hips and squeeze the glute first.']],
    feel: 'The glute of the leg that is on the floor.', breathing: BREATHE_LIFT, easier: '2471', harder: '4742',
  }),
  4742: draft({
    level: 'beginner', pattern: 'hinge',
    cues: ['Upper back against a bench, dumbbell resting in the crease of your hips.', 'Feet flat, shins about upright at the top.', 'Drive your hips up until your body is level from shoulders to knees.', 'Chin tucked, eyes forward. Pause, then lower.'],
    mistakes: [['Arching the lower back at the top.', 'Keep your ribs down and stop when your hips are level.'], ['Pushing through your toes.', 'Push through your heels.']],
    feel: 'Glutes.', breathing: BREATHE_LIFT, easier: '2471', harder: '1060',
  }),
  1459: draft({
    level: 'beginner', pattern: 'hinge',
    cues: ['Dumbbells in front of your thighs, knees slightly bent and staying that way.', 'Push your hips straight back, as if closing a car door with them.', 'Let the weights slide down close to your legs, back flat.', 'When you feel the back of your thighs stretch, stand up by pushing your hips forward.'],
    mistakes: [['The back rounding.', 'Do not go as low. Stop where the stretch starts.'], ['Turning it into a squat.', 'Hips go back, not down. The knees barely move.'], ['Weights drifting away from the legs.', 'Keep them brushing your thighs and shins.']],
    feel: 'Back of the thighs and the glutes. Your lower back works to stay flat, but should not ache.', breathing: BREATHE_DOWN_UP, easier: '2471', harder: '0085',
  }),
  '0085': draft({
    level: 'intermediate', pattern: 'hinge',
    cues: ['Bar against your thighs, hands just outside your legs.', 'Brace, then push your hips back with a small, fixed knee bend.', 'The bar stays in contact with your legs all the way down.', 'Stop when your thighs are stretched or your back wants to round, then drive your hips forward.'],
    mistakes: [['Back rounding to reach lower.', 'Mid-shin is plenty. Depth comes from your hips, not your spine.'], ['Bar swinging away from the body.', 'Pull it into your legs, as if bending it round them.'], ['Leaning back at the top.', 'Stand tall and stop there.']],
    feel: 'Back of the thighs and the glutes.', breathing: 'Breathe in and brace at the top, lower, and breathe out as you stand.', easier: '1459', harder: '0032',
  }),
  4618: draft({
    level: 'beginner', pattern: 'hinge',
    cues: ['Stand on the band, feet hip width, and take hold of it low down.', 'Flat back, hips pushed back, a small bend in the knees.', 'Stand up by pushing your hips forward.', 'Lower by sending your hips back again, under control.'],
    mistakes: [['Pulling with the arms.', 'Arms stay long, like ropes. The hips do the work.'], ['The band slack at the bottom.', 'Hold it lower down, or stand wider on it.']],
    feel: 'Glutes and the back of the thighs.', breathing: BREATHE_LIFT, easier: '2471', harder: '1459',
  }),
  '0032': draft({
    level: 'intermediate', pattern: 'hinge',
    cues: ['Stand with the bar over the middle of your feet.', 'Bend at your hips and knees to grip the bar.', 'Push the floor away and stand tall.'],
    mistakes: [['Bar moving away from your legs', 'Keep the bar close to your shins and thighs.'], ['Leaning back at the top', 'Finish with your shoulders over your hips.']],
    feel: 'Glutes, back of your thighs and back muscles.', breathing: 'Breathe out as you stand and in as you reset.',
    easier: '1459', sources: ['CrossFit, The Deadlift, points of performance.'],
  }),

  // ───────────────────────────── horizontal push ─────────────────────────────
  '0662': draft({
    level: 'beginner', pattern: 'push-h',
    cues: ['Hands a little wider than your shoulders, body in one straight line from head to heels.', 'Tighten your stomach and glutes, like a plank.', 'Lower your chest between your hands, elbows about 45 degrees from your sides.', 'Push the floor away until your arms are straight.'],
    mistakes: [['Hips sagging.', 'Squeeze your glutes. If they still sag, use the easier version.'], ['Elbows flared straight out to the sides.', 'Tuck them back towards your ribs a little.'], ['Half reps.', 'Do fewer, with your chest close to the floor each time.']],
    feel: 'Chest, front of the shoulders and the back of the arms.', breathing: BREATHE_PUSH, easier: '0493', harder: '0279',
  }),
  '0915': draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Band across your upper back, one end under each hand.', 'Set up as for a normal push-up, body in a straight line.', 'Lower under control, then push up against the band.', 'The top is the hardest part: finish every rep.'],
    mistakes: [['The band riding up onto your neck.', 'Place it across your shoulder blades before you start.'], ['Losing the straight body line as the band tightens.', 'Use a lighter band.']],
    feel: 'Chest, shoulders and the back of the arms.', breathing: BREATHE_PUSH, easier: '0662',
  }),
  '0025': draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Eyes under the bar, feet flat on the floor, shoulder blades pulled back and down into the bench.', 'Grip a little wider than your shoulders, wrists straight over your elbows.', 'Lower the bar to the middle of your chest under control.', 'Press up and slightly back until it is over your shoulders again.'],
    mistakes: [['Bouncing the bar off your chest.', 'Touch lightly, or pause for a moment.'], ['Elbows flared out level with the shoulders.', 'Bring them in to about 45 to 70 degrees from your sides.'], ['Lifting heavy alone with nothing to catch the bar.', 'Use a spotter or safety bars, and never clip the collars on if you have neither.']],
    feel: 'Chest, front of the shoulders and the back of the arms.', breathing: BREATHE_PUSH, easier: '0289',
  }),
  '0047': draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Bench at a gentle incline, about 30 degrees.', 'Shoulder blades back and down, feet flat.', 'Lower the bar to the top of your chest, just under your collarbones.', 'Press straight up.'],
    mistakes: [['The bench set too steep, so it becomes a shoulder press.', 'Use a lower incline.'], ['The bar drifting towards your stomach.', 'Aim it at the top of your chest.']],
    feel: 'Upper chest and the front of the shoulders.', breathing: BREATHE_PUSH, easier: '0314',
  }),
  2982: draft({
    level: 'beginner', pattern: 'push-h',
    cues: ['Lie on the floor, knees bent, a dumbbell in each hand above your chest.', 'Lower one arm until the back of the upper arm rests lightly on the floor.', 'Press it back up, then lower the other.', 'The waiting arm stays straight and steady.'],
    mistakes: [['Banging the elbow on the floor.', 'Lower slowly for the last few centimetres.'], ['Rocking from side to side.', 'Feet flat, stomach tight, and a lighter pair if needed.']],
    feel: 'Chest and the back of the arms. The floor stops the movement before your shoulders are stretched.', breathing: BREATHE_PUSH, harder: '0289',
  }),
  '0251': draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Arms straight on the bars, shoulders down away from your ears.', 'Lean your chest forward a little and bend your elbows.', 'Lower until your upper arms are about level with the floor.', 'Push up to straight arms.'],
    mistakes: [['Dropping lower than your shoulders are comfortable with.', 'Stop when your upper arms are level.'], ['Shoulders shrugging up.', 'Push the bars down and keep your neck long.'], ['Swinging.', 'Cross your ankles and move slowly.']],
    feel: 'Lower chest, front of the shoulders and the back of the arms.', breathing: BREATHE_PUSH, easier: '0009',
  }),
  3387: draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Two sturdy chairs that cannot slide, one hand on each seat.', 'Arms straight, shoulders down, legs out in front.', 'Bend your elbows straight back and lower under control.', 'Push up to straight arms.'],
    mistakes: [['Chairs that move.', 'Put them against a wall or on a mat. Test them before you put your weight on them.'], ['Going too deep.', 'Stop when your upper arms are about level with the floor.']],
    feel: 'Back of the arms, with the chest and shoulders helping.', breathing: BREATHE_PUSH, easier: '0815',
  }),
  '0815': draft({
    level: 'beginner', pattern: 'push-h',
    cues: ['Sit on the floor, hands behind your hips with fingers pointing forward, knees bent.', 'Lift your hips a little and straighten your arms.', 'Bend your elbows straight back to lower.', 'Push back up.'],
    mistakes: [['Elbows pointing out to the sides.', 'Keep them pointing straight behind you.'], ['Shoulders rolling forward.', 'Chest open, shoulders back.']],
    feel: 'Back of the arms.', breathing: BREATHE_PUSH, harder: '3387',
  }),
  '0289': draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Lie on a flat bench with feet on the floor.', 'Hold the dumbbells beside your chest.', 'Press up, then lower both weights slowly.'],
    mistakes: [['Wrists bending back', 'Keep your wrists stacked over your elbows.'], ['Bouncing at the bottom', 'Pause briefly before pressing.']],
    feel: 'Chest, front shoulders and back of your upper arms.', breathing: 'Breathe out as you press and in as you lower.',
    easier: '2982', harder: '0025', sources: ['PureGym, How To Do A Dumbbell Bench Press.'],
  }),
  '0314': draft({
    level: 'intermediate', pattern: 'push-h',
    cues: ['Set the bench to a low incline and plant your feet.', 'Hold the dumbbells beside your upper chest.', 'Press up, then lower both weights slowly.'],
    mistakes: [['Wrists bending back', 'Keep your wrists stacked over your elbows.'], ['Bouncing at the bottom', 'Pause briefly before pressing.']],
    feel: 'Chest, front shoulders and back of your upper arms.', breathing: 'Breathe out as you press and in as you lower.',
    easier: '2982', harder: '0047', sources: ['PureGym, How To Do An Incline Dumbbell Chest Press.'],
  }),

  // ───────────────────────────── vertical push ─────────────────────────────
  '0426': draft({
    level: 'beginner', pattern: 'push-v',
    cues: ['Dumbbells at your shoulders, elbows slightly in front of your body.', 'Squeeze your glutes and tighten your stomach.', 'Press straight up until your arms are by your ears.', 'Lower under control back to your shoulders.'],
    mistakes: [['Leaning back and arching.', 'Use less weight, ribs down, glutes tight.'], ['Pressing forwards instead of up.', 'Finish with the weights above the back of your head.']],
    feel: 'Shoulders and the back of the arms.', breathing: BREATHE_PUSH, easier: '0405', harder: '1162',
  }),
  '0997': draft({
    level: 'beginner', pattern: 'push-v',
    cues: ['Stand on the band and bring the ends to your shoulders.', 'Stomach tight, ribs down.', 'Press straight up to straight arms.', 'Lower slowly. The band will want to pull you down fast.'],
    mistakes: [['Arching the back as the band tightens.', 'Use a lighter band, or stand on it with one foot.'], ['The band slipping.', 'Stand on it with the arches of your feet.']],
    feel: 'Shoulders and the back of the arms.', breathing: BREATHE_PUSH, harder: '0426',
  }),
  2921: draft({
    level: 'intermediate', pattern: 'push-v',
    cues: ['From a push-up position, walk your feet in and lift your hips high: an upside-down V.', 'Hands shoulder width, head between your arms.', 'Bend your elbows and lower the top of your head towards the floor, a little in front of your hands.', 'Push back up to the V.'],
    mistakes: [['Hips dropping so it turns into a normal push-up.', 'Keep your hips as high as you can.'], ['Elbows flaring wide.', 'Point them back at about 45 degrees.']],
    feel: 'Shoulders and the back of the arms.', breathing: BREATHE_PUSH, easier: '0662', harder: '0471',
  }),
  '1162': draft({
    level: 'intermediate', pattern: 'push-v',
    cues: ['Start with the bar at your shoulders.', 'Keep your feet flat and your knees still.', 'Press the bar overhead, then lower it slowly.'],
    mistakes: [['Arching your back', 'Keep your ribs over your hips.'], ['Bar drifting forward', 'Finish with the bar over the middle of your feet.']],
    feel: 'Shoulders and back of your upper arms.', breathing: 'Breathe out as you press and in as you lower.',
    easier: '0426', sources: ['CrossFit, The Shoulder Press, points of performance.'],
  }),
  '0334': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Light dumbbells at your sides, a small bend in your elbows.', 'Raise your arms out to the sides until they are level with your shoulders.', 'Lead with your elbows, as if pouring water from two jugs.', 'Lower slowly.'],
    mistakes: [['Swinging the weights up with your body.', 'Go lighter. This exercise needs far less weight than you expect.'], ['Shrugging your shoulders towards your ears.', 'Keep your neck long and stop at shoulder height.']],
    feel: 'The outside of the shoulders.', breathing: BREATHE_LIFT, easier: '0907',
  }),

  // ───────────────────────────── horizontal pull ─────────────────────────────
  '0027': draft({
    level: 'intermediate', pattern: 'pull-h',
    cues: ['Hinge forward with a flat back until your chest faces the floor at an angle.', 'Bar hanging under your shoulders, grip just outside your knees.', 'Pull the bar to your lower ribs, elbows going back past your sides.', 'Lower it under control without standing up.'],
    mistakes: [['Standing more upright with every rep.', 'Use less weight and keep your chest angle fixed.'], ['The back rounding.', 'Brace, push your hips back, and stop the set when you cannot hold it.'], ['Yanking with the arms.', 'Start each rep by pulling your shoulder blades together.']],
    feel: 'The middle of the back and the back of the shoulders, with the arms helping.', breathing: BREATHE_PULL, easier: '0293',
  }),
  '0293': draft({
    level: 'beginner', pattern: 'pull-h',
    cues: ['Hinge forward with a flat back, dumbbells hanging under your shoulders.', 'Pull your elbows back towards your hips.', 'Squeeze your shoulder blades together at the top.', 'Lower all the way to straight arms.'],
    mistakes: [['Shrugging the weights up towards your ears.', 'Pull towards your hips, not your armpits.'], ['The back rounding as you tire.', 'Rest one hand on a bench and row one arm at a time.']],
    feel: 'The middle of the back and the back of the shoulders.', breathing: BREATHE_PULL, easier: '0292', harder: '0027',
  }),
  1323: draft({
    level: 'beginner', pattern: 'pull-h',
    cues: ['Sit tall, knees slightly bent, feet on the plates.', 'Start with arms straight and shoulders reaching forward a little.', 'Pull the rope to your lower ribs, elbows close to your sides.', 'Let it back slowly until your arms are straight.'],
    mistakes: [['Rocking back and forth to move the weight.', 'Keep your upper body still. Only the arms and shoulder blades move.'], ['Shoulders rounding forward at the end of the pull.', 'Finish with your chest proud.']],
    feel: 'The middle of the back.', breathing: BREATHE_PULL,
  }),
  3896: draft({
    level: 'beginner', pattern: 'pull-h',
    cues: ['Sit with your legs out, band looped round your feet, an end in each hand.', 'Sit tall, knees slightly bent.', 'Pull your elbows back past your sides.', 'Let the band back slowly.'],
    mistakes: [['Leaning back to finish the pull.', 'Stay upright and use a lighter band, or sit further from your feet.'], ['The band slipping off your feet.', 'Wrap it once round each foot before you begin.']],
    feel: 'The middle of the back.', breathing: BREATHE_PULL, harder: '0293',
  }),
  3381: draft({
    level: 'beginner', pattern: 'pull-h',
    cues: ['Lie under a heavy, stable table and grip its edge.', 'Body in a straight line, heels on the floor.', 'Pull your chest up to the table.', 'Lower until your arms are straight.'],
    mistakes: [['A table that can tip or slide.', 'Test it with your full weight first, close to the floor. If in any doubt, do not use it.'], ['Hips sagging.', 'Squeeze your glutes, or bend your knees to make it easier.']],
    feel: 'The middle of the back and the arms.', breathing: BREATHE_PULL, harder: '0652',
  }),
  1503: draft({
    level: 'beginner', pattern: 'pull-h',
    cues: ['Hold the band in front of you at chest height, arms straight.', 'Pull your hands apart until the band touches your chest.', 'Squeeze your shoulder blades together.', 'Return slowly.'],
    mistakes: [['Bending the elbows to make it easier.', 'Keep your arms long and use a lighter band.'], ['Shoulders creeping up.', 'Keep them down, away from your ears.']],
    feel: 'The back of the shoulders and between the shoulder blades.', breathing: BREATHE_PULL,
  }),
  '5609': draft({
    level: 'beginner', pattern: 'pull-h',
    cues: ['Face a high pulley and hold both rope ends.', 'Step back until the rope is taut.', 'Pull the rope ends beside your face.'],
    mistakes: [['Shrugging your shoulders', 'Keep your shoulders away from your ears.'], ['Leaning back to pull', 'Keep your trunk still.']],
    feel: 'Upper back and rear shoulders.', breathing: 'Breathe out as you pull and in as you return.',
    easier: '1503', sources: ['PureGym, How To Do Face Pulls.'],
  }),

  // ───────────────────────────── vertical pull ─────────────────────────────
  2330: draft({
    level: 'beginner', pattern: 'pull-v',
    cues: ['Thighs snug under the pads, grip a little wider than your shoulders.', 'Start with arms fully straight.', 'Pull the bar to the top of your chest by driving your elbows down.', 'Let it rise slowly until your arms are straight again.'],
    mistakes: [['Leaning far back and heaving.', 'A slight lean is fine. If you have to swing, the weight is too heavy.'], ['Pulling the bar behind your neck.', 'Always pull to the front.'], ['Stopping short at the top.', 'Let your arms straighten every rep.']],
    feel: 'The sides of the back, under your armpits.', breathing: BREATHE_PULL, harder: '0017',
  }),
  '0905': draft({
    level: 'beginner', pattern: 'pull-v',
    cues: ['Fix the band high up on something that cannot move, such as a closed door with a door anchor.', 'Kneel facing it, arms reaching up.', 'Pull your elbows down to your sides.', 'Let your arms rise slowly.'],
    mistakes: [['An anchor that can give way.', 'Tug it hard before you kneel under it.'], ['Bending forward to pull.', 'Stay tall on your knees.']],
    feel: 'The sides of the back.', breathing: BREATHE_PULL, harder: '2330',
  }),
  '0652': draft({
    level: 'intermediate', pattern: 'pull-v',
    cues: ['Grip the bar just wider than your shoulders, palms facing away.', 'Hang with straight arms, then pull yourself up.', 'Pull your elbows down toward your ribs.'],
    mistakes: [['Swinging your legs', 'Let your legs hang still.'], ['Reaching with your chin', 'Keep your neck in line with your back.']],
    feel: 'Sides of your back and front of your arms.', breathing: 'Breathe out as you pull and in as you return.',
    easier: '0017', harder: '0841', sources: ['American Council on Exercise, Pull-ups (exercise library 191).'],
  }),
  '1326': draft({
    level: 'intermediate', pattern: 'pull-v',
    cues: ['Grip the bar at shoulder width, palms facing you.', 'Hang with straight arms, then pull yourself up.', 'Pull your elbows down toward your ribs.'],
    mistakes: [['Swinging your legs', 'Let your legs hang still.'], ['Reaching with your chin', 'Keep your neck in line with your back.']],
    feel: 'Sides of your back and front of your arms.', breathing: 'Breathe out as you pull and in as you return.',
    easier: '0572', sources: ['American Council on Exercise, Chin-ups (exercise library 190).'],
  }),

  // ───────────────────────────── arms ─────────────────────────────
  '0031': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Stand tall, bar in front of your thighs, palms up, hands shoulder width.', 'Elbows stay by your sides.', 'Curl the bar up to your shoulders.', 'Lower slowly to straight arms.'],
    mistakes: [['Swinging the bar up with your hips.', 'Go lighter, or stand with your back against a wall.'], ['Elbows drifting forward.', 'Pin them to your sides.']],
    feel: 'Front of the upper arms.', breathing: BREATHE_LIFT, easier: '0294',
  }),
  '0294': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Dumbbells at your sides, palms facing forward.', 'Elbows stay by your ribs.', 'Curl up to your shoulders.', 'Lower slowly all the way.'],
    mistakes: [['Swinging.', 'Lighter weights and a slower pace.'], ['Half reps.', 'Straighten your arms fully at the bottom.']],
    feel: 'Front of the upper arms.', breathing: BREATHE_LIFT,
  }),
  '0313': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Dumbbells at your sides, palms facing each other, as if holding two hammers.', 'Elbows by your ribs.', 'Curl up without turning your wrists.', 'Lower slowly.'],
    mistakes: [['Swinging.', 'Go lighter.'], ['Wrists bending back.', 'Keep them straight, knuckles up.']],
    feel: 'Front of the upper arms and the top of the forearms.', breathing: BREATHE_LIFT,
  }),
  4063: draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Stand on the band, an end in each hand, palms forward.', 'Elbows by your sides.', 'Curl up to your shoulders.', 'Lower slowly against the pull of the band.'],
    mistakes: [['Letting the band snap your arms down.', 'Count two seconds on the way down.'], ['Elbows moving forward.', 'Keep them still.']],
    feel: 'Front of the upper arms.', breathing: BREATHE_LIFT, harder: '0294',
  }),
  '0241': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Stand close to the cable, elbows tucked into your sides.', 'Start with your forearms about level with the floor.', 'Push the bar down until your arms are straight.', 'Let it rise slowly. Only your forearms move.'],
    mistakes: [['Elbows swinging forward and back.', 'Imagine them bolted to your ribs.'], ['Leaning your body weight onto the bar.', 'Stand upright and use less weight.']],
    feel: 'Back of the upper arms.', breathing: BREATHE_PUSH,
  }),
  4143: draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Stand on the band and hinge forward with a flat back.', 'Upper arms by your sides, level with your body.', 'Straighten your elbows behind you.', 'Bend them again slowly.'],
    mistakes: [['The upper arm swinging.', 'Hold it still. Only the forearm moves.'], ['The back rounding.', 'Push your hips back and keep your chest long.']],
    feel: 'Back of the upper arms.', breathing: BREATHE_PUSH,
  }),
  '0200': draft({
    level: 'beginner', pattern: 'isolation',
    cues: ['Face a high pulley and hold both rope ends.', 'Keep your upper arms beside your ribs.', 'Straighten your elbows, then bend them slowly.'],
    mistakes: [['Elbows moving forward', 'Keep your upper arms still.'], ['Rocking your body', 'Keep your trunk still.']],
    feel: 'Back of your upper arms.', breathing: 'Breathe out as you straighten your arms and in as they bend.',
    sources: ['PureGym, How To Do A Tricep Rope Pushdown.'],
  }),

  // ───────────────────────────── core ─────────────────────────────
  '0463': draft({
    level: 'beginner', pattern: 'core',
    cues: ['Elbows under your shoulders, forearms on the floor.', 'Body in one straight line from head to heels.', 'Squeeze your glutes and pull your ribs towards your hips.', 'Look at the floor just in front of your hands.'],
    mistakes: [['Hips sagging towards the floor.', 'End the hold. A shorter hold done well beats a longer one done badly.'], ['Hips piked up high.', 'Lower them into the line.'], ['Holding your breath.', 'Keep breathing, slowly.']],
    feel: 'Stomach muscles, all the way round. Not the lower back.', breathing: 'Breathe steadily throughout. Do not hold your breath.', easier: '3238', harder: '3501',
  }),
  '0715': draft({
    level: 'beginner', pattern: 'core',
    cues: ['Lie on your side, elbow under your shoulder, feet stacked.', 'Lift your hips until your body is in a straight line.', 'Top shoulder stacked over the bottom one.', 'Hold, then swap sides.'],
    mistakes: [['Hips dropping.', 'Bend your knees and hold from your knees instead of your feet.'], ['Rolling forward.', 'Open your chest to the wall in front of you.']],
    feel: 'The side of your waist nearest the floor.', breathing: 'Breathe steadily throughout. Do not hold your breath.',
  }),
  '0276': draft({
    level: 'beginner', pattern: 'core',
    cues: ['Lie on your back with arms and knees raised.', 'Reach one arm back and extend the opposite leg.', 'Return to the start and switch sides.'],
    mistakes: [['Lower back lifting', 'Shorten the reach.'], ['Rushing the switch', 'Bring both limbs back before changing sides.']],
    feel: 'Muscles around your abdomen.', breathing: 'Breathe out as you reach and in as you return.',
    easier: '4007', harder: '4127', sources: ['PureGym, How To Do A Deadbug.'],
  }),
}
