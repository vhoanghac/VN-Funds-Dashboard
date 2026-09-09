import { describe, expect, it } from 'vitest'
import { buildYearlyChartData } from './YearlyPerformanceChart'

describe('buildYearlyChartData', () => {
  it('marks a single opening partial year with both markers', () => {
    const data = buildYearlyChartData([{
      name: 'ACB',
      color: '#000',
      data: [{ year: 2024, value: 0.2, isPartial: true, isOpeningYear: true }],
    }])

    expect(data[0]!.year).toBe('2024*†')
  })

  it('does not mark a shared year when only one portfolio is opening', () => {
    const data = buildYearlyChartData([
      { name: 'ACB', color: '#000', data: [{ year: 2024, value: 0.2, isPartial: true, isOpeningYear: true }] },
      { name: 'MBB', color: '#111', data: [{ year: 2024, value: 0.1, isPartial: false, isOpeningYear: false }] },
    ])

    expect(data[0]!.year).toBe('2024*')
  })
})
