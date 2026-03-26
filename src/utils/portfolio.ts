import type { ReturnPoint, RebalanceFrequency } from '../types'

/**
 * PORTFOLIO SIMULATION
 *
 * Simulates a 2-fund portfolio with periodic rebalancing.
 * (Kept for backward compatibility)
 */
export function simulatePortfolio(
  returnsA: ReturnPoint[],
  returnsB: ReturnPoint[],
  weightA: number,
  rebalFreq: RebalanceFrequency,
): ReturnPoint[] {
  return simulateMultiFundPortfolio(
    [returnsA, returnsB],
    [weightA, 1 - weightA],
    rebalFreq,
  )
}

/**
 * N-FUND PORTFOLIO SIMULATION
 *
 * Correct periodic rebalancing (NOT constant-weight):
 * - Between rebalance dates, weights drift naturally based on returns
 * - On rebalance dates, reset to target weights
 * - This matches tq_portfolio() behavior in R
 */
export function simulateMultiFundPortfolio(
  allReturns: ReturnPoint[][],
  weights: number[], // 0-1 each, must sum to ~1.0
  rebalFreq: RebalanceFrequency,
): ReturnPoint[] {
  const n = allReturns.length
  if (n === 0) return []

  const len = allReturns[0]!.length
  if (len === 0) return []
  for (const r of allReturns) {
    if (r.length !== len) {
      throw new Error('All return series must be the same length (aligned)')
    }
  }

  const result: ReturnPoint[] = []
  const values = weights.slice() // current component values
  let prevTotal = 1.0

  for (let i = 0; i < len; i++) {
    // Apply returns — weights drift naturally
    for (let j = 0; j < n; j++) {
      values[j] = values[j]! * (1 + allReturns[j]![i]!.value)
    }

    let totalValue = 0
    for (let j = 0; j < n; j++) totalValue += values[j]!

    const periodReturn = totalValue / prevTotal - 1
    result.push({ date: allReturns[0]![i]!.date, value: periodReturn })

    prevTotal = totalValue

    // Rebalance check
    const nextDate = i + 1 < len ? allReturns[0]![i + 1]!.date : null
    if (nextDate && shouldRebalance(allReturns[0]![i]!.date, nextDate, rebalFreq)) {
      for (let j = 0; j < n; j++) {
        values[j] = weights[j]! * totalValue
      }
    }
  }

  return result
}

/**
 * Determine if we should rebalance between two consecutive dates.
 * Rebalance at the start of a new period (month/quarter/year).
 */
function shouldRebalance(
  currentDate: string,
  nextDate: string,
  freq: RebalanceFrequency,
): boolean {
  const current = parseYMD(currentDate)
  const next = parseYMD(nextDate)

  switch (freq) {
    case 'monthly':
      return current.month !== next.month || current.year !== next.year
    case 'quarterly':
      return getQuarter(current.month) !== getQuarter(next.month) ||
        current.year !== next.year
    case 'yearly':
      return current.year !== next.year
  }
}

function getQuarter(month: number): number {
  return Math.ceil(month / 3)
}

function parseYMD(date: string): { year: number; month: number } {
  return {
    year: parseInt(date.substring(0, 4), 10),
    month: parseInt(date.substring(5, 7), 10),
  }
}
