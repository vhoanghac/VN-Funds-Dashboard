import type { PricePoint } from '../types'
import type { DCASlot } from './dca'

export type CashMode = 'flat' | 'savings' | 'fund'
export type LSvsDCAFreq = 'weekly' | 'monthly'

export interface LSvsDCAScenario {
  startDate: string
  lsGrowth: number    // lsFinal / totalCapital (e.g., 1.15 = +15%)
  dcaGrowth: number   // dcaFinal / totalCapital
  diff: number        // lsGrowth - dcaGrowth (positive = LS wins)
}

export interface LSvsDCASummary {
  totalScenarios: number
  lsWinRate: number       // fraction 0–1
  meanLSGrowth: number    // e.g., 1.15 = +15%
  meanDCAGrowth: number
  meanDiff: number        // mean of (lsGrowth - dcaGrowth)
  medianDiff: number
  p10: number
  p25: number
  p75: number
  p90: number
  meanWin: number         // mean diff when LS wins (positive)
  meanLoss: number        // mean diff when DCA wins (negative)
}

export interface HistogramBucket {
  midpoint: number      // e.g., 0.025 = 2.5%
  label: string         // e.g., "+2.5%"
  count: number
  positive: boolean     // true = LS outperforms in this range
}

const WEEKS_PER_YEAR = 52

/**
 * Compute rolling Lump Sum vs DCA scenarios.
 *
 * For each valid start date, simulate:
 *   - LS:  invest totalCapital on day 0, hold until holdingPeriodMonths (or horizonMonths)
 *   - DCA: deploy totalCapital/n each period over horizonMonths, then hold until end
 *          undeployed cash earns according to cashMode
 *
 * When holdingPeriodMonths > horizonMonths: DCA contributions finish early, portfolio
 * continues to grow until the full holding period ends.
 */
export function computeRollingScenarios(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  totalCapital: number,
  horizonMonths: number,
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,       // annual rate, e.g. 0.04 for 4%
  cashFundPrices: PricePoint[] | null,
  holdingPeriodMonths?: number,  // total holding window; defaults to horizonMonths
): LSvsDCAScenario[] {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0 || totalCapital <= 0) return []

  const totalWeight = validSlots.reduce((s, slot) => s + slot.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  // Build price lookups: date → price for each fund
  const priceMaps: Map<string, number>[] = fundIds.map(id => {
    const prices = alignedPrices.get(id)
    const map = new Map<string, number>()
    if (prices) for (const p of prices) map.set(p.date, p.price)
    return map
  })

  // Get aligned dates from first fund
  const firstFundPrices = alignedPrices.get(fundIds[0]!)
  if (!firstFundPrices || firstFundPrices.length === 0) return []
  const dates = firstFundPrices.map(p => p.date)

  // Cash fund lookup (for cashMode === 'fund')
  const cashFundMap = (cashMode === 'fund' && cashFundPrices)
    ? (() => {
        const m = new Map<string, number>()
        for (const p of cashFundPrices) m.set(p.date, p.price)
        return m
      })()
    : null

  // DCA period in weekly data points; holding period may be longer
  const horizonPoints = Math.round(horizonMonths * (WEEKS_PER_YEAR / 12))
  const holdingPoints = holdingPeriodMonths
    ? Math.round(holdingPeriodMonths * (WEEKS_PER_YEAR / 12))
    : horizonPoints
  if (horizonPoints <= 0 || holdingPoints < horizonPoints || dates.length <= holdingPoints) return []

  const scenarios: LSvsDCAScenario[] = []

  for (let startIdx = 0; startIdx + holdingPoints < dates.length; startIdx++) {
    const endIdx = startIdx + holdingPoints
    const startDate = dates[startIdx]!
    const endDate = dates[endIdx]!

    // Contributions only happen within the DCA period (may end before endIdx)
    const contribIndices = getContribIndices(dates, startIdx, startIdx + horizonPoints, freq)
    if (contribIndices.length === 0) continue

    const contribution = totalCapital / contribIndices.length

    // ── Lump Sum path ──
    // Buy all funds at target weights on startDate, hold to endDate (no rebalancing)
    const lsUnits = weights.map((w, j) => {
      const startPrice = priceMaps[j]!.get(startDate)
      if (!startPrice || startPrice <= 0) return 0
      return (totalCapital * w) / startPrice
    })

    let lsFinal = 0
    for (let j = 0; j < fundIds.length; j++) {
      const endPrice = priceMaps[j]!.get(endDate)
      if (endPrice) lsFinal += lsUnits[j]! * endPrice
    }
    if (lsFinal <= 0) continue

    // ── DCA path ──
    const dcaUnits = new Array<number>(fundIds.length).fill(0)

    // Cash fund: buy all units at start, sell gradually as contributions are made
    let cashFundUnits = 0
    if (cashMode === 'fund' && cashFundMap) {
      const startCashPrice = cashFundMap.get(startDate)
      if (!startCashPrice || startCashPrice <= 0) continue
      cashFundUnits = totalCapital / startCashPrice
    }

    // Remaining undeployed cash (flat/savings modes)
    let cashRemaining = totalCapital

    for (let ci = 0; ci < contribIndices.length; ci++) {
      const idx = contribIndices[ci]!
      const date = dates[idx]!

      // Compound savings interest from previous contribution to this one
      if (cashMode === 'savings' && ci > 0) {
        const prevIdx = contribIndices[ci - 1]!
        const weeksElapsed = idx - prevIdx
        cashRemaining *= Math.pow(1 + cashSavingsRate, weeksElapsed / WEEKS_PER_YEAR)
      }

      // Deploy contribution: remove from cash
      if (cashMode === 'fund' && cashFundMap) {
        const cashPrice = cashFundMap.get(date)
        if (!cashPrice || cashPrice <= 0) continue
        cashFundUnits -= contribution / cashPrice
      } else {
        cashRemaining -= contribution
      }

      // Buy main portfolio with contribution
      for (let j = 0; j < fundIds.length; j++) {
        const price = priceMaps[j]!.get(date)
        if (price && price > 0) {
          dcaUnits[j]! += (contribution * weights[j]!) / price
        }
      }
    }

    // Value of main portfolio at endDate
    let dcaPortfolioValue = 0
    for (let j = 0; j < fundIds.length; j++) {
      const endPrice = priceMaps[j]!.get(endDate)
      if (endPrice) dcaPortfolioValue += dcaUnits[j]! * endPrice
    }

    // Value of remaining cash at endDate
    let dcaCashValue = 0
    if (cashMode === 'savings') {
      const lastContribIdx = contribIndices[contribIndices.length - 1]!
      const weeksToEnd = endIdx - lastContribIdx
      const residual = Math.max(0, cashRemaining)
      dcaCashValue = residual > 0
        ? residual * Math.pow(1 + cashSavingsRate, weeksToEnd / WEEKS_PER_YEAR)
        : 0
    } else if (cashMode === 'fund' && cashFundMap) {
      const endCashPrice = cashFundMap.get(endDate)
      if (endCashPrice && cashFundUnits > 0) {
        dcaCashValue = cashFundUnits * endCashPrice
      }
    }
    // flat: dcaCashValue = 0 (all capital is deployed, cash earns nothing)

    const dcaFinal = dcaPortfolioValue + dcaCashValue
    if (dcaFinal <= 0) continue

    scenarios.push({
      startDate,
      lsGrowth: lsFinal / totalCapital,
      dcaGrowth: dcaFinal / totalCapital,
      diff: lsFinal / totalCapital - dcaFinal / totalCapital,
    })
  }

  return scenarios
}

/** Returns the indices (into dates[]) where contributions should be made within [startIdx, endIdx). */
function getContribIndices(
  dates: string[],
  startIdx: number,
  endIdx: number,
  freq: LSvsDCAFreq,
): number[] {
  if (freq === 'weekly') {
    const indices: number[] = []
    for (let i = startIdx; i < endIdx; i++) indices.push(i)
    return indices
  }

  // Monthly: first date + any date where the calendar month changes
  const indices: number[] = [startIdx]
  for (let i = startIdx + 1; i < endIdx; i++) {
    const prev = new Date(dates[i - 1]!)
    const curr = new Date(dates[i]!)
    if (
      curr.getMonth() !== prev.getMonth() ||
      curr.getFullYear() !== prev.getFullYear()
    ) {
      indices.push(i)
    }
  }
  return indices
}

export function summarizeScenarios(scenarios: LSvsDCAScenario[]): LSvsDCASummary | null {
  if (scenarios.length === 0) return null

  const sorted = scenarios.map(s => s.diff).sort((a, b) => a - b)
  const lsWins = scenarios.filter(s => s.diff > 0)
  const dcaWins = scenarios.filter(s => s.diff <= 0)
  const n = scenarios.length

  return {
    totalScenarios: n,
    lsWinRate: lsWins.length / n,
    meanLSGrowth: scenarios.reduce((a, s) => a + s.lsGrowth, 0) / n,
    meanDCAGrowth: scenarios.reduce((a, s) => a + s.dcaGrowth, 0) / n,
    meanDiff: sorted.reduce((a, b) => a + b, 0) / n,
    medianDiff: pctile(sorted, 0.5),
    p10: pctile(sorted, 0.1),
    p25: pctile(sorted, 0.25),
    p75: pctile(sorted, 0.75),
    p90: pctile(sorted, 0.9),
    meanWin: lsWins.length > 0
      ? lsWins.reduce((a, s) => a + s.diff, 0) / lsWins.length
      : 0,
    meanLoss: dcaWins.length > 0
      ? dcaWins.reduce((a, s) => a + s.diff, 0) / dcaWins.length
      : 0,
  }
}

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

export const HEATMAP_HOLDING_YEARS = [2, 5, 10, 20]
export const HEATMAP_DCA_MONTHS = [3, 6, 12, 18]

export interface HeatmapCell {
  holdingYears: number
  dcaMonths: number
  winRate: number | null   // null = insufficient data (< 10 scenarios)
  totalScenarios: number
}

/**
 * Compute a matrix of LS win rates for combinations of:
 *   rows: total holding periods (HEATMAP_HOLDING_YEARS)
 *   cols: DCA contribution periods (HEATMAP_DCA_MONTHS)
 */
export function computeHeatmap(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,
  cashFundPrices: PricePoint[] | null,
): HeatmapCell[][] {
  return HEATMAP_HOLDING_YEARS.map(hy =>
    HEATMAP_DCA_MONTHS.map(dm => {
      const holdingMonths = hy * 12
      const scenarios = computeRollingScenarios(
        alignedPrices, slots, 1, dm, freq, cashMode, cashSavingsRate, cashFundPrices, holdingMonths,
      )
      if (scenarios.length < 10) {
        return { holdingYears: hy, dcaMonths: dm, winRate: null, totalScenarios: scenarios.length }
      }
      const lsWins = scenarios.filter(s => s.diff > 0).length
      return { holdingYears: hy, dcaMonths: dm, winRate: lsWins / scenarios.length, totalScenarios: scenarios.length }
    })
  )
}

/** Build histogram buckets of width `bucketWidth` (as fraction of capital, e.g. 0.05 = 5%). */
export function buildHistogram(
  scenarios: LSvsDCAScenario[],
  bucketWidth = 0.05,
): HistogramBucket[] {
  if (scenarios.length === 0) return []

  const diffs = scenarios.map(s => s.diff)
  const minD = Math.min(...diffs)
  const maxD = Math.max(...diffs)

  const bucketMin = Math.floor(minD / bucketWidth) * bucketWidth
  const bucketMax = Math.ceil(maxD / bucketWidth) * bucketWidth

  const buckets: HistogramBucket[] = []
  for (let b = bucketMin; b < bucketMax - bucketWidth / 2; b += bucketWidth) {
    const mid = b + bucketWidth / 2
    const count = diffs.filter(d => d >= b && d < b + bucketWidth).length
    const pct = mid * 100
    const sign = mid >= 0 ? '+' : ''
    buckets.push({
      midpoint: mid,
      label: `${sign}${pct.toFixed(0)}%`,
      count,
      positive: mid >= 0,
    })
  }
  return buckets
}
