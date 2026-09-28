// The fallback that reads a body part off an exercise name when the export has no category
// column (Hevy). First match wins, so the order of the rules is the behaviour — reported on
// Discord by rubik_97 with the three cases below.
import { describe, expect, it } from 'vitest'
import { bpFromName } from './import-csv.js'

const bp = name => bpFromName(name.toLowerCase())

describe('body part from an exercise name', () => {
  it('reads a grip as a modifier, not as the movement', () => {
    expect(bp('Chest Supported T Row Neutral Grip')).toBe('back')
    expect(bp('Wide Grip Lat Pulldown')).toBe('back')
    expect(bp('Close Grip Bench Press')).toBe('chest')
  })

  it('files wrist and reverse curls under the forearms, not the upper arms', () => {
    expect(bp('Wrist Curl')).toBe('lower arms')
    expect(bp('Barbell Reverse Curl')).toBe('lower arms')
    expect(bp('Hammer Curl')).toBe('upper arms')
  })

  it('keeps leg curls and the hamstring deadlifts on the legs', () => {
    expect(bp('Lying Leg Curl')).toBe('upper legs')
    expect(bp('Romanian Deadlift')).toBe('upper legs')
    expect(bp('Stiff Leg Deadlift')).toBe('upper legs')
    expect(bp('RDL')).toBe('upper legs')
    expect(bp('Deadlift')).toBe('back')
  })

  // The rules are written with spaces, but people hyphenate these names as often as not (QA C28).
  // The matcher already treats "chest-supported row" and "chest supported row" as one exercise;
  // the body-part fallback has to agree with it, or the two spellings land on different maps.
  it('reads the hyphenated, underscored and slashed spellings like the spaced ones', () => {
    expect(bp('Stiff-Legged Deadlift')).toBe('upper legs')
    expect(bp('Straight-Leg Deadlift')).toBe('upper legs')
    expect(bp('Stiff_Leg Deadlift')).toBe('upper legs')
    expect(bp('Chest-Supported Row')).toBe('back')
    expect(bp('Chest-Supported T-Bar Row')).toBe('back')
    expect(bp('Chest/Supported Row')).toBe('back')
    expect(bp('Sit-Up')).toBe('waist')
  })

  it('still reads a bare grip exercise as forearms, and the rest as before', () => {
    expect(bp('Grip Trainer')).toBe('lower arms')
    expect(bp('Back Squat')).toBe('back')   // unchanged: "back" is matched before "squat"
    expect(bp('Standing Calf Raise')).toBe('lower legs')
    expect(bp('Something Unheard Of')).toBe(null)
  })
})
