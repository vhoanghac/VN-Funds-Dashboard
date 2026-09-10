import { describe, expect, it } from 'vitest'
import { buildAllocationData } from './DcaAllocationBlock'

describe('buildAllocationData', () => {
  it('converts asset values to percentages at each date', () => {
    const data = buildAllocationData([
      { fundId: 'A', values: [{ date: '2024-01-01', value: 100 }, { date: '2024-02-01', value: 50 }] },
      { fundId: 'B', values: [{ date: '2024-01-01', value: 100 }, { date: '2024-02-01', value: 150 }] },
    ])

    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ date: '2024-01-01', A: 50, B: 50 })
    expect(data[1]).toMatchObject({ date: '2024-02-01', A: 25, B: 75 })
  })

  it('aggregates duplicate assets before calculating percentages', () => {
    const [point] = buildAllocationData([
      { fundId: 'A', values: [{ date: '2024-01-01', value: 25 }] },
      { fundId: 'A', values: [{ date: '2024-01-01', value: 25 }] },
      { fundId: 'B', values: [{ date: '2024-01-01', value: 50 }] },
    ])

    expect(point).toMatchObject({ A: 50, B: 50 })
  })

  it('returns zero allocation when the portfolio has no value yet', () => {
    const [point] = buildAllocationData([
      { fundId: 'A', values: [{ date: '2024-01-01', value: 0 }] },
      { fundId: 'B', values: [{ date: '2024-01-01', value: 0 }] },
    ])

    expect(point).toMatchObject({ A: 0, B: 0 })
  })

  it('includes uninvested cash when the portfolio passes it as an asset', () => {
    const [point] = buildAllocationData([
      { fundId: 'ACB', values: [{ date: '2020-01-31', value: 2_300_000 }] },
      { fundId: 'REE', values: [{ date: '2020-01-31', value: 0 }] },
      { fundId: 'Tiền mặt', values: [{ date: '2020-01-31', value: 2_700_000 }] },
    ])

    expect(point).toMatchObject({ ACB: 46, REE: 0, 'Tiền mặt': 54 })
  })
})
