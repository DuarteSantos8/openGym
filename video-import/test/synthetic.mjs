// Synthetic OCR output: what the reader would produce, one frame per second, for a script of
// [caption, seconds] steps. Noise is applied by index so a test can say exactly which frame lies.

export function framesOf(script, { timer = 'down', noise = {}, conf = 90 } = {}) {
  const frames = []
  let t = 0
  for (const [name, sec, opts = {}] of script) {
    for (let i = 0; i < sec; i++) {
      const left = sec - i
      frames.push({
        t,
        name: name ?? '',
        nameConf: conf,
        timer: opts.noTimer ? '' : timer === 'down' ? `0:${String(left).padStart(2, '0')}` : `0:${String(i).padStart(2, '0')}`
      })
      t++
    }
  }
  for (const [idx, patch] of Object.entries(noise)) Object.assign(frames[+idx], patch)
  return frames
}

/** A typical follow-along: warm-up, `rounds` × exercises at work/rest, then a stretch. */
export function hiitScript({ rounds = 3, work = 40, rest = 20, exercises = ['BURPEES', 'MOUNTAIN CLIMBERS', 'JUMP SQUATS', 'PLANK JACKS'] } = {}) {
  const s = [['JUMPING JACKS', 60], ['ARM CIRCLES', 30], ['HIGH KNEES', 45]]
  for (let r = 0; r < rounds; r++) {
    for (const e of exercises) { s.push([e, work]); s.push(['REST', rest]) }
  }
  s.pop()   // the last interval runs straight into the stretch
  s.push(['QUAD STRETCH LEFT', 30], ['QUAD STRETCH RIGHT', 30], ["CHILD'S POSE", 45])
  return s
}
