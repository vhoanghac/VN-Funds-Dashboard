import type { PricePoint } from '../types'
import type { DCASlot } from './dca'
import { monthsAheadIndex } from './dateWindow'

export type CashMode = 'flat' | 'savings' | 'fund'
export type LSvsDCAFreq = 'weekly' | 'monthly'

export interface LSvsDCAScenario {
  startDate: string
  lsGrowth: number    // lsFinal / totalCapital (e.g., 1.15 = +15%)
  dcaGrowth: number   // dcaFinal / totalCapital
  diff: number        // lsGrowth - dcaGrowth (positive = LS wins)
}

export interface LSvsDCASummary {
  totalScenarios: number
  lsWinRate: number       // fraction 0–1
  meanLSGrowth: number    // e.g., 1.15 = +15%
  medianLSGrowth: number
  meanDCAGrowth: number
  medianDCAGrowth: number
  meanDiff: number        // mean of (lsGrowth - dcaGrowth)
  medianDiff: number
  p10: number
  p25: number
  p75: number
  p90: number
  meanWin: number         // mean diff when LS wins (positive)
  meanLoss: number        // mean diff when DCA wins (negative)
}

/**
 * Số cửa sổ ĐỘC LẬP, tức số lần thử không dùng chung một ngày dữ liệu nào.
 *
 * Vì sao cần: các kịch bản rolling chồng lấn nhau rất nặng. Với E1VFVN30, mốc
 * nắm giữ 3 năm cho 93 tháng khởi đầu, nhưng chuỗi giá chỉ dài 141 tháng nên
 * thực chất chỉ có 2 lần thử tách rời. Con số 93 trông chắc chắn hơn nhiều so
 * với mức đáng tin thật, và đó chính là chỗ dashboard dễ làm người dùng tin quá.
 */
export function countIndependentWindows(spanMonths: number, windowMonths: number): number {
  if (windowMonths <= 0 || spanMonths <= 0) return 0
  return Math.floor(spanMonths / windowMonths)
}

/** Độ dài chuỗi giá đã căn chỉnh, tính bằng tháng. */
export function alignedSpanMonths(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
): number {
  const first = slots.find(s => s.fundId && s.weight > 0)
  if (!first) return 0
  const prices = alignedPrices.get(first.fundId)
  if (!prices || prices.length < 2) return 0
  const a = prices[0]!.date
  const b = prices[prices.length - 1]!.date
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12
    + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
}

/** Dưới ngưỡng này thì không đủ lần thử tách rời để nói gì cho chắc. */
export const MIN_INDEPENDENT_WINDOWS = 3

export interface HistogramBucket {
  midpoint: number      // e.g., 0.025 = 2.5%
  label: string         // e.g., "+2.5%"
  count: number
  positive: boolean     // true = LS outperforms in this range
}

/**
 * Return the price at `date`, or the most recent price before `date` if
 * an exact match doesn't exist (last-observation-carried-forward).
 * Assumes `prices` is sorted ascending by date.
 */
function priceAtOrBefore(prices: PricePoint[], date: string): number | undefined {
  let lo = 0, hi = prices.length - 1, result: number | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (prices[mid]!.date <= date) {
      result = prices[mid]!.price
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

/**
 * Compute rolling Lump Sum vs DCA scenarios.
 *
 * For each valid start date, simulate:
 *   - LS:  invest totalCapital on day 0, hold until holdingPeriodMonths (or horizonMonths)
 *   - DCA: deploy totalCapital/n each period over horizonMonths, then hold until end
 *          undeployed cash earns according to cashMode
 *
 * When holdingPeriodMonths > horizonMonths: DCA contributions finish early, portfolio
 * continues to grow until the full holding period ends.
 */
export function computeRollingScenarios(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  totalCapital: number,
  horizonMonths: number,
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,       // annual rate, e.g. 0.04 for 4%
  cashFundPrices: PricePoint[] | null,
  holdingPeriodMonths?: number,  // total holding window; defaults to horizonMonths
): LSvsDCAScenario[] {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0 || totalCapital <= 0) return []

  const totalWeight = validSlots.reduce((s, slot) => s + slot.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  // Build price lookups: date → price for each fund
  const priceMaps: Map<string, number>[] = fundIds.map(id => {
    const prices = alignedPrices.get(id)
    const map = new Map<string, number>()
    if (prices) for (const p of prices) map.set(p.date, p.price)
    return map
  })

  // Get aligned dates from first fund
  const firstFundPrices = alignedPrices.get(fundIds[0]!)
  if (!firstFundPrices || firstFundPrices.length === 0) return []
  const dates = firstFundPrices.map(p => p.date)
  const dateTimes = dates.map(d => new Date(d).getTime())

  // Cash fund lookup (for cashMode === 'fund')
  // Uses last-observation-carried-forward so date gaps (e.g. holidays) don't skip scenarios.
  const getCashPrice = (cashMode === 'fund' && cashFundPrices)
    ? (date: string) => priceAtOrBefore(cashFundPrices, date)
    : null

  // Với mỗi startIdx, tìm index kết thúc kỳ DCA (horizon) và kết thúc kỳ nắm giữ
  // (holding) bằng lịch thực (calendar month), thay vì cộng số điểm cố định
  // (giả định lưới tuần đều đặn — sai khi dữ liệu là daily). Dùng chung
  // monthsAheadIndex với calculations.ts/dca.ts (xem dateWindow.ts).
  const horizonEndIndices = monthsAheadIndex(dateTimes, horizonMonths)
  const holdingEndIndices = holdingPeriodMonths
    ? monthsAheadIndex(dateTimes, holdingPeriodMonths)
    : horizonEndIndices
  if (horizonMonths <= 0 || (holdingPeriodMonths ?? horizonMonths) < horizonMonths) return []

  const scenarios: LSvsDCAScenario[] = []

  for (let startIdx = 0; startIdx < dates.length; startIdx++) {
    const horizonEndIdx = horizonEndIndices[startIdx]!
    const endIdx = holdingEndIndices[startIdx]!
    // j tăng đơn điệu theo startIdx (two-pointer) nên một khi hết dữ liệu
    // tương lai, mọi startIdx lớn hơn cũng sẽ hết — dừng hẳn vòng lặp.
    if (endIdx >= dates.length) break
    const startDate = dates[startIdx]!
    const endDate = dates[endIdx]!

    // Contributions only happen within the DCA period (may end before endIdx)
    const contribIndices = getContribIndices(dates, startIdx, horizonEndIdx, freq)
    if (contribIndices.length === 0) continue

    const contribution = totalCapital / contribIndices.length

    // ── Lump Sum path ──
    // Buy all funds at target weights on startDate, hold to endDate (no rebalancing)
    const lsUnits = weights.map((w, j) => {
      const startPrice = priceMaps[j]!.get(startDate)
      if (!startPrice || startPrice <= 0) return 0
      return (totalCapital * w) / startPrice
    })

    let lsFinal = 0
    for (let j = 0; j < fundIds.length; j++) {
      const endPrice = priceMaps[j]!.get(endDate)
      if (endPrice) lsFinal += lsUnits[j]! * endPrice
    }
    if (lsFinal <= 0) continue

    // ── DCA path ──
    const dcaUnits = new Array<number>(fundIds.length).fill(0)

    // Cash fund: buy all units at start, sell gradually as contributions are made
    let cashFundUnits = 0
    if (cashMode === 'fund' && getCashPrice) {
      const startCashPrice = getCashPrice(startDate)
      if (!startCashPrice || startCashPrice <= 0) continue
      cashFundUnits = totalCapital / startCashPrice
    }

    // Remaining undeployed cash (flat/savings modes)
    let cashRemaining = totalCapital

    for (let ci = 0; ci < contribIndices.length; ci++) {
      const idx = contribIndices[ci]!
      const date = dates[idx]!

      // Compound savings interest from previous contribution to this one
      if (cashMode === 'savings' && ci > 0) {
        const prevDate = dates[contribIndices[ci - 1]!]!
        const yearsElapsed = daysBetween(prevDate, date) / 365.25
        cashRemaining *= Math.pow(1 + cashSavingsRate, yearsElapsed)
      }

      // Deploy contribution: remove from cash
      if (cashMode === 'fund' && getCashPrice) {
        const cashPrice = getCashPrice(date)
        if (!cashPrice || cashPrice <= 0) continue
        cashFundUnits -= contribution / cashPrice
      } else {
        cashRemaining -= contribution
      }

      // Buy main portfolio with contribution
      for (let j = 0; j < fundIds.length; j++) {
        const price = priceMaps[j]!.get(date)
        if (price && price > 0) {
          dcaUnits[j]! += (contribution * weights[j]!) / price
        }
      }
    }

    // Value of main portfolio at endDate
    let dcaPortfolioValue = 0
    for (let j = 0; j < fundIds.length; j++) {
      const endPrice = priceMaps[j]!.get(endDate)
      if (endPrice) dcaPortfolioValue += dcaUnits[j]! * endPrice
    }

    // Value of remaining cash at endDate
    let dcaCashValue = 0
    if (cashMode === 'savings') {
      const lastContribDate = dates[contribIndices[contribIndices.length - 1]!]!
      const yearsToEnd = daysBetween(lastContribDate, endDate) / 365.25
      const residual = Math.max(0, cashRemaining)
      dcaCashValue = residual > 0
        ? residual * Math.pow(1 + cashSavingsRate, yearsToEnd)
        : 0
    } else if (cashMode === 'fund' && getCashPrice) {
      const endCashPrice = getCashPrice(endDate)
      const safeUnits = Math.max(0, cashFundUnits)
      if (endCashPrice && safeUnits > 0) {
        dcaCashValue = safeUnits * endCashPrice
      }
    }
    // flat: dcaCashValue = 0 (all capital is deployed, cash earns nothing)

    const dcaFinal = dcaPortfolioValue + dcaCashValue
    if (dcaFinal <= 0) continue

    scenarios.push({
      startDate,
      lsGrowth: lsFinal / totalCapital,
      dcaGrowth: dcaFinal / totalCapital,
      diff: lsFinal / totalCapital - dcaFinal / totalCapital,
    })
  }

  return scenarios
}

/** Returns the indices (into dates[]) where contributions should be made within [startIdx, endIdx). */
export function getContribIndices(
  dates: string[],
  startIdx: number,
  endIdx: number,
  freq: LSvsDCAFreq,
): number[] {
  if (freq === 'weekly') {
    // Chọn điểm cách nhau ~7 ngày thực kể từ lần góp trước (two-pointer),
    // thay vì "mỗi điểm dữ liệu 1 lần" (đúng khi lưới là tuần đều đặn,
    // sai khi lưới là daily — sẽ thành góp mỗi ngày thay vì mỗi tuần).
    const indices: number[] = [startIdx]
    let lastTime = new Date(dates[startIdx]!).getTime()
    for (let i = startIdx + 1; i < endIdx; i++) {
      const t = new Date(dates[i]!).getTime()
      if (t - lastTime >= 7 * 86400000) {
        indices.push(i)
        lastTime = t
      }
    }
    return indices
  }

  // Monthly: first date + any date where the calendar month changes
  const indices: number[] = [startIdx]
  for (let i = startIdx + 1; i < endIdx; i++) {
    const prev = new Date(dates[i - 1]!)
    const curr = new Date(dates[i]!)
    if (
      curr.getMonth() !== prev.getMonth() ||
      curr.getFullYear() !== prev.getFullYear()
    ) {
      indices.push(i)
    }
  }
  return indices
}

export interface PathPoint {
  date: string
  /** Giá trị danh mục nếu đầu tư hết vốn ngay ngày đầu. */
  lsValue: number
  /** Tổng tài sản bên DCA: phần đã mua quỹ cộng phần tiền còn chờ. */
  dcaValue: number
  /** Riêng phần đã mua quỹ. */
  dcaInvested: number
  /** Riêng phần tiền chưa giải ngân, tính theo cách người dùng chọn ở "vốn chờ". */
  dcaCash: number
  /** Ngày này có góp một kỳ DCA hay không. */
  isContribution: boolean
}

/**
 * Đường đi của hai chiến lược khi bắt đầu đúng vào một ngày cụ thể.
 *
 * Khác với computeRollingScenarios ở chỗ nó ghi giá trị tại MỌI ngày trong kỳ,
 * chứ không phải chỉ ngày cuối. Toàn bộ quy ước tính toán giữ y hệt hàm kia:
 * cùng lịch góp, cùng cách xử lý vốn chờ, cùng mốc kết thúc. Nhờ vậy điểm cuối
 * của đường trùng khít với kịch bản cùng ngày khởi đầu, và test khoá chuyện đó lại.
 *
 * Đường DCA cộng cả tiền chưa giải ngân. Nếu chỉ vẽ phần đã mua quỹ thì đường
 * DCA xuất phát gần bằng 0 rồi bò lên, nhìn như thua đậm ngay từ đầu trong khi
 * thực tế tiền vẫn còn nguyên trong túi.
 */
export function computeScenarioPath(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  totalCapital: number,
  horizonMonths: number,
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,
  cashFundPrices: PricePoint[] | null,
  startDate: string,
  holdingPeriodMonths?: number,
): PathPoint[] {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0 || totalCapital <= 0 || horizonMonths <= 0) return []
  if ((holdingPeriodMonths ?? horizonMonths) < horizonMonths) return []

  const totalWeight = validSlots.reduce((s, slot) => s + slot.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  const priceMaps: Map<string, number>[] = fundIds.map(id => {
    const prices = alignedPrices.get(id)
    const map = new Map<string, number>()
    if (prices) for (const p of prices) map.set(p.date, p.price)
    return map
  })

  const firstFundPrices = alignedPrices.get(fundIds[0]!)
  if (!firstFundPrices || firstFundPrices.length === 0) return []
  const dates = firstFundPrices.map(p => p.date)
  const dateTimes = dates.map(d => new Date(d).getTime())

  const startIdx = dates.indexOf(startDate)
  if (startIdx < 0) return []

  const horizonEndIdx = monthsAheadIndex(dateTimes, horizonMonths)[startIdx]!
  const endIdx = holdingPeriodMonths
    ? monthsAheadIndex(dateTimes, holdingPeriodMonths)[startIdx]!
    : horizonEndIdx
  if (endIdx >= dates.length) return []

  const contribIndices = getContribIndices(dates, startIdx, horizonEndIdx, freq)
  if (contribIndices.length === 0) return []
  const contribution = totalCapital / contribIndices.length
  const contribSet = new Set(contribIndices)

  const getCashPrice = (cashMode === 'fund' && cashFundPrices)
    ? (date: string) => priceAtOrBefore(cashFundPrices, date)
    : null

  // Lump sum: mua hết ngay ngày đầu, giữ nguyên số chứng chỉ quỹ tới cuối kỳ.
  const lsUnits = weights.map((w, j) => {
    const startPrice = priceMaps[j]!.get(startDate)
    if (!startPrice || startPrice <= 0) return 0
    return (totalCapital * w) / startPrice
  })

  const dcaUnits = new Array<number>(fundIds.length).fill(0)
  let cashFundUnits = 0
  if (cashMode === 'fund' && getCashPrice) {
    const startCashPrice = getCashPrice(startDate)
    if (!startCashPrice || startCashPrice <= 0) return []
    cashFundUnits = totalCapital / startCashPrice
  }
  let cashRemaining = totalCapital
  let lastContribDate = startDate

  const path: PathPoint[] = []

  for (let i = startIdx; i <= endIdx; i++) {
    const date = dates[i]!
    const isContribution = contribSet.has(i)

    if (isContribution) {
      // Lãi tiết kiệm dồn từ lần góp trước tới lần này, đúng thứ tự của
      // computeRollingScenarios: cộng lãi xong mới trừ tiền góp.
      if (cashMode === 'savings' && i !== startIdx) {
        const yearsElapsed = daysBetween(lastContribDate, date) / 365.25
        cashRemaining *= Math.pow(1 + cashSavingsRate, yearsElapsed)
      }
      if (cashMode === 'fund' && getCashPrice) {
        const cashPrice = getCashPrice(date)
        if (cashPrice && cashPrice > 0) cashFundUnits -= contribution / cashPrice
      } else {
        cashRemaining -= contribution
      }
      for (let j = 0; j < fundIds.length; j++) {
        const price = priceMaps[j]!.get(date)
        if (price && price > 0) dcaUnits[j]! += (contribution * weights[j]!) / price
      }
      lastContribDate = date
    }

    let lsValue = 0
    let dcaInvested = 0
    let missing = false
    for (let j = 0; j < fundIds.length; j++) {
      const price = priceMaps[j]!.get(date)
      if (!price) { missing = true; break }
      lsValue += lsUnits[j]! * price
      dcaInvested += dcaUnits[j]! * price
    }
    // Ngày nào thiếu giá của một quỹ thì bỏ hẳn điểm đó, không vẽ nửa vời.
    if (missing) continue

    let dcaCash = 0
    const residual = Math.max(0, cashRemaining)
    if (cashMode === 'savings') {
      const yearsElapsed = daysBetween(lastContribDate, date) / 365.25
      dcaCash = residual > 0 ? residual * Math.pow(1 + cashSavingsRate, yearsElapsed) : 0
    } else if (cashMode === 'fund' && getCashPrice) {
      const cashPrice = getCashPrice(date)
      const safeUnits = Math.max(0, cashFundUnits)
      if (cashPrice && safeUnits > 0) dcaCash = safeUnits * cashPrice
    } else {
      dcaCash = residual
    }

    path.push({
      date,
      lsValue,
      dcaValue: dcaInvested + dcaCash,
      dcaInvested,
      dcaCash,
      isContribution,
    })
  }

  return path
}

export function summarizeScenarios(scenarios: LSvsDCAScenario[]): LSvsDCASummary | null {
  if (scenarios.length === 0) return null

  const sorted = scenarios.map(s => s.diff).sort((a, b) => a - b)
  const sortedLS = scenarios.map(s => s.lsGrowth).sort((a, b) => a - b)
  const sortedDCA = scenarios.map(s => s.dcaGrowth).sort((a, b) => a - b)
  const lsWins = scenarios.filter(s => s.diff > 0)
  const dcaWins = scenarios.filter(s => s.diff <= 0)
  const n = scenarios.length

  return {
    totalScenarios: n,
    lsWinRate: lsWins.length / n,
    meanLSGrowth: scenarios.reduce((a, s) => a + s.lsGrowth, 0) / n,
    medianLSGrowth: pctile(sortedLS, 0.5),
    meanDCAGrowth: scenarios.reduce((a, s) => a + s.dcaGrowth, 0) / n,
    medianDCAGrowth: pctile(sortedDCA, 0.5),
    meanDiff: sorted.reduce((a, b) => a + b, 0) / n,
    medianDiff: pctile(sorted, 0.5),
    p10: pctile(sorted, 0.1),
    p25: pctile(sorted, 0.25),
    p75: pctile(sorted, 0.75),
    p90: pctile(sorted, 0.9),
    meanWin: lsWins.length > 0
      ? lsWins.reduce((a, s) => a + s.diff, 0) / lsWins.length
      : 0,
    meanLoss: dcaWins.length > 0
      ? dcaWins.reduce((a, s) => a + s.diff, 0) / dcaWins.length
      : 0,
  }
}

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

export const HEATMAP_HOLDING_YEARS = [2, 5, 10, 20]
export const HEATMAP_DCA_MONTHS = [3, 6, 12, 18]

export interface HoldingCostCell {
  holdingYears: number
  /**
   * Trung vị của (DCA - LS)/LS, tính bằng %. Âm nghĩa là DCA về sau ít tiền
   * hơn đầu tư một lần. Đây là câu hỏi "thua thì thua bao nhiêu", khác với
   * heatmap vốn chỉ trả lời "thua bao nhiêu lần".
   */
  medianCost: number | null
  /**
   * Trung vị của (DCA - LS) tính theo tỷ lệ trên vốn ban đầu. Nhân với số tiền
   * người dùng nhập là ra tiền thật, để khỏi bắt người đọc tự quy đổi từ %.
   */
  medianCostOfCapital: number | null
  /**
   * Trung vị giá trị cuối kỳ của từng bên, tính theo lần so với vốn ban đầu.
   * Cần cặp số này thì mới đọc được chênh lệch. Giữ 20 năm mà chênh 3 lần vốn
   * nghe như mất sạch, trong khi thực ra cả hai bên đều đã lớn hơn vốn nhiều lần.
   */
  medianLsGrowth: number | null
  medianDcaGrowth: number | null
  scenarios: number
  independentWindows: number
  /** Kỳ nắm giữ ngắn hơn thời gian DCA, tức chưa DCA xong. Vô lý, không phải thiếu số. */
  tooShort: boolean
}

export const COST_HOLDING_YEARS = [1, 2, 3, 5, 7, 10, 15, 20]

/**
 * Mốc thời gian ở bảng chi phí đếm theo kiểu nào.
 *
 * `total`: tổng thời gian kể từ ngày bắt đầu. Mốc "1 năm" khi DCA 12 tháng
 * nghĩa là mua xong phát cuối rồi bán luôn, không giữ thêm ngày nào. Hợp với
 * người đã biết mình có bao nhiêu năm rồi cần tiền.
 *
 * `afterLast`: giữ thêm bao lâu SAU lần mua cuối. Mốc "1 năm" luôn mang đúng
 * một nghĩa dù DCA 3 tháng hay 36 tháng, và không mốc nào bị bỏ trống vì chưa
 * DCA xong. Hợp với người rải tiền xong rồi giữ dài hạn.
 */
export type HoldingCostMode = 'total' | 'afterLast'

/**
 * Chi phí trung vị của việc rải tiền, đo ở từng mốc thời gian nắm giữ.
 */
export function computeHoldingCost(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  dcaMonths: number,
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,
  cashFundPrices: PricePoint[] | null,
  mode: HoldingCostMode = 'total',
): HoldingCostCell[] {
  const spanMonths = alignedSpanMonths(alignedPrices, slots)
  return COST_HOLDING_YEARS.map(hy => {
    const holdingMonths = mode === 'afterLast' ? dcaMonths + hy * 12 : hy * 12
    const independent = countIndependentWindows(spanMonths, holdingMonths)
    const empty = {
      holdingYears: hy, medianCost: null, medianCostOfCapital: null,
      medianLsGrowth: null, medianDcaGrowth: null,
      scenarios: 0, independentWindows: independent,
    }
    if (holdingMonths < dcaMonths) {
      return { ...empty, tooShort: true }
    }
    const scenarios = computeRollingScenarios(
      alignedPrices, slots, 1, dcaMonths, freq, cashMode, cashSavingsRate, cashFundPrices, holdingMonths,
    )
    if (scenarios.length === 0) {
      return { ...empty, tooShort: false }
    }
    const usable = scenarios.filter(s => s.lsGrowth > 0)
    const costs = usable.map(s => (s.dcaGrowth - s.lsGrowth) / s.lsGrowth * 100).sort((a, b) => a - b)
    // Tính riêng phần quy ra tiền: trung vị của chênh lệch trên vốn ban đầu.
    // Không suy ra từ % ở trên vì trung vị không cộng trừ với nhau được.
    const ofCapital = usable.map(s => s.dcaGrowth - s.lsGrowth).sort((a, b) => a - b)
    const lsEnds = usable.map(s => s.lsGrowth).sort((a, b) => a - b)
    const dcaEnds = usable.map(s => s.dcaGrowth).sort((a, b) => a - b)
    return {
      holdingYears: hy,
      medianCost: costs.length > 0 ? median(costs) : null,
      medianCostOfCapital: ofCapital.length > 0 ? median(ofCapital) : null,
      medianLsGrowth: lsEnds.length > 0 ? median(lsEnds) : null,
      medianDcaGrowth: dcaEnds.length > 0 ? median(dcaEnds) : null,
      scenarios: scenarios.length,
      independentWindows: independent,
      tooShort: false,
    }
  })
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

export interface HeatmapCell {
  holdingYears: number
  dcaMonths: number
  winRate: number | null   // null = insufficient data (< 10 scenarios)
  totalScenarios: number
  /** Số lần thử tách rời, xem countIndependentWindows */
  independentWindows: number
}

/**
 * Compute a matrix of LS win rates for combinations of:
 *   rows: total holding periods (HEATMAP_HOLDING_YEARS)
 *   cols: DCA contribution periods (HEATMAP_DCA_MONTHS)
 */
export function computeHeatmap(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,
  cashFundPrices: PricePoint[] | null,
): HeatmapCell[][] {
  const spanMonths = alignedSpanMonths(alignedPrices, slots)
  return HEATMAP_HOLDING_YEARS.map(hy =>
    HEATMAP_DCA_MONTHS.map(dm => {
      const holdingMonths = hy * 12
      const independentWindows = countIndependentWindows(spanMonths, holdingMonths)
      // totalCapital=1: win rate is scale-invariant, so any positive value gives the same result
      const scenarios = computeRollingScenarios(
        alignedPrices, slots, 1, dm, freq, cashMode, cashSavingsRate, cashFundPrices, holdingMonths,
      )
      if (scenarios.length < 10) {
        return { holdingYears: hy, dcaMonths: dm, winRate: null, totalScenarios: scenarios.length, independentWindows }
      }
      const lsWins = scenarios.filter(s => s.diff > 0).length
      return {
        holdingYears: hy,
        dcaMonths: dm,
        winRate: lsWins / scenarios.length,
        totalScenarios: scenarios.length,
        independentWindows,
      }
    })
  )
}

/** Build histogram buckets of width `bucketWidth` (as fraction of capital, e.g. 0.05 = 5%). */
export function buildHistogram(
  scenarios: LSvsDCAScenario[],
  bucketWidth = 0.05,
): HistogramBucket[] {
  if (scenarios.length === 0) return []

  const diffs = scenarios.map(s => s.diff)
  const minD = diffs.reduce((a, b) => Math.min(a, b), Infinity)
  const maxD = diffs.reduce((a, b) => Math.max(a, b), -Infinity)

  const bucketMin = Math.floor(minD / bucketWidth) * bucketWidth
  const bucketMax = Math.ceil(maxD / bucketWidth) * bucketWidth

  const buckets: HistogramBucket[] = []
  for (let b = bucketMin; b < bucketMax - bucketWidth / 2; b += bucketWidth) {
    const mid = b + bucketWidth / 2
    const count = diffs.filter(d => d >= b && d < b + bucketWidth).length
    const pct = mid * 100
    const sign = mid >= 0 ? '+' : ''
    buckets.push({
      midpoint: mid,
      label: `${sign}${pct.toFixed(0)}%`,
      count,
      positive: mid >= 0,
    })
  }
  return buckets
}
