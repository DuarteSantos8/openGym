// What each Garmin card measures, for its (i) popover (components/GarminFx.jsx). Plain English: ours.
export const INFO = {
  ready: {
    title: 'Readiness',
    body: 'A daily verdict from body battery, HRV, sleep and resting heart rate. "Ready to push" usually means a hard session will pay off; "Take it easy today" means your body is asking for a break. In between, train as planned.',
  },
  sick: {
    title: 'Possible illness',
    body: 'This shows when two or more signs appear together: higher resting heart rate, lower HRV, raised skin temperature or breathing rate, and poor sleep. Together they often mean your body is fighting something. Skip heavy sessions until the signs settle.',
  },
  bb: {
    title: 'Body battery',
    body: 'Garmin\'s estimate of your energy reserve, from 0 to 100. It usually charges with good sleep and drains with stress and training. Higher in the morning is better, and workouts are marked so you can see what each one cost.',
  },
  sleep: {
    title: 'Sleep rhythm',
    body: 'Your average bedtime and wake time over 14 nights, with the spread in minutes. A smaller spread usually means steadier sleep. Try to keep bedtime close to the suggested time, especially before heavy leg or back days.',
  },
  hrv: {
    title: 'HRV',
    body: 'Heart rate variability, measured overnight in milliseconds and compared with your own balanced range. Staying inside or above that range is usually a good sign. A few low nights in a row are a cue to lower intensity.',
  },
  rhr: {
    title: 'Resting heart rate',
    body: 'Your heart rate at rest, compared with your usual range from the week before. Lower or steady is generally better. A jump of several beats often follows hard training, poor sleep or illness, so go lighter that day.',
  },
  zones: {
    title: 'Heart rate zones',
    body: 'Minutes spent in each heart rate zone over the last 7 days. The goal is 150 minutes in zone 2, the easy pace where you can still talk. It builds your aerobic base, which helps you recover between sets.',
  },
  load: {
    title: 'Training load',
    body: 'Eight weeks of watch load next to gym volume. Acute is the last 7 days, chronic is your longer average. A ratio above 1.5 means you ramped up fast and injury risk is usually higher, so add weight or sets more gradually.',
  },
  cost: {
    title: 'Routine cost',
    body: 'What each of your gym routines takes out of you: the body battery drop, and the HRV and resting heart rate change the next morning. Routines that cost a lot are worth spacing out. Put the expensive ones on days you can recover after.',
  },
  sleeplift: {
    title: 'Sleep and lifting',
    body: 'Compares your lift performance after a good night with a short or poor one. If the gap is big, sleep is probably limiting you. Save your heavy top sets for days after good sleep when you can.',
  },
  run: {
    title: 'Running economy',
    body: 'Metres you cover per heartbeat across your runs. Higher usually means you are fitter, as the same effort takes you further. Easy runs between lifting days are a good way to push it up without adding much fatigue.',
  },
  fitness: {
    title: 'Fitness age',
    body: 'Garmin\'s estimate of how your fitness compares with the average person of each age. Lower is better. The levers are vigorous minutes, resting heart rate and BMI, so regular hard cardio alongside lifting usually moves it most.',
  },
  team: {
    title: 'Team goal',
    body: 'Steps or intensity minutes you and your partners add up this week toward a shared goal. It is about the group total, not who does the most. Short walks after training sessions are an easy way to chip in.',
  },
  partners: {
    title: 'Partners',
    body: 'Readiness, sleep, steps and body battery that a partner has chosen to share with you. Use it as a nudge, not a score. If you both look run down, a lighter shared session is often better than pushing through.',
  },
  trends: {
    title: '30-day trends',
    body: 'A month of sleep, HRV, resting heart rate, steps or body battery in one chart. Look at the direction over weeks, not single days. Tap or drag over the chart to read a day, and compare it with your hardest sessions.',
  },
};
