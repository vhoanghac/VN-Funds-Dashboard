import { describe, expect, it } from 'vitest'
import { getScenarioValueDomain } from './DcaConsistencyBlock'

describe('getScenarioValueDomain', () => {
  it('fits the axis to scenario values instead of starting at zero', () => {
    expect(getScenarioValueDomain([
      { date: '2026-01-01', base: 20_000_000, p15: 20_500_000, p25: 19_500_000 },
    ])).toEqual([19_420_000, 20_580_000])
  })

  it('keeps a small range around a flat series', () => {
    expect(getScenarioValueDomain([{ date: '2026-01-01', base: 0 }])).toEqual([0, 1])
  })
})
