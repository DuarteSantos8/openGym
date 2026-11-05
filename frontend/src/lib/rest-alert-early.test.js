// #995: on a locked Android phone "Rest's over" rang a minute into a 3:00 rest and took the
// countdown card with it, while the page and the card still had 2:00 to go. The alarm itself came
// early. RestCountdownPlan.alarmVerdict decides (JUnit, RestCountdownPlanTest); this checks the
// alert asks it before it rings, and that every booking tells it the end.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const java = readFileSync(new URL('../../android/app/src/main/java/ch/duartesantos/opengym/RestAlert.java', import.meta.url), 'utf8')
const fire = java.slice(java.indexOf('public static void fire('), java.indexOf('private static void rebook('))

describe('an early rest alarm on Android (#995)', () => {
  it('is judged before it claims the end or touches the card', () => {
    expect(fire.indexOf('alarmVerdict(')).toBeGreaterThan(-1)
    expect(fire.indexOf('alarmVerdict(')).toBeLessThan(fire.indexOf('claim(at)'))
    expect(fire).toMatch(/REBOOK\) \{[\s\S]*?rebook\(ctx, intent, at\);\s*return;/)
    expect(fire).toMatch(/STALE\) \{[\s\S]*?return;/)
  })
  it('knows the end of every rest it books, and forgets it on cancel', () => {
    expect((java.match(/bookedAt = at;/g) || []).length).toBe(3)
    expect(java).toMatch(/public static void cancel\(Context ctx, int id\) \{[\s\S]*?bookedAt = 0;/)
  })
  it('lets the card\'s own clock through as the current rest', () => {
    expect(java).toMatch(/static void fireFromCountdown[\s\S]*?putExtra\("fromCountdown", true\)/)
  })
})
