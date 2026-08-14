import { describe, it, expect } from 'vitest'
import {
  mergeAllSeries, getYearTicks, formatYear, formatTooltipDate,
  formatPercent, formatPercentFull, BASELINE_COLOR, DIMMED_COLOR,
} from './chartPlumbing'

describe('mergeAllSeries', () => {
  it('gộp nhiều chuỗi theo ngày, mỗi ngày một hàng, sắp theo thời gian', () => {
    const result = mergeAllSeries([
      {
        name: 'A',
        data: [
          { date: '2024-01-03', value: 0.1 },
          { date: '2024-01-05', value: 0.2 },
        ],
      },
      {
        name: 'B',
        data: [
          { date: '2024-01-04', value: -0.05 },
          { date: '2024-01-05', value: -0.1 },
        ],
      },
    ])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ date: '2024-01-03', timestamp: expect.any(Number), A: 0.1 })
    expect(result[1]).toEqual({ date: '2024-01-04', timestamp: expect.any(Number), B: -0.05 })
    expect(result[2]).toMatchObject({ date: '2024-01-05', A: 0.2, B: -0.1 })
    // Ngày phải sắp tăng dần.
    const timestamps = result.map(r => r.timestamp as number)
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps)
  })

  it('ngày trùng nhau thì gộp về một hàng', () => {
    const result = mergeAllSeries([
      { name: 'X', data: [{ date: '2024-02-01', value: 1 }] },
      { name: 'Y', data: [{ date: '2024-02-01', value: 2 }] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ X: 1, Y: 2 })
  })
})

describe('getYearTicks', () => {
  it('trả timestamp đầu tiên của mỗi năm', () => {
    const data = [
      { timestamp: new Date('2023-12-31').getTime() },
      { timestamp: new Date('2024-01-02').getTime() },
      { timestamp: new Date('2024-06-15').getTime() },
      { timestamp: new Date('2025-03-01').getTime() },
    ]
    const ticks = getYearTicks(data)
    expect(ticks).toHaveLength(3)
    expect(new Date(ticks[0]!).getFullYear()).toBe(2023)
    expect(new Date(ticks[1]!).getFullYear()).toBe(2024)
    expect(new Date(ticks[2]!).getFullYear()).toBe(2025)
  })
})

describe('formatYear / formatTooltipDate', () => {
  it('formatYear trả về năm', () => {
    expect(formatYear(new Date('2024-06-15').getTime())).toBe('2024')
  })

  it('formatTooltipDate trả dd/mm/yyyy có đệm số 0', () => {
    expect(formatTooltipDate(new Date('2024-01-05').getTime())).toBe('05/01/2024')
    expect(formatTooltipDate(new Date('2024-11-23').getTime())).toBe('23/11/2024')
  })
})

describe('formatPercent', () => {
  it('số thập phân ra phần trăm, mặc định 1 số lẻ', () => {
    expect(formatPercent(0.05)).toBe('5.0%')
    expect(formatPercent(-0.123)).toBe('-12.3%')
  })

  it('chỉnh được số chữ số lẻ', () => {
    expect(formatPercent(0.05, 0)).toBe('5%')
  })

  it('formatPercentFull luôn 2 số lẻ cho tooltip', () => {
    expect(formatPercentFull(0.05)).toBe('5.00%')
  })
})

describe('hằng màu', () => {
  it('baseline và dimmed cố định', () => {
    expect(BASELINE_COLOR).toBe('#7A7574')
    expect(DIMMED_COLOR).toBe('#CBD5E1')
  })
})
