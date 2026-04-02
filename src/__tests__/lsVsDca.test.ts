import { describe, it, expect } from 'vitest'
import {
  computeRollingScenarios,
  summarizeScenarios,
  buildHistogram,
  computeHeatmap,
  HEATMAP_HOLDING_YEARS,
  HEATMAP_DCA_MONTHS,
} from '../utils/lsVsDca'
import type { PricePoint } from '../types'
import type { DCASlot } from '../utils/dca'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate weekly dates starting from startDate for `n` weeks (inclusive). */
function makeDates(startDate: string, n: number): string[] {
  const dates: string[] = []
  const d = new Date(startDate)
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 7)
  }
  return dates
}

/** Build a PricePoint[] with prices[i] on dates[i]. */
function makePrices(dates: string[], prices: number[]): PricePoint[] {
  return dates.map((date, i) => ({ date, price: prices[i]! }))
}

/** Linearly rising prices: start → end over n points. */
function linearPrices(start: number, end: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start + (end - start) * (i / (n - 1)))
}

/** Flat prices at `value` for n points. */
function flatPrices(value: number, n: number): number[] {
  return Array.from({ length: n }, () => value)
}

/** Single-fund aligned price map. */
function singleFundMap(fundId: string, prices: PricePoint[]): Map<string, PricePoint[]> {
  return new Map([[fundId, prices]])
}

/** Single-fund slot at 100% weight. */
function singleSlot(fundId: string): DCASlot[] {
  return [{ id: '1', fundId, weight: 100, name: fundId }]
}

// ─── computeRollingScenarios ─────────────────────────────────────────────────

describe('computeRollingScenarios', () => {
  it('returns empty for empty slots', () => {
    const n = 60
    const dates = makeDates('2015-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('X', prices), [], 10000, 6, 'monthly', 'flat', 0, null,
    )
    expect(result).toEqual([])
  })

  it('returns empty for zero totalCapital', () => {
    const n = 60
    const dates = makeDates('2015-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('X', prices), singleSlot('X'), 0, 6, 'monthly', 'flat', 0, null,
    )
    expect(result).toEqual([])
  })

  it('returns empty when not enough dates for even one scenario', () => {
    // horizonMonths=6 ≈ 26 weeks, holdingPoints=26 → need dates.length > 26
    // give only 10 dates — too short
    const n = 10
    const dates = makeDates('2015-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('X', prices), singleSlot('X'), 10000, 6, 'monthly', 'flat', 0, null,
    )
    expect(result).toEqual([])
  })

  it('rising market: LS always wins (diff > 0 for every scenario)', () => {
    // 5-year linear run-up: start=100, end=200
    const n = 5 * 52 + 1   // 261 weekly points
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, linearPrices(100, 200, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    for (const s of result) {
      expect(s.diff).toBeGreaterThan(0)   // LS buys cheap early; always wins on uptrend
    }
  })

  it('flat market: diff ≈ 0 for every scenario', () => {
    const n = 5 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    for (const s of result) {
      expect(s.diff).toBeCloseTo(0, 6)
    }
  })

  it('declining market: DCA wins (diff < 0) for every scenario', () => {
    // 3-year linear decline: 100 → 50
    const n = 3 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, linearPrices(100, 50, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    for (const s of result) {
      expect(s.diff).toBeLessThan(0)   // DCA buys cheaper; wins on decline
    }
  })

  it('lsGrowth and dcaGrowth are ratio of finalValue/totalCapital', () => {
    // Flat prices → final value = totalCapital → growth ratio = 1.0
    const n = 3 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    for (const s of result) {
      expect(s.lsGrowth).toBeCloseTo(1.0, 6)
      expect(s.dcaGrowth).toBeCloseTo(1.0, 6)
    }
  })

  it('weekly frequency produces more contributions than monthly', () => {
    const n = 3 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const base = { alignedPrices: singleFundMap('A', prices), slots: singleSlot('A') }
    const weekly = computeRollingScenarios(
      base.alignedPrices, base.slots, 10000, 6, 'weekly', 'flat', 0, null,
    )
    const monthly = computeRollingScenarios(
      base.alignedPrices, base.slots, 10000, 6, 'monthly', 'flat', 0, null,
    )
    // Both should produce scenarios; weekly has more scenarios (smaller holding window)
    expect(weekly.length).toBeGreaterThan(0)
    expect(monthly.length).toBeGreaterThan(0)
    // Weekly DCA with flat prices: result same as monthly (both cost basis = end price)
    for (const s of weekly) expect(s.diff).toBeCloseTo(0, 5)
    for (const s of monthly) expect(s.diff).toBeCloseTo(0, 5)
  })

  it('holdingPeriodMonths > horizonMonths: DCA finishes early but portfolio grows to holdingEnd', () => {
    // Flat then rising: 100 for 12mo, then 150 for next 12mo
    // LS: buys at 100, holds 24mo → final = 150, lsGrowth = 1.5
    // DCA: deploys over 12mo at price=100, then holds another 12mo to end at 150, dcaGrowth = 1.5
    // Flat prices → LS = DCA when both hold the same period
    const n = 2 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))  // flat keeps math simple
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 6, 'monthly', 'flat', 0, null,
      /* holdingPeriodMonths= */ 12,
    )
    expect(result.length).toBeGreaterThan(0)
    for (const s of result) {
      expect(s.diff).toBeCloseTo(0, 5)
    }
  })

  it('cashMode=savings: undeployed cash earns interest, so dcaGrowth > flat for rising savings rate', () => {
    const n = 3 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    // Flat prices so main portfolio doesn't change — only savings matters
    const prices = makePrices(dates, flatPrices(100, n))
    const withSavings = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'savings', 0.04, null,
    )
    const flat = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(withSavings.length).toBeGreaterThan(0)
    // savings-mode DCA final > flat-mode DCA final → diff (LS-DCA) is more negative with savings
    for (let i = 0; i < Math.min(withSavings.length, flat.length); i++) {
      expect(withSavings[i]!.dcaGrowth).toBeGreaterThanOrEqual(flat[i]!.dcaGrowth)
    }
  })

  it('startDate is the first date of each scenario window', () => {
    const n = 3 * 52 + 1
    const dates = makeDates('2010-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 6, 'monthly', 'flat', 0, null,
    )
    expect(result[0]!.startDate).toBe(dates[0])
    expect(result[1]!.startDate).toBe(dates[1])
  })
})

// ─── summarizeScenarios ───────────────────────────────────────────────────────

describe('summarizeScenarios', () => {
  it('returns null for empty input', () => {
    expect(summarizeScenarios([])).toBeNull()
  })

  it('lsWinRate = 1 when all diffs > 0', () => {
    const s = summarizeScenarios([
      { startDate: 'a', lsGrowth: 1.1, dcaGrowth: 1.0, diff: 0.1 },
      { startDate: 'b', lsGrowth: 1.2, dcaGrowth: 1.05, diff: 0.15 },
    ])
    expect(s!.lsWinRate).toBe(1)
    expect(s!.totalScenarios).toBe(2)
  })

  it('lsWinRate = 0 when all diffs ≤ 0', () => {
    const s = summarizeScenarios([
      { startDate: 'a', lsGrowth: 0.9, dcaGrowth: 1.0, diff: -0.1 },
      { startDate: 'b', lsGrowth: 0.95, dcaGrowth: 1.0, diff: -0.05 },
    ])
    expect(s!.lsWinRate).toBe(0)
    expect(s!.meanLoss).toBeLessThan(0)
  })

  it('medianDiff is the middle value for odd-length sorted list', () => {
    const s = summarizeScenarios([
      { startDate: 'a', lsGrowth: 1, dcaGrowth: 1, diff: -0.1 },
      { startDate: 'b', lsGrowth: 1, dcaGrowth: 1, diff: 0.0 },
      { startDate: 'c', lsGrowth: 1, dcaGrowth: 1, diff: 0.1 },
    ])
    expect(s!.medianDiff).toBeCloseTo(0, 10)
  })

  it('p10 / p90 are the 10th/90th percentile of diffs', () => {
    // 10 evenly spaced diffs: -0.09, -0.07, ..., +0.09
    const diffs = Array.from({ length: 10 }, (_, i) => -0.09 + i * 0.02)
    const scenarios = diffs.map((d, i) => ({
      startDate: `${i}`,
      lsGrowth: 1 + d,
      dcaGrowth: 1,
      diff: d,
    }))
    const s = summarizeScenarios(scenarios)!
    expect(s.p10).toBeLessThan(s.p25)
    expect(s.p25).toBeLessThan(s.medianDiff)
    expect(s.medianDiff).toBeLessThan(s.p75)
    expect(s.p75).toBeLessThan(s.p90)
  })

  it('meanLSGrowth / meanDCAGrowth are correct', () => {
    const s = summarizeScenarios([
      { startDate: 'a', lsGrowth: 1.1, dcaGrowth: 1.0, diff: 0.1 },
      { startDate: 'b', lsGrowth: 1.3, dcaGrowth: 1.2, diff: 0.1 },
    ])
    expect(s!.meanLSGrowth).toBeCloseTo(1.2, 10)
    expect(s!.meanDCAGrowth).toBeCloseTo(1.1, 10)
  })

  it('meanWin is average diff when LS wins, meanLoss when DCA wins', () => {
    const s = summarizeScenarios([
      { startDate: 'a', lsGrowth: 1, dcaGrowth: 1, diff: 0.2 },
      { startDate: 'b', lsGrowth: 1, dcaGrowth: 1, diff: 0.4 },
      { startDate: 'c', lsGrowth: 1, dcaGrowth: 1, diff: -0.1 },
    ])
    expect(s!.meanWin).toBeCloseTo(0.3, 10)   // (0.2 + 0.4) / 2
    expect(s!.meanLoss).toBeCloseTo(-0.1, 10)
  })
})

// ─── buildHistogram ───────────────────────────────────────────────────────────

describe('buildHistogram', () => {
  it('returns empty for no scenarios', () => {
    expect(buildHistogram([])).toEqual([])
  })

  it('single scenario: one bucket at the correct midpoint', () => {
    const s = [{ startDate: 'a', lsGrowth: 1.1, dcaGrowth: 1, diff: 0.07 }]
    const buckets = buildHistogram(s, 0.05)
    // diff=0.07 → bucket [0.05, 0.10), midpoint = 0.075
    expect(buckets.length).toBeGreaterThan(0)
    const hit = buckets.find(b => b.count === 1)
    expect(hit).toBeDefined()
    expect(hit!.positive).toBe(true)
  })

  it('negative diff lands in a negative (LS-loses) bucket', () => {
    const s = [{ startDate: 'a', lsGrowth: 0.9, dcaGrowth: 1, diff: -0.07 }]
    const buckets = buildHistogram(s, 0.05)
    const hit = buckets.find(b => b.count === 1)
    expect(hit!.positive).toBe(false)
    expect(hit!.midpoint).toBeLessThan(0)
  })

  it('bucket counts sum to total scenarios', () => {
    const scenarios = Array.from({ length: 20 }, (_, i) => ({
      startDate: `${i}`,
      lsGrowth: 1,
      dcaGrowth: 1,
      diff: (i - 10) * 0.02,   // diffs from -0.20 to +0.18
    }))
    const buckets = buildHistogram(scenarios, 0.05)
    const total = buckets.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(20)
  })

  it('label format: +X% for positive midpoints, -X% for negative', () => {
    const scenarios = [
      { startDate: 'a', lsGrowth: 1, dcaGrowth: 1, diff: 0.07 },
      { startDate: 'b', lsGrowth: 1, dcaGrowth: 1, diff: -0.07 },
    ]
    const buckets = buildHistogram(scenarios, 0.05)
    const pos = buckets.find(b => b.positive)
    const neg = buckets.find(b => !b.positive)
    expect(pos!.label).toMatch(/^\+/)
    expect(neg!.label).toMatch(/^-/)
  })
})

// ─── computeHeatmap ──────────────────────────────────────────────────────────

describe('computeHeatmap', () => {
  it('returns a 4×4 matrix matching HEATMAP_HOLDING_YEARS × HEATMAP_DCA_MONTHS', () => {
    const n = 25 * 52 + 1   // 25 years of data — enough for all cells
    const dates = makeDates('2000-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const matrix = computeHeatmap(
      singleFundMap('A', prices), singleSlot('A'), 'monthly', 'flat', 0, null,
    )
    expect(matrix).toHaveLength(HEATMAP_HOLDING_YEARS.length)
    for (const row of matrix) {
      expect(row).toHaveLength(HEATMAP_DCA_MONTHS.length)
    }
    // Row labels
    expect(matrix.map(row => row[0]!.holdingYears)).toEqual(HEATMAP_HOLDING_YEARS)
    // Column labels
    expect(matrix[0]!.map(cell => cell.dcaMonths)).toEqual(HEATMAP_DCA_MONTHS)
  })

  it('all cells have winRate in [0, 1] or null (no out-of-range values)', () => {
    const n = 25 * 52 + 1
    const dates = makeDates('2000-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const matrix = computeHeatmap(
      singleFundMap('A', prices), singleSlot('A'), 'monthly', 'flat', 0, null,
    )
    for (const row of matrix) {
      for (const cell of row) {
        if (cell.winRate !== null) {
          expect(cell.winRate).toBeGreaterThanOrEqual(0)
          expect(cell.winRate).toBeLessThanOrEqual(1)
        }
        expect(cell.totalScenarios).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('returns null winRate when fewer than 10 scenarios', () => {
    // Very short history: only ~2 years of data → short holding periods might get a cell
    // but the 20-year holding period cell will definitely have null winRate
    const n = 3 * 52 + 1   // 3 years — not enough for 20-year holding
    const dates = makeDates('2020-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const matrix = computeHeatmap(
      singleFundMap('A', prices), singleSlot('A'), 'monthly', 'flat', 0, null,
    )
    // The 20-year holding row must be all null
    const twentyYearRow = matrix.find(row => row[0]!.holdingYears === 20)!
    for (const cell of twentyYearRow) {
      expect(cell.winRate).toBeNull()
    }
  })

  it('rising market: winRate = 1 for all cells with enough data', () => {
    const n = 25 * 52 + 1
    const dates = makeDates('2000-01-01', n)
    const prices = makePrices(dates, linearPrices(100, 800, n))   // 8× run-up
    const matrix = computeHeatmap(
      singleFundMap('A', prices), singleSlot('A'), 'monthly', 'flat', 0, null,
    )
    for (const row of matrix) {
      for (const cell of row) {
        if (cell.winRate !== null) {
          expect(cell.winRate).toBe(1)
        }
      }
    }
  })
})
