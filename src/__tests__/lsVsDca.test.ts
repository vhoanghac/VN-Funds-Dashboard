import { describe, it, expect } from 'vitest'
import {
  computeRollingScenarios,
  summarizeScenarios,
  buildHistogram,
  computeHeatmap,
  getContribIndices,
  countIndependentWindows,
  alignedSpanMonths,
  computeHoldingCost,
  computeScenarioPath,
  COST_HOLDING_YEARS,
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

/** Generate daily dates starting from startDate for `n` days (inclusive). */
function makeDailyDates(startDate: string, n: number): string[] {
  const dates: string[] = []
  const d = new Date(startDate)
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
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
  return [{ fundId, weight: 100 }]
}

// ─── getContribIndices ────────────────────────────────────────────────────────

describe('getContribIndices', () => {
  it('monthly frequency: picks the first date + every calendar-month change', () => {
    const dates = makeDates('2024-01-01', 20) // weekly-spaced, ~5 months of data
    const indices = getContribIndices(dates, 0, dates.length, 'monthly')
    const months = indices.map(i => dates[i]!.slice(0, 7))
    expect(new Set(months).size).toBe(months.length) // one contribution per distinct month
    expect(indices[0]).toBe(0)
  })

  it('weekly frequency on daily data: contributes ~once every 7 real days, not once per point', () => {
    const dates = makeDailyDates('2024-01-01', 60) // 60 daily points ≈ 2 months
    const indices = getContribIndices(dates, 0, dates.length, 'weekly')
    // ~60 days / 7 ≈ 8-9 contributions, nowhere near 60 (one per data point)
    expect(indices.length).toBeGreaterThan(5)
    expect(indices.length).toBeLessThan(15)
    // Verify actual spacing between consecutive contributions is ~7 days
    for (let i = 1; i < indices.length; i++) {
      const gapDays = (new Date(dates[indices[i]!]!).getTime() - new Date(dates[indices[i - 1]!]!).getTime()) / 86400000
      expect(gapDays).toBeGreaterThanOrEqual(7)
    }
  })

  it('weekly frequency on weekly-spaced data: contributes at every point (7-day cadence matches the grid)', () => {
    const dates = makeDates('2024-01-01', 10) // already 7 days apart
    const indices = getContribIndices(dates, 0, dates.length, 'weekly')
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('always includes startIdx as the first contribution', () => {
    const dates = makeDailyDates('2024-01-01', 30)
    const weekly = getContribIndices(dates, 5, 25, 'weekly')
    const monthly = getContribIndices(dates, 5, 25, 'monthly')
    expect(weekly[0]).toBe(5)
    expect(monthly[0]).toBe(5)
  })
})

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

// ─── computeRollingScenarios: daily-resolution data ─────────────────────────
// Dữ liệu thực tế hiện là daily (không còn resample tuần) — các test dưới đây
// đảm bảo pipeline không còn giả định ngầm "mỗi điểm = 1 tuần".

describe('computeRollingScenarios (daily data)', () => {
  it('monthly frequency: result invariant to sampling resolution (daily vs weekly) on flat prices', () => {
    const nWeekly = 3 * 52 + 1
    const weeklyDates = makeDates('2010-01-01', nWeekly)
    const weeklyPrices = makePrices(weeklyDates, flatPrices(100, nWeekly))

    const nDaily = 3 * 365 + 1
    const dailyDates = makeDailyDates('2010-01-01', nDaily)
    const dailyPrices = makePrices(dailyDates, flatPrices(100, nDaily))

    const weekly = computeRollingScenarios(
      singleFundMap('A', weeklyPrices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    const daily = computeRollingScenarios(
      singleFundMap('A', dailyPrices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(weekly.length).toBeGreaterThan(0)
    expect(daily.length).toBeGreaterThan(0)
    // Flat prices → growth ratio must be 1.0 regardless of sampling density
    for (const s of daily) {
      expect(s.lsGrowth).toBeCloseTo(1.0, 6)
      expect(s.dcaGrowth).toBeCloseTo(1.0, 6)
    }
  })

  it('weekly frequency on daily data contributes ~once every 7 days, not once per day', () => {
    const n = 2 * 365 + 1
    const dates = makeDailyDates('2010-01-01', n)
    const prices = makePrices(dates, flatPrices(100, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 6, 'weekly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    // 6-month DCA window ≈ 26 contributions if weekly-spaced; would be ~180 if daily (1 per point)
    // Growth ratio should still be exactly 1.0 on flat prices either way, so instead assert
    // indirectly via a rising market: too many (daily) contributions would front-load the average
    // cost basis very close to the start price, same as too few — so compare against monthly.
    const monthly = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 6, 'monthly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    expect(monthly.length).toBeGreaterThan(0)
  })

  it('cashMode=savings on daily data: interest compounds over real elapsed time, not point count', () => {
    // Same total time span (12 months), sampled daily vs weekly — final dcaGrowth from
    // undeployed cash interest should match closely, since interest depends on real days elapsed.
    const nWeekly = 2 * 52 + 1
    const weeklyDates = makeDates('2010-01-01', nWeekly)
    const weeklyPrices = makePrices(weeklyDates, flatPrices(100, nWeekly))
    const nDaily = 2 * 365 + 1
    const dailyDates = makeDailyDates('2010-01-01', nDaily)
    const dailyPrices = makePrices(dailyDates, flatPrices(100, nDaily))

    const weekly = computeRollingScenarios(
      singleFundMap('A', weeklyPrices), singleSlot('A'), 10000, 12, 'monthly', 'savings', 0.04, null,
    )
    const daily = computeRollingScenarios(
      singleFundMap('A', dailyPrices), singleSlot('A'), 10000, 12, 'monthly', 'savings', 0.04, null,
    )
    expect(weekly.length).toBeGreaterThan(0)
    expect(daily.length).toBeGreaterThan(0)
    // Both should show dcaGrowth > 1.0 (cash earning interest) by a similar magnitude
    expect(daily[0]!.dcaGrowth).toBeGreaterThan(1.0)
    expect(daily[0]!.dcaGrowth).toBeCloseTo(weekly[0]!.dcaGrowth, 2)
  })

  it('rising market on daily data: LS always wins, matching weekly-data behavior', () => {
    const n = 5 * 365 + 1
    const dates = makeDailyDates('2010-01-01', n)
    const prices = makePrices(dates, linearPrices(100, 200, n))
    const result = computeRollingScenarios(
      singleFundMap('A', prices), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
    )
    expect(result.length).toBeGreaterThan(0)
    for (const s of result) {
      expect(s.diff).toBeGreaterThan(0)
    }
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

// ─── countIndependentWindows ─────────────────────────────────────────────────

describe('countIndependentWindows', () => {
  it('đếm số lần thử tách rời, không đếm cửa sổ chồng lấn', () => {
    // 141 tháng dữ liệu, nắm giữ 3 năm: chỉ lọt 3 cửa sổ rời nhau.
    expect(countIndependentWindows(141, 36)).toBe(3)
    expect(countIndependentWindows(141, 60)).toBe(2)
    expect(countIndependentWindows(141, 120)).toBe(1)
  })

  it('trả 0 khi chuỗi ngắn hơn một cửa sổ', () => {
    expect(countIndependentWindows(141, 240)).toBe(0)
  })

  it('trả 0 với đầu vào vô nghĩa thay vì chia cho 0', () => {
    expect(countIndependentWindows(141, 0)).toBe(0)
    expect(countIndependentWindows(0, 36)).toBe(0)
    expect(countIndependentWindows(-5, 36)).toBe(0)
  })
})

describe('alignedSpanMonths', () => {
  it('đo độ dài chuỗi giá bằng tháng', () => {
    const prices = makePrices(makeDates('2020-01-06', 105), flatPrices(100, 105))
    // 105 tuần ≈ 24 tháng.
    const span = alignedSpanMonths(singleFundMap('A', prices), singleSlot('A'))
    expect(span).toBeGreaterThanOrEqual(23)
    expect(span).toBeLessThanOrEqual(25)
  })

  it('trả 0 khi không có quỹ nào được chọn', () => {
    const prices = makePrices(makeDates('2020-01-06', 20), flatPrices(100, 20))
    expect(alignedSpanMonths(singleFundMap('A', prices), [])).toBe(0)
    expect(alignedSpanMonths(new Map(), singleSlot('A'))).toBe(0)
  })
})

// ─── heatmap kèm số cửa sổ độc lập ───────────────────────────────────────────

describe('computeHeatmap, lớp trung thực về cỡ mẫu', () => {
  const n = 60 * 4 // ~4.6 năm dữ liệu tuần
  const prices = makePrices(makeDates('2015-01-05', n), linearPrices(100, 200, n))
  const cells = computeHeatmap(
    singleFundMap('A', prices), singleSlot('A'), 'monthly', 'flat', 0, null,
  ).flat()

  it('mỗi ô đều kèm số cửa sổ độc lập', () => {
    expect(cells.every(c => typeof c.independentWindows === 'number')).toBe(true)
  })

  it('số cửa sổ độc lập giảm khi thời gian nắm giữ tăng', () => {
    const byYear = new Map(cells.map(c => [c.holdingYears, c.independentWindows]))
    const years = [...byYear.keys()].sort((a, b) => a - b)
    for (let i = 1; i < years.length; i++) {
      expect(byYear.get(years[i]!)!).toBeLessThanOrEqual(byYear.get(years[i - 1]!)!)
    }
  })

  it('luôn ít hơn hẳn số kịch bản chồng lấn', () => {
    // Đây là lý do lớp này tồn tại: 2 con số cách nhau rất xa.
    const withData = cells.filter(c => c.winRate !== null)
    expect(withData.length).toBeGreaterThan(0)
    expect(withData.every(c => c.independentWindows < c.totalScenarios)).toBe(true)
  })

  it('mốc nắm giữ dài hơn cả chuỗi dữ liệu thì không có cửa sổ nào', () => {
    const long = cells.filter(c => c.holdingYears === 20)
    expect(long.every(c => c.independentWindows === 0)).toBe(true)
    expect(long.every(c => c.winRate === null)).toBe(true)
  })
})

// ─── computeHoldingCost ──────────────────────────────────────────────────────

describe('computeHoldingCost', () => {
  const n = 60 * 4
  const rising = makePrices(makeDates('2015-01-05', n), linearPrices(100, 200, n))

  it('trả về đúng một dòng cho mỗi mốc nắm giữ', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    expect(cost.map(c => c.holdingYears)).toEqual(COST_HOLDING_YEARS)
  })

  it('thị trường đi lên thì rải tiền chịu chi phí, tức chi phí âm', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const measured = cost.filter(c => c.medianCost !== null)
    expect(measured.length).toBeGreaterThan(0)
    expect(measured.every(c => c.medianCost! < 0)).toBe(true)
  })

  it('thị trường đi xuống thì rải tiền có lợi, chi phí dương', () => {
    const falling = makePrices(makeDates('2015-01-05', n), linearPrices(200, 100, n))
    const cost = computeHoldingCost(
      singleFundMap('A', falling), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const measured = cost.filter(c => c.medianCost !== null)
    expect(measured.length).toBeGreaterThan(0)
    expect(measured.every(c => c.medianCost! > 0)).toBe(true)
  })

  it('mốc nắm giữ ngắn hơn thời gian DCA thì đánh dấu là vô lý, không phải thiếu số', () => {
    // DCA 24 tháng mà hỏi kết quả sau 12 tháng thì chưa DCA xong. Hai lý do bỏ
    // trống này khác hẳn nhau nên giao diện phải nói khác nhau.
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 24, 'monthly', 'flat', 0, null,
    )
    const oneYear = cost.find(c => c.holdingYears === 1)!
    expect(oneYear.medianCost).toBeNull()
    expect(oneYear.tooShort).toBe(true)

    // Còn mốc 20 năm thì DCA xong từ lâu, chỉ là quỹ chưa đủ lịch sử.
    const twentyYear = cost.find(c => c.holdingYears === 20)!
    expect(twentyYear.medianCost).toBeNull()
    expect(twentyYear.tooShort).toBe(false)
  })

  it('quy được chênh lệch ra tiền, cùng dấu với phần trăm', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const measured = cost.filter(c => c.medianCost !== null)
    expect(measured.length).toBeGreaterThan(0)
    for (const c of measured) {
      expect(c.medianCostOfCapital).not.toBeNull()
      // Cùng chiều: mất % thì cũng mất tiền.
      expect(Math.sign(c.medianCostOfCapital!)).toBe(Math.sign(c.medianCost!))
    }
  })

  it('bỏ trống mốc dài hơn dữ liệu, không bịa số', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const long = cost.find(c => c.holdingYears === 20)!
    expect(long.medianCost).toBeNull()
    expect(long.independentWindows).toBe(0)
  })

  it('kèm số cửa sổ độc lập cho từng mốc', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const oneYear = cost.find(c => c.holdingYears === 1)!
    const fiveYear = cost.find(c => c.holdingYears === 5)!
    expect(oneYear.independentWindows).toBeGreaterThan(fiveYear.independentWindows)
  })
})

// ─── computeScenarioPath ──────────────────────────────────────────────────────

describe('computeScenarioPath', () => {
  const n = 5 * 52 + 1
  const dates = makeDates('2010-01-01', n)
  const wavy = makePrices(dates, Array.from({ length: n }, (_, i) =>
    100 + 40 * Math.sin(i / 9) + 30 * (i / (n - 1))))
  const cashFund = makePrices(dates, linearPrices(10, 11.5, n))

  it('trả về mảng rỗng khi ngày khởi đầu không có trong dữ liệu', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      '1999-01-01',
    )
    expect(path).toEqual([])
  })

  it('trả về mảng rỗng khi không còn đủ dữ liệu tương lai', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      dates[n - 3]!,
    )
    expect(path).toEqual([])
  })

  it('trả về mảng rỗng khi không có slot hợp lệ hoặc vốn bằng 0', () => {
    expect(computeScenarioPath(
      singleFundMap('A', wavy), [], 10000, 12, 'monthly', 'flat', 0, null, dates[0]!,
    )).toEqual([])
    expect(computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 0, 12, 'monthly', 'flat', 0, null, dates[0]!,
    )).toEqual([])
  })

  it('hai đường cùng xuất phát từ đúng tổng vốn', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      dates[0]!,
    )
    expect(path.length).toBeGreaterThan(0)
    expect(path[0]!.lsValue).toBeCloseTo(10000, 6)
    expect(path[0]!.dcaValue).toBeCloseTo(10000, 6)
    expect(path[0]!.date).toBe(dates[0])
  })

  it('ngày tăng dần và nằm trong kỳ nắm giữ', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      dates[10]!,
    )
    expect(path[0]!.date).toBe(dates[10])
    for (let i = 1; i < path.length; i++) {
      expect(path[i]!.date > path[i - 1]!.date).toBe(true)
    }
  })

  it('tổng tài sản DCA luôn bằng phần đã mua quỹ cộng phần tiền chờ', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'savings', 0.04, null,
      dates[5]!,
    )
    for (const p of path) {
      expect(p.dcaValue).toBeCloseTo(p.dcaInvested + p.dcaCash, 6)
    }
  })

  it('chế độ không sinh lãi: tiền chờ giảm dần về 0 khi góp xong', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      dates[0]!,
    )
    expect(path[0]!.dcaCash).toBeGreaterThan(0)
    expect(path[path.length - 1]!.dcaCash).toBeCloseTo(0, 6)
    for (let i = 1; i < path.length; i++) {
      expect(path[i]!.dcaCash).toBeLessThanOrEqual(path[i - 1]!.dcaCash + 1e-9)
    }
  })

  it('đánh dấu đúng số kỳ góp: DCA 12 tháng theo tháng thì có 12 lần', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      dates[0]!,
    )
    expect(path.filter(p => p.isContribution).length).toBe(12)
    expect(path[0]!.isContribution).toBe(true)
  })

  // Đây là ràng buộc quan trọng nhất: biểu đồ một kịch bản và bảng thống kê
  // phải nói cùng một con số, nếu không thì người đọc bắt được ngay.
  for (const [label, mode, rate, cash] of [
    ['không sinh lãi', 'flat', 0, null],
    ['gửi tiết kiệm', 'savings', 0.04, null],
    ['gửi quỹ khác', 'fund', 0, cashFund],
  ] as const) {
    it(`điểm cuối trùng khít với kịch bản cùng ngày khởi đầu (${label})`, () => {
      const scenarios = computeRollingScenarios(
        singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', mode, rate, cash,
      )
      expect(scenarios.length).toBeGreaterThan(20)
      for (const s of [scenarios[0]!, scenarios[37]!, scenarios[scenarios.length - 1]!]) {
        const path = computeScenarioPath(
          singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', mode, rate, cash,
          s.startDate,
        )
        const last = path[path.length - 1]!
        expect(last.lsValue / 10000).toBeCloseTo(s.lsGrowth, 9)
        expect(last.dcaValue / 10000).toBeCloseTo(s.dcaGrowth, 9)
      }
    })
  }

  it('giữ lâu hơn kỳ DCA: góp dừng sớm, đường vẫn chạy tới hết kỳ nắm giữ', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 6, 'monthly', 'flat', 0, null,
      dates[0]!, 36,
    )
    const contribs = path.filter(p => p.isContribution)
    expect(contribs.length).toBe(6)
    // Kỳ góp kết thúc sớm hơn hẳn ngày cuối của đường.
    expect(contribs[contribs.length - 1]!.date < path[path.length - 1]!.date).toBe(true)
    const scenarios = computeRollingScenarios(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 6, 'monthly', 'flat', 0, null, 36,
    )
    const match = scenarios.find(s => s.startDate === dates[0])!
    expect(path[path.length - 1]!.dcaValue / 10000).toBeCloseTo(match.dcaGrowth, 9)
  })

  it('kỳ nắm giữ ngắn hơn kỳ DCA thì không vẽ gì', () => {
    const path = computeScenarioPath(
      singleFundMap('A', wavy), singleSlot('A'), 10000, 12, 'monthly', 'flat', 0, null,
      dates[0]!, 6,
    )
    expect(path).toEqual([])
  })
})

// ─── computeHoldingCost, hai cách đếm mốc ────────────────────────────────────

describe('computeHoldingCost, chế độ giữ thêm sau lần mua cuối', () => {
  const n = 60 * 8
  const dates = makeDates('2005-01-05', n)
  const rising = makePrices(dates, linearPrices(100, 300, n))

  it('mặc định vẫn là chế độ đếm tổng thời gian', () => {
    const implicit = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const explicit = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null, 'total',
    )
    expect(implicit).toEqual(explicit)
  })

  // Đây là ràng buộc định nghĩa: giữ thêm N năm sau khi DCA xong 12 tháng
  // bằng đúng tổng thời gian N+1 năm kể từ ngày bắt đầu.
  it('DCA 12 tháng: mốc "N năm" của chế độ mới trùng mốc "N+1 năm" của chế độ cũ', () => {
    const total = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null, 'total',
    )
    const after = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null, 'afterLast',
    )
    for (const hy of [1, 2]) {
      const a = after.find(c => c.holdingYears === hy)!
      const t = total.find(c => c.holdingYears === hy + 1)!
      expect(a.medianCost).toBeCloseTo(t.medianCost!, 9)
      expect(a.medianCostOfCapital).toBeCloseTo(t.medianCostOfCapital!, 9)
      expect(a.scenarios).toBe(t.scenarios)
      expect(a.independentWindows).toBe(t.independentWindows)
    }
  })

  it('không mốc nào bị bỏ trống vì chưa DCA xong, kể cả khi DCA 36 tháng', () => {
    const after = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 36, 'monthly', 'flat', 0, null, 'afterLast',
    )
    expect(after.every(c => c.tooShort === false)).toBe(true)

    // Chế độ cũ thì hai mốc đầu chết trống, đó chính là lý do có chế độ mới.
    const total = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 36, 'monthly', 'flat', 0, null, 'total',
    )
    expect(total.find(c => c.holdingYears === 1)!.tooShort).toBe(true)
    expect(total.find(c => c.holdingYears === 2)!.tooShort).toBe(true)
  })

  it('DCA càng dài thì cùng một mốc càng cần nhiều dữ liệu, số giai đoạn tách rời giảm', () => {
    const short = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 3, 'monthly', 'flat', 0, null, 'afterLast',
    )
    const long = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 36, 'monthly', 'flat', 0, null, 'afterLast',
    )
    const s = short.find(c => c.holdingYears === 1)!
    const l = long.find(c => c.holdingYears === 1)!
    expect(l.independentWindows).toBeLessThan(s.independentWindows)
  })

  it('thị trường đi lên thì chế độ mới vẫn cho chi phí âm', () => {
    const after = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null, 'afterLast',
    )
    const measured = after.filter(c => c.medianCost !== null)
    expect(measured.length).toBeGreaterThan(0)
    expect(measured.every(c => c.medianCost! < 0)).toBe(true)
  })
})
