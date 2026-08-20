import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMultiComparison } from './useCalculations'

describe('useMultiComparison', () => {
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
