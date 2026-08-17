import type {
  Portfolio,
  PortfolioSlot,
  RebalanceFrequency,
  ReturnPoint,
  StoredPortfolio,
} from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRebalanceFrequency(value: unknown): value is RebalanceFrequency {
  return value === 'monthly' || value === 'quarterly' || value === 'yearly'
}

function parseSlots(value: unknown): PortfolioSlot[] | null {
  if (!Array.isArray(value)) return null

  return value.flatMap((slot): PortfolioSlot[] => {
    if (!isRecord(slot) || typeof slot.fundId !== 'string' ||
      typeof slot.weight !== 'number' || !Number.isFinite(slot.weight) || slot.weight < 0) {
      return []
    }
    return [{ fundId: slot.fundId, weight: slot.weight }]
  })
}

function parseStoredPortfolioShape(value: unknown): StoredPortfolio | null {
  if (!isRecord(value)) return null
  const slots = parseSlots(value.slots)
  if (!slots) return null

  return {
    slots,
    rebalFreq: typeof value.rebalFreq === 'string' ? value.rebalFreq : '',
    name: typeof value.name === 'string' && value.name.length > 0
      ? value.name
      : undefined,
  }
}

export function parsePortfolio(value: unknown): Portfolio | null {
  const stored = parseStoredPortfolioShape(value)
  if (!stored) return null

  return {
    slots: stored.slots,
    rebalFreq: isRebalanceFrequency(stored.rebalFreq)
      ? stored.rebalFreq
      : 'quarterly',
    name: stored.name,
  }
}

export function parsePortfolios(value: unknown): Portfolio[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): Portfolio[] => {
    const portfolio = parsePortfolio(item)
    return portfolio ? [portfolio] : []
  })
}

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
    // Apply returns, weights drift naturally
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
