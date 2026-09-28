import { describe, expect, it } from 'vitest'
import { balanceStatusView } from './structuralBalance-view.js'

describe('balanceStatusView', () => {
  it('maps every known status to a label and severity', () => {
    expect(balanceStatusView('balanced')).toEqual({ label: 'Balanced', severity: 0 })
    expect(balanceStatusView('borderline')).toEqual({ label: 'Borderline', severity: 1 })
    expect(balanceStatusView('weak')).toEqual({ label: 'Weak', severity: 2 })
    expect(balanceStatusView('no-data')).toEqual({ label: 'No data', severity: 3 })
  })

  it('falls back to no-data for an unknown status', () => {
    expect(balanceStatusView('bogus')).toEqual({ label: 'No data', severity: 3 })
  })

  it('reads a logged lift with no anchor to hold it against as not scored, not as no data', () => {
    expect(balanceStatusView('no-data', true)).toEqual({ label: 'Not scored', severity: 3 })
    expect(balanceStatusView('no-data', false)).toEqual({ label: 'No data', severity: 3 })
  })
})
