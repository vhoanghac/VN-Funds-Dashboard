import type { PricePoint, WeeklyPrice } from '../types'

/**
 * Resample daily prices to weekly by taking the last trading day
 * of each ISO week (typically Friday, but could be earlier if
 * Friday is a holiday).
 *
 * Groups by ISO week number, takes the last date in each group.
 */
export function resampleToWeekly(daily: PricePoint[]): WeeklyPrice[] {
  if (daily.length === 0) return []

  const weekMap = new Map<string, PricePoint>()

  for (const point of daily) {
    const weekKey = getISOWeekKey(point.date)
    // Always keep the latest date in each week
    const existing = weekMap.get(weekKey)
    if (!existing || point.date > existing.date) {
      weekMap.set(weekKey, point)
    }
  }

  const weekly = Array.from(weekMap.values())
  weekly.sort((a, b) => a.date.localeCompare(b.date))

  return weekly.map(p => ({ date: p.date, price: p.price }))
}

/**
 * Returns "YYYY-WNN" key for ISO week grouping.
 */
/**
 * Align multiple funds' weekly prices to a common date grid.
 *
 * Different funds may have different "last trading days" within the same
 * ISO week (e.g., Fund A trades until Thursday, Fund B until Friday).
 * This causes chart lines to misalign because they have different x-values.
 *
 * Fix: for each ISO week, pick ONE representative date (the latest across
 * all funds), and remap every fund's price to that common date.
 */
export function alignFundsToCommonGrid(
  fundPrices: Map<string, PricePoint[]>,
): Map<string, PricePoint[]> {
  if (fundPrices.size <= 1) return fundPrices

  // Step 1: For each ISO week, find the latest date across all funds
  const weekToCommonDate = new Map<string, string>()
  for (const prices of fundPrices.values()) {
    for (const p of prices) {
      const wk = getISOWeekKey(p.date)
      const existing = weekToCommonDate.get(wk)
      if (!existing || p.date > existing) {
        weekToCommonDate.set(wk, p.date)
      }
    }
  }

  // Step 2: Sort weeks by their common date
  const sortedWeeks = Array.from(weekToCommonDate.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))

  // Step 3: Remap each fund's prices to the common dates
  const result = new Map<string, PricePoint[]>()
  for (const [fundId, prices] of fundPrices) {
    // Build ISO week → price for this fund
    const weekPrice = new Map<string, number>()
    for (const p of prices) {
      weekPrice.set(getISOWeekKey(p.date), p.price)
    }

    const aligned: PricePoint[] = []
    for (const [wk, commonDate] of sortedWeeks) {
      const price = weekPrice.get(wk)
      if (price !== undefined) {
        aligned.push({ date: commonDate, price })
      }
    }

    result.set(fundId, aligned)
  }

  return result
}

export function getISOWeekKey(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  const year = date.getFullYear()

  // ISO week calculation
  const jan4 = new Date(year, 0, 4)
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(year, 0, 1).getTime()) / 86400000
  ) + 1

  const jan4DayOfWeek = (jan4.getDay() + 6) % 7 // Mon=0
  const weekNumber = Math.floor((dayOfYear + jan4DayOfWeek - 1) / 7)

  return `${year}-W${String(weekNumber).padStart(2, '0')}`
}
