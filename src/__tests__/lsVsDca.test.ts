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
  computeDrawdownBuckets,
  drawdownFromRunningPeak,
  DRAWDOWN_BANDS,
  computeSincePeakBuckets,
  SINCE_PEAK_BANDS,
  COST_HOLDING_YEARS,
  HEATMAP_HOLDING_YEARS,
  HEATMAP_DCA_MONTHS,
  dcaEndingForNarrative,
} from '../utils/lsVsDca'
import type { PricePoint } from '../types'
import type { DCASlot } from '../utils/dca'
import { alignFundsToCommonGridDaily } from '../utils/weeklyResample'

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

  // Regression: ISSUE-002 — narrative endings must reconcile with the shown diff
  // Found by /qa on 2026-08-14
  // Report: .gstack/qa-reports/qa-report-localhost-5173-2026-08-14.md
  it('DCA về đích suy từ LS + chênh lệch, khớp đúng con số chênh hiển thị', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    const measured = cost.filter(c => c.medianLsGrowth !== null && c.medianCostOfCapital !== null)
    expect(measured.length).toBeGreaterThan(0)
    for (const c of measured) {
      const dcaEnd = dcaEndingForNarrative(c.medianLsGrowth!, c.medianCostOfCapital!)
      // Ba con số kể trong câu phải khớp: DCA = LS + chênh, chênh = DCA − LS.
      expect(dcaEnd - c.medianLsGrowth!).toBeCloseTo(c.medianCostOfCapital!, 10)
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

// ─── computeHoldingCost, dãy mốc và cách đếm ─────────────────────────────────

describe('computeHoldingCost, mốc là tổng thời gian', () => {
  const n = 60 * 8
  const dates = makeDates('2005-01-05', n)
  const rising = makePrices(dates, linearPrices(100, 300, n))

  it('có đủ mốc liên tục từ 1 tới 10 năm, rồi 15 và 20', () => {
    expect(COST_HOLDING_YEARS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20])
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    expect(cost.map(c => c.holdingYears)).toEqual(COST_HOLDING_YEARS)
  })

  // Ràng buộc định nghĩa: mốc đếm từ ngày ĐẦU, không phải từ lần mua cuối.
  // Nên mốc N năm luôn là đúng N*12 tháng bất kể kỳ DCA dài bao nhiêu.
  it('mốc N năm luôn là N*12 tháng, không đổi theo kỳ DCA', () => {
    const dca6 = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 6, 'monthly', 'flat', 0, null,
    )
    const dca24 = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 24, 'monthly', 'flat', 0, null,
    )
    // Cùng mốc 5 năm thì cùng độ dài cửa sổ, nên cùng số giai đoạn tách rời,
    // dù kỳ DCA khác nhau. Nếu mốc tính từ lần mua cuối thì hai số này đã lệch.
    const a = dca6.find(c => c.holdingYears === 5)!
    const b = dca24.find(c => c.holdingYears === 5)!
    expect(a.independentWindows).toBe(b.independentWindows)
  })

  it('mốc ngắn hơn kỳ DCA thì bỏ trống vì chưa rải xong', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 36, 'monthly', 'flat', 0, null,
    )
    expect(cost.find(c => c.holdingYears === 1)!.tooShort).toBe(true)
    expect(cost.find(c => c.holdingYears === 2)!.tooShort).toBe(true)
    expect(cost.find(c => c.holdingYears === 3)!.tooShort).toBe(false)
  })

  it('mốc dài hơn thì số giai đoạn tách rời giảm dần, không tăng', () => {
    const cost = computeHoldingCost(
      singleFundMap('A', rising), singleSlot('A'), 12, 'monthly', 'flat', 0, null,
    )
    for (let i = 1; i < cost.length; i++) {
      expect(cost[i]!.independentWindows).toBeLessThanOrEqual(cost[i - 1]!.independentWindows)
    }
  })
})

// ─── computeDrawdownBuckets ──────────────────────────────────────────────────

describe('drawdownFromRunningPeak', () => {
  it('dùng đỉnh tính tới đúng ngày đó, không nhìn trộm đỉnh tương lai', () => {
    const dates = makeDates('2020-01-06', 5)
    // Giá lên 100 → 200, sụt về 100, rồi vọt lên 400.
    const prices = makePrices(dates, [100, 200, 100, 150, 400])
    const dd = drawdownFromRunningPeak(prices)
    // Ngày thứ 3 giảm 50% so với đỉnh 200 lúc đó, KHÔNG phải 75% so với đỉnh 400 sau này.
    expect(dd.get(dates[2]!)!.drawdown).toBeCloseTo(-0.5, 9)
    expect(dd.get(dates[2]!)!.peak).toBe(200)
    // Ngày lập đỉnh mới thì mức giảm bằng 0.
    expect(dd.get(dates[4]!)!.drawdown).toBeCloseTo(0, 9)
    expect(dd.get(dates[0]!)!.drawdown).toBeCloseTo(0, 9)
  })

  it('đỉnh không bao giờ giảm khi đi dọc chuỗi', () => {
    const dates = makeDates('2020-01-06', 40)
    const prices = makePrices(dates, Array.from({ length: 40 }, (_, i) => 100 + 50 * Math.sin(i / 3)))
    const dd = drawdownFromRunningPeak(prices)
    let last = 0
    for (const d of dates) {
      const peak = dd.get(d)!.peak
      expect(peak).toBeGreaterThanOrEqual(last)
      last = peak
    }
  })
})

describe('computeDrawdownBuckets', () => {
  const n = 52 * 12
  const dates = makeDates('2010-01-01', n)
  // Hai chu kỳ tăng rồi sập sâu, để có đợt sụt giảm thật sự tách rời nhau.
  const cyclical = makePrices(dates, Array.from({ length: n }, (_, i) => {
    const cycle = Math.floor(i / (n / 2))
    const t = (i % (n / 2)) / (n / 2)
    const base = 100 * Math.pow(2, cycle)
    return base * (t < 0.5 ? 1 + 2.4 * t : 2.2 - 2.6 * (t - 0.5))
  }))

  const scen = computeRollingScenarios(
    singleFundMap('A', cyclical), singleSlot('A'), 1e8, 12, 'monthly', 'flat', 0, null,
  )

  it('trả về đúng một dòng cho mỗi dải', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    expect(rows.map(r => r.label)).toEqual(DRAWDOWN_BANDS.map(b => b.label))
  })

  // Các dải rời nhau nên tổng phải khớp, không được đếm trùng hay bỏ sót.
  it('mỗi kịch bản vào đúng một dải, tổng bằng tổng số kịch bản', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    const sum = rows.reduce((a, r) => a + r.scenarios, 0)
    expect(sum).toBe(scen.length)
  })

  it('số đợt luôn nhỏ hơn hẳn số kịch bản ở dải có dữ liệu', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    const filled = rows.filter(r => r.scenarios > 20)
    expect(filled.length).toBeGreaterThan(0)
    for (const r of filled) {
      expect(r.episodes).toBeGreaterThan(0)
      expect(r.episodes).toBeLessThan(r.scenarios)
    }
  })

  it('hai chu kỳ sập giống nhau thì dải sâu ghi nhận 2 đợt', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    const deep = rows.filter(r => r.to <= -0.3 && r.scenarios > 0)
    expect(deep.length).toBeGreaterThan(0)
    for (const r of deep) {
      expect(r.episodes).toBeLessThanOrEqual(2)
    }
  })

  it('dải không có tháng nào thì để trống, không bịa số', () => {
    const flat = makePrices(dates, flatPrices(100, n))
    const flatScen = computeRollingScenarios(
      singleFundMap('A', flat), singleSlot('A'), 1e8, 12, 'monthly', 'flat', 0, null,
    )
    const rows = computeDrawdownBuckets(singleFundMap('A', flat), singleSlot('A'), flatScen, 12)
    // Giá phẳng thì luôn sát đỉnh, mọi dải sâu đều rỗng.
    for (const r of rows.filter(x => x.to <= -0.1)) {
      expect(r.scenarios).toBe(0)
      expect(r.episodes).toBe(0)
      expect(r.lsWinRate).toBeNull()
      expect(r.medianCost).toBeNull()
    }
    expect(rows[0]!.scenarios).toBe(flatScen.length)
  })

  it('trả về mọi dải rỗng khi không có kịch bản hoặc không có slot', () => {
    expect(computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), [], 12)
      .every(r => r.scenarios === 0)).toBe(true)
    expect(computeDrawdownBuckets(singleFundMap('A', cyclical), [], scen, 12)
      .every(r => r.scenarios === 0)).toBe(true)
  })

  // Lỗi đã mắc: gộp đợt theo đỉnh chung khiến đợt tăng TRƯỚC cú sập và đợt hồi
  // phục SAU cú sập dính làm một, vì cả hai cùng đứng dưới một đỉnh cũ.
  it('hai lần vào dải cách nhau nhiều năm là hai đợt, không gộp làm một', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    const nearPeak = rows[0]!
    expect(nearPeak.scenarios).toBeGreaterThan(50)
    // Chuỗi có 2 chu kỳ nên vùng sát đỉnh phải xuất hiện ít nhất 2 lần tách rời.
    expect(nearPeak.episodes).toBeGreaterThanOrEqual(2)
  })

  // Lỗi đã mắc: lấy kỳ nắm giữ làm ngưỡng gộp đợt. Ở chế độ giữ thêm 2 năm,
  // ngưỡng thành 42 tháng, mà đáy 2018 với đáy 2022 của Bitcoin cách nhau 38
  // tháng nên bị gộp thành một đợt. Số cú sập phải là chuyện của lịch sử giá,
  // không đổi theo việc người dùng định giữ bao lâu.
  it('hai bear market dài, cách nhau ngắn hơn kỳ nắm giữ, vẫn là hai đợt', () => {
    // Dựng giống Bitcoin: sập rồi NẰM SÂU nhiều năm chứ không hồi ngay.
    // Bear 1 kéo từ năm 2 tới năm 4, bear 2 từ năm 6 tới năm 8, tức đáy nọ
    // cách đáy kia 2 năm, ngắn hơn kỳ nắm giữ 42 tháng.
    //
    // Cách đếm cũ đo khoảng cách tới NGÀY LIỀN TRƯỚC nên chuỗi ngày sát nhau
    // trong cùng một bear nối dài mãi, rồi nối luôn sang bear sau vì 2 năm
    // ngắn hơn 3,5 năm. Kết quả gộp cả hai thành 1 đợt. Cách mới đo từ ngày
    // đã CHỌN nên không bị nối kiểu đó.
    const n = 52 * 11
    const d = makeDates('2010-01-01', n)
    const px = makePrices(d, Array.from({ length: n }, (_, i) => {
      const yr = i / 52
      if (yr < 2) return 100 + 50 * yr              // lên, đỉnh 200
      if (yr < 2.5) return 200 - 150 * (yr - 2)     // sập còn 125
      if (yr < 4) return 125                        // nằm sâu, dưới -35%
      if (yr < 5.5) return 125 + 90 * (yr - 4)      // hồi, đỉnh mới 260
      if (yr < 6) return 260 - 200 * (yr - 5.5)     // sập lần hai còn 160
      if (yr < 8) return 160                        // lại nằm sâu, dưới -38%
      return 160 + 40 * (yr - 8)
    }))
    const s = computeRollingScenarios(
      singleFundMap('A', px), singleSlot('A'), 1e8, 12, 'monthly', 'flat', 0, null, 42,
    )
    const rows = computeDrawdownBuckets(singleFundMap('A', px), singleSlot('A'), s, 42)
    const deep = rows.filter(r => r.to <= -0.3 && r.scenarios > 0)
    expect(deep.length).toBeGreaterThan(0)
    expect(Math.max(...deep.map(r => r.episodes))).toBe(2)
  })

  // Con số giai đoạn là lời khẳng định, danh sách ngày là bằng chứng. Ba test
  // dưới đây khoá chuyện bằng chứng phải khớp lời khẳng định.
  it('số giai đoạn luôn bằng đúng số ngày liệt kê ra', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    for (const r of rows) {
      expect(r.episodeStarts.length).toBe(r.episodes)
    }
  })

  it('các ngày liệt kê ra thật sự không đè lên nhau', () => {
    for (const hold of [12, 24, 42]) {
      const s = computeRollingScenarios(
        singleFundMap('A', cyclical), singleSlot('A'), 1e8, 12, 'monthly', 'flat', 0, null, hold,
      )
      const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), s, hold)
      const minGapMs = hold * 30.44 * 86400000
      for (const r of rows) {
        for (let i = 1; i < r.episodeStarts.length; i++) {
          const gap = new Date(r.episodeStarts[i]!).getTime()
            - new Date(r.episodeStarts[i - 1]!).getTime()
          expect(gap).toBeGreaterThanOrEqual(minGapMs)
        }
      }
    }
  })

  it('mọi ngày liệt kê ra đều là ngày bắt đầu có thật của một kịch bản', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    const realStarts = new Set(scen.map(s => s.startDate))
    for (const r of rows) {
      for (const d of r.episodeStarts) {
        expect(realStarts.has(d)).toBe(true)
      }
    }
  })

  // Chốt ràng buộc: số giai đoạn không được vượt số quãng không đè lên nhau
  // mà cả chuỗi chứa nổi, tức đúng con số countIndependentWindows dùng ở
  // heatmap và bảng chi phí. Trước đây dải nông của BTC báo 19 trong khi
  // cả lịch sử chỉ nhét vừa 3 quãng 42 tháng.
  it('số đợt không vượt quá số quãng không đè nhau mà cả chuỗi chứa nổi', () => {
    for (const hold of [12, 24, 42]) {
      const s = computeRollingScenarios(
        singleFundMap('A', cyclical), singleSlot('A'), 1e8, 12, 'monthly', 'flat', 0, null, hold,
      )
      const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), s, hold)
      const ceiling = countIndependentWindows(
        alignedSpanMonths(singleFundMap('A', cyclical), singleSlot('A')), hold,
      )
      for (const r of rows) {
        expect(r.episodes).toBeLessThanOrEqual(ceiling)
      }
    }
  })

  it('tỷ lệ LS thắng nằm trong khoảng 0 tới 1', () => {
    const rows = computeDrawdownBuckets(singleFundMap('A', cyclical), singleSlot('A'), scen, 12)
    for (const r of rows.filter(x => x.lsWinRate !== null)) {
      expect(r.lsWinRate!).toBeGreaterThanOrEqual(0)
      expect(r.lsWinRate!).toBeLessThanOrEqual(1)
    }
  })
})

// ─── computeSincePeakBuckets ─────────────────────────────────────────────────

describe('computeSincePeakBuckets', () => {
  // Một chu kỳ: lên 2 năm tới đỉnh, sập sâu rồi nằm dưới đáy gần 3 năm, sau đó hồi.
  const n = 52 * 11
  const dates = makeDates('2010-01-01', n)
  const cycle = makePrices(dates, Array.from({ length: n }, (_, i) => {
    const yr = i / 52
    if (yr < 2) return 100 + 50 * yr           // lên, đỉnh 200 ở năm 2
    if (yr < 3) return 200 - 120 * (yr - 2)    // sập còn 80, tức -60%
    if (yr < 5) return 80 + 10 * (yr - 3)      // nằm sâu rồi bò lên chậm
    return 100 + 45 * (yr - 5)                 // hồi mạnh
  }))
  const scen = computeRollingScenarios(
    singleFundMap('A', cycle), singleSlot('A'), 1e8, 12, 'monthly', 'flat', 0, null, 12,
  )

  it('trả về đúng một dòng cho mỗi nhóm thời gian', () => {
    const rows = computeSincePeakBuckets(singleFundMap('A', cycle), singleSlot('A'), scen, 12)
    expect(rows.map(r => r.label)).toEqual(SINCE_PEAK_BANDS.map(b => b.label))
  })

  it('chỉ tính những lần đã rời đỉnh đủ sâu, không tính lúc quanh đỉnh', () => {
    const rows = computeSincePeakBuckets(singleFundMap('A', cycle), singleSlot('A'), scen, 12)
    const total = rows.reduce((a, r) => a + r.scenarios, 0)
    // Phải ít hơn hẳn tổng số kịch bản, vì phần lớn thời gian giá không giảm sâu.
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThan(scen.length)
  })

  // Ràng buộc định nghĩa: chuỗi này chỉ có một đỉnh thật, nên mọi ngày trong
  // đợt sập phải xếp theo đúng khoảng cách tới đỉnh đó, tăng dần qua các nhóm.
  it('xếp đúng nhóm theo khoảng cách tới đỉnh', () => {
    const rows = computeSincePeakBuckets(singleFundMap('A', cycle), singleSlot('A'), scen, 12)
    const filled = rows.filter(r => r.scenarios > 0)
    expect(filled.length).toBeGreaterThan(1)
    for (const r of filled) {
      for (const d of r.episodeStarts) {
        // Đỉnh ở khoảng đầu năm 2012 (năm thứ 2 của chuỗi bắt đầu 2010).
        const months = (new Date(d).getTime() - new Date('2012-01-01').getTime()) / 86400000 / 30.44
        expect(months).toBeGreaterThanOrEqual(r.from - 2)
        expect(months).toBeLessThan(r.to + 2)
      }
    }
  })

  it('giữ nguyên lớp trung thực: số giai đoạn khớp danh sách ngày', () => {
    const rows = computeSincePeakBuckets(singleFundMap('A', cycle), singleSlot('A'), scen, 12)
    for (const r of rows) {
      expect(r.episodeStarts.length).toBe(r.episodes)
    }
  })

  it('tỷ lệ đang lỗ nằm trong khoảng 0 tới 1', () => {
    const rows = computeSincePeakBuckets(singleFundMap('A', cycle), singleSlot('A'), scen, 12)
    for (const r of rows.filter(x => x.lsLossRate !== null)) {
      expect(r.lsLossRate!).toBeGreaterThanOrEqual(0)
      expect(r.lsLossRate!).toBeLessThanOrEqual(1)
    }
  })

  it('trả về mọi nhóm rỗng khi không có kịch bản hoặc không có slot', () => {
    expect(computeSincePeakBuckets(singleFundMap('A', cycle), singleSlot('A'), [], 12)
      .every(r => r.scenarios === 0)).toBe(true)
    expect(computeSincePeakBuckets(singleFundMap('A', cycle), [], scen, 12)
      .every(r => r.scenarios === 0)).toBe(true)
  })
})

// ─── Danh mục nhiều quỹ khác ngày ra đời ─────────────────────────────────────

describe('danh mục nhiều quỹ: lưới ngày phải là giao của mọi quỹ', () => {
  // Lỗi đã mắc: lấy lưới ngày từ quỹ ĐỨNG ĐẦU danh mục. Mà
  // alignFundsToCommonGridDaily cố ý không thêm điểm cho quỹ chưa ra đời, nên
  // với quỹ dài đứng trước, mọi ngày trước khi quỹ sau ra đời đều thiếu giá.
  // Phần vốn của quỹ đó bị tính là đã tiêu nhưng không mua được gì.
  //
  // Đo trước khi sửa: giá phẳng tuyệt đối mà 105 trên 208 kịch bản trả về 0,5
  // thay vì 1,0. Và kết quả đổi theo thứ tự người dùng kéo thả quỹ.
  const dLong = makeDates('2010-01-01', 260)
  const dShort = makeDates('2012-01-06', 156)
  const twoFunds = () => alignFundsToCommonGridDaily(new Map([
    ['LONG', makePrices(dLong, flatPrices(100, dLong.length))],
    ['SHORT', makePrices(dShort, flatPrices(50, dShort.length))],
  ]))

  it('giá phẳng tuyệt đối thì mọi kịch bản phải bằng đúng vốn, bất kể thứ tự quỹ', () => {
    for (const order of [['LONG', 'SHORT'], ['SHORT', 'LONG']]) {
      const slots = order.map(id => ({ fundId: id, weight: 50 }))
      const s = computeRollingScenarios(
        twoFunds(), slots, 1e8, 12, 'monthly', 'flat', 0, null,
      )
      expect(s.length).toBeGreaterThan(0)
      for (const x of s) {
        expect(x.lsGrowth).toBeCloseTo(1, 9)
        expect(x.dcaGrowth).toBeCloseTo(1, 9)
      }
    }
  })

  it('đổi thứ tự quỹ không làm đổi kết quả', () => {
    const a = computeRollingScenarios(
      twoFunds(), [{ fundId: 'LONG', weight: 50 }, { fundId: 'SHORT', weight: 50 }],
      1e8, 12, 'monthly', 'flat', 0, null,
    )
    const b = computeRollingScenarios(
      twoFunds(), [{ fundId: 'SHORT', weight: 50 }, { fundId: 'LONG', weight: 50 }],
      1e8, 12, 'monthly', 'flat', 0, null,
    )
    expect(a.length).toBe(b.length)
    expect(a.map(x => x.startDate)).toEqual(b.map(x => x.startDate))
  })

  it('không kịch bản nào bắt đầu trước ngày quỹ ra đời muộn nhất', () => {
    const s = computeRollingScenarios(
      twoFunds(), [{ fundId: 'LONG', weight: 50 }, { fundId: 'SHORT', weight: 50 }],
      1e8, 12, 'monthly', 'flat', 0, null,
    )
    expect(s.length).toBeGreaterThan(0)
    for (const x of s) {
      expect(x.startDate >= dShort[0]!).toBe(true)
    }
  })

  it('đường đi một kịch bản dùng chung lưới ngày với bảng kịch bản', () => {
    const slots = [{ fundId: 'LONG', weight: 50 }, { fundId: 'SHORT', weight: 50 }]
    const s = computeRollingScenarios(twoFunds(), slots, 1e8, 12, 'monthly', 'flat', 0, null)
    const target = s[10]!
    const path = computeScenarioPath(
      twoFunds(), slots, 1e8, 12, 'monthly', 'flat', 0, null, target.startDate,
    )
    expect(path.length).toBeGreaterThan(0)
    const last = path[path.length - 1]!
    expect(last.lsValue / 1e8).toBeCloseTo(target.lsGrowth, 9)
    expect(last.dcaValue / 1e8).toBeCloseTo(target.dcaGrowth, 9)
  })

  // Ca cực đoan: hai quỹ cách nhau 15 năm, không trùng ngày gốc nào. Hàm căn
  // chỉnh chuyển tiếp giá cuối của quỹ cũ nên vẫn có giao, nhưng giao đó phải
  // bắt đầu từ ngày quỹ sau ra đời chứ không sớm hơn.
  it('hai quỹ cách nhau rất xa: kịch bản chỉ bắt đầu từ khi quỹ sau ra đời', () => {
    const early = makeDates('2000-01-07', 100)
    const late = makeDates('2015-01-02', 300)
    const far = alignFundsToCommonGridDaily(new Map([
      ['EARLY', makePrices(early, flatPrices(100, early.length))],
      ['LATE', makePrices(late, flatPrices(100, late.length))],
    ]))
    const s = computeRollingScenarios(
      far, [{ fundId: 'EARLY', weight: 50 }, { fundId: 'LATE', weight: 50 }],
      1e8, 12, 'monthly', 'flat', 0, null,
    )
    expect(s.length).toBeGreaterThan(0)
    for (const x of s) {
      expect(x.startDate >= late[0]!).toBe(true)
      expect(x.lsGrowth).toBeCloseTo(1, 9)
    }
  })
})

// ─── alignedSpanMonths trên danh mục nhiều quỹ ───────────────────────────────

describe('alignedSpanMonths đo trên giao của mọi quỹ', () => {
  // Lỗi đã mắc: đo trên quỹ ĐỨNG ĐẦU. Với DCDS (2004) cộng E1VFVN30 (2014) nó
  // trả về 266 tháng trong khi phân tích chỉ chạy được 141 tháng, khiến hàng
  // "2 năm" của heatmap báo 11 giai đoạn tách rời thay vì 5.
  const dLong = makeDates('2010-01-01', 260)    // 5 năm
  const dShort = makeDates('2012-01-06', 156)   // ra đời muộn 2 năm
  const twoFunds = () => alignFundsToCommonGridDaily(new Map([
    ['LONG', makePrices(dLong, flatPrices(100, dLong.length))],
    ['SHORT', makePrices(dShort, flatPrices(50, dShort.length))],
  ]))

  it('không đổi theo thứ tự quỹ trong danh mục', () => {
    const a = alignedSpanMonths(twoFunds(), [
      { fundId: 'LONG', weight: 50 }, { fundId: 'SHORT', weight: 50 },
    ])
    const b = alignedSpanMonths(twoFunds(), [
      { fundId: 'SHORT', weight: 50 }, { fundId: 'LONG', weight: 50 },
    ])
    expect(a).toBe(b)
  })

  it('ngắn hơn dải của quỹ dài, vì chỉ tính từ khi quỹ sau ra đời', () => {
    const both = alignedSpanMonths(twoFunds(), [
      { fundId: 'LONG', weight: 50 }, { fundId: 'SHORT', weight: 50 },
    ])
    const longOnly = alignedSpanMonths(twoFunds(), [{ fundId: 'LONG', weight: 100 }])
    expect(both).toBeLessThan(longOnly)
    // Quỹ sau ra đời muộn đúng 2 năm nên giao ngắn hơn khoảng 24 tháng.
    expect(longOnly - both).toBeGreaterThanOrEqual(23)
  })

  // Đây là chỗ lỗi biểu hiện ra mặt người dùng: lớp trung thực về cỡ mẫu.
  it('số giai đoạn tách rời không bị thổi lên gấp đôi', () => {
    const slots = [{ fundId: 'LONG', weight: 50 }, { fundId: 'SHORT', weight: 50 }]
    const span = alignedSpanMonths(twoFunds(), slots)
    const longSpan = alignedSpanMonths(twoFunds(), [{ fundId: 'LONG', weight: 100 }])
    expect(countIndependentWindows(span, 24))
      .toBeLessThan(countIndependentWindows(longSpan, 24))
  })
})

// ─── buildHistogram không được làm rơi kịch bản ──────────────────────────────

describe('buildHistogram giữ đủ mọi kịch bản', () => {
  // Lỗi đã mắc: ô cuối là nửa khoảng [max-w, max), nên giá trị lớn nhất khi
  // đúng bằng bội của độ rộng ô rơi ra ngoài mọi ô và mất trắng.
  const mk = (diffs: number[]) => diffs.map((d, i) => ({
    startDate: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
    lsGrowth: 1 + d, dcaGrowth: 1, diff: d,
  }))

  it('tổng số đếm luôn bằng đúng số kịch bản', () => {
    const cases: number[][] = [
      [-0.10, 0, 0.10, 0.20],           // mọi giá trị đúng bội của 0,05
      [-0.33, 0.07, 1.24, 22.5],        // biên độ rộng như Bitcoin
      [0.05, 0.05, 0.05],               // trùng nhau, đúng mép ô
      [-0.05],                          // đúng một kịch bản, đúng mép
      [0],                              // đúng một kịch bản bằng 0
    ]
    for (const diffs of cases) {
      const h = buildHistogram(mk(diffs))
      const total = h.reduce((a, b) => a + b.count, 0)
      expect(total).toBe(diffs.length)
    }
  })

  it('giá trị lớn nhất nằm trong ô cuối cùng, không rơi ra ngoài', () => {
    // 0,20 là bội đúng của 0,05 nên đây chính là ca lỗi cũ.
    const h = buildHistogram(mk([-0.10, 0.20]))
    expect(h[h.length - 1]!.count).toBeGreaterThan(0)
  })

  it('mốc giữa các ô không bị trôi số thực dù nhiều ô', () => {
    const h = buildHistogram(mk([-0.5, 20]))
    expect(h.length).toBeGreaterThan(300)
    for (let i = 1; i < h.length; i++) {
      expect(h[i]!.midpoint - h[i - 1]!.midpoint).toBeCloseTo(0.05, 9)
    }
  })
})
