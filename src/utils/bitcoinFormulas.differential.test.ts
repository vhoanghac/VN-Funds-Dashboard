/**
 * DIFFERENTIAL TEST — kiểm chứng độc lập mọi công thức tab Bitcoin.
 *
 * Ý tưởng: với mỗi hàm trong calculations.ts / portfolio.ts / dateAlign.ts /
 * dividendAdjust.ts / cycleReturns.ts mà BitcoinPanel dùng, VIẾT LẠI MỘT CÁCH
 * ĐỘC LẬP theo đúng định nghĩa toán học nhưng dùng THUẬT TOÁN KHÁC với code
 * thật (vd portfolio: share-based thay vì value-based; rolling: nhân trực tiếp
 * từng cửa sổ thay vì log-prefix; dividend: forward-scan thay vì reverse-scan),
 * rồi chạy CẢ HAI trên cùng dữ liệu và so khớp.
 *
 * Nếu hai bên cho kết quả khác nhau → ít nhất một bên sai. Vì reference là định
 * nghĩa, lỗi thường nằm ở code thật. Đây là lớp bảo hiểm không phụ thuộc vào
 * golden test (vốn có thể "chốt sai" ngay từ đầu).
 *
 * Dữ liệu: synthetic sinh bằng PRNG seeded (tái lập được), + snapshot thật của
 * BTC (daily) và E1VFVN30 (weekly) trong 5-6/2022 (fixture bitcoinRealData).
 */
import { describe, it, expect } from 'vitest'
import {
  weeklyReturns, cumulativeReturns, cagr, annualizedStdev, maxDrawdown,
  riskContribution, worstWeeklyReturn, worstMonthlyReturn,
  rollingCumulativeReturns, rollingCumulativeReturnsMap, winRateAgainstRolledB,
  rollingReturns, rollingAverage, rollingAnnualizedStdev, rollingMaxDrawdown,
  positiveRollingRate,
} from './calculations'
import { simulateMultiFundPortfolio } from './portfolio'
import { alignMultiSeries } from './dateAlign'
import { applyDividendAdjustment } from './dividendAdjust'
import { buildPeriods, periodStat, groupByYearInTerm } from './cycleReturns'
import type { ReturnPoint, PricePoint, RebalanceFrequency } from '../types'
import { REAL_BTC, REAL_FUND } from '../__tests__/fixtures/bitcoinRealData.fixture'

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

// ─── Reference implementations (độc lập) ───────────────────

function refWeeklyReturns(dates: string[], prices: number[]): ReturnPoint[] {
  const out: ReturnPoint[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) continue
    out.push({ date: dates[i]!, value: prices[i]! / prices[i - 1]! - 1 })
  }
  return out
}

function refCumulativeReturns(returns: ReturnPoint[], startDate?: string): ReturnPoint[] {
  if (returns.length === 0) return []
  const out: ReturnPoint[] = []
  if (startDate) out.push({ date: startDate, value: 0 })
  let growth = 1
  for (const r of returns) {
    growth *= 1 + r.value
    out.push({ date: r.date, value: growth - 1 })
  }
  return out
}

function refCagr(returns: ReturnPoint[]): number | null {
  if (returns.length === 0) return null
  let growth = 1
  for (const r of returns) growth *= 1 + r.value
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years =
    (Date.parse(returns[returns.length - 1]!.date) - Date.parse(returns[0]!.date)) / msPerYear
  if (years <= 0) return null
  return Math.pow(growth, 1 / years) - 1
}

function refAnnualizedStdev(returns: ReturnPoint[]): number {
  if (returns.length < 2) return 0
  const n = returns.length
  let sum = 0
  let sumSq = 0
  for (const r of returns) {
    sum += r.value
    sumSq += r.value * r.value
  }
  // Biến thể khác production (sum-of-squares thay vì sum (x-mean)^2)
  const variance = (sumSq - (sum * sum) / n) / (n - 1)
  const msPerYear = 365.25 * 24 * 3600 * 1000
  const years = (Date.parse(returns[n - 1]!.date) - Date.parse(returns[0]!.date)) / msPerYear
  const ppy = years > 0 ? n / years : 52
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(ppy)
}

function refMaxDrawdown(returns: ReturnPoint[]): number {
  if (returns.length === 0) return 0
  const growth: number[] = []
  let g = 1
  for (const r of returns) {
    g *= 1 + r.value
    growth.push(g)
  }
  const peak: number[] = []
  let p = 1 // peak ban đầu = giá trị đầu tư ban đầu (1.0), như production
  for (const v of growth) {
    p = Math.max(p, v)
    peak.push(p)
  }
  let maxDD = 0
  for (let i = 0; i < growth.length; i++) {
    const dd = growth[i]! / peak[i]! - 1
    if (dd < maxDD) maxDD = dd
  }
  return maxDD
}

function refRiskContribution(
  returnsA: ReturnPoint[], returnsB: ReturnPoint[], wA: number, wB: number,
): { contribA: number; contribB: number } {
  const n = Math.min(returnsA.length, returnsB.length)
  if (n < 2 || (wA === 0 && wB === 0)) return { contribA: 0, contribB: 0 }
  const A = returnsA.slice(0, n).map(r => r.value)
  const B = returnsB.slice(0, n).map(r => r.value)
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length
  const mA = mean(A)
  const mB = mean(B)
  const cov = (X: number[], Y: number[], mX: number, mY: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += (X[i]! - mX) * (Y[i]! - mY)
    return s / (n - 1)
  }
  const covAA = cov(A, A, mA, mA)
  const covAB = cov(A, B, mA, mB)
  const covBB = cov(B, B, mB, mB)
  const portVar = wA * wA * covAA + 2 * wA * wB * covAB + wB * wB * covBB
  const portSd = Math.sqrt(portVar)
  if (portSd === 0) return { contribA: 0, contribB: 0 }
  const margA = (wA * covAA + wB * covAB) / portSd
  const margB = (wA * covAB + wB * covBB) / portSd
  return { contribA: (margA * wA) / portSd, contribB: (margB * wB) / portSd }
}

/** Tệ nhất rolling window theo ngày lịch — nhân TRỰC TIẾP từng cửa sổ (O(n·w)). */
function refWorstRollingCalendarReturn(returns: ReturnPoint[], windowDays: number): number {
  const n = returns.length
  if (n === 0) return 0
  const dates = returns.map(r => Date.parse(r.date))
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  let worst = 0
  for (let i = 0; i < n; i++) {
    let prod = 1
    for (let j = i; j >= 0; j--) {
      if (dates[i]! - dates[j]! >= windowMs) break
      prod *= 1 + returns[j]!.value
    }
    const v = prod - 1
    if (v < worst) worst = v
  }
  return worst
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

/** rollingWindowStarts naive: tìm lại từ đầu mỗi i, không dùng two-pointer. */
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

/** Rolling cumulative return — windowed product trực tiếp, không log-prefix. */
function refRollingCumulativeReturns(returns: ReturnPoint[], periodMonths: number): ReturnPoint[] {
  const n = returns.length
  if (n === 0) return []
  const dates = returns.map(r => Date.parse(r.date))
  const starts = refRollingWindowStarts(dates, periodMonths)
  const out: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    let prod = 1
    for (let k = j + 1; k <= i; k++) prod *= 1 + returns[k]!.value
    out.push({ date: returns[i]!.date, value: prod - 1 })
  }
  return out
}

/** Rolling annualized stdev — variance từng cửa sổ bằng sum-of-squares. */
function refRollingAnnualizedStdev(returns: ReturnPoint[], periodMonths: number): ReturnPoint[] {
  const n = returns.length
  if (n < 2) return []
  const dates = returns.map(r => Date.parse(r.date))
  const starts = refRollingWindowStarts(dates, periodMonths)
  const out: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    const w = i - j
    if (w < 2) continue
    let sum = 0
    let sumSq = 0
    for (let k = j + 1; k <= i; k++) {
      sum += returns[k]!.value
      sumSq += returns[k]!.value * returns[k]!.value
    }
    const variance = Math.max(0, (sumSq - (sum * sum) / w) / (w - 1))
    const ppy = w / (periodMonths / 12)
    out.push({ date: returns[i]!.date, value: Math.sqrt(variance) * Math.sqrt(ppy) })
  }
  return out
}

/** Rolling max drawdown — mô phỏng maxDrawdown() từng cửa sổ. */
function refRollingMaxDrawdown(returns: ReturnPoint[], periodMonths: number): ReturnPoint[] {
  const n = returns.length
  if (n === 0) return []
  const dates = returns.map(r => Date.parse(r.date))
  const starts = refRollingWindowStarts(dates, periodMonths)
  const out: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    let growth = 1
    let peak = 1
    let maxDD = 0
    for (let k = j + 1; k <= i; k++) {
      growth *= 1 + returns[k]!.value
      if (growth > peak) peak = growth
      const dd = growth / peak - 1
      if (dd < maxDD) maxDD = dd
    }
    out.push({ date: returns[i]!.date, value: maxDD })
  }
  return out
}

function refRollingReturns(returns: ReturnPoint[], periodMonths: number): ReturnPoint[] {
  const n = returns.length
  if (n === 0) return []
  const dates = returns.map(r => Date.parse(r.date))
  const starts = refRollingWindowStarts(dates, periodMonths)
  const out: ReturnPoint[] = []
  for (let i = 0; i < n; i++) {
    const j = starts[i]!
    if (j < 0) continue
    let growth = 1
    for (let k = j + 1; k <= i; k++) growth *= 1 + returns[k]!.value
    const annualized = Math.pow(growth, 12 / periodMonths) - 1
    out.push({ date: returns[i]!.date, value: annualized })
  }
  return out
}

function refRollingAverage(rolling: ReturnPoint[]): number | null {
  if (rolling.length === 0) return null
  let sum = 0
  for (const r of rolling) sum += r.value
  return sum / rolling.length
}

function refPositiveRollingRate(rolling: ReturnPoint[]): number | null {
  if (rolling.length === 0) return null
  let pos = 0
  for (const r of rolling) if (r.value > 0) pos++
  return pos / rolling.length
}

/**
 * Portfolio simulation — SHARE-BASED (khác production value-based).
 * mỗi quỹ có price (bắt đầu 1) và shares (bắt đầu = weight). Giá trị = shares × price.
 * Rebalance: chia lại shares theo weight mục tiêu tại tổng hiện tại.
 */
function refSimulateMultiFundPortfolio(
  allReturns: ReturnPoint[][],
  weights: number[],
  rebalFreq: RebalanceFrequency,
): ReturnPoint[] {
  const n = allReturns.length
  if (n === 0) return []
  const len = allReturns[0]!.length
  if (len === 0) return []
  for (const r of allReturns) if (r.length !== len) throw new Error('length mismatch')

  const prices = new Array(n).fill(1)
  const shares = weights.slice()
  const result: ReturnPoint[] = []
  let prevTotal = 1
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < n; j++) prices[j] = prices[j]! * (1 + allReturns[j]![i]!.value)
    let total = 0
    for (let j = 0; j < n; j++) total += shares[j]! * prices[j]!
    result.push({ date: allReturns[0]![i]!.date, value: total / prevTotal - 1 })
    prevTotal = total
    const nextDate = i + 1 < len ? allReturns[0]![i + 1]!.date : null
    if (nextDate && refShouldRebalance(allReturns[0]![i]!.date, nextDate, rebalFreq)) {
      for (let j = 0; j < n; j++) shares[j] = (weights[j]! * total) / prices[j]!
    }
  }
  return result
}

function refShouldRebalance(currentDate: string, nextDate: string, freq: RebalanceFrequency): boolean {
  const cur = { y: +currentDate.slice(0, 4), m: +currentDate.slice(5, 7) }
  const next = { y: +nextDate.slice(0, 4), m: +nextDate.slice(5, 7) }
  const q = (m: number) => Math.ceil(m / 3)
  switch (freq) {
    case 'monthly': return cur.y !== next.y || cur.m !== next.m
    case 'quarterly': return cur.y !== next.y || q(cur.m) !== q(next.m)
    case 'yearly': return cur.y !== next.y
  }
}

/** alignMultiSeries — dùng con trỏ chỉ số (pointer) thay vì Map. */
function refAlignMultiSeries(allSeries: PricePoint[][]): { dates: string[]; prices: number[][] } {
  const n = allSeries.length
  if (n === 0) throw new Error('no series')
  const ptrs = new Array(n).fill(0)
  const dateSet = new Set<string>()
  for (const s of allSeries) for (const p of s) dateSet.add(p.date)
  const allDates = Array.from(dateSet).sort()
  let commonStart = ''
  let commonEnd = 'z'
  for (const s of allSeries) {
    if (s.length === 0) throw new Error('empty series')
    if (s[0]!.date > commonStart) commonStart = s[0]!.date
    if (s[s.length - 1]!.date < commonEnd) commonEnd = s[s.length - 1]!.date
  }
  if (commonStart > commonEnd) throw new Error('no overlap')
  const rangeDates = allDates.filter(d => d >= commonStart && d <= commonEnd)

  const lastValues: (number | null)[] = new Array(n).fill(null)
  const lastDates: (string | null)[] = new Array(n).fill(null)
  const dates: string[] = []
  const prices: number[][] = Array.from({ length: n }, () => [])

  for (const date of rangeDates) {
    let valid = true
    for (let j = 0; j < n; j++) {
      const s = allSeries[j]!
      while (ptrs[j]! < s.length && s[ptrs[j]!]!.date <= date) ptrs[j] = ptrs[j]! + 1
      if (ptrs[j]! > 0 && s[ptrs[j]! - 1]!.date === date) {
        lastValues[j] = s[ptrs[j]! - 1]!.price
        lastDates[j] = date
      }
      if (
        lastValues[j] === null ||
        Math.round((Date.parse(date) - Date.parse(lastDates[j]!)) / 86400000) > 14
      ) {
        valid = false
      }
    }
    if (!valid) continue
    dates.push(date)
    for (let j = 0; j < n; j++) prices[j]!.push(lastValues[j]!)
  }
  if (dates.length === 0) throw new Error('no valid points')
  return { dates, prices }
}

/** applyDividendAdjustment — forward-scan tìm closePreEx thay vì reverse-scan. */
function refApplyDividendAdjustment(daily: PricePoint[], events: { exDate: string; amountPerCert: number; taxRate: number }[]): PricePoint[] {
  if (events.length === 0 || daily.length === 0) return daily
  const sorted = [...events].sort((a, b) => a.exDate.localeCompare(b.exDate))
  const out: PricePoint[] = daily.map(p => ({ date: p.date, price: p.price }))
  for (const ev of sorted) {
    let idx = -1
    for (let i = 0; i < out.length; i++) {
      if (out[i]!.date < ev.exDate) idx = i
      else break
    }
    if (idx === -1) continue
    const closePreEx = out[idx]!.price
    const netDiv = ev.amountPerCert * (1 - ev.taxRate)
    const factor = Math.max(0, (closePreEx - netDiv) / closePreEx)
    if (factor >= 1 || factor <= 0) continue
    for (let i = 0; i <= idx; i++) out[i]!.price = out[i]!.price * factor
  }
  return out
}

function refPeriodStat(prices: PricePoint[], period: { from: string; to: string }): { close: number | null; peak: number | null; giveback: number | null } {
  let base: number | null = null
  for (const p of prices) {
    if (p.date <= period.from) base = p.price
    else break
  }
  if (base === null) {
    // Fallback như production priceAtStart: không có giá trước mốc thì lấy giá đầu tiên sau đó
    const after = prices.find(p => p.date > period.from)
    base = after ? after.price : null
  }
  const inside = prices.filter(p => p.date > period.from && p.date <= period.to)
  if (base === null || base <= 0 || inside.length === 0) return { close: null, peak: null, giveback: null }
  const last = inside[inside.length - 1]!.price
  const high = Math.max(...inside.map(p => p.price))
  return {
    close: (last / base - 1) * 100,
    peak: (high / base - 1) * 100,
    giveback: (last / high - 1) * 100,
  }
}

// ─── Comparison helpers ─────────────────────────────────────
function expectPointsEqual(actual: ReturnPoint[], expected: ReturnPoint[], digits = 9): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!.date, `date[${i}]`).toBe(expected[i]!.date)
    expect(actual[i]!.value, `value[${i}]`).toBeCloseTo(expected[i]!.value, digits)
  }
}

// ─── Synthetic data builders ────────────────────────────────
function genWeeklySeries(startISO: string, n: number, rng: () => number, base = 100): { dates: string[]; prices: number[] } {
  const dates: string[] = []
  const prices: number[] = []
  let d = startISO
  let p = base
  for (let i = 0; i < n; i++) {
    dates.push(d)
    prices.push(p)
    d = isoAddDays(d, 7)
    p = p * (1 + (rng() - 0.5) * 0.06)
  }
  return { dates, prices }
}

// ─── Dữ liệu dùng chung ─────────────────────────────────────
const SYNTH_A = genWeeklySeries('2019-01-07', 156, mulberry32(42))
const SYNTH_B = genWeeklySeries('2019-01-07', 156, mulberry32(7))
const RA = refWeeklyReturns(SYNTH_A.dates, SYNTH_A.prices)
const RB = refWeeklyReturns(SYNTH_B.dates, SYNTH_B.prices)

// ============================================================================
describe('differential: weeklyReturns', () => {
  it('khớp reference trên synthetic weekly', () => {
    expectPointsEqual(weeklyReturns(SYNTH_A.dates, SYNTH_A.prices), RA)
    expectPointsEqual(weeklyReturns(SYNTH_B.dates, SYNTH_B.prices), RB)
  })

  it('khớp reference trên BTC daily thật', () => {
    expectPointsEqual(
      weeklyReturns(REAL_BTC.map(p => p.date), REAL_BTC.map(p => p.price)),
      refWeeklyReturns(REAL_BTC.map(p => p.date), REAL_BTC.map(p => p.price)),
    )
  })

  it('khớp khi có giá 0 (bước bị skip)', () => {
    const dates = ['2021-01-01', '2021-01-08', '2021-01-15', '2021-01-22']
    const prices = [0, 100, 110, 121]
    expectPointsEqual(weeklyReturns(dates, prices), refWeeklyReturns(dates, prices))
  })
})

// ============================================================================
describe('differential: cumulativeReturns', () => {
  it('khớp reference (kèm startDate)', () => {
    const start = SYNTH_A.dates[0]!
    expectPointsEqual(cumulativeReturns(RA, start), refCumulativeReturns(RA, start))
  })

  it('khớp reference khi không có startDate', () => {
    expectPointsEqual(cumulativeReturns(RA), refCumulativeReturns(RA))
  })

  it('chuỗi rỗng → []', () => {
    expect(cumulativeReturns([])).toEqual([])
  })
})

// ============================================================================
describe('differential: cagr & annualizedStdev', () => {
  it('cagr khớp reference trên synthetic + dữ liệu thật', () => {
    for (const r of [RA, RB, refWeeklyReturns(REAL_BTC.map(p => p.date), REAL_BTC.map(p => p.price))]) {
      expect(cagr(r)).toBeCloseTo(refCagr(r)!, 8)
    }
  })

  it('cagr null cho chuỗi rỗng / cùng ngày', () => {
    expect(cagr([])).toBeNull()
    expect(cagr([{ date: '2021-01-01', value: 0.1 }])).toBeNull()
  })

  it('annualizedStdev khớp reference', () => {
    for (const r of [RA, RB]) {
      expect(annualizedStdev(r)).toBeCloseTo(refAnnualizedStdev(r), 8)
    }
  })

  it('annualizedStdev trả 0 khi < 2 điểm', () => {
    expect(annualizedStdev([])).toBe(0)
    expect(annualizedStdev([{ date: '2021-01-01', value: 0.1 }])).toBe(0)
  })
})

// ============================================================================
describe('differential: maxDrawdown', () => {
  it('khớp reference', () => {
    for (const r of [RA, RB]) {
      expect(maxDrawdown(r)).toBeCloseTo(refMaxDrawdown(r), 9)
    }
  })

  it('khớp trên dữ liệu thật', () => {
    const btc = refWeeklyReturns(REAL_BTC.map(p => p.date), REAL_BTC.map(p => p.price))
    expect(maxDrawdown(btc)).toBeCloseTo(refMaxDrawdown(btc), 9)
  })

  it('chuỗi rỗng → 0', () => {
    expect(maxDrawdown([])).toBe(0)
  })
})

// ============================================================================
describe('differential: riskContribution', () => {
  it.each([[0.5, 0.5], [0.9, 0.1], [0.03, 0.97], [0.2, 0.8]])('wA=%s wB=%s', (wA, wB) => {
    const prod = riskContribution(RA, RB, wA, wB)
    const ref = refRiskContribution(RA, RB, wA, wB)
    expect(prod.contribA).toBeCloseTo(ref.contribA, 9)
    expect(prod.contribB).toBeCloseTo(ref.contribB, 9)
    // Tổng ≈ 1 (chia trọn rủi ro danh mục)
    expect(prod.contribA + prod.contribB).toBeCloseTo(1, 9)
  })
})

// ============================================================================
describe('differential: worstWeeklyReturn / worstMonthlyReturn', () => {
  it('khớp reference trên synthetic daily', () => {
    // synthetic daily: tạo chuỗi daily để kiểm tra rolling theo ngày lịch
    const dates: string[] = []
    const prices: number[] = []
    const rng = mulberry32(123)
    let d = '2021-01-01'
    let p = 100
    for (let i = 0; i < 200; i++) {
      dates.push(d)
      prices.push(p)
      d = isoAddDays(d, 1)
      p = p * (1 + (rng() - 0.5) * 0.05)
    }
    const r = refWeeklyReturns(dates, prices)
    expect(worstWeeklyReturn(r)).toBeCloseTo(refWorstRollingCalendarReturn(r, 7), 8)
    expect(worstMonthlyReturn(r)).toBeCloseTo(refWorstRollingCalendarReturn(r, 28), 8)
  })

  it('khớp reference trên synthetic weekly', () => {
    expect(worstWeeklyReturn(RA)).toBeCloseTo(refWorstRollingCalendarReturn(RA, 7), 8)
    expect(worstMonthlyReturn(RA)).toBeCloseTo(refWorstRollingCalendarReturn(RA, 28), 8)
  })

  it('khớp trên dữ liệu thật', () => {
    const btc = refWeeklyReturns(REAL_BTC.map(p => p.date), REAL_BTC.map(p => p.price))
    expect(worstWeeklyReturn(btc)).toBeCloseTo(refWorstRollingCalendarReturn(btc, 7), 8)
    expect(worstMonthlyReturn(btc)).toBeCloseTo(refWorstRollingCalendarReturn(btc, 28), 8)
  })
})

// ============================================================================
describe('differential: rollingCumulativeReturns + rollingWinRate', () => {
  it.each([6, 12, 24])('periodMonths=%s khớp reference', period => {
    expectPointsEqual(rollingCumulativeReturns(RA, period), refRollingCumulativeReturns(RA, period))
    expectPointsEqual(rollingCumulativeReturns(RB, period), refRollingCumulativeReturns(RB, period))
  })

  it('rollingCumulativeReturnsMap + winRateAgainstRolledB khớp rollingWinRate', () => {
    const bMap = rollingCumulativeReturnsMap(RB, 12)
    const refBMap = new Map(refRollingCumulativeReturns(RB, 12).map(p => [p.date, p.value]))
    // Map (production) phải khớp reference map
    expect(bMap.size).toBe(refBMap.size)
    for (const [d, v] of refBMap) expect(bMap.get(d)).toBeCloseTo(v, 9)
    // win rate so với baseline precomputed
    const direct = winRateAgainstRolledB(RA, 12, refBMap)
    expect(winRateAgainstRolledB(RA, 12, bMap)).toEqual(direct)
  })

  it('chuỗi rỗng → []', () => {
    expect(rollingCumulativeReturns([], 6)).toEqual([])
  })
})

// ============================================================================
describe('differential: rollingReturns / rollingAnnualizedStdev / rollingMaxDrawdown', () => {
  it('rollingReturns khớp reference', () => {
    expectPointsEqual(rollingReturns(RA, 12), refRollingReturns(RA, 12), 8)
  })

  it('rollingAverage khớp reference', () => {
    expect(rollingAverage(RA)).toBeCloseTo(refRollingAverage(RA)!, 9)
  })

  it('rollingAnnualizedStdev khớp reference', () => {
    expectPointsEqual(rollingAnnualizedStdev(RA, 12), refRollingAnnualizedStdev(RA, 12), 8)
  })

  it('rollingMaxDrawdown khớp reference', () => {
    expectPointsEqual(rollingMaxDrawdown(RA, 12), refRollingMaxDrawdown(RA, 12), 8)
  })

  it('positiveRollingRate khớp reference', () => {
    const roll = refRollingCumulativeReturns(RA, 12)
    expect(positiveRollingRate(roll)).toBeCloseTo(refPositiveRollingRate(roll)!, 9)
    expect(positiveRollingRate([])).toBeNull()
  })
})

// ============================================================================
describe('differential: simulateMultiFundPortfolio (share-based)', () => {
  it.each(['monthly', 'quarterly', 'yearly'] as RebalanceFrequency[])('%s rebal khớp', freq => {
    expectPointsEqual(
      simulateMultiFundPortfolio([RA, RB], [0.5, 0.5], freq),
      refSimulateMultiFundPortfolio([RA, RB], [0.5, 0.5], freq),
    )
  })

  it('tỷ trọng thiên lệch (BTC 3%) khớp', () => {
    expectPointsEqual(
      simulateMultiFundPortfolio([RA, RB], [0.03, 0.97], 'quarterly'),
      refSimulateMultiFundPortfolio([RA, RB], [0.03, 0.97], 'quarterly'),
    )
  })

  it('chuỗi dài lệch nhau → throw (cùng contract)', () => {
    const short = RA.slice(0, 10)
    expect(() => simulateMultiFundPortfolio([RA, short], [0.5, 0.5], 'yearly')).toThrow()
  })
})

// ============================================================================
describe('differential: alignMultiSeries (pointer-based)', () => {
  it('khớp reference khi hai chuỗi có grid ngày khác nhau', () => {
    // FUND bỏ bớt vài ngày (giả lập giao dịch thiếu ngày lễ)
    const fundDates = new Set(SYNTH_A.dates)
    const fundDropped = SYNTH_A.dates.filter((_, i) => i % 13 !== 0) // bỏ ~1/13 ngày
    const fund: PricePoint[] = fundDropped.map(d => ({ date: d, price: SYNTH_A.prices[SYNTH_A.dates.indexOf(d)]! }))
    const btc: PricePoint[] = SYNTH_B.dates.map((d, i) => ({ date: d, price: SYNTH_B.prices[i]! }))
    void fundDates

    const prod = alignMultiSeries([btc, fund])
    const ref = refAlignMultiSeries([btc, fund])

    expect(prod.dates).toEqual(ref.dates)
    expect(prod.prices[0]).toEqual(ref.prices[0])
    // prices[1] (fund) forward-filled giống hệt
    for (let i = 0; i < ref.prices[1]!.length; i++) {
      expect(prod.prices[1]![i]!).toBeCloseTo(ref.prices[1]![i]!, 6)
    }
  })

  it('khớp reference trên dữ liệu thật BTC daily × FUND weekly', () => {
    const prod = alignMultiSeries([REAL_BTC, REAL_FUND])
    const ref = refAlignMultiSeries([REAL_BTC, REAL_FUND])
    expect(prod.dates).toEqual(ref.dates)
    for (let i = 0; i < ref.dates.length; i++) {
      expect(prod.prices[0]![i]!).toBeCloseTo(ref.prices[0]![i]!, 6)
      expect(prod.prices[1]![i]!).toBeCloseTo(ref.prices[1]![i]!, 6)
    }
  })
})

// ============================================================================
describe('differential: applyDividendAdjustment', () => {
  const events = [
    { exDate: '2022-05-12', payDate: '2022-05-20', amountPerCert: 800, taxRate: 0.05 },
    { exDate: '2022-06-15', payDate: '2022-06-22', amountPerCert: 500, taxRate: 0.05 },
  ]

  it('khớp reference khi có nhiều đợt cổ tức', () => {
    const prod = applyDividendAdjustment(REAL_FUND, events)
    const ref = refApplyDividendAdjustment(REAL_FUND, events)
    expect(prod.length).toBe(ref.length)
    for (let i = 0; i < ref.length; i++) {
      expect(prod[i]!.date).toBe(ref[i]!.date)
      expect(prod[i]!.price).toBeCloseTo(ref[i]!.price, 9)
    }
  })

  it('không đổi gì khi không có sự kiện', () => {
    expect(applyDividendAdjustment(REAL_FUND, [])).toBe(REAL_FUND)
  })

  it('event trước khi series bắt đầu → không ảnh hưởng', () => {
    const early = [{ exDate: '2021-01-01', payDate: '2021-01-10', amountPerCert: 100, taxRate: 0.05 }]
    const prod = applyDividendAdjustment(REAL_FUND, early)
    const ref = refApplyDividendAdjustment(REAL_FUND, early)
    expect(prod).toEqual(REAL_FUND)
    expect(prod).toEqual(ref)
  })
})

// ============================================================================
describe('differential: pipeline end-to-end (đúng quy trình BitcoinPanel)', () => {
  it('toàn bộ pipeline dữ liệu thật khớp reference', () => {
    // BitcoinPanel: align → weeklyReturns → slice minLen → simulate → stats
    const alignedProd = alignMultiSeries([REAL_BTC, REAL_FUND])
    const alignedRef = refAlignMultiSeries([REAL_BTC, REAL_FUND])

    const btcR = weeklyReturns(alignedProd.dates, alignedProd.prices[0]!)
    const fundR = weeklyReturns(alignedProd.dates, alignedProd.prices[1]!)
    const refBtcR = refWeeklyReturns(alignedRef.dates, alignedRef.prices[0]!)
    const refFundR = refWeeklyReturns(alignedRef.dates, alignedRef.prices[1]!)

    const minLen = Math.min(btcR.length, fundR.length)
    const btcR2 = btcR.slice(btcR.length - minLen)
    const fundR2 = fundR.slice(fundR.length - minLen)
    const refBtcR2 = refBtcR.slice(refBtcR.length - minLen)
    const refFundR2 = refFundR.slice(refFundR.length - minLen)

    expectPointsEqual(btcR2, refBtcR2)
    expectPointsEqual(fundR2, refFundR2)

    const sim = simulateMultiFundPortfolio([btcR2, fundR2], [0.03, 0.97], 'quarterly')
    const refSim = refSimulateMultiFundPortfolio([refBtcR2, refFundR2], [0.03, 0.97], 'quarterly')
    expectPointsEqual(sim, refSim)

    // Mọi KPI hiển thị trên tab đều khớp
    expect(cagr(sim)).toBeCloseTo(refCagr(refSim)!, 8)
    expect(annualizedStdev(sim)).toBeCloseTo(refAnnualizedStdev(refSim), 8)
    expect(maxDrawdown(sim)).toBeCloseTo(refMaxDrawdown(refSim), 9)
    expect(worstWeeklyReturn(sim)).toBeCloseTo(refWorstRollingCalendarReturn(refSim, 7), 8)
    expect(worstMonthlyReturn(sim)).toBeCloseTo(refWorstRollingCalendarReturn(refSim, 28), 8)
    expectPointsEqual(
      cumulativeReturns(sim, alignedProd.dates[0]!),
      refCumulativeReturns(refSim, alignedRef.dates[0]!),
      8,
    )

    const rc = riskContribution(btcR2, fundR2, 0.03, 0.97)
    const refRc = refRiskContribution(refBtcR2, refFundR2, 0.03, 0.97)
    expect(rc.contribA).toBeCloseTo(refRc.contribA, 9)
    expect(rc.contribB).toBeCloseTo(refRc.contribB, 9)
  })
})

// ============================================================================
describe('differential: cycleReturns (periodStat) + tính liên tục buildPeriods', () => {
  it('periodStat khớp reference trên từng kỳ dữ liệu thật', () => {
    const dataEnd = REAL_BTC[REAL_BTC.length - 1]!.date
    const dataStart = REAL_BTC[0]!.date
    for (const mode of ['term', 'election', 'calendar'] as const) {
      const periods = buildPeriods(mode, dataStart, dataEnd)
      expect(periods.length).toBeGreaterThan(0)
      for (const p of periods) {
        const prod = periodStat(REAL_BTC, p)
        const ref = refPeriodStat(REAL_BTC, p)
        expect(prod.close, `${mode} ${p.id} close`).toBeCloseTo(ref.close!, 8)
        expect(prod.peak, `${mode} ${p.id} peak`).toBeCloseTo(ref.peak!, 8)
        expect(prod.giveback, `${mode} ${p.id} giveback`).toBeCloseTo(ref.giveback!, 8)
      }
    }
  })

  it('các kỳ term/election nối liền nhau, không hở không chồng', () => {
    for (const mode of ['term', 'election'] as const) {
      const periods = buildPeriods(mode, '2014-01-01', '2026-12-31')
      const sorted = [...periods].sort((a, b) => a.from.localeCompare(b.from))
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.from).toBe(sorted[i - 1]!.to)
      }
    }
  })

  it('groupByYearInTerm chia mỗi kỳ đúng năm 1-4', () => {
    const periods = buildPeriods('term', '2014-09-17', '2026-07-27')
    const g = groupByYearInTerm(periods.filter(x => x.complete))
    let total = 0
    for (const y of [1, 2, 3, 4] as const) {
      const list = g.get(y) ?? []
      total += list.length
      expect(list.every(p => p.yearInTerm === y)).toBe(true)
    }
    expect(total).toBe(periods.filter(x => x.complete).length)
  })
})
