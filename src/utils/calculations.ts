import type { ReturnPoint, YearlyReturn, MonthlyReturn } from '../types'
import { daysBetween } from './dateMath'
import { rollingWindowStarts } from './dateWindow'

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
 * Ngưỡng coi như "không biến động".
 *
 * Một tài sản lãi suất cố định (tiết kiệm ngân hàng) đáng lẽ có độ lệch chuẩn
 * đúng bằng 0, nhưng lãi kép tính bằng số thực dấu phẩy động để lại nhiễu cỡ
 * 1e-15. Nếu chỉ chặn `stdev > 0` thì phép chia CAGR/stdev cho ra Sharpe cỡ
 * 2e13, một con số vô nghĩa trông như lỗi. Mọi tài sản có rủi ro thật đều có
 * độ lệch chuẩn quy năm từ khoảng 0,5% trở lên, nên ngưỡng này không bao giờ
 * chạm nhầm vào chúng.
 */
export const ZERO_VOLATILITY_EPSILON = 1e-9

/**
 * Annualized standard deviation.
 *
 * Matches R: sqrt(252) * sd(daily_returns), adapted cho weekly: sqrt(52) * sd(...).
 * Số kỳ/năm được SUY RA từ khoảng thời gian thực tế của chuỗi (n điểm trải
 * trên bao nhiêu năm), thay vì cố định 52 — nên đúng bất kể input là daily
 * hay weekly.
 */
export function annualizedStdev(returns: ReturnPoint[]): number {
  if (returns.length < 2) return 0
  const n = returns.length
  const mean = returns.reduce((sum, r) => sum + r.value, 0) / n
  const variance = returns.reduce((sum, r) => sum + (r.value - mean) ** 2, 0) / (n - 1)

  const startDate = new Date(returns[0]!.date)
  const endDate = new Date(returns[n - 1]!.date)
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000)
  const periodsPerYear = years > 0 ? n / years : WEEKS_PER_YEAR

  return Math.sqrt(variance) * Math.sqrt(periodsPerYear)
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
 * @returns contribA, contribB: percentages of total portfolio risk (sum ≈ 1)
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
 * Tệ nhất trong bất kỳ cửa sổ `windowDays` NGÀY LỊCH liên tiếp nào (rolling
 * calendar-day cumulative return, lấy giá trị nhỏ nhất). Two-pointer trên
 * mốc thời gian thực tế nên đúng bất kể chuỗi `returns` là daily hay weekly —
 * khác cách tính cũ (giả định "1 phần tử = 1 tuần"), vốn sai kể từ khi pipeline
 * chuyển sang dùng dữ liệu daily (mỗi phần tử chỉ còn là 1 ngày).
 */
function worstRollingCalendarReturn(returns: ReturnPoint[], windowDays: number): number {
  const n = returns.length
  if (n === 0) return 0

  const dates = returns.map(r => new Date(r.date).getTime())
  const logR = new Float64Array(n)
  for (let i = 0; i < n; i++) logR[i] = Math.log1p(returns[i]!.value)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + logR[i]!

  const windowMs = windowDays * 24 * 60 * 60 * 1000
  let worst = 0
  let j = 0
  for (let i = 0; i < n; i++) {
    // returns[k] chỉ lưu NGÀY KẾT THÚC của kỳ đó (dates[k]); điểm bắt đầu thực
    // sự là dates[k-1] (ẩn, không có trong mảng). Vì vậy so `dates[i] - dates[j]`
    // (không phải dates[j-1]) với windowMs sẽ "quên tính" độ dài của chính kỳ j —
    // nếu dùng so sánh không nghiêm ngặt (`>`), 2 kỳ cách nhau ĐÚNG bằng windowDays
    // (vd dữ liệu weekly thật, cách nhau đúng 7 ngày) sẽ bị gộp nhầm thành 1 cửa
    // sổ 14 ngày thay vì tách thành 2 cửa sổ 7 ngày riêng biệt. Dùng `>=` để loại
    // kỳ j ngay khi đưa nó vào sẽ chạm mốc giới hạn (không chỉ khi vượt hẳn).
    while (j < i && dates[i]! - dates[j]! >= windowMs) j++
    const logSum = prefix[i + 1]! - prefix[j]!
    const v = Math.expm1(logSum)
    if (v < worst) worst = v
  }
  return worst
}

/**
 * Tệ nhất 1 tuần: rolling 7-ngày-lịch cumulative return, lấy min.
 * Dùng cho "sleep test", dịch ra VND để người dùng cảm được pain threshold.
 */
export function worstWeeklyReturn(returns: ReturnPoint[]): number {
  return worstRollingCalendarReturn(returns, 7)
}

/**
 * Tệ nhất 1 tháng: rolling 28-ngày-lịch (~4 tuần) cumulative return, lấy min.
 * Không phải calendar month mà là bất kỳ cửa sổ 28-ngày nào. Phản ánh
 * "trong 28 ngày liên tiếp tệ nhất, bạn mất bao nhiêu".
 */
export function worstMonthlyReturn(returns: ReturnPoint[]): number {
  return worstRollingCalendarReturn(returns, 28)
}

/**
 * Thống kê drawdown: đáy sâu nhất + bao nhiêu tuần để hồi phục.
 *
 * Walk qua cumulative growth, lock vào drawdown sâu nhất, rồi sau
 * đáy đó tìm tuần đầu tiên growth >= peak cũ (hồi phục).
 *
 * Nếu tới hết chuỗi vẫn chưa về lại peak: recoveryWeeks = null
 * (quỹ vẫn đang ở "under water").
 */
export interface DrawdownStats {
  maxDrawdown: number        // âm, ví dụ -0.23 nghĩa là -23%
  peakDate: string | null    // ngày đỉnh trước khi sụp
  troughDate: string | null  // ngày đáy
  recoveryDate: string | null  // ngày về lại đỉnh cũ (null nếu chưa)
  recoveryWeeks: number | null // số tuần từ đáy tới hồi phục (null nếu chưa)
  underwaterWeeks: number | null // số tuần từ đỉnh tới nay (nếu chưa hồi)
}
export function drawdownStats(returns: ReturnPoint[]): DrawdownStats {
  const empty: DrawdownStats = {
    maxDrawdown: 0,
    peakDate: null,
    troughDate: null,
    recoveryDate: null,
    recoveryWeeks: null,
    underwaterWeeks: null,
  }
  if (returns.length === 0) return empty

  // Pass 1: tính growth, peak, và DD series để tìm đáy sâu nhất
  const n = returns.length
  const growth = new Float64Array(n)
  const peakAtT = new Float64Array(n)
  const peakDateAtT: string[] = new Array(n)
  let g = 1.0
  let peak = 1.0
  let peakDate = returns[0]!.date

  let maxDD = 0
  let troughIdx = -1
  let peakIdxForMaxDD = -1

  for (let i = 0; i < n; i++) {
    g *= 1 + returns[i]!.value
    if (g > peak) {
      peak = g
      peakDate = returns[i]!.date
    }
    growth[i] = g
    peakAtT[i] = peak
    peakDateAtT[i] = peakDate

    const dd = g / peak - 1
    if (dd < maxDD) {
      maxDD = dd
      troughIdx = i
      // Walk back to find peak date before trough
      for (let j = i; j >= 0; j--) {
        if (growth[j]! >= peakAtT[i]! - 1e-12) {
          peakIdxForMaxDD = j
          break
        }
      }
    }
  }

  if (troughIdx < 0 || peakIdxForMaxDD < 0) return empty

  const troughDate = returns[troughIdx]!.date
  const peakGrowth = growth[peakIdxForMaxDD]!
  const peakDateStr = returns[peakIdxForMaxDD]!.date

  // Pass 2: tìm recovery sau đáy
  let recoveryIdx = -1
  for (let i = troughIdx + 1; i < n; i++) {
    if (growth[i]! >= peakGrowth - 1e-12) {
      recoveryIdx = i
      break
    }
  }

  if (recoveryIdx >= 0) {
    return {
      maxDrawdown: maxDD,
      peakDate: peakDateStr,
      troughDate,
      recoveryDate: returns[recoveryIdx]!.date,
      recoveryWeeks: recoveryIdx - troughIdx,
      underwaterWeeks: null,
    }
  }

  // Chưa hồi phục tính tới cuối series
  return {
    maxDrawdown: maxDD,
    peakDate: peakDateStr,
    troughDate,
    recoveryDate: null,
    recoveryWeeks: null,
    underwaterWeeks: n - 1 - peakIdxForMaxDD,
  }
}

/**
 * Tỉ lệ rolling windows dương: trong bao nhiêu % khoảng rolling (ví dụ 12 tháng)
 * quỹ đem lại lợi nhuận dương. Phản ánh "mức độ tin cậy".
 */
export function positiveRollingRate(rolling: ReturnPoint[]): number | null {
  if (rolling.length === 0) return null
  let pos = 0
  for (const r of rolling) if (r.value > 0) pos++
  return pos / rolling.length
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

    // Dữ liệu resample theo tuần lẫn daily đều hiếm khi có điểm đúng ngày
    // 01/01 hoặc 31/12 — chỉ tính "năm chưa trọn" khi lệch nhiều (>20 ngày),
    // và chỉ xét năm ĐẦU/CUỐI (không phụ thuộc mật độ dữ liệu).
    const firstDate = group[0]!.date
    const lastDate = group[group.length - 1]!.date
    const isPartial =
      (year === firstYear && daysBetween(`${year}-01-01`, firstDate) > 20) ||
      (year === lastYear && daysBetween(lastDate, `${year}-12-31`) > 20)

    result.push({ year, value: growth - 1, isPartial })
  }

  return result
}

// ─── Monthly returns ─────────────────────────────────────────

/**
 * Lợi nhuận theo từng tháng dương lịch. Gom các return rồi compounding trong
 * cùng tháng/năm. Dùng làm dữ liệu cho heatmap "tháng × năm".
 *
 * Tháng ĐẦU và CUỐI của chuỗi bị đánh dấu isPartial nếu dữ liệu bắt đầu/kết thúc
 * giữa tháng, để heatmap không vẽ như tháng trọn vẹn. Các tháng ở giữa luôn trọn.
 */
export function monthlyReturns(returns: ReturnPoint[]): MonthlyReturn[] {
  if (returns.length === 0) return []

  // Gom return theo (year, month)
  const groups = new Map<string, ReturnPoint[]>()
  for (const r of returns) {
    const key = r.date.substring(0, 7) // YYYY-MM
    const group = groups.get(key)
    if (group) {
      group.push(r)
    } else {
      groups.set(key, [r])
    }
  }

  const monthKeys = Array.from(groups.keys()).sort()
  const firstKey = monthKeys[0]!
  const lastKey = monthKeys[monthKeys.length - 1]!

  const result: MonthlyReturn[] = []

  for (const key of monthKeys) {
    const group = groups.get(key)!
    let growth = 1.0
    for (const r of group) {
      growth *= 1 + r.value
    }

    const year = parseInt(key.substring(0, 4), 10)
    const month = parseInt(key.substring(5, 7), 10)

    const firstDate = group[0]!.date
    const lastDate = group[group.length - 1]!.date
    const isPartial =
      (key === firstKey && firstDate !== `${key}-01`) ||
      (key === lastKey && lastDate !== `${key}-31` && lastDate !== `${key}-30` && lastDate !== `${key}-28` && lastDate !== `${key}-29`)

    result.push({ year, month, value: growth - 1, isPartial })
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
 * O(n) via log-space sliding window. No array allocations per step.
 *
 * Uses: log(∏(1+rᵢ)) = Σlog(1+rᵢ), slide by adding new log and
 * subtracting the oldest. Math.log1p / Math.expm1 for precision.
 *
 * Equivalent result to the naive O(n×w) cumprod approach.
 */
export function rollingCumulativeReturns(
  returns: ReturnPoint[],
  periodMonths: number,
): ReturnPoint[] {
  const n = returns.length
  if (n === 0) return []

  const dates = returns.map(r => new Date(r.date).getTime())
  // Prefix log-sum: prefix[i] = tổng log(1+r) từ 0..i-1. O(n).
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + Math.log1p(returns[i]!.value)

  const starts = rollingWindowStarts(dates, periodMonths)
  const result: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    const logSum = prefix[i + 1]! - prefix[j + 1]!
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
  periodMonths: number,
): { wins: number; total: number } {
  const rolledBMap = rollingCumulativeReturnsMap(returnsB, periodMonths)
  return winRateAgainstRolledB(returnsA, periodMonths, rolledBMap)
}

/**
 * Precompute rollingCumulativeReturns cho 1 series thành Map<date, value>, để
 * tái sử dụng qua nhiều lần so sánh (winRateAgainstRolledB) mà không phải
 * tính lại từ đầu mỗi lần — hữu ích khi cùng 1 baseline (vd danh mục không
 * BTC) được so với NHIỀU danh mục khác ở CÙNG 1 kỳ hạn (xem WinRateBlock:
 * so 3 tỷ trọng BTC với cùng 1 baseline × 4 kỳ hạn — baseline chỉ cần tính
 * 4 lần thay vì 12 lần).
 */
export function rollingCumulativeReturnsMap(
  returns: ReturnPoint[],
  periodMonths: number,
): Map<string, number> {
  const rolled = rollingCumulativeReturns(returns, periodMonths)
  return new Map(rolled.map(r => [r.date, r.value]))
}

/** Win rate của `returnsA` so với 1 rolling map B đã tính sẵn (xem rollingCumulativeReturnsMap). */
export function winRateAgainstRolledB(
  returnsA: ReturnPoint[],
  periodMonths: number,
  rolledBMap: Map<string, number>,
): { wins: number; total: number } {
  const rollA = rollingCumulativeReturns(returnsA, periodMonths)
  if (rollA.length === 0 || rolledBMap.size === 0) {
    return { wins: 0, total: 0 }
  }

  let wins = 0
  let total = 0
  for (const r of rollA) {
    const bVal = rolledBMap.get(r.date)
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
 * O(n) via sliding sum + sum-of-squares. No array allocations per step.
 *
 * variance = (sumSq - sum²/w) / (w-1)  (Bessel-corrected sample variance)
 * annualized = sqrt(variance) × sqrt(52)
 *
 * Math.max(0, variance) guards against tiny negatives from float rounding.
 */
export function rollingAnnualizedStdev(
  returns: ReturnPoint[],
  periodMonths: number,
): ReturnPoint[] {
  const n = returns.length
  if (n < 2) return []

  const dates = returns.map(r => new Date(r.date).getTime())
  const prefixSum = new Float64Array(n + 1)
  const prefixSumSq = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const v = returns[i]!.value
    prefixSum[i + 1] = prefixSum[i]! + v
    prefixSumSq[i + 1] = prefixSumSq[i]! + v * v
  }

  const starts = rollingWindowStarts(dates, periodMonths)
  const result: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    const w = i - j // số return thực tế trong cửa sổ
    if (w < 2) continue

    const sum = prefixSum[i + 1]! - prefixSum[j + 1]!
    const sumSq = prefixSumSq[i + 1]! - prefixSumSq[j + 1]!
    const variance = Math.max(0, (sumSq - (sum * sum) / w) / (w - 1))
    // Annualize tự thích ứng theo mật độ dữ liệu thực tế trong cửa sổ,
    // thay vì cố định sqrt(52) — đúng bất kể input daily hay weekly.
    const periodsPerYear = w / (periodMonths / 12)
    result.push({
      date: returns[i]!.date,
      value: Math.sqrt(variance) * Math.sqrt(periodsPerYear),
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
 * O(n×w). No O(n) shortcut exists for sliding-window max drawdown.
 * Optimized by using direct index access (no .slice() allocations).
 */
export function rollingMaxDrawdown(
  returns: ReturnPoint[],
  periodMonths: number,
): ReturnPoint[] {
  const n = returns.length
  if (n === 0) return []

  const dates = returns.map(r => new Date(r.date).getTime())
  const starts = rollingWindowStarts(dates, periodMonths)
  const result: ReturnPoint[] = []

  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    let growth = 1.0
    let peak = 1.0
    let maxDD = 0
    for (let k = j + 1; k <= i; k++) {
      growth *= 1 + returns[k]!.value
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
  const n = returns.length
  if (n === 0) return []

  const dates = returns.map(r => new Date(r.date).getTime())
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + Math.log1p(returns[i]!.value)

  const starts = rollingWindowStarts(dates, periodMonths)
  const result: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    const logSum = prefix[i + 1]! - prefix[j + 1]!
    const growth = Math.exp(logSum)
    const annualized = Math.pow(growth, 12 / periodMonths) - 1
    result.push({ date: returns[i]!.date, value: annualized })
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

/**
 * Liệt kê các chu kỳ rolling có đủ dữ liệu để tính. Một chu kỳ được coi là
 * "có dữ liệu" nếu ít nhất một quỹ trong danh sách sinh ra ít nhất một điểm
 * rolling. Dùng để làm mờ button chu kỳ không tính được.
 */
export function availableRollingPeriods(
  returnsList: ReturnPoint[][],
  periods: number[],
): number[] {
  return periods.filter(p =>
    returnsList.some(r => rollingReturns(r, p).length > 0),
  )
}

/** Nhãn 5 khoảng phân bổ lợi nhuận rolling, theo thứ tự từ thấp đến cao. */
export const ROLLING_DISTRIBUTION_LABELS = [
  'Âm',
  '0–5%',
  '5–10%',
  '10–20%',
  '>20%',
] as const

/**
 * Đếm tần suất các quan sát rơi vào 5 khoảng lợi nhuận rolling, trả về tỉ lệ
 * phần trăm trên tổng số quan sát (mỗi quan sát thuộc đúng một khoảng).
 *
 * Khoảng là nửa mở [a, b), riêng khoảng cuối nhận cả cận trên:
 *   Âm:     x < 0
 *   0–5%:   0 ≤ x < 0.05
 *   5–10%:  0.05 ≤ x < 0.10
 *   10–20%: 0.10 ≤ x < 0.20
 *   >20%:   x ≥ 0.20
 *
 * Trả về mảng 5 số thập phân (0.15 = 15%), cùng thứ tự ROLLING_DISTRIBUTION_LABELS.
 * Tổng 5 số luôn bằng 1 khi có ít nhất một quan sát.
 */
export function rollingReturnDistribution(values: number[]): number[] {
  const counts = [0, 0, 0, 0, 0]
  const n = values.length
  if (n === 0) return counts

  for (const v of values) {
    if (v < 0) {
      counts[0]!++
    } else if (v < 0.05) {
      counts[1]!++
    } else if (v < 0.10) {
      counts[2]!++
    } else if (v < 0.20) {
      counts[3]!++
    } else {
      counts[4]!++
    }
  }

  return counts.map(c => c / n)
}
