import type { PricePoint, ReturnPoint, RebalanceFrequency } from '../types'

/**
 * DCA (Dollar Cost Averaging) SIMULATION
 *
 * Simulates periodic investment into a portfolio of funds.
 * Unlike lump-sum simulation, DCA adds new money at regular intervals.
 *
 * Returns portfolio value over time as ReturnPoint[] (value = cumulative return %).
 */

export type DCAFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

export interface DCASlot {
  fundId: string
  weight: number // 0-100
}

export interface DCAPortfolio {
  id: string
  name: string
  slots: DCASlot[]
  rebalFreq: RebalanceFrequency
}

export interface DCAParams {
  initialAmount: number    // Initial lump sum
  cashflowAmount: number   // Amount per period
  cashflowFreq: DCAFrequency
}

export interface DCAResult {
  /** Portfolio value over time (absolute VND) */
  values: { date: string; value: number }[]
  /** Total money invested over time */
  invested: { date: string; value: number }[]
  /** Cumulative return series (for charts) — value = (portfolio / invested) - 1 */
  cumulative: ReturnPoint[]
  /** Weekly return series (for drawdown, rolling, yearly calculations) */
  returns: ReturnPoint[]
  /** Summary stats */
  totalInvested: number
  finalValue: number
}

/**
 * Check if a cashflow should happen on this date given the frequency.
 */
function shouldInvest(
  prevDate: string,
  currentDate: string,
  freq: DCAFrequency,
): boolean {
  const prev = new Date(prevDate)
  const curr = new Date(currentDate)

  switch (freq) {
    case 'daily':
      return true

    case 'weekly': {
      // Different ISO week
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays >= 5 // at least 5 days apart (weekly data points)
    }

    case 'biweekly': {
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays >= 12
    }

    case 'monthly': {
      const prevM = prev.getFullYear() * 12 + prev.getMonth()
      const currM = curr.getFullYear() * 12 + curr.getMonth()
      return currM > prevM
    }

    case 'quarterly': {
      const prevQ = prev.getFullYear() * 4 + Math.floor(prev.getMonth() / 3)
      const currQ = curr.getFullYear() * 4 + Math.floor(curr.getMonth() / 3)
      return currQ > prevQ
    }

    case 'semiannual': {
      const prevH = prev.getFullYear() * 2 + Math.floor(prev.getMonth() / 6)
      const currH = curr.getFullYear() * 2 + Math.floor(curr.getMonth() / 6)
      return currH > prevH
    }

    case 'yearly': {
      return curr.getFullYear() > prev.getFullYear()
    }
  }
}

/**
 * Simulate DCA for a single portfolio.
 *
 * Uses DAILY price data (not weekly) for more accurate DCA timing.
 * Each fund's daily prices are aligned to common dates.
 *
 * @param dailyPrices - Map of fundId → PricePoint[] (daily prices, sorted by date)
 * @param slots - Fund allocations with weights (must sum to 100)
 * @param params - DCA parameters (initial amount, cashflow, frequency)
 * @param rebalFreq - How often to rebalance weights
 */
export function simulateDCA(
  dailyPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  params: DCAParams,
  rebalFreq: RebalanceFrequency,
): DCAResult {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0) {
    return { values: [], invested: [], cumulative: [], returns: [], totalInvested: 0, finalValue: 0 }
  }

  // Normalize weights to fractions
  const totalWeight = validSlots.reduce((s, slot) => s + slot.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  // Get all daily price arrays
  const priceArrays = fundIds.map(id => dailyPrices.get(id) || [])

  // Find common date range
  const startDates = priceArrays.map(arr => arr[0]?.date || '9999')
  const endDates = priceArrays.map(arr => arr[arr.length - 1]?.date || '0000')
  const commonStart = startDates.reduce((a, b) => a > b ? a : b)
  const commonEnd = endDates.reduce((a, b) => a < b ? a : b)

  if (commonStart >= commonEnd) {
    return { values: [], invested: [], cumulative: [], returns: [], totalInvested: 0, finalValue: 0 }
  }

  // Build date → price lookup for each fund
  const priceLookups = priceArrays.map(arr => {
    const map = new Map<string, number>()
    for (const p of arr) map.set(p.date, p.price)
    return map
  })

  // Collect all common dates (dates where ALL funds have prices)
  const allDates: string[] = []
  const firstPrices = priceArrays[0]!
  for (const p of firstPrices) {
    if (p.date < commonStart || p.date > commonEnd) continue
    if (fundIds.every((_, i) => priceLookups[i]!.has(p.date))) {
      allDates.push(p.date)
    }
  }

  if (allDates.length < 2) {
    return { values: [], invested: [], cumulative: [], returns: [], totalInvested: 0, finalValue: 0 }
  }

  // ── Run DCA simulation ──
  // Track units held for each fund
  const units = new Array(fundIds.length).fill(0)
  let totalInvested = 0
  let lastInvestDate = ''

  const values: { date: string; value: number }[] = []
  const invested: { date: string; value: number }[] = []
  const cumulative: ReturnPoint[] = []

  // Helper: buy funds with a given amount
  function buyFunds(amount: number, dateIdx: number) {
    const date = allDates[dateIdx]!
    for (let j = 0; j < fundIds.length; j++) {
      const price = priceLookups[j]!.get(date)!
      const allocation = amount * weights[j]!
      units[j] += allocation / price
    }
    totalInvested += amount
    lastInvestDate = date
  }

  // Helper: get total portfolio value at a date
  function getPortfolioValue(date: string): number {
    let total = 0
    for (let j = 0; j < fundIds.length; j++) {
      const price = priceLookups[j]!.get(date)!
      total += units[j]! * price
    }
    return total
  }

  // Helper: rebalance — sell everything and rebuy at target weights
  function rebalance(date: string) {
    const totalValue = getPortfolioValue(date)
    for (let j = 0; j < fundIds.length; j++) {
      const price = priceLookups[j]!.get(date)!
      units[j] = (totalValue * weights[j]!) / price
    }
  }

  // Initial investment on first date
  if (params.initialAmount > 0) {
    buyFunds(params.initialAmount, 0)
  }

  // Track for rebalancing
  let prevDateForRebal = allDates[0]!

  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i]!

    // DCA cashflow (skip first date — initial investment already made)
    if (i > 0 && params.cashflowAmount > 0) {
      const investDate = lastInvestDate || allDates[0]!
      if (shouldInvest(investDate, date, params.cashflowFreq)) {
        buyFunds(params.cashflowAmount, i)
      }
    }

    // Rebalance check
    if (i > 0 && totalInvested > 0) {
      const nextDate = allDates[i]!
      if (shouldRebalForDCA(prevDateForRebal, nextDate, rebalFreq)) {
        rebalance(date)
      }
    }
    prevDateForRebal = date

    // Record portfolio value
    const portfolioValue = totalInvested > 0 ? getPortfolioValue(date) : 0
    values.push({ date, value: portfolioValue })
    invested.push({ date, value: totalInvested })

    // Cumulative return = (value / invested) - 1
    if (totalInvested > 0) {
      cumulative.push({ date, value: portfolioValue / totalInvested - 1 })
    }
  }

  // Compute weekly-ish returns for KPI calculations (sample every ~5 trading days)
  const weeklyReturns: ReturnPoint[] = []
  const step = Math.max(1, Math.min(5, Math.floor(values.length / 52)))
  for (let i = step; i < values.length; i += step) {
    const prev = values[i - step]!
    const curr = values[i]!
    if (prev.value > 0) {
      weeklyReturns.push({
        date: curr.date,
        value: curr.value / prev.value - 1,
      })
    }
  }

  const finalValue = values.length > 0 ? values[values.length - 1]!.value : 0

  return {
    values,
    invested,
    cumulative,
    returns: weeklyReturns,
    totalInvested,
    finalValue,
  }
}

function shouldRebalForDCA(
  prevDate: string,
  nextDate: string,
  freq: RebalanceFrequency,
): boolean {
  const prev = new Date(prevDate)
  const next = new Date(nextDate)

  switch (freq) {
    case 'monthly':
      return prev.getMonth() !== next.getMonth() || prev.getFullYear() !== next.getFullYear()
    case 'quarterly': {
      const prevQ = Math.floor(prev.getMonth() / 3)
      const nextQ = Math.floor(next.getMonth() / 3)
      return prevQ !== nextQ || prev.getFullYear() !== next.getFullYear()
    }
    case 'yearly':
      return prev.getFullYear() !== next.getFullYear()
  }
}
