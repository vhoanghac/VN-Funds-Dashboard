import type { WeeklyPrice } from '../types'

export interface AlignedPair {
  dates: string[]
  pricesA: number[]
  pricesB: number[]
}

/**
 * Align two weekly price series to their common date range.
 * Start from the first date where both series have data.
 * End at the last date where both series have data.
 *
 * For dates where one series has data and the other doesn't,
 * forward-fill from the most recent available value (max 2 weeks gap
 * for weekly data, equivalent to ~10 trading days).
 */
export function alignWeeklySeries(
  seriesA: WeeklyPrice[],
  seriesB: WeeklyPrice[],
): AlignedPair {
  if (seriesA.length === 0 || seriesB.length === 0) {
    throw new NoOverlapError('One or both series are empty')
  }

  const mapA = new Map(seriesA.map(p => [p.date, p.price]))
  const mapB = new Map(seriesB.map(p => [p.date, p.price]))

  // All unique dates, sorted
  const allDates = Array.from(
    new Set([...mapA.keys(), ...mapB.keys()])
  ).sort()

  // Find common start: first date where both have data
  const startA = seriesA[0]!.date
  const startB = seriesB[0]!.date
  const commonStart = startA > startB ? startA : startB

  // Find common end
  const endA = seriesA[seriesA.length - 1]!.date
  const endB = seriesB[seriesB.length - 1]!.date
  const commonEnd = endA < endB ? endA : endB

  if (commonStart > commonEnd) {
    throw new NoOverlapError('No overlapping date range between the two series')
  }

  // Filter to common range
  const rangeDates = allDates.filter(d => d >= commonStart && d <= commonEnd)

  const dates: string[] = []
  const pricesA: number[] = []
  const pricesB: number[] = []

  let lastA: number | null = null
  let lastB: number | null = null
  let gapA = 0
  let gapB = 0
  const MAX_GAP_WEEKS = 2

  for (const date of rangeDates) {
    const a = mapA.get(date)
    const b = mapB.get(date)

    if (a !== undefined) {
      lastA = a
      gapA = 0
    } else {
      gapA++
    }

    if (b !== undefined) {
      lastB = b
      gapB = 0
    } else {
      gapB++
    }

    // Skip if gap is too large or no prior value
    if (lastA === null || lastB === null) continue
    if (gapA > MAX_GAP_WEEKS || gapB > MAX_GAP_WEEKS) continue

    dates.push(date)
    pricesA.push(lastA)
    pricesB.push(lastB)
  }

  if (dates.length === 0) {
    throw new NoOverlapError('No valid aligned data points after forward-fill')
  }

  return { dates, pricesA, pricesB }
}

export interface AlignedMulti {
  dates: string[]
  prices: number[][] // prices[fundIndex][dateIndex]
}

/**
 * Align N weekly price series to their common date range.
 * Forward-fill with max 2 week gap for each series.
 */
export function alignMultiSeries(
  allSeries: WeeklyPrice[][],
): AlignedMulti {
  const n = allSeries.length
  if (n === 0) throw new NoOverlapError('No series provided')

  const maps = allSeries.map(s => new Map(s.map(p => [p.date, p.price])))

  // All unique dates
  const dateSet = new Set<string>()
  for (const m of maps) for (const k of m.keys()) dateSet.add(k)
  const allDates = Array.from(dateSet).sort()

  // Common range: max of starts, min of ends
  let commonStart = ''
  let commonEnd = 'z'
  for (const s of allSeries) {
    if (s.length === 0) throw new NoOverlapError('One or more series are empty')
    const start = s[0]!.date
    const end = s[s.length - 1]!.date
    if (start > commonStart) commonStart = start
    if (end < commonEnd) commonEnd = end
  }

  if (commonStart > commonEnd) {
    throw new NoOverlapError('No overlapping date range')
  }

  const rangeDates = allDates.filter(d => d >= commonStart && d <= commonEnd)

  const MAX_GAP_WEEKS = 2
  const lastValues: (number | null)[] = new Array(n).fill(null)
  const gaps: number[] = new Array(n).fill(0)

  const dates: string[] = []
  const prices: number[][] = Array.from({ length: n }, () => [])

  for (const date of rangeDates) {
    let valid = true

    for (let j = 0; j < n; j++) {
      const val = maps[j]!.get(date)
      if (val !== undefined) {
        lastValues[j] = val
        gaps[j] = 0
      } else {
        gaps[j]!++
      }
      if (lastValues[j] === null || gaps[j]! > MAX_GAP_WEEKS) {
        valid = false
      }
    }

    if (!valid) continue

    dates.push(date)
    for (let j = 0; j < n; j++) {
      prices[j]!.push(lastValues[j]!)
    }
  }

  if (dates.length === 0) {
    throw new NoOverlapError('No valid aligned data points')
  }

  return { dates, prices }
}

export class NoOverlapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoOverlapError'
  }
}
