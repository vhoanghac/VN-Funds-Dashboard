import { describe, expect, it } from 'vitest'
import { isValidYearsBack, yearsBackDateRange } from './dateRange'

describe('yearsBackDateRange', () => {
  it('formats calendar dates without shifting through UTC', () => {
    const now = new Date(2026, 8, 9, 0, 30)
    expect(yearsBackDateRange(1, now)).toEqual({ from: '2025-09-09', to: '2026-09-09' })
  })

  it('clamps February 29 to February 28 in a non-leap year', () => {
    const leapDay = new Date(2024, 1, 29, 12)
    expect(yearsBackDateRange(1, leapDay)).toEqual({ from: '2023-02-28', to: '2024-02-29' })
  })

  it('rejects non-finite, fractional and unsupported values', () => {
    expect(isValidYearsBack(1)).toBe(true)
    expect(isValidYearsBack(10)).toBe(true)
    expect(isValidYearsBack(0)).toBe(false)
    expect(isValidYearsBack(1.5)).toBe(false)
    expect(isValidYearsBack(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidYearsBack(11)).toBe(false)
  })
})
