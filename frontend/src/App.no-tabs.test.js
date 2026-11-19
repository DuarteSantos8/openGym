// The Android app's first-launch card ("How do you want to use openGym?") showed the tab bar under
// it, and a tap on a tab changed the route behind the card and stacked history entries for back to
// walk through. Shell is not rendered in a test, so this reads the condition from the source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

describe('the tab bar', () => {
  it('stays away from the first-launch onboarding', () => {
    const cond = app.match(/const noTabs = ([^\n]+)/)?.[1] || ''
    expect(cond).toContain('needsMobileOnboarding')
    // The desktop sidebar (lib/use-desktop.js) is shown on more routes than the phone's tab bar,
    // but not on the first-launch steps either.
    const show = app.match(/const showTabs = ([^\n]+)/)?.[1] || ''
    expect(show).toMatch(/desktop \? !\(needsMobileOnboarding \|\| permSteps\) : !noTabs/)
    expect(app).toMatch(/\{showTabs && <TabBar /)
  })
})
