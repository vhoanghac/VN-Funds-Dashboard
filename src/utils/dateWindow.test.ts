import { describe, it, expect } from 'vitest'
import {
  addMonthsClamped,
  rollingWindowStarts,
  monthsAheadIndex,
  countIndependentWindows,
} from './dateWindow'

function toTime(dateStr: string): number {
  return new Date(dateStr).getTime()
}

function toDateStr(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

describe('addMonthsClamped', () => {
  it('adds months normally when day exists in target month', () => {
    expect(toDateStr(addMonthsClamped(toTime('2024-01-15'), 1))).toBe('2024-02-15')
  })

  it('clamps to Feb 29 instead of overflowing to March (leap year)', () => {
    // Native Date.setMonth would overflow "Jan 31 + 1 month" to Mar 2 (Feb 2024 has 29 days).
    expect(toDateStr(addMonthsClamped(toTime('2024-01-31'), 1))).toBe('2024-02-29')
  })

  it('clamps to Feb 28 instead of overflowing to March (non-leap year)', () => {
    expect(toDateStr(addMonthsClamped(toTime('2023-01-31'), 1))).toBe('2023-02-28')
  })

  it('clamps when subtracting months lands on a shorter month', () => {
    // Native Date.setMonth would overflow "Mar 31 - 1 month" to Mar 2 (Feb 2024 has 29 days).
    expect(toDateStr(addMonthsClamped(toTime('2024-03-31'), -1))).toBe('2024-02-29')
  })

  it('does not clamp when target month is equal or longer', () => {
    expect(toDateStr(addMonthsClamped(toTime('2024-04-30'), 1))).toBe('2024-05-30')
  })
})

describe('rollingWindowStarts', () => {
  it('finds the correct backward index for a simple monthly series', () => {
    const dates = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01'].map(toTime)
    const starts = rollingWindowStarts(dates, 2)
    // index 0,1: not enough history. index 2 (Mar): 2 months back = Jan 1 = index 0.
    expect(starts[0]).toBe(-1)
    expect(starts[1]).toBe(-1)
    expect(starts[2]).toBe(0)
    expect(starts[3]).toBe(1)
  })

  it('does not silently misplace the window on month-end dates (regression for setMonth overflow)', () => {
    // Without clamping, "31/03 - 1 month" overflows to 02/03, landing on index 1
    // (itself!) instead of correctly finding the point closest to 29/02.
    const dates = ['2024-01-31', '2024-02-29', '2024-03-31'].map(toTime)
    const starts = rollingWindowStarts(dates, 1)
    expect(starts[2]).toBe(1) // Mar 31 - 1mo = Feb 29 (clamped) = index 1, not index 2
  })

  it('returns empty starts for empty input', () => {
    expect(rollingWindowStarts([], 3)).toEqual([])
  })
})

describe('monthsAheadIndex', () => {
  it('finds the correct forward index for a simple monthly series', () => {
    const dates = ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01'].map(toTime)
    const result = monthsAheadIndex(dates, 2)
    expect(result[0]).toBe(2) // Jan 1 + 2mo = Mar 1 = index 2
    expect(result[1]).toBe(3) // Feb 1 + 2mo = Apr 1 = index 3
    expect(result[2]).toBe(4) // Mar 1 + 2mo = May 1: not enough data, sentinel = n
  })

  it('does not silently misplace the window on month-end dates (regression for setMonth overflow)', () => {
    // Without clamping, "31/01 + 1 month" overflows to 02/03, skipping past
    // the Feb 29 point entirely and landing one index too far.
    const dates = ['2024-01-31', '2024-02-29', '2024-03-02', '2024-03-03'].map(toTime)
    const result = monthsAheadIndex(dates, 1)
    expect(result[0]).toBe(1) // Jan 31 + 1mo = Feb 29 (clamped) = index 1
  })

  it('is monotonically non-decreasing (two-pointer invariant)', () => {
    const dates = ['2024-01-01', '2024-01-15', '2024-02-01', '2024-03-01'].map(toTime)
    const result = monthsAheadIndex(dates, 1)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]!)
    }
  })
})

describe('countIndependentWindows', () => {
  it('counts only non-overlapping windows', () => {
    expect(countIndependentWindows(141, 36)).toBe(3)
    expect(countIndependentWindows(141, 60)).toBe(2)
    expect(countIndependentWindows(141, 120)).toBe(1)
  })

  it('returns zero for invalid or shorter spans', () => {
    expect(countIndependentWindows(240, 0)).toBe(0)
    expect(countIndependentWindows(0, 36)).toBe(0)
    expect(countIndependentWindows(-5, 36)).toBe(0)
    expect(countIndependentWindows(24, 36)).toBe(0)
  })
})
