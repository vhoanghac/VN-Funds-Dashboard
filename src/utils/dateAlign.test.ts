import { describe, it, expect } from 'vitest'
import { alignWeeklySeries, alignMultiSeries, NoOverlapError } from './dateAlign'

describe('alignWeeklySeries', () => {
  it('aligns two series with no gaps', () => {
    const a = [
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-12', price: 110 },
      { date: '2024-01-19', price: 120 },
    ]
    const b = [
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-12', price: 11 },
      { date: '2024-01-19', price: 12 },
    ]
    const result = alignWeeklySeries(a, b)
    expect(result.dates).toEqual(['2024-01-05', '2024-01-12', '2024-01-19'])
    expect(result.pricesA).toEqual([100, 110, 120])
    expect(result.pricesB).toEqual([10, 11, 12])
  })

  it('forward-fills a gap within tolerance (<=14 days)', () => {
    const a = [
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-12', price: 110 }, // B thiếu ngày này, cách A 7 ngày trước đó — trong ngưỡng
      { date: '2024-01-19', price: 120 },
    ]
    const b = [
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-19', price: 12 },
    ]
    const result = alignWeeklySeries(a, b)
    expect(result.dates).toEqual(['2024-01-05', '2024-01-12', '2024-01-19'])
    expect(result.pricesB).toEqual([10, 10, 12]) // forward-filled tại 01-12
  })

  it('excludes dates once the gap exceeds 14 days', () => {
    const a = [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-08', price: 101 },
      { date: '2024-01-15', price: 102 },
      { date: '2024-01-22', price: 103 }, // 21 ngày kể từ giá B gần nhất (01-01) → vượt ngưỡng
      { date: '2024-01-29', price: 104 },
    ]
    const b = [
      { date: '2024-01-01', price: 10 },
      { date: '2024-01-29', price: 13 },
    ]
    const result = alignWeeklySeries(a, b)
    // 01-08 (7 ngày) và 01-15 (14 ngày) vẫn trong ngưỡng, 01-22 (21 ngày) bị loại
    expect(result.dates).toEqual(['2024-01-01', '2024-01-08', '2024-01-15', '2024-01-29'])
  })

  it('gives the same result whether the gap is expressed in daily or weekly points', () => {
    // Cùng 1 khoảng trống ~10 ngày ở B, nhưng A có mật độ daily thay vì weekly —
    // kết quả phải NHẤT QUÁN (không phụ thuộc "2 bước" mà phụ thuộc "14 ngày").
    const aDaily = [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 100 },
      { date: '2024-01-03', price: 100 },
      { date: '2024-01-04', price: 100 },
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-06', price: 100 },
      { date: '2024-01-07', price: 100 },
      { date: '2024-01-08', price: 100 },
      { date: '2024-01-09', price: 100 },
      { date: '2024-01-10', price: 100 },
      { date: '2024-01-11', price: 100 },
    ]
    const b = [
      { date: '2024-01-01', price: 10 },
      { date: '2024-01-11', price: 11 }, // 10 ngày sau — vẫn trong ngưỡng 14 ngày
    ]
    const result = alignWeeklySeries(aDaily, b)
    // Toàn bộ 11 ngày phải còn lại (không bị cắt vì "quá 2 điểm" như logic cũ)
    expect(result.dates).toHaveLength(11)
  })

  it('throws NoOverlapError when either series is empty', () => {
    expect(() => alignWeeklySeries([], [{ date: '2024-01-01', price: 1 }])).toThrow(NoOverlapError)
  })

  it('throws NoOverlapError when date ranges do not overlap', () => {
    const a = [{ date: '2020-01-01', price: 100 }]
    const b = [{ date: '2024-01-01', price: 10 }]
    expect(() => alignWeeklySeries(a, b)).toThrow(NoOverlapError)
  })
})

describe('alignMultiSeries', () => {
  it('aligns 3 series with no gaps', () => {
    const a = [{ date: '2024-01-05', price: 100 }, { date: '2024-01-12', price: 110 }]
    const b = [{ date: '2024-01-05', price: 10 }, { date: '2024-01-12', price: 11 }]
    const c = [{ date: '2024-01-05', price: 1 }, { date: '2024-01-12', price: 1.1 }]
    const result = alignMultiSeries([a, b, c])
    expect(result.dates).toEqual(['2024-01-05', '2024-01-12'])
    expect(result.prices).toEqual([[100, 110], [10, 11], [1, 1.1]])
  })

  it('excludes a date once any series exceeds the 14-day gap', () => {
    const a = [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-08', price: 101 },
      { date: '2024-01-22', price: 103 }, // 21 ngày kể từ giá B/C gần nhất
      { date: '2024-01-29', price: 104 },
    ]
    const bc = [
      { date: '2024-01-01', price: 10 },
      { date: '2024-01-29', price: 13 },
    ]
    const result = alignMultiSeries([a, bc, bc])
    expect(result.dates).not.toContain('2024-01-22')
    expect(result.dates).toContain('2024-01-08')
  })

  it('throws NoOverlapError when no series provided', () => {
    expect(() => alignMultiSeries([])).toThrow(NoOverlapError)
  })
})
