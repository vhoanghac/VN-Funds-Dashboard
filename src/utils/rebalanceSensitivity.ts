/**
 * rebalanceSensitivity: mô phỏng MỘT danh mục cố định tỷ trọng qua nhiều
 * lịch tái cân bằng khác nhau, để đo "kết quả thay đổi bao nhiêu khi chỉ
 * đổi lịch rebalance" (ý tưởng từ công cụ Rebalancing Sensitivity của
 * testfol.io).
 *
 * Các biến thể được chạy:
 *   - 8 tần suất lịch: hàng ngày / tuần / tháng / 2 tháng / quý / 4 tháng /
 *     nửa năm / năm. Mỗi tần suất chạy đủ mọi offset hợp lệ (offset = số
 *     ngày giao dịch TRƯỚC ngày cuối kỳ mà lệnh rebalance được thực hiện;
 *     offset 0 = ngày giao dịch cuối cùng của kỳ).
 *   - Band (tùy chọn): không theo lịch, chỉ rebalance khi tỷ trọng lệch
 *     khỏi mục tiêu quá ngưỡng 1%..20% (tuyệt đối hoặc tương đối).
 *   - "Không tái cân bằng" (buy & hold): baseline luôn có.
 *
 * Mô phỏng lump-sum chuẩn hóa vốn = 1, giá đã dividend-adjusted như mọi
 * tab khác. Có thể tính phí giao dịch cho mỗi lần tái cân bằng (xem feePct).
 */
import type { PricePoint } from '../types'
import type { DCASlot } from './dca'
import { ZERO_VOLATILITY_EPSILON } from './calculations'

export type ScheduleId =
  | 'daily' | 'weekly' | 'monthly' | 'bimonthly'
  | 'quarterly' | 'every4months' | 'semiannual' | 'yearly'

export const SCHEDULES: { id: ScheduleId; label: string; maxOffset: number }[] = [
  { id: 'daily', label: 'Hàng ngày', maxOffset: 0 },
  { id: 'weekly', label: 'Hàng tuần', maxOffset: 4 },
  { id: 'monthly', label: 'Hàng tháng', maxOffset: 20 },
  { id: 'bimonthly', label: 'Mỗi 2 tháng', maxOffset: 41 },
  { id: 'quarterly', label: 'Hàng quý', maxOffset: 62 },
  { id: 'every4months', label: 'Mỗi 4 tháng', maxOffset: 83 },
  { id: 'semiannual', label: 'Nửa năm', maxOffset: 125 },
  { id: 'yearly', label: 'Hàng năm', maxOffset: 251 },
]

export type VariantGroup = ScheduleId | 'band-abs' | 'band-rel' | 'none'

export const GROUP_LABELS: Record<VariantGroup, string> = {
  daily: 'Hàng ngày',
  weekly: 'Hàng tuần',
  monthly: 'Hàng tháng',
  bimonthly: 'Mỗi 2 tháng',
  quarterly: 'Hàng quý',
  every4months: 'Mỗi 4 tháng',
  semiannual: 'Nửa năm',
  yearly: 'Hàng năm',
  'band-abs': 'Ngưỡng lệch tuyệt đối',
  'band-rel': 'Ngưỡng lệch tương đối',
  none: 'Không tái cân bằng',
}

export interface VariantResult {
  group: VariantGroup
  /** "Hàng tháng · offset 3" / "Lệch tuyệt đối 5%" / "Không tái cân bằng" */
  label: string
  offset?: number
  /** Ngưỡng band, đơn vị % (5 = 5%) */
  threshold?: number
  cagr: number
  stdev: number
  maxDrawdown: number
  sharpe: number
  /** Số lần rebalance thực tế trong kỳ */
  rebalCount: number
}

/** Dải ngưỡng band, đơn vị % (vd start 1, step 1, end 20) */
export interface BandSweep {
  start: number
  step: number
  end: number
}

export interface SensitivityInput {
  /** Giá đã align cùng lưới ngày (mọi quỹ cùng dates) */
  alignedPrices: Map<string, PricePoint[]>
  slots: DCASlot[]
  /** Các tần suất lịch người dùng muốn phân tích */
  schedules: ScheduleId[]
  absBand: BandSweep | null
  relBand: BandSweep | null
  /**
   * Phí giao dịch mỗi lần tái cân bằng, đơn vị % (0.1 = 0.1%). Phí trừ trên
   * CẢ HAI chiều mua và bán của phần tài sản lệch tỷ trọng: mỗi lần cân,
   * phần giá trị bị bán (traded) mất feeRate, và phần mua lại cũng mất
   * feeRate, nên tổng phí ≈ traded × feeRate × 2. Mặc định 0 = không tính phí.
   */
  feePct?: number
}

export interface SensitivityResult {
  variants: VariantResult[]
  startDate: string
  endDate: string
  years: number
}

export function runRebalanceSensitivity(input: SensitivityInput): SensitivityResult | null {
  const validSlots = input.slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length < 2) return null

  // Grid align theo union + forward-fill có thể cho mỗi quỹ một độ dài khác
  // nhau ở PHẦN ĐẦU (quỹ chưa có điểm nào thì ngày đó bị bỏ). Cắt mọi quỹ về
  // ngày đầu chung muộn nhất: từ điểm đầu tiên của một quỹ trở đi, forward-fill
  // đảm bảo quỹ đó có điểm ở MỌI ngày trong union, nên sau khi cắt các mảng
  // sẽ dài bằng nhau và cùng lưới ngày.
  const rawSeries: PricePoint[][] = []
  let commonStart = ''
  for (const slot of validSlots) {
    const prices = input.alignedPrices.get(slot.fundId)
    if (!prices || prices.length === 0) return null
    rawSeries.push(prices)
    if (prices[0]!.date > commonStart) commonStart = prices[0]!.date
  }
  const series = rawSeries.map(prices => prices.filter(p => p.date >= commonStart))

  const firstFund = series[0]!
  if (firstFund.length < 30) return null
  const dates = firstFund.map(p => p.date)
  const n = dates.length

  // Ma trận lợi nhuận ngày: returns[f][t] (t bắt đầu từ 1)
  const weights = validSlots.map(s => s.weight / 100)
  const totalW = weights.reduce((a, b) => a + b, 0)
  const targetW = weights.map(w => w / totalW)

  const returns: Float64Array[] = []
  for (const prices of series) {
    if (prices.length !== n) return null
    const r = new Float64Array(n)
    for (let t = 1; t < n; t++) {
      const prev = prices[t - 1]!.price
      r[t] = prev > 0 ? prices[t]!.price / prev - 1 : 0
    }
    returns.push(r)
  }

  const years = (new Date(dates[n - 1]!).getTime() - new Date(dates[0]!).getTime())
    / (365.25 * 24 * 60 * 60 * 1000)
  if (years <= 0) return null

  // Phí mỗi lần cân, đơn vị thập phân (0.001 = 0.1%).
  const feeRate = (input.feePct ?? 0) / 100

  const variants: VariantResult[] = []

  // ── Biến thể lịch: từng tần suất × từng offset ──
  for (const sched of SCHEDULES.filter(s => input.schedules.includes(s.id))) {
    const periods = buildPeriods(dates, sched.id)
    const maxLen = Math.max(...periods.map(p => p.length))
    const maxOffset = Math.min(sched.maxOffset, maxLen - 1)
    for (let offset = 0; offset <= maxOffset; offset++) {
      const rebalDays = new Set<number>()
      for (const period of periods) {
        const idx = period.length - 1 - offset
        if (idx >= 0) {
          const day = period[idx]!
          if (day > 0) rebalDays.add(day)
        }
      }
      const sim = simulateCalendar(returns, targetW, n, rebalDays, feeRate)
      variants.push({
        group: sched.id,
        label: sched.maxOffset === 0
          ? sched.label
          : `${sched.label} (${offset === 0 ? 'ngày cuối kỳ' : `cách cuối kỳ ${offset} ngày`})`,
        offset,
        ...computeMetrics(sim.totals, years),
        rebalCount: sim.rebalCount,
      })
    }
  }

  // ── Biến thể band ──
  if (input.absBand) {
    for (const thr of buildThresholds(input.absBand)) {
      const sim = simulateBand(returns, targetW, n, thr / 100, false, feeRate)
      variants.push({
        group: 'band-abs',
        label: `Lệch tuyệt đối ${formatThreshold(thr)}%`,
        threshold: thr,
        ...computeMetrics(sim.totals, years),
        rebalCount: sim.rebalCount,
      })
    }
  }
  if (input.relBand) {
    for (const thr of buildThresholds(input.relBand)) {
      const sim = simulateBand(returns, targetW, n, thr / 100, true, feeRate)
      variants.push({
        group: 'band-rel',
        label: `Lệch tương đối ${formatThreshold(thr)}%`,
        threshold: thr,
        ...computeMetrics(sim.totals, years),
        rebalCount: sim.rebalCount,
      })
    }
  }

  // ── Baseline: không bao giờ tái cân bằng ──
  {
    const sim = simulateCalendar(returns, targetW, n, new Set(), feeRate)
    variants.push({
      group: 'none',
      label: 'Không tái cân bằng',
      ...computeMetrics(sim.totals, years),
      rebalCount: 0,
    })
  }

  return { variants, startDate: dates[0]!, endDate: dates[n - 1]!, years }
}

/** Sinh danh sách ngưỡng từ dải start/step/end, tối đa 40 ngưỡng để tránh bùng nổ biến thể. */
function buildThresholds(sweep: BandSweep): number[] {
  const start = Math.max(0.5, sweep.start)
  const end = Math.max(start, sweep.end)
  const step = Math.max(0.5, sweep.step)
  const out: number[] = []
  for (let thr = start; thr <= end + 1e-9 && out.length < 40; thr += step) {
    out.push(Math.round(thr * 100) / 100)
  }
  return out
}

/** 5 → "5", 7.5 → "7,5" */
function formatThreshold(thr: number): string {
  return String(thr).replace('.', ',')
}

/** Gom index các ngày giao dịch theo kỳ của một tần suất. */
function buildPeriods(dates: string[], sched: ScheduleId): number[][] {
  if (sched === 'daily') {
    // Mỗi ngày một kỳ — offset luôn 0
    return dates.map((_, i) => [i])
  }
  const keyOf = (date: string): string => {
    const [y, m, d] = date.split('-').map(Number)
    switch (sched) {
      case 'weekly': {
        // Khoá tuần ISO-đơn-giản: số tuần kể từ epoch, tuần bắt đầu thứ Hai
        const t = Date.UTC(y!, m! - 1, d!) / 86400000
        return String(Math.floor((t + 3) / 7))
      }
      case 'monthly': return `${y}-${m}`
      case 'bimonthly': return `${y}-${Math.floor((m! - 1) / 2)}`
      case 'quarterly': return `${y}-${Math.floor((m! - 1) / 3)}`
      case 'every4months': return `${y}-${Math.floor((m! - 1) / 4)}`
      case 'semiannual': return `${y}-${Math.floor((m! - 1) / 6)}`
      case 'yearly': return String(y)
      default: return date
    }
  }
  const periods: number[][] = []
  let currentKey = ''
  for (let i = 0; i < dates.length; i++) {
    const k = keyOf(dates[i]!)
    if (k !== currentKey) {
      periods.push([])
      currentKey = k
    }
    periods[periods.length - 1]!.push(i)
  }
  return periods
}

/**
 * Áp phí giao dịch của một lần tái cân bằng: phí trừ trên phần tài sản lệch
 * tỷ trọng (traded), tính CẢ chiều bán lẫn chiều mua — bán phần thừa mất
 * feeRate, mua lại phần thiếu cũng mất feeRate, nên tổng phí ≈ traded ×
 * feeRate × 2. Trả về total sau phí (luôn ≥ 0) và đưa mọi values về đúng
 * tỷ trọng target dựa trên total mới.
 */
function applyRebalanceFee(
  values: Float64Array,
  total: number,
  targetW: number[],
  feeRate: number,
): number {
  let traded = 0
  for (let i = 0; i < values.length; i++) {
    const diff = values[i]! - total * targetW[i]!
    if (diff > 0) traded += diff
  }
  const afterFee = Math.max(0, total - traded * feeRate * 2)
  for (let i = 0; i < values.length; i++) values[i] = afterFee * targetW[i]!
  return afterFee
}

function simulateCalendar(
  returns: Float64Array[],
  targetW: number[],
  n: number,
  rebalDays: Set<number>,
  feeRate: number,
): { totals: Float64Array; rebalCount: number } {
  const f = returns.length
  const values = new Float64Array(f)
  for (let i = 0; i < f; i++) values[i] = targetW[i]!
  const totals = new Float64Array(n)
  totals[0] = 1
  let rebalCount = 0
  for (let t = 1; t < n; t++) {
    let total = 0
    for (let i = 0; i < f; i++) {
      values[i] = values[i]! * (1 + returns[i]![t]!)
      total += values[i]!
    }
    if (rebalDays.has(t)) {
      total = applyRebalanceFee(values, total, targetW, feeRate)
      rebalCount++
    }
    totals[t] = total
  }
  return { totals, rebalCount }
}

function simulateBand(
  returns: Float64Array[],
  targetW: number[],
  n: number,
  threshold: number,
  relative: boolean,
  feeRate: number,
): { totals: Float64Array; rebalCount: number } {
  const f = returns.length
  const values = new Float64Array(f)
  for (let i = 0; i < f; i++) values[i] = targetW[i]!
  const totals = new Float64Array(n)
  totals[0] = 1
  let rebalCount = 0
  for (let t = 1; t < n; t++) {
    let total = 0
    for (let i = 0; i < f; i++) {
      values[i] = values[i]! * (1 + returns[i]![t]!)
      total += values[i]!
    }
    let breach = false
    for (let i = 0; i < f; i++) {
      const drift = Math.abs(values[i]! / total - targetW[i]!)
      const limit = relative ? threshold * targetW[i]! : threshold
      if (drift > limit) { breach = true; break }
    }
    if (breach) {
      total = applyRebalanceFee(values, total, targetW, feeRate)
      rebalCount++
    }
    totals[t] = total
  }
  return { totals, rebalCount }
}

export function computeMetrics(totals: Float64Array, years: number): {
  cagr: number; stdev: number; maxDrawdown: number; sharpe: number
} {
  const n = totals.length
  const cagr = Math.pow(totals[n - 1]! / totals[0]!, 1 / years) - 1

  let sum = 0
  let sumSq = 0
  let peak = totals[0]!
  let maxDD = 0
  for (let t = 1; t < n; t++) {
    const r = totals[t]! / totals[t - 1]! - 1
    sum += r
    sumSq += r * r
    if (totals[t]! > peak) peak = totals[t]!
    const dd = totals[t]! / peak - 1
    if (dd < maxDD) maxDD = dd
  }
  const count = n - 1
  const mean = sum / count
  const variance = count > 1 ? (sumSq - sum * sum / count) / (count - 1) : 0
  // Số kỳ/năm SUY RA từ mật độ dữ liệu thực tế (count/years), giống
  // annualizedStdev() trong calculations.ts — không hard-code 252, vì danh
  // mục ở đây có thể gồm quỹ mở VN (~252 phiên/năm) LẪN BTC (giao dịch 365
  // ngày/năm) hay vàng (tần suất bất định). Hard-code 252 sẽ làm "Biến động"
  // và "Sharpe" bị đánh giá thấp hơn thực tế khi danh mục có BTC/vàng.
  const periodsPerYear = years > 0 ? count / years : 252
  const stdev = Math.sqrt(Math.max(variance, 0)) * Math.sqrt(periodsPerYear)
  // Ngưỡng epsilon thay vì `> 0`: danh mục toàn tiết kiệm ngân hàng có stdev
  // đúng ra bằng 0 nhưng số thực để lại nhiễu ~1e-15, chia cho nó ra Sharpe
  // cỡ 2e13. Trả 0 để không hiện một con số vô nghĩa. Xem ZERO_VOLATILITY_EPSILON.
  const sharpe = stdev > ZERO_VOLATILITY_EPSILON ? (mean * periodsPerYear) / stdev : 0

  return { cagr, stdev, maxDrawdown: maxDD, sharpe }
}

/** Thống kê min/median/max của một mảng số. */
export function summarize(values: number[]): { min: number; median: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: sorted[0] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  }
}
