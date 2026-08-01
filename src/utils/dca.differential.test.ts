/**
 * DIFFERENTIAL TEST — kiểm chứng độc lập mọi công thức tab DCA (src/utils/dca.ts).
 *
 * Ý tưởng (giống bitcoinFormulas.differential.test.ts): với mỗi hàm trong dca.ts,
 * VIẾT LẠI MỘT CÁCH ĐỘC LẬP theo đúng định nghĩa nhưng dùng THUẬT TOÁN KHÁC với
 * code thật, rồi chạy CẢ HAI trên cùng dữ liệu và so khớp.
 *
 *  - simulateDCA: reference tính TWRR theo "trọng số quỹ × lợi nhuận từng quỹ"
 *    (weighted-return), còn production chia valueBeforeCashflow/prevEndValue;
 *    cadence nạp tiền dùng period-key số học thay vì so sánh Date từng tần suất.
 *  - dcaMWRR: bisection (không đạo hàm) thay vì Newton-Raphson.
 *  - computeDCARolling: naive scan từng cửa sổ thay vì two-pointer rollingWindowStarts.
 *  - dcaYearlyMWRR: quét valueSeries MỘT LẦN gom năm, thay vì filter() mỗi năm.
 *  - dcaStormStats: đếm bão theo phân rã khoảng (maximal-interval) thay vì state machine.
 *  - trackDividendNarrative: hàng đợi sự kiện đã sắp xếp + con trỏ, thay vì
 *    quét toàn bộ schedule mỗi ngày.
 *  - trailingWindowCagr: binary search thay vì linear scan.
 *  - resampleToWeeklyGrid: forward-fill bằng con trỏ thay vì Map.has.
 *
 * Dữ liệu: synthetic sinh bằng PRNG seeded (tái lập được) + snapshot thật
 * REAL_FUND (E1VFVN30 weekly, fixture bitcoinRealData).
 */
import { describe, it, expect } from 'vitest'
import {
  resampleToWeeklyGrid, monthlyEquivalentContribution, derivePortfolioName, simulateDCA,
  dcaMWRR, dcaCagr, investorCagr, dcaMaxDrawdown, dcaYearlyReturns, dcaYearlyMWRR,
  computeDCARolling, dcaStormStats, dcaProfitFactor, rollingCAGR, trailingWindowCagr,
  histogramBuckets, dcaMonthlyReturns, monteCarloProjection, probabilityAtLeast,
  trackDividendNarrative,
} from './dca'
import type { DCAFrequency, DCAResult, DCASlot } from './dca'
import type { DividendEvent } from './dividendAdjust'
import type { PricePoint, ReturnPoint, RebalanceFrequency, YearlyReturn } from '../types'
import { REAL_FUND } from '../__tests__/fixtures/bitcoinRealData.fixture'

// ─── PRNG seeded, tái lập được ──────────────────────────────
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isoAddDays(iso: string, days: number): string {
  const t = Date.parse(iso + 'T00:00:00Z')
  return new Date(t + days * 86400000).toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}

// ─── Reference implementations (độc lập) ───────────────────

/** shouldInvest: period-key số học thay vì so sánh Date từng tần suất. */
function periodKey(date: string, freq: DCAFrequency): number {
  const y = +date.slice(0, 4)
  const m = +date.slice(5, 7)
  switch (freq) {
    case 'monthly': return y * 12 + m
    case 'quarterly': return y * 4 + Math.ceil(m / 3)
    case 'semiannual': return y * 2 + Math.ceil(m / 6)
    case 'yearly': return y
    default: return 0
  }
}

function refShouldInvest(prevDate: string, currDate: string, freq: DCAFrequency): boolean {
  switch (freq) {
    case 'daily': return true
    case 'weekly': return daysBetween(prevDate, currDate) >= 5
    case 'biweekly': return daysBetween(prevDate, currDate) >= 12
    default: return periodKey(currDate, freq) > periodKey(prevDate, freq)
  }
}

function refShouldRebal(prevDate: string, nextDate: string, freq: RebalanceFrequency): boolean {
  const py = +prevDate.slice(0, 4), pm = +prevDate.slice(5, 7)
  const ny = +nextDate.slice(0, 4), nm = +nextDate.slice(5, 7)
  switch (freq) {
    case 'monthly': return py !== ny || pm !== nm
    case 'quarterly': return py !== ny || Math.ceil(pm / 3) !== Math.ceil(nm / 3)
    case 'yearly': return py !== ny
  }
}

const EMPTY_SIM: DCAResult = {
  values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [],
  totalInvested: 0, finalValue: 0,
}

/**
 * simulateDCA — reference TWRR theo weighted-return: với mỗi quỹ lấy trọng số
 * tại close hôm trước (shares×pPrev/prevEndValue) nhân lợi nhuận của chính quỹ
 * (pNow/pPrev − 1). Production chia trực tiếp valueBeforeCashflow/prevEndValue.
 * Hai đường floating-point khác nhau → khác ở vài bit cuối, so khớp 8 chữ số.
 */
function refSimulateDCA(
  dailyPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  params: { initialAmount: number; cashflowAmount: number; cashflowFreq: DCAFrequency },
  rebalFreq: RebalanceFrequency,
  options?: { skipContributionWhen?: (d: string, dd: number) => boolean; contributionAmountOverride?: (d: string, dd: number) => number; purchasePrices?: Map<string, PricePoint[]> },
): DCAResult {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0) return { ...EMPTY_SIM }
  const totalWeight = validSlots.reduce((s, x) => s + x.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  const priceArrays = fundIds.map(id => dailyPrices.get(id) || [])
  if (priceArrays.some(a => a.length === 0)) return { ...EMPTY_SIM }
  let commonStart = priceArrays[0]![0]!.date
  let commonEnd = priceArrays[0]![priceArrays[0]!.length - 1]!.date
  for (const arr of priceArrays) {
    if (arr[0]!.date > commonStart) commonStart = arr[0]!.date
    if (arr[arr.length - 1]!.date < commonEnd) commonEnd = arr[arr.length - 1]!.date
  }
  if (commonStart >= commonEnd) return { ...EMPTY_SIM }

  const priceLookups = priceArrays.map(arr => {
    const m = new Map<string, number>()
    for (const p of arr) m.set(p.date, p.price)
    return m
  })
  const purchaseLookups = fundIds.map((id, j) => {
    const ov = options?.purchasePrices?.get(id)
    if (!ov) return priceLookups[j]!
    const m = new Map<string, number>()
    for (const p of ov) m.set(p.date, p.price)
    return m
  })

  const allDates: string[] = []
  for (const p of priceArrays[0]!) {
    if (p.date < commonStart || p.date > commonEnd) continue
    if (fundIds.every((_, i) => priceLookups[i]!.has(p.date))) allDates.push(p.date)
  }
  if (allDates.length < 2) return { ...EMPTY_SIM }

  const shares = new Array<number>(fundIds.length).fill(0)
  let totalInvested = 0
  let lastInvestDate = ''
  let twrrGrowth = 1
  let twrrPeak = 1
  let prevEndValue = 0
  let prevDateForRebal = allDates[0]!

  const values: { date: string; value: number }[] = []
  const invested: { date: string; value: number }[] = []
  const cashflows: { date: string; amount: number }[] = []
  const cumulative: ReturnPoint[] = []
  const drawdown: ReturnPoint[] = []
  const returns: ReturnPoint[] = []

  const valueOf = (date: string): number => {
    let t = 0
    for (let j = 0; j < fundIds.length; j++) t += shares[j]! * priceLookups[j]!.get(date)!
    return t
  }

  if (params.initialAmount > 0) {
    const date = allDates[0]!
    for (let j = 0; j < fundIds.length; j++) shares[j]! += (params.initialAmount * weights[j]!) / purchaseLookups[j]!.get(date)!
    totalInvested += params.initialAmount
    lastInvestDate = date
    cashflows.push({ date, amount: -params.initialAmount })
  }
  prevEndValue = totalInvested > 0 ? valueOf(allDates[0]!) : 0
  values.push({ date: allDates[0]!, value: prevEndValue })
  invested.push({ date: allDates[0]!, value: totalInvested })
  cumulative.push({ date: allDates[0]!, value: 0 })
  drawdown.push({ date: allDates[0]!, value: 0 })

  for (let i = 1; i < allDates.length; i++) {
    const date = allDates[i]!
    const prevDate = allDates[i - 1]!

    let dailyReturn = 0
    if (prevEndValue > 0) {
      let wsum = 0
      for (let j = 0; j < fundIds.length; j++) {
        const pPrev = priceLookups[j]!.get(prevDate)!
        const pNow = priceLookups[j]!.get(date)!
        const w = (shares[j]! * pPrev) / prevEndValue
        wsum += w * (pNow / pPrev - 1)
      }
      dailyReturn = wsum
    }
    returns.push({ date, value: dailyReturn })
    twrrGrowth *= 1 + dailyReturn

    if (params.cashflowAmount > 0) {
      const investDate = lastInvestDate || allDates[0]!
      if (refShouldInvest(investDate, date, params.cashflowFreq)) {
        const currentDD = twrrPeak > 0 ? twrrGrowth / twrrPeak - 1 : 0
        const shouldSkip = options?.skipContributionWhen?.(date, currentDD) ?? false
        if (!shouldSkip) {
          const amount = options?.contributionAmountOverride?.(date, currentDD) ?? params.cashflowAmount
          for (let j = 0; j < fundIds.length; j++) shares[j]! += (amount * weights[j]!) / purchaseLookups[j]!.get(date)!
          totalInvested += amount
          lastInvestDate = date
          cashflows.push({ date, amount: -amount })
        } else {
          lastInvestDate = date
        }
      }
    }

    if (totalInvested > 0 && refShouldRebal(prevDateForRebal, date, rebalFreq)) {
      const tv = valueOf(date)
      for (let j = 0; j < fundIds.length; j++) shares[j]! = (tv * weights[j]!) / priceLookups[j]!.get(date)!
    }
    prevDateForRebal = date

    const portfolioValue = totalInvested > 0 ? valueOf(date) : 0
    values.push({ date, value: portfolioValue })
    invested.push({ date, value: totalInvested })
    cumulative.push({ date, value: twrrGrowth - 1 })
    if (twrrGrowth > twrrPeak) twrrPeak = twrrGrowth
    drawdown.push({ date, value: twrrGrowth / twrrPeak - 1 })
    prevEndValue = portfolioValue
  }

  const finalValue = values.length > 0 ? values[values.length - 1]!.value : 0
  const allCashflows = [...cashflows, { date: allDates[allDates.length - 1]!, amount: finalValue }]
  return { values, invested, cashflows: allCashflows, cumulative, drawdown, returns, totalInvested, finalValue }
}

/** MWRR — bisection (không đạo hàm) thay vì Newton-Raphson. */
function refDcaMWRR(cashflows: { date: string; amount: number }[]): number | null {
  if (cashflows.length < 2) return null
  const t0 = Date.parse(cashflows[0]!.date + 'T00:00:00Z')
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const cfs = cashflows.map(cf => ({
    amount: cf.amount,
    years: (Date.parse(cf.date + 'T00:00:00Z') - t0) / msPerYear,
  }))
  const npv = (r: number): number => {
    let s = 0
    for (const c of cfs) {
      const disc = Math.pow(1 + r, c.years)
      if (!isFinite(disc) || disc === 0) continue
      s += c.amount / disc
    }
    return s
  }

  // Quét lưới để tìm khoảng đổi dấu, rồi bisection (khác hẳn Newton)
  const lo0 = -0.99, hi0 = 10
  let lo = lo0, hi = hi0
  let flo = npv(lo), fhi = npv(hi)
  if (!isFinite(flo) || !isFinite(fhi)) return null
  const STEPS = 10000
  let a = lo0, fa = npv(a)
  let found = false
  for (let g = 1; g <= STEPS; g++) {
    const x = lo0 + (hi0 - lo0) * g / STEPS
    const fx = npv(x)
    if (!isFinite(fx)) break
    if (fa * fx <= 0) { lo = a; hi = x; flo = fa; fhi = fx; found = true; break }
    a = x; fa = fx
  }
  if (!found) return null
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2
    const fm = npv(mid)
    if (!isFinite(fm)) return null
    if (Math.abs(fm) < 1e-12 || (hi - lo) < 1e-14) return mid
    if (flo * fm <= 0) { hi = mid; fhi = fm }
    else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

function refDcaCagr(cumulative: ReturnPoint[]): number | null {
  if (cumulative.length < 2) return null
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years = (Date.parse(cumulative[cumulative.length - 1]!.date + 'T00:00:00Z') - Date.parse(cumulative[0]!.date + 'T00:00:00Z')) / msPerYear
  if (years <= 0) return null
  return Math.pow(1 + cumulative[cumulative.length - 1]!.value, 1 / years) - 1
}

function refInvestorCagr(cumulative: ReturnPoint[], totalInvested: number, finalValue: number): number | null {
  if (cumulative.length < 2 || totalInvested <= 0 || finalValue <= 0) return null
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years = (Date.parse(cumulative[cumulative.length - 1]!.date + 'T00:00:00Z') - Date.parse(cumulative[0]!.date + 'T00:00:00Z')) / msPerYear
  if (years <= 0) return null
  return Math.pow(finalValue / totalInvested, 1 / years) - 1
}

/** max drawdown — hai mảng peak riêng thay vì một vòng chạy running-peak. */
function refDcaMaxDrawdown(cumulative: ReturnPoint[]): number {
  if (cumulative.length === 0) return 0
  const growth = cumulative.map(p => 1 + p.value)
  const peak = new Array<number>(growth.length)
  let p = -Infinity
  for (let i = 0; i < growth.length; i++) { if (growth[i]! > p) p = growth[i]!; peak[i] = p }
  let maxDD = 0
  for (let i = 0; i < growth.length; i++) {
    const dd = growth[i]! / peak[i]! - 1
    if (dd < maxDD) maxDD = dd
  }
  return maxDD
}

/** dcaYearlyReturns — phát hiện ranh giới năm khi quét một lần thay vì Map gom năm. */
function refDcaYearlyReturns(cumulative: ReturnPoint[]): YearlyReturn[] {
  if (cumulative.length < 2) return []
  interface YearBounds { year: number; first: ReturnPoint; last: ReturnPoint }
  const bounds: YearBounds[] = []
  let curYear = -1
  let curFirst: ReturnPoint | null = null
  let curLast: ReturnPoint | null = null
  for (const p of cumulative) {
    const y = +p.date.slice(0, 4)
    if (y !== curYear) {
      if (curYear !== -1 && curFirst && curLast) bounds.push({ year: curYear, first: curFirst, last: curLast })
      curYear = y; curFirst = p
    }
    curLast = p
  }
  if (curFirst && curLast) bounds.push({ year: curYear, first: curFirst, last: curLast })

  const firstYear = bounds[0]!.year
  const lastYear = bounds[bounds.length - 1]!.year
  const result: YearlyReturn[] = []
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]!
    const growthAtEnd = 1 + b.last.value
    const growthAtPrevEnd = i === 0 ? 1 : 1 + bounds[i - 1]!.last.value
    const yearReturn = growthAtEnd / growthAtPrevEnd - 1
    const isPartial =
      (b.year === firstYear && daysBetween(`${b.year}-01-01`, b.first.date) > 20) ||
      (b.year === lastYear && daysBetween(b.last.date, `${b.year}-12-31`) > 20)
    result.push({ year: b.year, value: yearReturn, isPartial })
  }
  return result
}

/** dcaYearlyMWRR — quét valueSeries một lần gom năm, thay vì filter() mỗi năm. */
function refDcaYearlyMWRR(
  valueSeries: { date: string; value: number }[],
  cashflows: { date: string; amount: number }[],
): { year: number; value: number | null; isPartial: boolean; endValue: number }[] {
  if (valueSeries.length < 2) return []
  const years = Array.from(new Set(valueSeries.map(p => +p.date.slice(0, 4)))).sort((a, b) => a - b)
  if (years.length === 0) return []
  const firstYear = years[0]!, lastYear = years[years.length - 1]!

  // Quét một lần: lastInYear[y], firstInYear[y]
  const lastInYear = new Map<number, { date: string; value: number }>()
  const firstInYear = new Map<number, { date: string; value: number }>()
  for (const p of valueSeries) {
    const y = +p.date.slice(0, 4)
    if (!firstInYear.has(y)) firstInYear.set(y, p)
    lastInYear.set(y, p)
  }
  // contributions dương (bỏ dòng finalValue tổng), quét một lần gom năm
  const contribByYear = new Map<number, { date: string; amount: number }[]>()
  for (const cf of cashflows) {
    if (cf.amount >= 0) continue
    const y = +cf.date.slice(0, 4)
    const arr = contribByYear.get(y) ?? []
    arr.push({ date: cf.date, amount: -cf.amount })
    contribByYear.set(y, arr)
  }

  const results: { year: number; value: number | null; isPartial: boolean; endValue: number }[] = []
  for (const year of years) {
    const yearStartStr = `${year}-01-01`, yearEndStr = `${year}-12-31`
    const bvPoint = year > years[0]! ? lastInYear.get(year - 1) ?? null : null
    const BV = bvPoint ? bvPoint.value : 0
    const periodStartDate = bvPoint ? bvPoint.date : (firstInYear.get(year)?.date ?? yearStartStr)
    const endPoint = lastInYear.get(year)
    if (!endPoint) continue
    const EV = endPoint.value
    const periodEndDate = endPoint.date
    const totalDays = Math.max(1, daysBetween(periodStartDate, periodEndDate))

    const isPartial =
      (year === firstYear && daysBetween(yearStartStr, periodStartDate) > 20) ||
      (year === lastYear && daysBetween(periodEndDate, yearEndStr) > 20)

    const yearContribs = (contribByYear.get(year) ?? [])
      .filter(c => c.date >= periodStartDate && c.date <= periodEndDate)
    const netContrib = yearContribs.reduce((s, c) => s + c.amount, 0)
    const weightedContrib = yearContribs.reduce((s, c) => s + c.amount * (1 - daysBetween(periodStartDate, c.date) / totalDays), 0)
    const denominator = BV + weightedContrib
    const value = denominator !== 0 ? (EV - BV - netContrib) / denominator : null
    results.push({ year, value, isPartial, endValue: EV })
  }
  return results
}

function refAddMonthsClamped(time: number, delta: number): number {
  const d = new Date(time)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + delta)
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, dim))
  return d.getTime()
}

/** rollingWindowStarts naive: tìm lại từ đầu mỗi i, không two-pointer. */
function refRollingWindowStarts(dates: number[], periodMonths: number): number[] {
  const n = dates.length
  const starts = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const target = refAddMonthsClamped(dates[i]!, -periodMonths)
    if (dates[0]! > target) continue
    let j = 0
    while (j < i && dates[j]! < target) j++
    starts[i] = j
  }
  return starts
}

/** computeDCARolling — cùng công thức nhưng window naive từng i. */
function refComputeDCARolling(cumulative: ReturnPoint[], periodMonths: number): ReturnPoint[] {
  if (cumulative.length === 0) return []
  const dates = cumulative.map(p => Date.parse(p.date + 'T00:00:00Z'))
  const starts = refRollingWindowStarts(dates, periodMonths)
  const raw: ReturnPoint[] = []
  for (let i = 0; i < cumulative.length; i++) {
    const j = starts[i]!
    if (j < 0) continue
    const growthNow = 1 + cumulative[i]!.value
    const growthPast = 1 + cumulative[j]!.value
    if (growthPast > 0) {
      const periodGrowth = growthNow / growthPast
      raw.push({ date: cumulative[i]!.date, value: Math.pow(periodGrowth, 12 / periodMonths) - 1 })
    }
  }
  if (raw.length <= 200) return raw
  const sampleStep = Math.max(1, Math.floor(raw.length / 200))
  const result: ReturnPoint[] = []
  for (let i = 0; i < raw.length; i += sampleStep) result.push(raw[i]!)
  if (result[result.length - 1] !== raw[raw.length - 1]) result.push(raw[raw.length - 1]!)
  return result
}

/**
 * dcaStormStats — đếm bão theo phân rã khoảng (maximal interval): bắt đầu khi
 * dd ≤ -10%, kết thúc khi dd ≥ -2%; reference đếm các lần "xuống qua -10%",
 * còn production dùng state machine inStorm.
 */
function refDcaStormStats(
  drawdown: ReturnPoint[],
  cumulative: ReturnPoint[],
): { maxDrawdown: number; maxDDDate: string; maxDDPeakDate: string; recoveryMonths: number | null; stormsCount: number; inBearPeriod: 'bear2018' | 'covid2020' | 'bear2022' | null } {
  const empty = { maxDrawdown: 0, maxDDDate: '', maxDDPeakDate: '', recoveryMonths: null, stormsCount: 0, inBearPeriod: null }
  if (drawdown.length === 0 || cumulative.length === 0) return empty

  let maxDD = 0, maxDDIdx = 0
  for (let i = 0; i < drawdown.length; i++) {
    if (drawdown[i]!.value < maxDD) { maxDD = drawdown[i]!.value; maxDDIdx = i }
  }
  // Peak trước đáy — argmax trên cumulative[0..maxDDIdx]
  let peakIdx = 0
  for (let i = 1; i <= maxDDIdx; i++) {
    if (1 + cumulative[i]!.value > 1 + cumulative[peakIdx]!.value) peakIdx = i
  }
  const peakVal = 1 + cumulative[peakIdx]!.value

  let recoveryIdx = -1
  for (let i = maxDDIdx + 1; i < cumulative.length; i++) {
    if (1 + cumulative[i]!.value >= peakVal) { recoveryIdx = i; break }
  }
  const recoveryMonths = recoveryIdx >= 0
    ? Math.max(0, (new Date(cumulative[recoveryIdx]!.date).getFullYear() - new Date(drawdown[maxDDIdx]!.date).getFullYear()) * 12
      + (new Date(cumulative[recoveryIdx]!.date).getMonth() - new Date(drawdown[maxDDIdx]!.date).getMonth()))
    : null

  let stormsCount = 0
  let i = 0
  const n = drawdown.length
  while (i < n) {
    if (drawdown[i]!.value <= -0.10) {
      stormsCount++
      while (i < n && drawdown[i]!.value < -0.02) i++
    } else i++
  }

  const ddDate = drawdown[maxDDIdx]!.date
  let inBearPeriod: 'bear2018' | 'covid2020' | 'bear2022' | null = null
  if (ddDate >= '2018-04-01' && ddDate <= '2019-12-31') inBearPeriod = 'bear2018'
  else if (ddDate >= '2020-02-15' && ddDate <= '2020-06-30') inBearPeriod = 'covid2020'
  else if (ddDate >= '2022-04-01' && ddDate <= '2023-06-30') inBearPeriod = 'bear2022'

  return {
    maxDrawdown: maxDD,
    maxDDDate: drawdown[maxDDIdx]!.date,
    maxDDPeakDate: cumulative[peakIdx]!.date,
    recoveryMonths,
    stormsCount,
    inBearPeriod,
  }
}

function refDcaProfitFactor(returns: ReturnPoint[]): number | null {
  let gain = 0, loss = 0
  for (const r of returns) {
    if (r.value > 0) gain += r.value
    else if (r.value < 0) loss += -r.value
  }
  return loss === 0 ? null : gain / loss
}

/** rollingCAGR — con trỏ tăng đơn điệu tìm endpoint thay vì quét lại từ i+1 mỗi lần. */
function refRollingCAGR(
  cumulative: ReturnPoint[],
  windowYears: number,
): { startDate: string; endDate: string; cagr: number }[] {
  if (cumulative.length === 0 || windowYears <= 0) return []
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const windowMs = windowYears * msPerYear
  const results: { startDate: string; endDate: string; cagr: number }[] = []
  let lastSampledMonth = ''
  let ptr = 1
  for (let i = 0; i < cumulative.length; i++) {
    const startPt = cumulative[i]!
    const startMonth = startPt.date.slice(0, 7)
    if (startMonth === lastSampledMonth) continue
    lastSampledMonth = startMonth
    const startTime = Date.parse(startPt.date + 'T00:00:00Z')
    const targetTime = startTime + windowMs
    while (ptr < cumulative.length && Date.parse(cumulative[ptr]!.date + 'T00:00:00Z') < targetTime) ptr++
    if (ptr >= cumulative.length) break
    const endPt = cumulative[ptr]!
    const startGrowth = 1 + startPt.value
    const endGrowth = 1 + endPt.value
    if (startGrowth <= 0) continue
    const actualYears = (Date.parse(endPt.date + 'T00:00:00Z') - startTime) / msPerYear
    if (actualYears <= 0) continue
    results.push({ startDate: startPt.date, endDate: endPt.date, cagr: Math.pow(endGrowth / startGrowth, 1 / actualYears) - 1 })
  }
  return results
}

/** trailingWindowCagr — binary search điểm đầu tiên ≥ targetStartTime, rồi so sánh với điểm trước. */
function refTrailingWindowCagr(cumulative: ReturnPoint[], windowYears: number): number | null {
  if (cumulative.length < 2 || windowYears <= 0) return null
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const endPt = cumulative[cumulative.length - 1]!
  const endTime = Date.parse(endPt.date + 'T00:00:00Z')
  const target = endTime - windowYears * msPerYear
  if (Date.parse(cumulative[0]!.date + 'T00:00:00Z') > target) return null
  let lo = 0, hi = cumulative.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (Date.parse(cumulative[mid]!.date + 'T00:00:00Z') >= target) hi = mid
    else lo = mid + 1
  }
  let startIdx = lo
  if (lo > 0) {
    const distK = Math.abs(Date.parse(cumulative[lo]!.date + 'T00:00:00Z') - target)
    const distPrev = Math.abs(Date.parse(cumulative[lo - 1]!.date + 'T00:00:00Z') - target)
    if (distPrev < distK) startIdx = lo - 1
  }
  if (startIdx >= cumulative.length - 1) return null
  const startGrowth = 1 + cumulative[startIdx]!.value
  const endGrowth = 1 + endPt.value
  if (startGrowth <= 0) return null
  const actualYears = (endTime - Date.parse(cumulative[startIdx]!.date + 'T00:00:00Z')) / msPerYear
  if (actualYears <= 0) return null
  return Math.pow(endGrowth / startGrowth, 1 / actualYears) - 1
}

function refHistogramBuckets(values: number[], bucketSize = 0.02): { min: number; max: number; center: number; count: number }[] {
  if (values.length === 0) return []
  const minV = Math.min(...values), maxV = Math.max(...values)
  const minBucket = Math.floor(minV / bucketSize) * bucketSize
  const maxBucket = Math.ceil(maxV / bucketSize) * bucketSize
  const buckets: { min: number; max: number; center: number; count: number }[] = []
  for (let b = minBucket; b < maxBucket + bucketSize / 2; b += bucketSize) {
    buckets.push({ min: b, max: b + bucketSize, center: b + bucketSize / 2, count: 0 })
  }
  for (const v of values) {
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor((v - minBucket) / bucketSize)))
    buckets[idx]!.count++
  }
  return buckets
}

/** dcaMonthlyReturns — phát hiện ranh giới tháng khi quét một lần thay vì Map "YYYY-MM". */
function refDcaMonthlyReturns(cumulative: ReturnPoint[]): ReturnPoint[] {
  if (cumulative.length < 2) return []
  const months: { ym: string; lastIdx: number }[] = []
  let cur = cumulative[0]!.date.slice(0, 7)
  for (let i = 1; i <= cumulative.length; i++) {
    const ym = i < cumulative.length ? cumulative[i]!.date.slice(0, 7) : null
    if (ym !== cur) {
      months.push({ ym: cur, lastIdx: i - 1 })
      if (ym === null) break
      cur = ym
    }
  }
  const out: ReturnPoint[] = []
  for (let i = 1; i < months.length; i++) {
    const growthEnd = 1 + cumulative[months[i]!.lastIdx]!.value
    const growthPrev = 1 + cumulative[months[i - 1]!.lastIdx]!.value
    if (growthPrev <= 0) continue
    out.push({ date: months[i]!.ym, value: growthEnd / growthPrev - 1 })
  }
  return out
}

/** monteCarloProjection — layout per-iteration (hàng) thay vì matrix tháng-chiều. Cùng rng stream. */
function refMonteCarloProjection(opts: {
  monthlyReturnPool: number[]; startValue: number; monthlyContribution: number; horizonMonths: number;
  iterations?: number; blockSize?: number; rng?: () => number;
}): { path: { month: number; p10: number; p25: number; p50: number; p75: number; p90: number }[]; finalValues: number[] } | null {
  const { monthlyReturnPool: pool, startValue, monthlyContribution, horizonMonths, iterations = 1000, blockSize = 12, rng = Math.random } = opts
  if (pool.length === 0 || horizonMonths <= 0 || iterations <= 0) return null
  const poolLen = pool.length
  const rows: number[][] = []
  for (let it = 0; it < iterations; it++) {
    const vals = new Array<number>(horizonMonths + 1)
    vals[0] = startValue
    let v = startValue, built = 0
    while (built < horizonMonths) {
      const start = Math.floor(rng() * poolLen)
      const take = Math.min(blockSize, horizonMonths - built)
      for (let k = 0; k < take; k++) {
        v = v * (1 + pool[(start + k) % poolLen]!) + monthlyContribution
        built++
        vals[built] = v
      }
    }
    rows.push(vals)
  }
  const percentile = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]!
    const idx = (sorted.length - 1) * p
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]!
    const frac = idx - lo
    return sorted[lo]! * (1 - frac) + sorted[hi]! * frac
  }
  const path = Array.from({ length: horizonMonths + 1 }, (_, m) => {
    const sorted = rows.map(r => r[m]!).sort((a, b) => a - b)
    return {
      month: m,
      p10: percentile(sorted, 0.10),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.50),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.90),
    }
  })
  const finalValues = rows.map(r => r[horizonMonths]!).sort((a, b) => a - b)
  return { path, finalValues }
}

/** probabilityAtLeast — đếm trực tiếp (O(n)) thay vì binary search. */
function refProbabilityAtLeast(sortedFinalValues: number[], target: number): number {
  if (sortedFinalValues.length === 0) return 0
  let count = 0
  for (const v of sortedFinalValues) if (v >= target) count++
  return count / sortedFinalValues.length
}

/** resampleToWeeklyGrid — forward-fill bằng con trỏ (pointer) thay vì Map.has. */
function refResampleToWeeklyGrid(allSeries: ReturnPoint[][]): ReturnPoint[][] {
  if (allSeries.length <= 1) return allSeries
  if (allSeries.some(s => s.length === 0)) return allSeries
  const dateSet = new Set<string>()
  for (const s of allSeries) for (const p of s) dateSet.add(p.date)
  const allDates = Array.from(dateSet).sort()
  if (allDates.length === 0) return allSeries
  const step = Math.max(1, Math.min(5, Math.floor(allDates.length / 200)))
  const weeklyDates: string[] = [allDates[0]!]
  for (let i = step; i < allDates.length; i += step) weeklyDates.push(allDates[i]!)
  if (weeklyDates[weeklyDates.length - 1] !== allDates[allDates.length - 1]) weeklyDates.push(allDates[allDates.length - 1]!)
  return allSeries.map(series => {
    const result: ReturnPoint[] = []
    let ptr = 0
    let lastValue: number | null = null
    for (const date of weeklyDates) {
      while (ptr < series.length && series[ptr]!.date < date) ptr++
      if (ptr < series.length && series[ptr]!.date === date) {
        lastValue = series[ptr]!.value
        result.push({ date, value: lastValue })
      } else if (lastValue !== null) {
        result.push({ date, value: lastValue })
      }
    }
    return result
  })
}

/** trackDividendNarrative — hàng đợi sự kiện đã sắp xếp + con trỏ thay vì quét schedule mỗi ngày. */
function refTrackDividendNarrative(
  rawWeeklyPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  params: { initialAmount: number; cashflowAmount: number; cashflowFreq: DCAFrequency },
  rebalFreq: RebalanceFrequency,
  dividends: Map<string, DividendEvent[]>,
) {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0) return []
  const totalWeight = validSlots.reduce((s, x) => s + x.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)
  if (!fundIds.some(id => dividends.has(id))) return []

  const priceArrays = fundIds.map(id => rawWeeklyPrices.get(id) || [])
  if (priceArrays.some(a => a.length === 0)) return []
  let commonStart = priceArrays[0]![0]!.date
  let commonEnd = priceArrays[0]![priceArrays[0]!.length - 1]!.date
  for (const arr of priceArrays) {
    if (arr[0]!.date > commonStart) commonStart = arr[0]!.date
    if (arr[arr.length - 1]!.date < commonEnd) commonEnd = arr[arr.length - 1]!.date
  }
  if (commonStart >= commonEnd) return []
  const priceLookups = priceArrays.map(arr => {
    const m = new Map<string, number>()
    for (const p of arr) m.set(p.date, p.price)
    return m
  })
  const allDates: string[] = []
  for (const p of priceArrays[0]!) {
    if (p.date < commonStart || p.date > commonEnd) continue
    if (fundIds.every((_, i) => priceLookups[i]!.has(p.date))) allDates.push(p.date)
  }
  if (allDates.length < 2) return []

  interface Entry { fundIdx: number; fundId: string; exIdx: number; payIdx: number; exDate: string; payDate: string; amountPerCert: number; taxRate: number; unitsAtEx: number }
  const schedule: Entry[] = []
  for (let j = 0; j < fundIds.length; j++) {
    const evs = dividends.get(fundIds[j]!)
    if (!evs) continue
    for (const ev of evs) {
      if (ev.exDate <= allDates[0]!) continue
      if (ev.payDate > allDates[allDates.length - 1]!) continue
      let exIdx = -1
      for (let i = 0; i < allDates.length; i++) { if (allDates[i]! >= ev.exDate) { exIdx = i; break } }
      if (exIdx < 1) continue
      let payIdx = -1
      for (let i = exIdx; i < allDates.length; i++) { if (allDates[i]! >= ev.payDate) { payIdx = i; break } }
      if (payIdx === -1) continue
      schedule.push({ fundIdx: j, fundId: fundIds[j]!, exIdx, payIdx, exDate: ev.exDate, payDate: ev.payDate, amountPerCert: ev.amountPerCert, taxRate: ev.taxRate, unitsAtEx: 0 })
    }
  }
  if (schedule.length === 0) return []

  const units = new Array<number>(fundIds.length).fill(0)
  const pending = new Array<number>(fundIds.length).fill(0)
  const stats = new Map<string, { fundId: string; eventCount: number; events: { exDate: string; payDate: string; unitsAtEx: number; gross: number; tax: number; net: number; sharesAdded: number }[]; totalGross: number; totalTax: number; totalNet: number; totalSharesAdded: number }>()
  let totalInvested = 0
  let lastInvestDate = ''

  const buy = (amount: number, dateIdx: number) => {
    const date = allDates[dateIdx]!
    for (let j = 0; j < fundIds.length; j++) units[j]! += (amount * weights[j]!) / priceLookups[j]!.get(date)!
    totalInvested += amount
    lastInvestDate = date
  }
  const rebal = (date: string) => {
    let unitsValue = 0
    for (let j = 0; j < fundIds.length; j++) unitsValue += units[j]! * priceLookups[j]!.get(date)!
    for (let j = 0; j < fundIds.length; j++) units[j]! = (unitsValue * weights[j]!) / priceLookups[j]!.get(date)!
  }

  if (params.initialAmount > 0) buy(params.initialAmount, 0)
  let prevDateForRebal = allDates[0]!

  const exQueue = [...schedule].sort((a, b) => a.exIdx - b.exIdx)
  const payQueue = [...schedule].sort((a, b) => a.payIdx - b.payIdx)
  let exCursor = 0, payCursor = 0

  for (let i = 1; i < allDates.length; i++) {
    const date = allDates[i]!
    while (exCursor < exQueue.length && exQueue[exCursor]!.exIdx === i) {
      const dv = exQueue[exCursor]!
      dv.unitsAtEx = units[dv.fundIdx]!
      pending[dv.fundIdx]! += units[dv.fundIdx]! * dv.amountPerCert
      exCursor++
    }
    while (payCursor < payQueue.length && payQueue[payCursor]!.payIdx === i) {
      const dv = payQueue[payCursor]!
      const gross = dv.unitsAtEx * dv.amountPerCert
      if (gross > 0) {
        const tax = gross * dv.taxRate
        const net = gross - tax
        const sharesAdded = net / priceLookups[dv.fundIdx]!.get(date)!
        units[dv.fundIdx]! += sharesAdded
        pending[dv.fundIdx]! -= gross
        let s = stats.get(dv.fundId)
        if (!s) {
          s = { fundId: dv.fundId, eventCount: 0, events: [], totalGross: 0, totalTax: 0, totalNet: 0, totalSharesAdded: 0 }
          stats.set(dv.fundId, s)
        }
        s.eventCount++
        s.events.push({ exDate: dv.exDate, payDate: dv.payDate, unitsAtEx: dv.unitsAtEx, gross, tax, net, sharesAdded })
        s.totalGross += gross
        s.totalTax += tax
        s.totalNet += net
        s.totalSharesAdded += sharesAdded
      }
      payCursor++
    }
    if (params.cashflowAmount > 0) {
      const investDate = lastInvestDate || allDates[0]!
      if (refShouldInvest(investDate, date, params.cashflowFreq)) buy(params.cashflowAmount, i)
    }
    if (totalInvested > 0 && refShouldRebal(prevDateForRebal, date, rebalFreq)) rebal(date)
    prevDateForRebal = date
  }
  return Array.from(stats.values())
}

// ─── Comparison helpers ─────────────────────────────────────
function expectPointsEqual(actual: ReturnPoint[], expected: ReturnPoint[], digits = 9): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!.date, `date[${i}]`).toBe(expected[i]!.date)
    expect(actual[i]!.value, `value[${i}]`).toBeCloseTo(expected[i]!.value, digits)
  }
}

function expectRelClose(actual: number, expected: number, rel = 1e-9, msg?: string): void {
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected))
  expect(Math.abs(actual - expected), msg ?? `${actual} ~ ${expected}`).toBeLessThan(scale * rel)
}

function expectSimEqual(prod: DCAResult, ref: DCAResult): void {
  expect(prod.totalInvested).toBe(ref.totalInvested)
  expectRelClose(prod.finalValue, ref.finalValue, 1e-9, 'finalValue')
  expect(prod.values).toHaveLength(ref.values.length)
  for (let i = 0; i < ref.values.length; i++) {
    expect(prod.values[i]!.date, `values[${i}].date`).toBe(ref.values[i]!.date)
    expectRelClose(prod.values[i]!.value, ref.values[i]!.value, 1e-9, `values[${i}].value`)
  }
  expect(prod.invested).toEqual(ref.invested)
  expect(prod.cashflows).toHaveLength(ref.cashflows.length)
  for (let i = 0; i < ref.cashflows.length; i++) {
    expect(prod.cashflows[i]!.date, `cashflows[${i}].date`).toBe(ref.cashflows[i]!.date)
    expect(prod.cashflows[i]!.amount, `cashflows[${i}].amount`).toBe(ref.cashflows[i]!.amount)
  }
  expectPointsEqual(prod.cumulative, ref.cumulative, 8)
  expectPointsEqual(prod.drawdown, ref.drawdown, 8)
  expectPointsEqual(prod.returns, ref.returns, 8)
}

// ─── Synthetic data builders ────────────────────────────────
function genDailySeries(startISO: string, nPoints: number, seed: number): PricePoint[] {
  const rng = mulberry32(seed)
  const out: PricePoint[] = []
  let d = startISO
  let p = 10000
  while (out.length < nPoints) {
    const dow = new Date(d + 'T00:00:00Z').getDay()
    if (dow !== 0 && dow !== 6) {
      out.push({ date: d, price: p })
      p = p * (1 + 0.0005 + (rng() - 0.5) * 0.02)
    }
    d = isoAddDays(d, 1)
  }
  return out
}

function genWeeklySeries(startISO: string, n: number, seed: number): PricePoint[] {
  const rng = mulberry32(seed)
  const out: PricePoint[] = []
  let d = startISO
  let p = 10000
  for (let i = 0; i < n; i++) {
    out.push({ date: d, price: p })
    p = p * (1 + (rng() - 0.5) * 0.03)
    d = isoAddDays(d, 7)
  }
  return out
}

function cumulativeFromPrices(dates: string[], prices: number[]): ReturnPoint[] {
  const out: ReturnPoint[] = [{ date: dates[0]!, value: 0 }]
  let growth = 1
  for (let i = 1; i < prices.length; i++) {
    growth *= prices[i]! / prices[i - 1]!
    out.push({ date: dates[i]!, value: growth - 1 })
  }
  return out
}

function drawdownFromCumulative(cumulative: ReturnPoint[]): ReturnPoint[] {
  let peak = -Infinity
  return cumulative.map(p => {
    const g = 1 + p.value
    if (g > peak) peak = g
    return { date: p.date, value: g / peak - 1 }
  })
}

// ─── Dữ liệu dùng chung ─────────────────────────────────────
const FUND_A = genDailySeries('2024-01-01', 200, 11)
const FUND_B = genDailySeries('2024-01-01', 200, 47)
const WK_LONG = genWeeklySeries('2020-01-06', 260, 3)
const CUM_WK = cumulativeFromPrices(WK_LONG.map(p => p.date), WK_LONG.map(p => p.price))

// ============================================================================
describe('differential: resampleToWeeklyGrid', () => {
  it('khớp reference khi hai chuỗi có grid ngày khác nhau', () => {
    const rng = mulberry32(5)
    const datesA: string[] = []
    const datesB: string[] = []
    const valuesA: number[] = []
    const valuesB: number[] = []
    let d = '2024-01-01'
    for (let i = 0; i < 40; i++) {
      datesA.push(d)
      valuesA.push(1 + (rng() - 0.5) * 0.2)
      if (i % 2 === 0) { datesB.push(d); valuesB.push(1 + (rng() - 0.5) * 0.2) }
      d = isoAddDays(d, 7)
    }
    const A: ReturnPoint[] = datesA.map((date, i) => ({ date, value: valuesA[i]! }))
    const B: ReturnPoint[] = datesB.map((date, i) => ({ date, value: valuesB[i]! }))
    const prod = resampleToWeeklyGrid([A, B])
    const ref = refResampleToWeeklyGrid([A, B])
    expect(prod).toHaveLength(2)
    for (let s = 0; s < 2; s++) expectPointsEqual(prod[s]!, ref[s]!, 9)
  })

  it('edge: 1 chuỗi → trả nguyên chuỗi; chuỗi rỗng → trả nguyên', () => {
    const single = [CUM_WK]
    expect(resampleToWeeklyGrid(single)).toBe(single)
    const empty: ReturnPoint[][] = [[], CUM_WK]
    expect(resampleToWeeklyGrid(empty)).toBe(empty)
  })

  it('edge: hai chuỗi cùng grid ngày → lưới tuần giữ nguyên giá trị', () => {
    const dates = FUND_A.slice(0, 30).map(p => p.date)
    const S1 = dates.map((date, i) => ({ date, value: i / 100 }))
    const S2 = dates.map((date, i) => ({ date, value: i / 200 }))
    const prod = resampleToWeeklyGrid([S1, S2])
    const ref = refResampleToWeeklyGrid([S1, S2])
    for (let s = 0; s < 2; s++) expectPointsEqual(prod[s]!, ref[s]!, 9)
  })
})

// ============================================================================
describe('differential: simulateDCA (weighted-return reference)', () => {
  function pricesMap(...pts: PricePoint[][]): Map<string, PricePoint[]> {
    const m = new Map<string, PricePoint[]>()
    pts.forEach((p, i) => m.set(`F${i + 1}`, p))
    return m
  }

  it('1 quỹ, monthly nạp + quarterly rebalance', () => {
    const prices = pricesMap(FUND_A)
    const params = { initialAmount: 5_000_000, cashflowAmount: 1_000_000, cashflowFreq: 'monthly' as DCAFrequency }
    const prod = simulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'quarterly')
    const ref = refSimulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'quarterly')
    expectSimEqual(prod, ref)
  })

  it('2 quỹ tỷ trọng lệch, weekly nạp + monthly rebalance', () => {
    const prices = new Map([['A', FUND_A], ['B', FUND_B]])
    const slots = [{ fundId: 'A', weight: 70 }, { fundId: 'B', weight: 30 }]
    const params = { initialAmount: 2_000_000, cashflowAmount: 500_000, cashflowFreq: 'weekly' as DCAFrequency }
    const prod = simulateDCA(prices, slots, params, 'monthly')
    const ref = refSimulateDCA(prices, slots, params, 'monthly')
    expectSimEqual(prod, ref)
  })

  it.each(['daily', 'biweekly', 'semiannual', 'yearly'] as DCAFrequency[])('tần suất nạp %s khớp', freq => {
    const prices = pricesMap(FUND_A)
    const params = { initialAmount: 1_000_000, cashflowAmount: 300_000, cashflowFreq: freq }
    const prod = simulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'yearly')
    const ref = refSimulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'yearly')
    expectSimEqual(prod, ref)
  })

  it('skipContributionWhen: cùng (date, drawdown) được truyền vào hook và cùng kết quả', () => {
    const prices = pricesMap(FUND_A)
    const params = { initialAmount: 0, cashflowAmount: 1_000_000, cashflowFreq: 'monthly' as DCAFrequency }
    const prodCalls: Array<[string, number]> = []
    const refCalls: Array<[string, number]> = []
    const prod = simulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'quarterly', {
      skipContributionWhen: (d, dd) => { prodCalls.push([d, dd]); return dd < -0.05 },
    })
    const ref = refSimulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'quarterly', {
      skipContributionWhen: (d, dd) => { refCalls.push([d, dd]); return dd < -0.05 },
    })
    expectSimEqual(prod, ref)
    expect(prodCalls).toHaveLength(refCalls.length)
    for (let i = 0; i < refCalls.length; i++) {
      expect(prodCalls[i]![0]).toBe(refCalls[i]![0])
      expect(prodCalls[i]![1]).toBeCloseTo(refCalls[i]![1], 8)
    }
  })

  it('contributionAmountOverride + ưu tiên skip khi cả hai đặt', () => {
    const prices = pricesMap(FUND_A)
    const params = { initialAmount: 0, cashflowAmount: 100_000, cashflowFreq: 'monthly' as DCAFrequency }
    const slots = [{ fundId: 'F1', weight: 100 }]
    const prod = simulateDCA(prices, slots, params, 'quarterly', {
      contributionAmountOverride: (d) => d.startsWith('2024-02') ? 500_000 : 100_000,
    })
    const ref = refSimulateDCA(prices, slots, params, 'quarterly', {
      contributionAmountOverride: (d) => d.startsWith('2024-02') ? 500_000 : 100_000,
    })
    expectSimEqual(prod, ref)
    // skip chiếm ưu tiên → không nạp gì
    const prod2 = simulateDCA(prices, slots, params, 'quarterly', {
      skipContributionWhen: () => true,
      contributionAmountOverride: () => 999_999,
    })
    const ref2 = refSimulateDCA(prices, slots, params, 'quarterly', {
      skipContributionWhen: () => true,
      contributionAmountOverride: () => 999_999,
    })
    expectSimEqual(prod2, ref2)
    expect(prod2.totalInvested).toBe(0)
  })

  it('purchasePrices (vàng 2 giá): mua ở giá bán, định giá ở giá mua', () => {
    const prices = pricesMap(FUND_A)
    const goldBuy = new Map([['F1', FUND_A]])
    const goldSell = new Map([['F1', FUND_A.map(p => ({ date: p.date, price: p.price * 1.1 }))]])
    const params = { initialAmount: 10_000_000, cashflowAmount: 0, cashflowFreq: 'monthly' as DCAFrequency }
    const prod = simulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'yearly', { purchasePrices: goldSell })
    const ref = refSimulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'yearly', { purchasePrices: goldSell })
    expectSimEqual(prod, ref)
    // quỹ không có entry purchasePrices → không bị ảnh hưởng
    const prod2 = simulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'yearly', { purchasePrices: goldBuy })
    const ref2 = refSimulateDCA(prices, [{ fundId: 'F1', weight: 100 }], params, 'yearly', { purchasePrices: goldBuy })
    expectSimEqual(prod2, ref2)
  })

  it('edge: slot rỗng / thiếu quỹ → kết quả rỗng', () => {
    const prices = pricesMap(FUND_A)
    const params = { initialAmount: 1000, cashflowAmount: 100, cashflowFreq: 'monthly' as DCAFrequency }
    expect(simulateDCA(prices, [], params, 'yearly')).toEqual(EMPTY_SIM)
    expect(simulateDCA(prices, [{ fundId: '', weight: 100 }], params, 'yearly')).toEqual(EMPTY_SIM)
    expect(refSimulateDCA(prices, [], params, 'yearly')).toEqual(EMPTY_SIM)
  })

  it('edge: không có giao ngày chung → kết quả rỗng', () => {
    const disjoint = new Map([
      ['A', [{ date: '2024-01-01', price: 100 }, { date: '2024-01-02', price: 101 }]],
      ['B', [{ date: '2025-01-01', price: 100 }, { date: '2025-01-02', price: 101 }]],
    ])
    const params = { initialAmount: 1000, cashflowAmount: 100, cashflowFreq: 'monthly' as DCAFrequency }
    expect(simulateDCA(disjoint, [{ fundId: 'A', weight: 50 }, { fundId: 'B', weight: 50 }], params, 'yearly')).toEqual(EMPTY_SIM)
    expect(refSimulateDCA(disjoint, [{ fundId: 'A', weight: 50 }, { fundId: 'B', weight: 50 }], params, 'yearly')).toEqual(EMPTY_SIM)
  })

  it('dữ liệu thật REAL_FUND, chỉ nạp định kỳ không rebalance', () => {
    const prices = new Map([['E1VFVN30', REAL_FUND]])
    const params = { initialAmount: 1_000_000, cashflowAmount: 200_000, cashflowFreq: 'weekly' as DCAFrequency }
    const prod = simulateDCA(prices, [{ fundId: 'E1VFVN30', weight: 100 }], params, 'yearly')
    const ref = refSimulateDCA(prices, [{ fundId: 'E1VFVN30', weight: 100 }], params, 'yearly')
    expectSimEqual(prod, ref)
  })
})

// ============================================================================
describe('differential: dcaMWRR (bisection reference)', () => {
  function monthlyCashflow(startISO: string, months: number, perMonth: number, finalValue: number) {
    const out: { date: string; amount: number }[] = []
    const d = new Date(startISO + 'T00:00:00Z')
    for (let i = 0; i < months; i++) {
      out.push({ date: new Date(d.getTime() + i * 30 * 86400000).toISOString().slice(0, 10), amount: -perMonth })
    }
    out.push({ date: new Date(d.getTime() + months * 30 * 86400000).toISOString().slice(0, 10), amount: finalValue })
    return out
  }

  it('khớp reference trên chuỗi nạp đều 24 tháng', () => {
    const cfs = monthlyCashflow('2020-01-01', 24, 1_000_000, 26_000_000)
    const prod = dcaMWRR(cfs)
    const ref = refDcaMWRR(cfs)
    expect(prod).not.toBeNull()
    expect(ref).not.toBeNull()
    expect(prod!).toBeCloseTo(ref!, 4)
  })

  it('khớp trên MWRR từ chính kết quả simulateDCA (dữ liệu thật)', () => {
    const prices = new Map([['E1VFVN30', REAL_FUND]])
    const result = simulateDCA(
      prices,
      [{ fundId: 'E1VFVN30', weight: 100 }],
      { initialAmount: 0, cashflowAmount: 200_000, cashflowFreq: 'weekly' },
      'yearly',
    )
    const prod = dcaMWRR(result.cashflows)
    const ref = refDcaMWRR(result.cashflows)
    expect(prod).not.toBeNull()
    expect(prod!).toBeCloseTo(ref!, 4)
  })

  it('IRR âm (mua đắt, kết thúc ít hơn vốn) khớp', () => {
    const cfs = [
      { date: '2020-01-01', amount: -10_000_000 },
      { date: '2021-01-01', amount: -10_000_000 },
      { date: '2022-01-01', amount: 15_000_000 },
    ]
    const prod = dcaMWRR(cfs)
    const ref = refDcaMWRR(cfs)
    expect(prod).not.toBeNull()
    expect(prod).toBeLessThan(0)
    expect(prod!).toBeCloseTo(ref!, 4)
  })

  it('không đủ 2 cashflow → null', () => {
    expect(dcaMWRR([{ date: '2020-01-01', amount: -100 }])).toBeNull()
    expect(refDcaMWRR([{ date: '2020-01-01', amount: -100 }])).toBeNull()
  })
})

// ============================================================================
describe('differential: CAGR / maxDrawdown / profitFactor / investorCagr', () => {
  it('dcaCagr khớp reference', () => {
    expect(dcaCagr(CUM_WK)).toBeCloseTo(refDcaCagr(CUM_WK)!, 9)
    expect(dcaCagr([])).toBeNull()
  })

  it('investorCagr khớp reference', () => {
    const total = 12_000_000
    const final = 15_000_000
    expect(investorCagr(CUM_WK, total, final)).toBeCloseTo(refInvestorCagr(CUM_WK, total, final)!, 9)
    expect(investorCagr(CUM_WK, 0, final)).toBeNull()
  })

  it('dcaMaxDrawdown khớp reference', () => {
    expect(dcaMaxDrawdown(CUM_WK)).toBeCloseTo(refDcaMaxDrawdown(CUM_WK), 9)
    expect(dcaMaxDrawdown([])).toBe(0)
  })

  it('dcaProfitFactor khớp reference', () => {
    const returns = refComputeDCARolling(CUM_WK, 12)
    expect(dcaProfitFactor(returns)).toBeCloseTo(refDcaProfitFactor(returns)!, 9)
    expect(dcaProfitFactor([{ date: '2020-01-01', value: 0.1 }])).toBeNull()
  })
})

// ============================================================================
describe('differential: dcaYearlyReturns', () => {
  it('khớp reference trên cumulative thật', () => {
    const prod = dcaYearlyReturns(CUM_WK)
    const ref = refDcaYearlyReturns(CUM_WK)
    expect(prod).toHaveLength(ref.length)
    for (let i = 0; i < ref.length; i++) {
      expect(prod[i]!.year).toBe(ref[i]!.year)
      expect(prod[i]!.value).toBeCloseTo(ref[i]!.value, 9)
      expect(prod[i]!.isPartial).toBe(ref[i]!.isPartial)
    }
  })

  it('chuỗi ngắn → []', () => {
    expect(dcaYearlyReturns([{ date: '2024-01-01', value: 0 }])).toEqual([])
    expect(refDcaYearlyReturns([{ date: '2024-01-01', value: 0 }])).toEqual([])
  })
})

// ============================================================================
describe('differential: dcaYearlyMWRR (single-pass reference)', () => {
  it('khớp reference trên simulateDCA thật', () => {
    const prices = new Map([['A', FUND_A], ['B', FUND_B]])
    const result = simulateDCA(
      prices,
      [{ fundId: 'A', weight: 60 }, { fundId: 'B', weight: 40 }],
      { initialAmount: 3_000_000, cashflowAmount: 500_000, cashflowFreq: 'monthly' },
      'quarterly',
    )
    const prod = dcaYearlyMWRR(result.values, result.cashflows)
    const ref = refDcaYearlyMWRR(result.values, result.cashflows)
    expect(prod).toHaveLength(ref.length)
    for (let i = 0; i < ref.length; i++) {
      expect(prod[i]!.year).toBe(ref[i]!.year)
      if (ref[i]!.value === null) expect(prod[i]!.value).toBeNull()
      else expect(prod[i]!.value!).toBeCloseTo(ref[i]!.value!, 9)
      expect(prod[i]!.isPartial).toBe(ref[i]!.isPartial)
      expect(prod[i]!.endValue).toBeCloseTo(ref[i]!.endValue, 6)
    }
  })

  it('kỳ đầu bắt đầu giữa năm: BV=0 và isPartial', () => {
    const valueSeries = [
      { date: '2024-06-01', value: 100 },
      { date: '2024-09-15', value: 105 },
      { date: '2024-12-31', value: 110 },
    ]
    const cashflows = [{ date: '2024-06-01', amount: -100 }]
    const prod = dcaYearlyMWRR(valueSeries, cashflows)
    const ref = refDcaYearlyMWRR(valueSeries, cashflows)
    expect(prod).toHaveLength(ref.length)
    expect(prod[0]!.year).toBe(ref[0]!.year)
    expect(prod[0]!.isPartial).toBe(true)
    expect(prod[0]!.value!).toBeCloseTo(ref[0]!.value!, 9)
  })
})

// ============================================================================
describe('differential: computeDCARolling (naive window reference)', () => {
  it.each([6, 12, 24])('periodMonths=%s khớp reference', period => {
    expectPointsEqual(computeDCARolling(CUM_WK, period), refComputeDCARolling(CUM_WK, period), 8)
  })

  it('chuỗi chưa đủ window → []', () => {
    const short = cumulativeFromPrices(
      WK_LONG.map(p => p.date).slice(0, 20),
      WK_LONG.map(p => p.price).slice(0, 20),
    )
    expect(computeDCARolling(short, 24)).toEqual([])
    expect(refComputeDCARolling(short, 24)).toEqual([])
  })

  it('chuỗi rỗng → []', () => {
    expect(computeDCARolling([], 12)).toEqual([])
    expect(refComputeDCARolling([], 12)).toEqual([])
  })
})

// ============================================================================
describe('differential: dcaStormStats', () => {
  /**
   * Dựng chuỗi xác định: tăng lên đỉnh, rơi -70% tại đúng troughDate, rồi hồi
   * phục về đỉnh. Đảm bảo maxDD nằm chính xác tại troughDate → xác định được
   * inBearPeriod, không phụ thuộc random walk.
   */
  function stormSeries(troughDate: string): { cumulative: ReturnPoint[]; drawdown: ReturnPoint[] } {
    const peakValue = 0.20 // growth 1.20
    const troughValue = 1.20 * (1 - 0.70) - 1 // growth 0.36 → dd -0.70
    const cumulative: ReturnPoint[] = [
      { date: isoAddDays(troughDate, -60), value: 0.10 },
      { date: isoAddDays(troughDate, -30), value: 0.15 },
      { date: isoAddDays(troughDate, -14), value: peakValue },
      { date: isoAddDays(troughDate, -7), value: 0.10 },
      { date: troughDate, value: troughValue },
      { date: isoAddDays(troughDate, 30), value: 0.05 },
      { date: isoAddDays(troughDate, 60), value: 0.15 },
      { date: isoAddDays(troughDate, 120), value: peakValue },
      { date: isoAddDays(troughDate, 300), value: 0.25 },
    ]
    return { cumulative, drawdown: drawdownFromCumulative(cumulative) }
  }

  it('khớp reference với bão -70% tại 9/2022 (bear2022)', () => {
    const { cumulative, drawdown } = stormSeries('2022-09-15')
    const prod = dcaStormStats(drawdown, cumulative)
    const ref = refDcaStormStats(drawdown, cumulative)
    expect(prod.maxDrawdown).toBeCloseTo(ref.maxDrawdown, 9)
    expect(prod.maxDDDate).toBe(ref.maxDDDate)
    expect(prod.maxDDPeakDate).toBe(ref.maxDDPeakDate)
    expect(prod.recoveryMonths).toBe(ref.recoveryMonths)
    expect(prod.stormsCount).toBe(ref.stormsCount)
    expect(prod.stormsCount).toBeGreaterThanOrEqual(1)
    expect(prod.inBearPeriod).toBe(ref.inBearPeriod)
    expect(prod.inBearPeriod).toBe('bear2022')
  })

  it('nhận diện đúng bear period theo ngày chạm đáy', () => {
    for (const [date, expected] of [
      ['2020-04-15', 'covid2020'],
      ['2018-08-15', 'bear2018'],
      ['2022-09-15', 'bear2022'],
      ['2025-06-15', null],
    ] as const) {
      const { cumulative, drawdown } = stormSeries(date)
      const prod = dcaStormStats(drawdown, cumulative)
      const ref = refDcaStormStats(drawdown, cumulative)
      expect(prod.inBearPeriod, date).toBe(expected)
      expect(prod.inBearPeriod).toBe(ref.inBearPeriod)
      expect(prod.stormsCount).toBe(ref.stormsCount)
      expect(prod.maxDDDate).toBe(ref.maxDDDate)
      expect(prod.recoveryMonths).toBe(ref.recoveryMonths)
    }
  })

  it('chuỗi phẳng → 0 bão, không bear, không hồi phục', () => {
    const flat: ReturnPoint[] = []
    const dd: ReturnPoint[] = []
    for (let i = 0; i < 52; i++) {
      flat.push({ date: isoAddDays('2020-01-01', i * 7), value: 0.01 })
      dd.push({ date: isoAddDays('2020-01-01', i * 7), value: 0 })
    }
    const prod = dcaStormStats(dd, flat)
    const ref = refDcaStormStats(dd, flat)
    expect(prod.stormsCount).toBe(0)
    expect(prod.inBearPeriod).toBeNull()
    // Chuỗi phẳng → maxDD=0 tại index 0, "hồi phục" về peak ngay index 1 → 0 tháng
    expect(prod.recoveryMonths).toBe(ref.recoveryMonths)
    expect(prod).toEqual(ref)
  })

  it('rỗng → kết quả rỗng', () => {
    const prod = dcaStormStats([], [])
    const ref = refDcaStormStats([], [])
    expect(prod).toEqual(ref)
    expect(prod.maxDrawdown).toBe(0)
  })
})

// ============================================================================
describe('differential: rollingCAGR / trailingWindowCagr', () => {
  it('rollingCAGR khớp reference (window 3 và 5 năm)', () => {
    const longer = genWeeklySeries('2016-01-04', 520, 21)
    const cum = cumulativeFromPrices(longer.map(p => p.date), longer.map(p => p.price))
    for (const w of [3, 5]) {
      const prod = rollingCAGR(cum, w)
      const ref = refRollingCAGR(cum, w)
      expect(prod).toHaveLength(ref.length)
      for (let i = 0; i < ref.length; i++) {
        expect(prod[i]!.startDate).toBe(ref[i]!.startDate)
        expect(prod[i]!.endDate).toBe(ref[i]!.endDate)
        expect(prod[i]!.cagr).toBeCloseTo(ref[i]!.cagr, 8)
      }
    }
  })

  it('trailingWindowCagr khớp reference', () => {
    const longer = genWeeklySeries('2016-01-04', 520, 21)
    const cum = cumulativeFromPrices(longer.map(p => p.date), longer.map(p => p.price))
    for (const w of [1, 3, 5]) {
      const prod = trailingWindowCagr(cum, w)
      const ref = refTrailingWindowCagr(cum, w)
      if (ref === null) expect(prod).toBeNull()
      else expect(prod!).toBeCloseTo(ref, 8)
    }
  })

  it('trailingWindowCagr null khi không đủ lịch sử', () => {
    expect(trailingWindowCagr(CUM_WK, 10)).toBeNull()
    expect(refTrailingWindowCagr(CUM_WK, 10)).toBeNull()
  })
})

// ============================================================================
describe('differential: histogramBuckets / dcaMonthlyReturns / monthlyEquivalentContribution / derivePortfolioName', () => {
  it('histogramBuckets khớp reference', () => {
    const rng = mulberry32(77)
    const values = Array.from({ length: 300 }, () => (rng() - 0.5) * 0.4)
    expect(histogramBuckets(values, 0.02)).toEqual(refHistogramBuckets(values, 0.02))
    expect(histogramBuckets([], 0.02)).toEqual([])
  })

  it('dcaMonthlyReturns khớp reference', () => {
    expectPointsEqual(dcaMonthlyReturns(CUM_WK), refDcaMonthlyReturns(CUM_WK), 9)
  })

  it('monthlyEquivalentContribution khớp hệ số quy đổi', () => {
    expect(monthlyEquivalentContribution(6_000_000, 'monthly')).toBe(6_000_000)
    expect(monthlyEquivalentContribution(18_000_000, 'quarterly')).toBe(6_000_000)
    expect(monthlyEquivalentContribution(1_000_000, 'weekly')).toBeCloseTo(1_000_000 * (365.25 / 7 / 12), 9)
    expect(monthlyEquivalentContribution(1_000_000, 'daily')).toBeCloseTo(1_000_000 * (365.25 / 12), 9)
  })

  it('derivePortfolioName', () => {
    expect(derivePortfolioName([{ fundId: 'DCDS', weight: 100 }], 'Portfolio 1')).toBe('DCDS')
    expect(derivePortfolioName([{ fundId: 'DCDS', weight: 60 }, { fundId: 'DCBF', weight: 40 }], 'Portfolio 2')).toBe('Portfolio 2')
  })
})

// ============================================================================
describe('differential: monteCarloProjection + probabilityAtLeast', () => {
  it('khớp reference với rng seeded (cùng stream rng)', () => {
    const monthly = refDcaMonthlyReturns(CUM_WK).map(p => p.value)
    const base = {
      monthlyReturnPool: monthly,
      startValue: 100_000_000,
      monthlyContribution: 3_000_000,
      horizonMonths: 60,
      iterations: 400,
      blockSize: 12,
    }
    const prod = monteCarloProjection({ ...base, rng: mulberry32(2024) })
    const ref = refMonteCarloProjection({ ...base, rng: mulberry32(2024) })
    expect(prod).not.toBeNull()
    expect(ref).not.toBeNull()
    expect(prod!.path).toHaveLength(ref!.path.length)
    for (let m = 0; m < ref!.path.length; m++) {
      const p = prod!.path[m]!
      const r = ref!.path[m]!
      expect(p.month).toBe(r.month)
      expect(p.p10).toBeCloseTo(r.p10, 6)
      expect(p.p25).toBeCloseTo(r.p25, 6)
      expect(p.p50).toBeCloseTo(r.p50, 6)
      expect(p.p75).toBeCloseTo(r.p75, 6)
      expect(p.p90).toBeCloseTo(r.p90, 6)
    }
    expect(prod!.finalValues).toHaveLength(ref!.finalValues.length)
    for (let i = 0; i < ref!.finalValues.length; i++) {
      expect(prod!.finalValues[i]!).toBeCloseTo(ref!.finalValues[i]!, 6)
    }
  })

  it('probabilityAtLeast khớp reference (count trực tiếp)', () => {
    const monthly = refDcaMonthlyReturns(CUM_WK).map(p => p.value)
    const ref = refMonteCarloProjection({
      monthlyReturnPool: monthly,
      startValue: 100_000_000,
      monthlyContribution: 3_000_000,
      horizonMonths: 36,
      iterations: 200,
      blockSize: 12,
      rng: mulberry32(7),
    })!
    for (const target of [90_000_000, 120_000_000, 200_000_000]) {
      expect(probabilityAtLeast(ref.finalValues, target)).toBeCloseTo(refProbabilityAtLeast(ref.finalValues, target), 10)
    }
    expect(probabilityAtLeast([], 100)).toBe(0)
  })
})

// ============================================================================
describe('differential: trackDividendNarrative (event-queue reference)', () => {
  const FUND = 'A'
  const OTHER = 'B'

  it('khớp reference khi có 2 đợt cổ tức, cashflow + rebalance chạy song song', () => {
    const weekly = genWeeklySeries('2024-01-01', 40, 5)
    const prices = new Map([[FUND, weekly], [OTHER, genWeeklySeries('2024-01-01', 40, 8)]])
    const dividends = new Map<string, DividendEvent[]>([
      [FUND, [
        { exDate: '2024-03-05', payDate: '2024-03-12', amountPerCert: 800, taxRate: 0.05 },
        { exDate: '2024-05-07', payDate: '2024-05-14', amountPerCert: 500, taxRate: 0.05 },
      ]],
    ])
    const params = { initialAmount: 5_000_000, cashflowAmount: 1_000_000, cashflowFreq: 'monthly' as DCAFrequency }
    const slots = [{ fundId: FUND, weight: 60 }, { fundId: OTHER, weight: 40 }]

    const prod = trackDividendNarrative(prices, slots, params, 'quarterly', dividends)
    const ref = refTrackDividendNarrative(prices, slots, params, 'quarterly', dividends)

    expect(prod).toHaveLength(ref.length)
    for (let f = 0; f < ref.length; f++) {
      const p = prod[f]!
      const r = ref[f]!
      expect(p.fundId).toBe(r.fundId)
      expect(p.eventCount).toBe(r.eventCount)
      expect(p.totalGross).toBeCloseTo(r.totalGross, 6)
      expect(p.totalTax).toBeCloseTo(r.totalTax, 6)
      expect(p.totalNet).toBeCloseTo(r.totalNet, 6)
      expect(p.totalSharesAdded).toBeCloseTo(r.totalSharesAdded, 6)
      expect(p.events).toHaveLength(r.events.length)
      for (let e = 0; e < r.events.length; e++) {
        expect(p.events[e]!.exDate).toBe(r.events[e]!.exDate)
        expect(p.events[e]!.payDate).toBe(r.events[e]!.payDate)
        expect(p.events[e]!.unitsAtEx).toBeCloseTo(r.events[e]!.unitsAtEx, 6)
        expect(p.events[e]!.gross).toBeCloseTo(r.events[e]!.gross, 6)
        expect(p.events[e]!.tax).toBeCloseTo(r.events[e]!.tax, 6)
        expect(p.events[e]!.net).toBeCloseTo(r.events[e]!.net, 6)
        expect(p.events[e]!.sharesAdded).toBeCloseTo(r.events[e]!.sharesAdded, 6)
      }
    }
  })

  it('không quỹ nào có cổ tức → []', () => {
    const weekly = genWeeklySeries('2024-01-01', 30, 11)
    const prices = new Map([[FUND, weekly]])
    const params = { initialAmount: 1000, cashflowAmount: 100, cashflowFreq: 'monthly' as DCAFrequency }
    expect(trackDividendNarrative(prices, [{ fundId: FUND, weight: 100 }], params, 'yearly', new Map())).toEqual([])
    expect(refTrackDividendNarrative(prices, [{ fundId: FUND, weight: 100 }], params, 'yearly', new Map())).toEqual([])
  })
})

// ============================================================================
describe('differential: pipeline end-to-end (đúng quy trình DCAPanel)', () => {
  it('simulateDCA → mọi KPI khớp reference', () => {
    const prices = new Map([['A', FUND_A], ['B', FUND_B]])
    const slots = [{ fundId: 'A', weight: 60 }, { fundId: 'B', weight: 40 }]
    const params = { initialAmount: 3_000_000, cashflowAmount: 1_000_000, cashflowFreq: 'monthly' as DCAFrequency }
    const prod = simulateDCA(prices, slots, params, 'quarterly')
    const ref = refSimulateDCA(prices, slots, params, 'quarterly')

    // TWRR-based KPIs
    expect(dcaCagr(prod.cumulative)).toBeCloseTo(refDcaCagr(ref.cumulative)!, 8)
    expect(dcaMaxDrawdown(prod.cumulative)).toBeCloseTo(refDcaMaxDrawdown(ref.cumulative), 8)
    expect(dcaProfitFactor(prod.returns)).toBeCloseTo(refDcaProfitFactor(ref.returns)!, 8)
    expect(investorCagr(prod.cumulative, prod.totalInvested, prod.finalValue))
      .toBeCloseTo(refInvestorCagr(ref.cumulative, ref.totalInvested, ref.finalValue)!, 8)
    expect(dcaMWRR(prod.cashflows)).toBeCloseTo(refDcaMWRR(ref.cashflows)!, 4)

    // Rolling & yearly
    expectPointsEqual(computeDCARolling(prod.cumulative, 12), refComputeDCARolling(ref.cumulative, 12), 8)
    const py = dcaYearlyReturns(prod.cumulative)
    const ry = refDcaYearlyReturns(ref.cumulative)
    expect(py).toHaveLength(ry.length)
    for (let i = 0; i < ry.length; i++) expect(py[i]!.value).toBeCloseTo(ry[i]!.value, 8)
    const pm = dcaYearlyMWRR(prod.values, prod.cashflows)
    const rm = refDcaYearlyMWRR(ref.values, ref.cashflows)
    expect(pm).toHaveLength(rm.length)
    for (let i = 0; i < rm.length; i++) {
      if (rm[i]!.value !== null) expect(pm[i]!.value!).toBeCloseTo(rm[i]!.value!, 8)
    }

    // Storm & monthly pool
    const dd = prod.drawdown
    const pd = dcaStormStats(dd, prod.cumulative)
    const rd = refDcaStormStats(ref.drawdown, ref.cumulative)
    expect(pd.stormsCount).toBe(rd.stormsCount)
    expect(pd.maxDDDate).toBe(rd.maxDDDate)
    expectPointsEqual(dcaMonthlyReturns(prod.cumulative), refDcaMonthlyReturns(ref.cumulative), 8)
  })
})
