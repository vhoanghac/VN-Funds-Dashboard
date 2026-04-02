import type { PricePoint, ReturnPoint, RebalanceFrequency, YearlyReturn } from '../types'

/**
 * Resample multiple ReturnPoint[] series to a common weekly date grid.
 *
 * When different portfolios have different trading dates (e.g. fund A has prices
 * on dates that fund B doesn't), charts break because merged data has gaps.
 *
 * This function:
 * 1. Collects all dates from all series
 * 2. Builds a weekly grid (every ~5 trading days)
 * 3. For each series, forward-fills to the common grid
 *
 * Returns the resampled series in the same order as input.
 */
export function resampleToWeeklyGrid(
  allSeries: ReturnPoint[][],
): ReturnPoint[][] {
  if (allSeries.length <= 1) return allSeries
  if (allSeries.some(s => s.length === 0)) return allSeries

  // Collect ALL unique dates, sorted
  const dateSet = new Set<string>()
  for (const series of allSeries) {
    for (const p of series) dateSet.add(p.date)
  }
  const allDates = Array.from(dateSet).sort()

  if (allDates.length === 0) return allSeries

  // Build weekly grid: sample every ~5 dates, always include first and last
  const step = Math.max(1, Math.min(5, Math.floor(allDates.length / 200)))
  const weeklyDates: string[] = [allDates[0]!]
  for (let i = step; i < allDates.length; i += step) {
    weeklyDates.push(allDates[i]!)
  }
  // Always include last date
  if (weeklyDates[weeklyDates.length - 1] !== allDates[allDates.length - 1]) {
    weeklyDates.push(allDates[allDates.length - 1]!)
  }

  // Resample each series to the weekly grid via forward-fill
  return allSeries.map(series => {
    const dateMap = new Map<string, number>()
    for (const p of series) dateMap.set(p.date, p.value)

    const result: ReturnPoint[] = []
    let lastValue: number | null = null

    for (const date of weeklyDates) {
      const exact = dateMap.get(date)
      if (exact !== undefined) {
        lastValue = exact
        result.push({ date, value: exact })
      } else if (lastValue !== null) {
        // Forward-fill: use last known value
        result.push({ date, value: lastValue })
      }
      // If lastValue is null, this date is before the series starts — skip
    }

    return result
  })
}

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
  /** Portfolio value over time (absolute VND) — includes cashflows (for MWRR / value chart) */
  values: { date: string; value: number }[]
  /** Total money invested over time */
  invested: { date: string; value: number }[]
  /** Individual cashflow events: { date, amount } — for MWRR/IRR calculation */
  cashflows: { date: string; amount: number }[]
  /** TWRR cumulative return series — ignores cashflows effect */
  cumulative: ReturnPoint[]
  /** TWRR drawdown series — computed from TWRR growth, not raw portfolio value */
  drawdown: ReturnPoint[]
  /** TWRR daily returns (for rolling, yearly calculations) */
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
 * Uses WEEKLY price data (last trading day of each ISO week).
 * Matches the Compare/Simulate tabs — unified date grid across all tabs.
 *
 * @param weeklyPrices - Map of fundId → PricePoint[] (weekly prices, sorted by date)
 * @param slots - Fund allocations with weights (must sum to 100)
 * @param params - DCA parameters (initial amount, cashflow, frequency)
 * @param rebalFreq - How often to rebalance weights
 */
export function simulateDCA(
  weeklyPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  params: DCAParams,
  rebalFreq: RebalanceFrequency,
): DCAResult {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0) {
    return { values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [], totalInvested: 0, finalValue: 0 }
  }

  // Normalize weights to fractions
  const totalWeight = validSlots.reduce((s, slot) => s + slot.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  // Get all weekly price arrays
  const priceArrays = fundIds.map(id => weeklyPrices.get(id) || [])

  // Find common date range
  const startDates = priceArrays.map(arr => arr[0]?.date || '9999')
  const endDates = priceArrays.map(arr => arr[arr.length - 1]?.date || '0000')
  const commonStart = startDates.reduce((a, b) => a > b ? a : b)
  const commonEnd = endDates.reduce((a, b) => a < b ? a : b)

  if (commonStart >= commonEnd) {
    return { values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [], totalInvested: 0, finalValue: 0 }
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
    return { values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [], totalInvested: 0, finalValue: 0 }
  }

  // ── Run DCA simulation ──
  // Track units held for each fund
  const units = new Array(fundIds.length).fill(0)
  let totalInvested = 0
  let lastInvestDate = ''

  // MWRR series (portfolio value includes cashflows)
  const values: { date: string; value: number }[] = []
  const invested: { date: string; value: number }[] = []
  const cashflows: { date: string; amount: number }[] = []

  // TWRR series (ignores cashflows effect — pure investment performance)
  const twrrDailyReturns: ReturnPoint[] = []
  const cumulative: ReturnPoint[] = []
  const drawdown: ReturnPoint[] = []

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
    cashflows.push({ date: allDates[0]!, amount: -params.initialAmount })
  }

  // Track for rebalancing & TWRR
  let prevDateForRebal = allDates[0]!
  let twrrGrowth = 1.0  // chain-linked TWRR growth factor
  let twrrPeak = 1.0    // for TWRR-based drawdown
  // prevEndValue: portfolio value at end of previous day (AFTER any cashflow on that day)
  let prevEndValue = totalInvested > 0 ? getPortfolioValue(allDates[0]!) : 0

  // Record day 0
  values.push({ date: allDates[0]!, value: prevEndValue })
  invested.push({ date: allDates[0]!, value: totalInvested })
  cumulative.push({ date: allDates[0]!, value: 0 })  // 0% return on day 0
  drawdown.push({ date: allDates[0]!, value: 0 })

  for (let i = 1; i < allDates.length; i++) {
    const date = allDates[i]!

    // ── TWRR Step 1: compute value BEFORE any cashflow today ──
    // This reflects pure market movement since yesterday's close
    const valueBeforeCashflow = getPortfolioValue(date)

    // Daily TWRR return = market movement only (before adding new money)
    let dailyReturn = 0
    if (prevEndValue > 0) {
      dailyReturn = valueBeforeCashflow / prevEndValue - 1
    }
    twrrDailyReturns.push({ date, value: dailyReturn })

    // Chain-link TWRR growth
    twrrGrowth *= (1 + dailyReturn)

    // ── Step 2: DCA cashflow (add new money AFTER computing return) ──
    if (params.cashflowAmount > 0) {
      const investDate = lastInvestDate || allDates[0]!
      if (shouldInvest(investDate, date, params.cashflowFreq)) {
        buyFunds(params.cashflowAmount, i)
        cashflows.push({ date, amount: -params.cashflowAmount })
      }
    }

    // ── Step 3: Rebalance check ──
    if (totalInvested > 0) {
      if (shouldRebalForDCA(prevDateForRebal, date, rebalFreq)) {
        rebalance(date)
      }
    }
    prevDateForRebal = date

    // ── Record MWRR portfolio value (AFTER cashflow) ──
    const portfolioValue = totalInvested > 0 ? getPortfolioValue(date) : 0
    values.push({ date, value: portfolioValue })
    invested.push({ date, value: totalInvested })

    // ── Record TWRR cumulative return ──
    cumulative.push({ date, value: twrrGrowth - 1 })

    // ── Record TWRR drawdown ──
    if (twrrGrowth > twrrPeak) twrrPeak = twrrGrowth
    drawdown.push({ date, value: twrrGrowth / twrrPeak - 1 })

    // Update prevEndValue for next day's TWRR calculation
    prevEndValue = portfolioValue
  }

  // Data is already weekly — use period returns directly (no manual resampling needed)
  const weeklyReturns = twrrDailyReturns

  const finalValue = values.length > 0 ? values[values.length - 1]!.value : 0

  // Add final value as positive cashflow (terminal)
  const allCashflows = [
    ...cashflows,
    { date: allDates[allDates.length - 1]!, amount: finalValue },
  ]

  return {
    values,
    invested,
    cashflows: allCashflows,
    cumulative,
    drawdown,
    returns: weeklyReturns,
    totalInvested,
    finalValue,
  }
}

/**
 * Compute rolling returns from TWRR cumulative growth series.
 *
 * Uses the cumulative return series (which already excludes cashflow effects)
 * to compute annualized rolling returns over a given period.
 *
 * cumulative[i].value = TWRR growth - 1, so growth_i = 1 + cumulative[i].value
 * rolling_return = (growth_t / growth_{t-window})^(252/window) - 1
 *
 * Output is sampled every ~5 trading days for chart display.
 */

/**
 * Compute MWRR (Money-Weighted Rate of Return) as annualized IRR.
 *
 * Uses Newton-Raphson to find the annual rate r such that:
 *   sum( CF_i / (1+r)^t_i ) = 0
 *
 * where CF_i are cashflows (negative = investment, positive = final value)
 * and t_i are years from the first cashflow.
 */
export function dcaMWRR(cashflows: { date: string; amount: number }[]): number | null {
  if (cashflows.length < 2) return null

  const t0 = new Date(cashflows[0]!.date).getTime()
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000

  // Convert to { amount, years } pairs
  const cfs = cashflows.map(cf => ({
    amount: cf.amount,
    years: (new Date(cf.date).getTime() - t0) / msPerYear,
  }))

  // Newton-Raphson to solve NPV(r) = 0
  let r = 0.10 // initial guess: 10% annual

  for (let iter = 0; iter < 200; iter++) {
    let npv = 0
    let dnpv = 0 // derivative

    for (const cf of cfs) {
      const disc = Math.pow(1 + r, cf.years)
      if (!isFinite(disc) || disc === 0) break
      npv += cf.amount / disc
      dnpv -= cf.years * cf.amount / (disc * (1 + r))
    }

    if (Math.abs(npv) < 0.01) return r // converged (within 0.01 VND)
    if (Math.abs(dnpv) < 1e-12) break // flat derivative, can't converge

    const step = npv / dnpv
    r -= step

    // Clamp to reasonable range to prevent divergence
    if (r < -0.99) r = -0.99
    if (r > 10) r = 10
  }

  return null // failed to converge
}

/**
 * Compute CAGR from TWRR cumulative series using actual calendar time.
 *
 * Unlike the generic cagr() in calculations.ts (which assumes 52 points/year),
 * this uses the actual start/end dates to compute years precisely.
 *
 * Formula: (twrrGrowth)^(1/years) - 1
 */
export function dcaCagr(cumulative: ReturnPoint[]): number | null {
  if (cumulative.length < 2) return null

  const startDate = new Date(cumulative[0]!.date)
  const endDate = new Date(cumulative[cumulative.length - 1]!.date)
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years = (endDate.getTime() - startDate.getTime()) / msPerYear

  if (years <= 0) return null

  const twrrGrowth = 1 + cumulative[cumulative.length - 1]!.value
  return Math.pow(twrrGrowth, 1 / years) - 1
}

/**
 * Compute max drawdown from TWRR cumulative series.
 *
 * Uses cumulative growth values directly instead of compounding weekly returns.
 */
export function dcaMaxDrawdown(cumulative: ReturnPoint[]): number {
  if (cumulative.length === 0) return 0

  let peak = -Infinity
  let maxDD = 0

  for (const p of cumulative) {
    const growth = 1 + p.value
    if (growth > peak) peak = growth
    const dd = growth / peak - 1
    if (dd < maxDD) maxDD = dd
  }

  return maxDD
}

/**
 * Compute yearly returns directly from TWRR cumulative series.
 *
 * For each calendar year, computes: growth_end_of_year / growth_end_of_prev_year - 1
 * This avoids artifacts from the pseudo-weekly return windowing used by yearlyReturns().
 */
export function dcaYearlyReturns(cumulative: ReturnPoint[]): YearlyReturn[] {
  if (cumulative.length < 2) return []

  // Find last cumulative value for each year
  const yearEnd = new Map<number, number>() // year → (1 + cumulative.value) at year end
  let firstYear = Infinity
  let lastYear = -Infinity

  for (const p of cumulative) {
    const year = parseInt(p.date.substring(0, 4), 10)
    // Always overwrite — cumulative is sorted, so last write = last date in year
    yearEnd.set(year, 1 + p.value)
    if (year < firstYear) firstYear = year
    if (year > lastYear) lastYear = year
  }

  const years = Array.from(yearEnd.keys()).sort((a, b) => a - b)
  const result: YearlyReturn[] = []

  for (let i = 0; i < years.length; i++) {
    const year = years[i]!
    const growthAtEnd = yearEnd.get(year)!
    const growthAtPrevEnd = i === 0 ? 1.0 : yearEnd.get(years[i - 1]!)!
    const yearReturn = growthAtEnd / growthAtPrevEnd - 1

    // Count weekly data points in this year to detect partial years
    let daysInYear = 0
    for (const p of cumulative) {
      if (parseInt(p.date.substring(0, 4), 10) === year) daysInYear++
    }
    // A full year has ~52 weekly data points; partial if < 48
    const isPartial = (year === firstYear || year === lastYear) && daysInYear < 48

    result.push({ year, value: yearReturn, isPartial })
  }

  return result
}

export function computeDCARolling(
  cumulative: ReturnPoint[],
  periodMonths: number,
): ReturnPoint[] {
  const WEEKS_PER_YEAR = 52
  const window = Math.round(periodMonths * (WEEKS_PER_YEAR / 12))

  if (cumulative.length <= window) return []

  const result: ReturnPoint[] = []
  const sampleStep = Math.max(1, Math.min(5, Math.floor((cumulative.length - window) / 200)))

  for (let i = window; i < cumulative.length; i += sampleStep) {
    const growthNow = 1 + cumulative[i]!.value
    const growthPast = 1 + cumulative[i - window]!.value
    if (growthPast > 0) {
      const periodGrowth = growthNow / growthPast
      const annualized = Math.pow(periodGrowth, WEEKS_PER_YEAR / window) - 1
      result.push({ date: cumulative[i]!.date, value: annualized })
    }
  }

  // Always include last data point
  const lastIdx = cumulative.length - 1
  if (lastIdx >= window) {
    const lastResult = result[result.length - 1]
    const lastDate = cumulative[lastIdx]!.date
    if (!lastResult || lastResult.date !== lastDate) {
      const growthNow = 1 + cumulative[lastIdx]!.value
      const growthPast = 1 + cumulative[lastIdx - window]!.value
      if (growthPast > 0) {
        const periodGrowth = growthNow / growthPast
        const annualized = Math.pow(periodGrowth, WEEKS_PER_YEAR / window) - 1
        result.push({ date: lastDate, value: annualized })
      }
    }
  }

  return result
}

/**
 * Compute Profit Factor from weekly TWRR returns.
 *
 * Profit Factor = sum(positive returns) / |sum(negative returns)|
 *
 * > 1 means total gains exceed total losses.
 * Returns null when there are no losing periods (no basis for comparison).
 */
export function dcaProfitFactor(returns: ReturnPoint[]): number | null {
  let totalGain = 0
  let totalLoss = 0
  for (const r of returns) {
    if (r.value > 0) totalGain += r.value
    else if (r.value < 0) totalLoss += Math.abs(r.value)
  }
  if (totalLoss === 0) return null
  return totalGain / totalLoss
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
