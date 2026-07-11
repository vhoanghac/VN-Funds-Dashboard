import type { PricePoint } from '../types'
import type { DCASlot } from './dca'
import { monthsAheadIndex } from './dateWindow'

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
  medianLSGrowth: number
  meanDCAGrowth: number
  medianDCAGrowth: number
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

/**
 * Return the price at `date`, or the most recent price before `date` if
 * an exact match doesn't exist (last-observation-carried-forward).
 * Assumes `prices` is sorted ascending by date.
 */
function priceAtOrBefore(prices: PricePoint[], date: string): number | undefined {
  let lo = 0, hi = prices.length - 1, result: number | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (prices[mid]!.date <= date) {
      result = prices[mid]!.price
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

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
  const dateTimes = dates.map(d => new Date(d).getTime())

  // Cash fund lookup (for cashMode === 'fund')
  // Uses last-observation-carried-forward so date gaps (e.g. holidays) don't skip scenarios.
  const getCashPrice = (cashMode === 'fund' && cashFundPrices)
    ? (date: string) => priceAtOrBefore(cashFundPrices, date)
    : null

  // Với mỗi startIdx, tìm index kết thúc kỳ DCA (horizon) và kết thúc kỳ nắm giữ
  // (holding) bằng lịch thực (calendar month), thay vì cộng số điểm cố định
  // (giả định lưới tuần đều đặn — sai khi dữ liệu là daily). Dùng chung
  // monthsAheadIndex với calculations.ts/dca.ts (xem dateWindow.ts).
  const horizonEndIndices = monthsAheadIndex(dateTimes, horizonMonths)
  const holdingEndIndices = holdingPeriodMonths
    ? monthsAheadIndex(dateTimes, holdingPeriodMonths)
    : horizonEndIndices
  if (horizonMonths <= 0 || (holdingPeriodMonths ?? horizonMonths) < horizonMonths) return []

  const scenarios: LSvsDCAScenario[] = []

  for (let startIdx = 0; startIdx < dates.length; startIdx++) {
    const horizonEndIdx = horizonEndIndices[startIdx]!
    const endIdx = holdingEndIndices[startIdx]!
    // j tăng đơn điệu theo startIdx (two-pointer) nên một khi hết dữ liệu
    // tương lai, mọi startIdx lớn hơn cũng sẽ hết — dừng hẳn vòng lặp.
    if (endIdx >= dates.length) break
    const startDate = dates[startIdx]!
    const endDate = dates[endIdx]!

    // Contributions only happen within the DCA period (may end before endIdx)
    const contribIndices = getContribIndices(dates, startIdx, horizonEndIdx, freq)
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
    if (cashMode === 'fund' && getCashPrice) {
      const startCashPrice = getCashPrice(startDate)
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
        const prevDate = dates[contribIndices[ci - 1]!]!
        const yearsElapsed = daysBetween(prevDate, date) / 365.25
        cashRemaining *= Math.pow(1 + cashSavingsRate, yearsElapsed)
      }

      // Deploy contribution: remove from cash
      if (cashMode === 'fund' && getCashPrice) {
        const cashPrice = getCashPrice(date)
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
      const lastContribDate = dates[contribIndices[contribIndices.length - 1]!]!
      const yearsToEnd = daysBetween(lastContribDate, endDate) / 365.25
      const residual = Math.max(0, cashRemaining)
      dcaCashValue = residual > 0
        ? residual * Math.pow(1 + cashSavingsRate, yearsToEnd)
        : 0
    } else if (cashMode === 'fund' && getCashPrice) {
      const endCashPrice = getCashPrice(endDate)
      const safeUnits = Math.max(0, cashFundUnits)
      if (endCashPrice && safeUnits > 0) {
        dcaCashValue = safeUnits * endCashPrice
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
export function getContribIndices(
  dates: string[],
  startIdx: number,
  endIdx: number,
  freq: LSvsDCAFreq,
): number[] {
  if (freq === 'weekly') {
    // Chọn điểm cách nhau ~7 ngày thực kể từ lần góp trước (two-pointer),
    // thay vì "mỗi điểm dữ liệu 1 lần" (đúng khi lưới là tuần đều đặn,
    // sai khi lưới là daily — sẽ thành góp mỗi ngày thay vì mỗi tuần).
    const indices: number[] = [startIdx]
    let lastTime = new Date(dates[startIdx]!).getTime()
    for (let i = startIdx + 1; i < endIdx; i++) {
      const t = new Date(dates[i]!).getTime()
      if (t - lastTime >= 7 * 86400000) {
        indices.push(i)
        lastTime = t
      }
    }
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
  const sortedLS = scenarios.map(s => s.lsGrowth).sort((a, b) => a - b)
  const sortedDCA = scenarios.map(s => s.dcaGrowth).sort((a, b) => a - b)
  const lsWins = scenarios.filter(s => s.diff > 0)
  const dcaWins = scenarios.filter(s => s.diff <= 0)
  const n = scenarios.length

  return {
    totalScenarios: n,
    lsWinRate: lsWins.length / n,
    meanLSGrowth: scenarios.reduce((a, s) => a + s.lsGrowth, 0) / n,
    medianLSGrowth: pctile(sortedLS, 0.5),
    meanDCAGrowth: scenarios.reduce((a, s) => a + s.dcaGrowth, 0) / n,
    medianDCAGrowth: pctile(sortedDCA, 0.5),
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
      // totalCapital=1: win rate is scale-invariant, so any positive value gives the same result
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
  const minD = diffs.reduce((a, b) => Math.min(a, b), Infinity)
  const maxD = diffs.reduce((a, b) => Math.max(a, b), -Infinity)

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
