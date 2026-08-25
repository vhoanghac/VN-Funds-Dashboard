import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMultiComparison } from './useCalculations'

describe('useMultiComparison', () => {
  it('uses the sell quote for a gold entry and keeps buy prices for later valuation', () => {
    const fundData = new Map([
      ['GOLD_NHAN_DOJI', [
        { date: '2026-07-24', price: 138_000_000 },
        { date: '2026-08-24', price: 149_000_000 },
      ]],
    ])
    const purchaseData = new Map([
      ['GOLD_NHAN_DOJI', [
        { date: '2026-07-24', price: 142_500_000 },
        { date: '2026-08-24', price: 153_000_000 },
      ]],
    ])

    const { result } = renderHook(() => useMultiComparison(
      ['GOLD_NHAN_DOJI'],
      fundData,
      60,
      '2026-07-24',
      '2026-08-24',
      purchaseData,
    ))

    if (result.current.status !== 'ready') throw new Error('Expected comparison data')
    const fund = result.current.data.funds[0]!
    expect(fund.prices).toEqual([
      { date: '2026-07-24', value: 138_000_000 },
      { date: '2026-08-24', value: 149_000_000 },
    ])
    expect(fund.returns[0]!.value).toBeCloseTo(149_000_000 / 142_500_000 - 1)
    expect(fund.cumulative[fund.cumulative.length - 1]!.value)
      .toBeCloseTo(149_000_000 / 142_500_000 - 1)
  })

  it('returns an insufficient-data error for a single aligned point', () => {
    const fundData = new Map([
      ['E1VFVN30', [{ date: '2025-10-17', price: 34_900 }]],
      ['DCDS', [{ date: '2025-10-17', price: 115_766.13 }]],
    ])

    const { result } = renderHook(() => useMultiComparison(
      ['E1VFVN30', 'DCDS'],
      fundData,
      60,
      '2025-10-17',
      '2025-10-17',
    ))

    expect(result.current).toEqual({
      status: 'error',
      error: {
        type: 'insufficient_data',
        message: 'Khoảng thời gian đã chọn chỉ có một điểm dữ liệu chung. Cần ít nhất hai điểm để tính lợi nhuận.',
      },
    })
  })
})
