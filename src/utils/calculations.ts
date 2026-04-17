import type { ReturnPoint, YearlyReturn } from '../types'

/**
 * CALCULATION ENGINE
 *
 * All formulas match the user's R code:
 * - Return.annualized(scale = 252) for CAGR
 * - cumprod(1 + returns) for cumulative
 * - cummax for drawdown
 * - tk_augment_slidify for rolling
 *
 * Weekly data: ~52 points/year (not 252 trading days).
 * Scale factor for annualization with weekly data = 52.
 */

const WEEKS_PER_YEAR = 52

// ─── Weekly returns ─────────────────────────────────────────

/**
 * Compute weekly returns from weekly prices.
 * return_t = price_t / price_{t-1} - 1
 */
export function weeklyReturns(
  dates: string[],
  prices: number[],
): ReturnPoint[] {
  const returns: ReturnPoint[] = []

  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!
    if (prev === 0) continue

    returns.push({
      date: dates[i]!,
      value: prices[i]! / prev - 1,
    })
  }

  return returns
}

// ─── Cumulative returns ─────────────────────────────────────

/**
 * Cumulative returns: growth_t = cumprod(1 + r) - 1
 * If startDate is provided, prepends a 0% point at the investment start date.
 */
export function cumulativeReturns(returns: ReturnPoint[], startDate?: string): ReturnPoint[] {
  if (returns.length === 0) return []

  const result: ReturnPoint[] = []
  if (startDate) {
    result.push({ date: startDate, value: 0 })
  }
  let growth = 1.0

  for (const r of returns) {
    growth *= 1 + r.value
    result.push({ date: r.date, value: growth - 1 })
  }

  return result
}

// ─── CAGR ───────────────────────────────────────────────────

/**
 * Annualized return (CAGR) using actual calendar time.
 *
 * Formula: (cumprod(1 + r))^(1/years) - 1
 * where years = actual elapsed time from first to last data point.
 *
 * This is more accurate than the old 52/n approach which assumed
 * exactly 52 data points per year.
 */
export function cagr(returns: ReturnPoint[]): number | null {
  if (returns.length === 0) return null

  let growth = 1.0
  for (const r of returns) {
    growth *= 1 + r.value
  }

  // Use actual calendar time for annualization
  const startDate = new Date(returns[0]!.date)
  const endDate = new Date(returns[returns.length - 1]!.date)
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years = (endDate.getTime() - startDate.getTime()) / msPerYear

  if (years <= 0) return null
  return Math.pow(growth, 1 / years) - 1
}

// ─── Annualized Standard Deviation ─────────────────────────

/**
 * Annualized standard deviation from weekly returns.
 *
 * Matches R: sqrt(252) * sd(daily_returns)
 * Adapted for weekly: sqrt(52) * sd(weekly_returns)
 */
export function annualizedStdev(returns: ReturnPoint[]): number {
  if (returns.length < 2) return 0
  const n = returns.length
  const mean = returns.reduce((sum, r) => sum + r.value, 0) / n
  const variance = returns.reduce((sum, r) => sum + (r.value - mean) ** 2, 0) / (n - 1)
  return Math.sqrt(variance) * Math.sqrt(WEEKS_PER_YEAR)
}

// ─── Risk Contribution ─────────────────────────────────────

/**
 * Component risk contribution of each asset in a 2-asset portfolio.
 *
 * Matches R function component_matrix():
 *   cov_matrix       <- cov(returns)
 *   sd_portfolio     <- sqrt(t(w) %*% cov_matrix %*% w)
 *   marginal         <- w %*% cov_matrix / sd_portfolio
 *   component        <- marginal * w
 *   component_pct    <- component / sd_portfolio   (sums to 1)
 *
 * @returns contribA, contribB — percentages of total portfolio risk (sum ≈ 1)
 */
export function riskContribution(
  returnsA: ReturnPoint[],
  returnsB: ReturnPoint[],
  weightA: number,
  weightB: number,
): { contribA: number; contribB: number } {
  const n = Math.min(returnsA.length, returnsB.length)
  if (n < 2 || (weightA === 0 && weightB === 0)) {
    return { contribA: 0, contribB: 0 }
  }

  let sumA = 0, sumB = 0
  for (let i = 0; i < n; i++) {
    sumA += returnsA[i]!.value
    sumB += returnsB[i]!.value
  }
  const meanA = sumA / n
  const meanB = sumB / n

  // Sample covariance matrix elements
  let covAA = 0, covAB = 0, covBB = 0
  for (let i = 0; i < n; i++) {
    const da = returnsA[i]!.value - meanA
    const db = returnsB[i]!.value - meanB
    covAA += da * da
    covAB += da * db
    covBB += db * db
  }
  covAA /= (n - 1)
  covAB /= (n - 1)
  covBB /= (n - 1)

  // Portfolio std: sqrt(w' Σ w)
  const portVar = weightA * weightA * covAA
    + 2 * weightA * weightB * covAB
    + weightB * weightB * covBB
  const portSd = Math.sqrt(portVar)
  if (portSd === 0) return { contribA: 0, contribB: 0 }

  // Marginal contribution: (w Σ) / σ_p
  const margA = (weightA * covAA + weightB * covAB) / portSd
  const margB = (weightA * covAB + weightB * covBB) / portSd

  // Component percentage: (marginal * w) / σ_p
  return {
    contribA: (margA * weightA) / portSd,
    contribB: (margB * weightB) / portSd,
  }
}

// ─── Max Drawdown ───────────────────────────────────────────

/**
 * Max drawdown: the largest peak-to-trough decline.
 *
 * growth_t = cumprod(1 + r)
 * maxgrowth_t = cummax(growth_t)
 * drawdown_t = growth_t / maxgrowth_t - 1
 *
 * Returns the minimum drawdown_t value (most negative).
 */
export function maxDrawdown(returns: ReturnPoint[]): number {
  if (returns.length === 0) return 0

  let growth = 1.0
  let peak = 1.0
  let maxDD = 0

  for (const r of returns) {
    growth *= 1 + r.value
    if (growth > peak) peak = growth
    const dd = growth / peak - 1
    if (dd < maxDD) maxDD = dd
  }

  return maxDD
}

/**
 * Tệ nhất 1 tuần: min trong toàn bộ weekly returns.
 * Dùng cho "sleep test" — dịch ra VND để người dùng cảm được pain threshold.
 */
export function worstWeeklyReturn(returns: ReturnPoint[]): number {
  if (returns.length === 0) return 0
  let worst = 0
  for (const r of returns) {
    if (r.value < worst) worst = r.value
  }
  return worst
}

/**
 * Tệ nhất 1 tháng: rolling 4-week cumulative return, lấy min.
 * Không phải calendar month mà là any 4-week window — phản ánh
 * "trong 4 tuần liên tiếp tệ nhất, bạn mất bao nhiêu".
 */
export function worstMonthlyReturn(returns: ReturnPoint[]): number {
  const WEEKS = 4
  if (returns.length < WEEKS) return 0

  // Log-space sliding window — giống rollingCumulativeReturns
  const n = returns.length
  const logR = new Float64Array(n)
  for (let i = 0; i < n; i++) logR[i] = Math.log1p(returns[i]!.value)

  let logSum = 0
  for (let i = 0; i < WEEKS; i++) logSum += logR[i]!
  let worst = Math.expm1(logSum)

  for (let i = WEEKS; i < n; i++) {
    logSum += logR[i]! - logR[i - WEEKS]!
    const v = Math.expm1(logSum)
    if (v < worst) worst = v
  }

  return worst
}

/**
 * Drawdown series over time (for chart).
 */
export function drawdownSeries(returns: ReturnPoint[], startDate?: string): ReturnPoint[] {
  if (returns.length === 0) return []

  const result: ReturnPoint[] = []
  if (startDate) {
    result.push({ date: startDate, value: 0 })
  }
  let growth = 1.0
  let peak = 1.0

  for (const r of returns) {
    growth *= 1 + r.value
    if (growth > peak) peak = growth
    result.push({ date: r.date, value: growth / peak - 1 })
  }

  return result
}

// ─── Yearly Returns ─────────────────────────────────────────

/**
 * Returns for each calendar year.
 * Computed as cumprod(1 + weekly_returns_in_year) - 1.
 *
 * Partial first/last years are included but flagged with isPartial.
 */
export function yearlyReturns(returns: ReturnPoint[]): YearlyReturn[] {
  if (returns.length === 0) return []

  // Group returns by year
  const yearGroups = new Map<number, ReturnPoint[]>()
  for (const r of returns) {
    const year = parseInt(r.date.substring(0, 4), 10)
    const group = yearGroups.get(year)
    if (group) {
      group.push(r)
    } else {
      yearGroups.set(year, [r])
    }
  }

  const years = Array.from(yearGroups.keys()).sort((a, b) => a - b)
  const firstYear = years[0]!
  const lastYear = years[years.length - 1]!

  const result: YearlyReturn[] = []

  for (const year of years) {
    const group = yearGroups.get(year)!
    let growth = 1.0
    for (const r of group) {
      growth *= 1 + r.value
    }

    // A year is partial if it's the first or last year and doesn't
    // have roughly a full year of data (~48+ weeks)
    const isPartial =
      (year === firstYear || year === lastYear) && group.length < 48

    result.push({ year, value: growth - 1, isPartial })
  }

  return result
}

// ─── Win Rate ───────────────────────────────────────────────

/**
 * Win rate: fraction of full calendar years where A's return > B's return.
 * Only counts non-partial years. Returns null if no full years exist.
 */
export function winRate(
  yearlyA: YearlyReturn[],
  yearlyB: YearlyReturn[],
): number | null {
  const fullA = yearlyA.filter(y => !y.isPartial)
  const fullB = yearlyB.filter(y => !y.isPartial)

  // Build lookup for B
  const bMap = new Map(fullB.map(y => [y.year, y.value]))

  let wins = 0
  let total = 0

  for (const a of fullA) {
    const bValue = bMap.get(a.year)
    if (bValue === undefined) continue
    total++
    if (a.value > bValue) wins++
  }

  if (total === 0) return null
  return wins / total
}

/**
 * Win rate among N funds: fraction of full calendar years where
 * this fund had the best return among all compared funds.
 */
export function winRateAmong(
  allYearly: YearlyReturn[][],
  fundIndex: number,
): number | null {
  // Build year → value[] map
  const yearMap = new Map<number, (number | null)[]>()
  const n = allYearly.length

  for (let i = 0; i < n; i++) {
    for (const y of allYearly[i]!) {
      if (y.isPartial) continue
      if (!yearMap.has(y.year)) yearMap.set(y.year, new Array(n).fill(null))
      yearMap.get(y.year)![i] = y.value
    }
  }

  let wins = 0
  let total = 0

  for (const [, values] of yearMap) {
    // Only count years where ALL funds have data
    if (values.some(v => v === null)) continue
    total++
    const myValue = values[fundIndex]!
    const isBest = values.every(v => myValue >= v!)
    if (isBest) wins++
  }

  return total > 0 ? wins / total : null
}

// ─── Rolling Cumulative Returns ─────────────────────────────

/**
 * Rolling cumulative (total) return over a sliding window.
 *
 * O(n) via log-space sliding window — no array allocations per step.
 *
 * Uses: log(∏(1+rᵢ)) = Σlog(1+rᵢ), slide by adding new log and
 * subtracting the oldest. Math.log1p / Math.expm1 for precision.
 *
 * Equivalent result to the naive O(n×w) cumprod approach.
 */
export function rollingCumulativeReturns(
  returns: ReturnPoint[],
  windowSizeWeeks: number,
): ReturnPoint[] {
  const n = returns.length
  if (n < windowSizeWeeks) return []

  // Precompute log(1+r) once — O(n)
  const logR = new Float64Array(n)
  for (let i = 0; i < n; i++) logR[i] = Math.log1p(returns[i]!.value)

  // Seed the first window sum
  let logSum = 0
  for (let i = 0; i < windowSizeWeeks; i++) logSum += logR[i]!

  const result: ReturnPoint[] = []
  result.push({
    date: returns[windowSizeWeeks - 1]!.date,
    value: Math.expm1(logSum),
  })

  // Slide: O(1) per step
  for (let i = windowSizeWeeks; i < n; i++) {
    logSum += logR[i]! - logR[i - windowSizeWeeks]!
    result.push({ date: returns[i]!.date, value: Math.expm1(logSum) })
  }

  return result
}

/**
 * Rolling win rate: trong tất cả các khoảng rolling window dài `windowWeeks`,
 * có bao nhiêu khoảng mà portfolio A (BTC) có lợi nhuận tích lũy cao hơn
 * portfolio B (baseline không BTC)?
 *
 * Trả về { wins, total } để UI có thể hiển thị "87/100 lần thắng".
 *
 * Dùng rollingCumulativeReturns cho cả hai series rồi match theo date.
 * Cả hai series phải đã được simulate trên cùng một khoảng thời gian
 * (kết quả của simulateMultiFundPortfolio với cùng weekly data).
 */
export function rollingWinRate(
  returnsA: ReturnPoint[],
  returnsB: ReturnPoint[],
  windowWeeks: number,
): { wins: number; total: number } {
  if (returnsA.length < windowWeeks || returnsB.length < windowWeeks) {
    return { wins: 0, total: 0 }
  }

  const rollA = rollingCumulativeReturns(returnsA, windowWeeks)
  const rollB = rollingCumulativeReturns(returnsB, windowWeeks)
  const mapB = new Map(rollB.map(r => [r.date, r.value]))

  let wins = 0
  let total = 0
  for (const r of rollA) {
    const bVal = mapB.get(r.date)
    if (bVal === undefined) continue
    total++
    if (r.value > bVal) wins++
  }

  return { wins, total }
}

// ─── Rolling Annualized Std Dev ─────────────────────────────

/**
 * Rolling annualized standard deviation over a sliding window.
 *
 * O(n) via sliding sum + sum-of-squares — no array allocations per step.
 *
 * variance = (sumSq - sum²/w) / (w-1)  (Bessel-corrected sample variance)
 * annualized = sqrt(variance) × sqrt(52)
 *
 * Math.max(0, variance) guards against tiny negatives from float rounding.
 */
export function rollingAnnualizedStdev(
  returns: ReturnPoint[],
  windowSizeWeeks: number,
): ReturnPoint[] {
  const n = returns.length
  if (n < windowSizeWeeks || windowSizeWeeks < 2) return []

  const w = windowSizeWeeks
  const sqrtAnnualize = Math.sqrt(WEEKS_PER_YEAR)

  // Seed first window
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < w; i++) {
    const v = returns[i]!.value
    sum += v
    sumSq += v * v
  }

  const result: ReturnPoint[] = []
  const variance0 = Math.max(0, (sumSq - (sum * sum) / w) / (w - 1))
  result.push({
    date: returns[w - 1]!.date,
    value: Math.sqrt(variance0) * sqrtAnnualize,
  })

  // Slide: O(1) per step
  for (let i = w; i < n; i++) {
    const vIn  = returns[i]!.value
    const vOut = returns[i - w]!.value
    sum   += vIn - vOut
    sumSq += vIn * vIn - vOut * vOut
    const variance = Math.max(0, (sumSq - (sum * sum) / w) / (w - 1))
    result.push({
      date: returns[i]!.date,
      value: Math.sqrt(variance) * sqrtAnnualize,
    })
  }

  return result
}

// ─── Rolling Max Drawdown ───────────────────────────────────

/**
 * Rolling maximum drawdown over a sliding window.
 *
 * For each endpoint t, computes the max peak-to-trough decline
 * over the preceding windowSizeWeeks weekly returns.
 *
 * Matches R: rollapply(width = 1095, FUN = maxDrawdown) from
 * PerformanceAnalytics, where maxDrawdown returns the most negative
 * value of growth_t / cummax(growth_t) - 1.
 *
 * Values are negative (or zero): e.g., -0.35 = -35% drawdown.
 *
 * O(n×w) — no O(n) shortcut exists for sliding-window max drawdown.
 * Optimized by using direct index access (no .slice() allocations).
 */
export function rollingMaxDrawdown(
  returns: ReturnPoint[],
  windowSizeWeeks: number,
): ReturnPoint[] {
  const n = returns.length
  if (n < windowSizeWeeks) return []

  const result: ReturnPoint[] = []

  for (let i = windowSizeWeeks - 1; i < n; i++) {
    const start = i - windowSizeWeeks + 1
    let growth = 1.0
    let peak = 1.0
    let maxDD = 0
    for (let j = start; j <= i; j++) {
      growth *= 1 + returns[j]!.value
      if (growth > peak) peak = growth
      const dd = growth / peak - 1
      if (dd < maxDD) maxDD = dd
    }
    result.push({ date: returns[i]!.date, value: maxDD })
  }

  return result
}

// ─── Rolling Returns ────────────────────────────────────────

/**
 * Rolling annualized returns over a sliding window.
 *
 * Window size = periodMonths * (52/12) weeks ≈ periodMonths * 4.33
 * Annualized with scale = 52 (weekly data).
 *
 * Matches R: tk_augment_slidify(.f = Return.annualized,
 *            .period = periodMonths * 21, scale = 252)
 * but adapted for weekly data.
 */
export function rollingReturns(
  returns: ReturnPoint[],
  periodMonths: number,
): ReturnPoint[] {
  const windowSize = Math.round(periodMonths * (WEEKS_PER_YEAR / 12))

  if (returns.length < windowSize) return []

  const result: ReturnPoint[] = []

  for (let i = windowSize; i <= returns.length; i++) {
    const windowReturns = returns.slice(i - windowSize, i)

    let growth = 1.0
    for (const r of windowReturns) {
      growth *= 1 + r.value
    }

    const annualized = Math.pow(growth, WEEKS_PER_YEAR / windowSize) - 1

    result.push({
      date: windowReturns[windowReturns.length - 1]!.date,
      value: annualized,
    })
  }

  return result
}

/**
 * Average of rolling returns (for KPI card).
 */
export function rollingAverage(rolling: ReturnPoint[]): number | null {
  if (rolling.length === 0) return null
  const sum = rolling.reduce((acc, r) => acc + r.value, 0)
  return sum / rolling.length
}
