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
function getISOWeekKey(dateStr: string): string {
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
