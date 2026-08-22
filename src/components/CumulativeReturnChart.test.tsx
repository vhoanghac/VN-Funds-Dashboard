import { describe, expect, it } from 'vitest'
import { getCumulativeReturnDomain } from './CumulativeReturnChart'

describe('getCumulativeReturnDomain', () => {
  it('keeps small return differences visible', () => {
    const domain = getCumulativeReturnDomain([{
      name: 'Fund A',
      color: '#000000',
      data: [
        { date: '2024-01-01', value: 0 },
        { date: '2024-01-02', value: 0.02 },
      ],
    }])

    expect(domain[0]).toBe(0)
    expect(domain[1]).toBeCloseTo(0.022)
    expect(domain[1]).toBeLessThan(0.05)
  })

  it('includes the baseline and never goes below -100%', () => {
    const domain = getCumulativeReturnDomain([{
      name: 'Fund A',
      color: '#000000',
      data: [{ date: '2024-01-01', value: -0.98 }],
    }])

    expect(domain[0]).toBe(-1)
    expect(domain[1]).toBe(0)
  })

  it('uses a small fallback range for flat data', () => {
    expect(getCumulativeReturnDomain([])).toEqual([-0.01, 0.01])
  })
})
