import type { PricePoint } from '../types'
import type { DCASlot } from './dca'
import { daysBetween } from './dateMath'
import { monthsAheadIndex, countIndependentWindows } from './dateWindow'

// Giữ export cũ cho các caller của LS vs DCA. Helper dùng chung nằm ở dateWindow.
export { countIndependentWindows } from './dateWindow'

export type CashMode = 'flat' | 'savings' | 'fund'
export type LSvsDCAFreq = 'weekly' | 'monthly'

export function isCashMode(value: unknown): value is CashMode {
  return value === 'flat' || value === 'savings' || value === 'fund'
}

export function isLSvsDCAFreq(value: unknown): value is LSvsDCAFreq {
  return value === 'weekly' || value === 'monthly'
}

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
/**
 * Độ dài quãng dữ liệu THẬT SỰ dùng được, tính bằng tháng.
 *
 * Đo trên giao của mọi quỹ trong danh mục, không phải trên quỹ đứng đầu. Con
 * số này là đầu vào của countIndependentWindows, tức lớp trung thực về cỡ mẫu
 * ở heatmap và bảng chi phí. Lấy quỹ đứng đầu thì với DCDS (2004) cộng
 * E1VFVN30 (2014) nó trả về 266 tháng trong khi phân tích chỉ chạy được 141
 * tháng, và hàng "2 năm" của heatmap báo 11 giai đoạn tách rời thay vì 5. Nói
 * quá gấp đôi, đúng thứ lớp trung thực sinh ra để chặn.
 */
export function alignedSpanMonths(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
): number {
  const fundIds = slots.filter(s => s.fundId && s.weight > 0).map(s => s.fundId)
  if (fundIds.length === 0) return 0
  const dates = commonDates(alignedPrices, fundIds)
  if (dates.length < 2) return 0
  const a = dates[0]!
  const b = dates[dates.length - 1]!
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

/**
 * Lưới ngày dùng chung cho danh mục: chỉ giữ những ngày mà MỌI quỹ đều có giá.
 *
 * Vì sao không lấy thẳng lưới của quỹ đứng đầu: alignFundsToCommonGridDaily cố
 * ý không thêm điểm cho quỹ chưa ra đời, nên mỗi quỹ bắt đầu từ ngày riêng của
 * nó. Lấy lưới của quỹ đứng đầu thì với danh mục DCDS (2004) cộng E1VFVN30
 * (2014), mọi ngày trước 2014 đều thiếu giá E1VFVN30. Phần vốn của quỹ đó bị
 * tính là đã tiêu nhưng không mua được gì, nên bốc hơi im lặng.
 *
 * Hậu quả đo được trước khi sửa: chuỗi giá phẳng tuyệt đối mà 105 trên 208
 * kịch bản trả về 0,5 thay vì 1,0, tức dashboard bao lỗ 50% trong khi giá
 * không đổi. Và kết quả phụ thuộc THỨ TỰ người dùng kéo thả quỹ: DCDS trước
 * cho LS lãi trung bình 8,1%, E1VFVN30 trước cho 17,1%.
 */
function commonDates(
  alignedPrices: Map<string, PricePoint[]>,
  fundIds: string[],
  /** Truyền vào khi nơi gọi đã dựng sẵn, để khỏi dựng lại. */
  prebuiltMaps?: Map<string, number>[],
): string[] {
  const firstFundPrices = alignedPrices.get(fundIds[0]!)
  if (!firstFundPrices || firstFundPrices.length === 0) return []
  if (fundIds.length === 1) return firstFundPrices.map(p => p.date)
  const priceMaps = prebuiltMaps ?? fundIds.map(id => {
    const map = new Map<string, number>()
    const prices = alignedPrices.get(id)
    if (prices) for (const p of prices) map.set(p.date, p.price)
    return map
  })
  return firstFundPrices
    .map(p => p.date)
    .filter(d => priceMaps.every(m => m.has(d)))
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

  const dates = commonDates(alignedPrices, fundIds, priceMaps)
  if (dates.length === 0) return []
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
    /** Thiếu giá quỹ tiền chờ giữa chừng: không mô phỏng nổi, bỏ cả kịch bản. */
    let cashPriceMissing = false

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
      //
      // Trước đây chỗ này dùng `continue`, làm nhảy luôn qua đoạn mua danh mục
      // bên dưới: tiền không bị trừ nên không mất, nhưng lịch góp bị đổi âm
      // thầm và kịch bản vẫn được tính là hợp lệ. Giờ bỏ hẳn kịch bản, vì
      // thiếu giá quỹ tiền chờ thì không mô phỏng đúng được.
      if (cashMode === 'fund' && getCashPrice) {
        const cashPrice = getCashPrice(date)
        if (!cashPrice || cashPrice <= 0) { cashPriceMissing = true; break }
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
    if (cashPriceMissing) continue

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

  // Cùng lưới ngày với computeRollingScenarios, nếu không thì đường đi và
  // kịch bản cùng ngày khởi đầu sẽ không còn khớp nhau.
  const dates = commonDates(alignedPrices, fundIds, priceMaps)
  if (dates.length === 0) return []
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

/**
 * Liên tục 1 tới 10 năm, rồi thưa dần. Mốc dày ở đoạn đầu vì đó là khoảng
 * thời gian người ta thật sự cân nhắc, và vì mốc càng dài thì càng ít giai
 * đoạn tách rời nên có chi tiết hơn cũng không nói thêm được gì.
 */
export const COST_HOLDING_YEARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]

/**
 * Chi phí trung vị của việc rải tiền, đo ở từng mốc thời gian nắm giữ.
 *
 * Mốc là TỔNG thời gian kể từ ngày xuống tiền đầu tiên, gồm luôn cả quãng
 * đang rải. Nên mốc 3 năm với kỳ DCA 12 tháng nghĩa là rải 12 tháng rồi giữ
 * thêm 24 tháng nữa mới bán.
 *
 * Từng có thêm kiểu đếm thứ hai, tính từ lần mua cuối trở đi, chuyển qua
 * lại bằng nút. Đã bỏ: cả hai chỉ là một đường cong duy nhất được lấy mẫu ở
 * những điểm khác nhau, mà lại buộc người đọc giữ hai mô hình trong đầu. Giờ
 * mỗi dòng tự ghi rõ cách phân tách, khỏi cần đoán mốc tính từ đâu.
 */
export function computeHoldingCost(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  dcaMonths: number,
  freq: LSvsDCAFreq,
  cashMode: CashMode,
  cashSavingsRate: number,
  cashFundPrices: PricePoint[] | null,
): HoldingCostCell[] {
  const spanMonths = alignedSpanMonths(alignedPrices, slots)
  return COST_HOLDING_YEARS.map(hy => {
    const holdingMonths = hy * 12
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

/**
 * Giá trị cuối kỳ của DCA dùng cho câu kể "về đích bao nhiêu".
 *
 * Không lấy thẳng medianDcaGrowth. Trung vị không cộng trừ được với nhau:
 * median(LS) và median(DCA) mỗi bên một phân bố, còn medianCostOfCapital là
 * trung vị của chênh lệch TỪNG KỊCH BẢN (DCA − LS). Nên median(DCA) − median(LS)
 * có thể khác dấu với median(DCA − LS), gây chuyện "LS về đích 160, DCA về đích
 * 160, mà chênh −7.4 triệu" — hai số đầu tự mâu thuẫn với số chênh bên cạnh.
 *
 * Cách dựng: lấy medianLsGrowth làm gốc rồi cộng đúng medianCostOfCapital, ba
 * con số kể trong câu luôn khớp nhau bằng cách xây dựng.
 */
export function dcaEndingForNarrative(lsGrowth: number, costOfCapital: number): number {
  return lsGrowth + costOfCapital
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
  const bucketCount = Math.max(1, Math.round((bucketMax - bucketMin) / bucketWidth))

  // Đếm một lượt rồi mới dựng ô, thay vì quét lại toàn bộ mảng cho từng ô.
  // Với Bitcoin, chênh lệch trải từ -0,3 tới hơn 20 lần vốn nên có vài trăm ô,
  // cách cũ tốn cỡ 1,8 triệu phép so sánh mỗi lần vẽ.
  //
  // Kẹp chỉ số vào ô cuối: giá trị lớn nhất khi đúng bằng bội của độ rộng ô sẽ
  // rơi ra ngoài mọi ô, làm mất trắng một kịch bản. Test khoá tổng số đếm phải
  // bằng đúng số kịch bản.
  const counts = new Array<number>(bucketCount).fill(0)
  for (const d of diffs) {
    const i = Math.floor((d - bucketMin) / bucketWidth)
    counts[Math.min(bucketCount - 1, Math.max(0, i))]!++
  }

  const buckets: HistogramBucket[] = []
  for (let i = 0; i < bucketCount; i++) {
    // Nhân chứ không cộng dồn: cộng dồn qua vài trăm vòng làm trôi số thực.
    const mid = bucketMin + i * bucketWidth + bucketWidth / 2
    const sign = mid >= 0 ? '+' : ''
    buckets.push({
      midpoint: mid,
      label: `${sign}${(mid * 100).toFixed(0)}%`,
      count: counts[i]!,
      positive: mid >= 0,
    })
  }
  return buckets
}

// ─── Kết quả theo mức giảm từ đỉnh lúc vào lệnh ──────────────────────────────

export interface DrawdownBand {
  /** Mức sâu hơn của dải, ví dụ -0.5. Dải cuối để -1 nghĩa là không đáy. */
  from: number
  /** Mức nông hơn của dải, ví dụ -0.4. Dải đầu để 0. */
  to: number
  label: string
}

/**
 * Dải rời nhau, không chồng lên nhau. Cố ý không làm kiểu "giảm ít nhất 30%"
 * vì kiểu đó khiến mọi tháng ở mức -60% nằm luôn trong dòng -30%, các dòng đè
 * lên nhau và không so với nhau được.
 */
export const DRAWDOWN_BANDS: DrawdownBand[] = [
  { from: -0.10, to: 0.00, label: 'Sát đỉnh (0 tới −10%)' },
  { from: -0.20, to: -0.10, label: '−10 tới −20%' },
  { from: -0.30, to: -0.20, label: '−20 tới −30%' },
  { from: -0.40, to: -0.30, label: '−30 tới −40%' },
  { from: -0.50, to: -0.40, label: '−40 tới −50%' },
  { from: -0.60, to: -0.50, label: '−50 tới −60%' },
  { from: -1.00, to: -0.60, label: 'Dưới −60%' },
]

export interface DrawdownBucketRow {
  label: string
  from: number
  to: number
  /** Số kịch bản có ngày bắt đầu rơi vào dải này. */
  scenarios: number
  /**
   * Số quãng thời gian trong dải này KHÔNG dùng chung ngày nào với nhau.
   *
   * Đếm tham lam: lấy ngày bắt đầu sớm nhất, bỏ hết những ngày nằm trong cùng
   * kỳ nắm giữ, lấy tiếp ngày kế. Cùng ý niệm với countIndependentWindows ở
   * heatmap và bảng chi phí, chỉ khác là đếm trên riêng các ngày của dải này.
   *
   * Đây mới là con số đáng tin, và nó thường nhỏ đến giật mình. Với Bitcoin,
   * mức dưới -60% có tới 735 kịch bản nhưng chỉ gói lại thành 6 quãng rời nhau.
   *
   * Từng thử thêm một tầng nữa là gom theo cú sập (nhóm các ngày cùng đứng
   * dưới một đỉnh). Đã bỏ vì nó đo thứ khác nhau ở từng dải: vùng sát đỉnh gộp
   * nguyên một bull market ba năm thành một, còn dải -10 tới -20% thì vỡ thành
   * 23 mẩu vài ngày. Hai dải không so được với nhau, mà người đọc lại đang so.
   */
  episodes: number
  /**
   * Ngày bắt đầu của từng quãng đã đếm ở trên, để người đọc tự kiểm chứng
   * thay vì phải tin. Không có cái này thì con số kia là lời khẳng định suông.
   */
  episodeStarts: string[]
  lsWinRate: number | null
  /** Tỷ lệ số lần mà đầu tư một lần vẫn đang lỗ vào ngày bán. */
  lsLossRate: number | null
  medianCost: number | null
  medianCostOfCapital: number | null
  medianLsGrowth: number | null
  medianDcaGrowth: number | null
}

/** Dưới ngưỡng này thì số đợt quá ít để nói gì cho chắc. */
export const MIN_DRAWDOWN_EPISODES = 3

/**
 * Mức giảm so với đỉnh cao nhất TÍNH TỚI ĐÚNG NGÀY ĐÓ, cho từng ngày.
 *
 * Dùng đỉnh chạy (running max) chứ không phải đỉnh của cả chuỗi. Lấy đỉnh cả
 * chuỗi là nhìn trộm tương lai: ngày 1/2015 không thể biết đỉnh 2021 ở đâu.
 * Với tài sản theo chu kỳ như Bitcoin, đỉnh chạy tự nó chính là đỉnh chu kỳ
 * gần nhất, vì qua đỉnh rồi thì mức cao nhất quá khứ đứng yên tới lúc lập
 * đỉnh mới.
 */
export function drawdownFromRunningPeak(
  prices: PricePoint[],
): Map<string, { drawdown: number; peak: number }> {
  const result = new Map<string, { drawdown: number; peak: number }>()
  let peak = 0
  for (const p of prices) {
    if (p.price > peak) peak = p.price
    result.set(p.date, {
      drawdown: peak > 0 ? p.price / peak - 1 : 0,
      peak,
    })
  }
  return result
}

/** Dải chứa mức giảm này, hoặc -1 nếu không dải nào chứa. */
function bandIndexOf(drawdown: number): number {
  for (let i = 0; i < DRAWDOWN_BANDS.length; i++) {
    const b = DRAWDOWN_BANDS[i]!
    // Cận trên đóng, cận dưới mở, để không đếm trùng ở đúng mốc tròn.
    if (drawdown <= b.to && drawdown > b.from) return i
  }
  // Đúng đáy tuyệt đối (-100%) thì cho vào dải cuối.
  return drawdown <= DRAWDOWN_BANDS[DRAWDOWN_BANDS.length - 1]!.to
    ? DRAWDOWN_BANDS.length - 1
    : -1
}

/**
 * Kết quả LS so với DCA, tách theo mức giảm từ đỉnh tại ngày bắt đầu.
 *
 * Nhận thẳng mảng kịch bản đã tính sẵn thay vì tự chạy lại, để khối này dùng
 * đúng bộ kịch bản với khối tóm tắt và histogram. Nhờ vậy dòng "mọi tháng"
 * cộng lại phải bằng con số tổng ở trên, và test khoá chuyện đó.
 */
export function computeDrawdownBuckets(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  scenarios: LSvsDCAScenario[],
  holdingMonths: number,
): DrawdownBucketRow[] {
  const empty = DRAWDOWN_BANDS.map(b => ({
    label: b.label, from: b.from, to: b.to,
    scenarios: 0, episodes: 0, episodeStarts: [] as string[], lsWinRate: null, lsLossRate: null,
    medianCost: null, medianCostOfCapital: null,
    medianLsGrowth: null, medianDcaGrowth: null,
  }))

  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0 || scenarios.length === 0) return empty

  // Mức giảm đo trên chính chuỗi giá đang phân tích. Danh mục nhiều quỹ thì
  // lấy quỹ đầu làm đại diện, vì "đỉnh của danh mục" cần dựng lại đường giá
  // có tái cân bằng, mà tab này cố ý không tái cân bằng.
  const prices = alignedPrices.get(validSlots[0]!.fundId)
  if (!prices || prices.length === 0) return empty
  const ddMap = drawdownFromRunningPeak(prices)

  const grouped: LSvsDCAScenario[][] = DRAWDOWN_BANDS.map(() => [])

  for (const s of scenarios) {
    const info = ddMap.get(s.startDate)
    if (!info) continue
    const bi = bandIndexOf(info.drawdown)
    if (bi < 0) continue
    grouped[bi]!.push(s)
  }

  return DRAWDOWN_BANDS.map((b, bi) => {
    const list = grouped[bi]!
    if (list.length === 0) return empty[bi]!
    return { label: b.label, from: b.from, to: b.to, ...summarizeGroup(list, holdingMonths) }
  })
}

/**
 * Số liệu chung cho một nhóm kịch bản đã lọc: thống kê tiền, cộng lớp trung
 * thực về cỡ mẫu. Dùng chung cho bảng chia theo mức giảm lẫn bảng chia theo
 * thời gian kể từ đỉnh, để hai bảng không bao giờ lệch quy ước.
 */
function summarizeGroup(list: LSvsDCAScenario[], holdingMonths: number) {
  // Đếm quãng không đè lên nhau, tham lam từ ngày sớm nhất: lấy một ngày rồi
  // bỏ hết những ngày nằm trong cùng kỳ nắm giữ, lấy tiếp ngày kế.
  //
  // Chỉ một quy tắc duy nhất cho mọi dòng, nên các dòng so được với nhau. Cùng
  // ý niệm với countIndependentWindows ở heatmap và bảng chi phí, để cả tab
  // nói một giọng.
  //
  // Ghi lại luôn ngày bắt đầu của từng quãng: không có danh sách đó thì con
  // số này là lời khẳng định suông, người đọc không cách nào kiểm.
  const holdMs = Math.max(1, holdingMonths) * 30.44 * 86400000
  const sorted = list.map(s => s.startDate).sort()
  const episodeStarts: string[] = []
  let lastTaken = -Infinity
  for (const d of sorted) {
    const t = new Date(d).getTime()
    if (t - lastTaken >= holdMs) {
      episodeStarts.push(d)
      lastTaken = t
    }
  }

  const usable = list.filter(s => s.lsGrowth > 0)
  const wins = list.filter(s => s.diff > 0).length
  const costs = usable.map(s => (s.dcaGrowth - s.lsGrowth) / s.lsGrowth * 100).sort((a, c) => a - c)
  const ofCapital = usable.map(s => s.dcaGrowth - s.lsGrowth).sort((a, c) => a - c)
  const lsEnds = usable.map(s => s.lsGrowth).sort((a, c) => a - c)
  const dcaEnds = usable.map(s => s.dcaGrowth).sort((a, c) => a - c)

  return {
    scenarios: list.length,
    episodes: episodeStarts.length,
    episodeStarts,
    lsWinRate: wins / list.length,
    /** Tỷ lệ số lần mà đầu tư một lần vẫn đang lỗ vào ngày bán. */
    lsLossRate: list.length > 0 ? list.filter(s => s.lsGrowth < 1).length / list.length : 0,
    medianCost: costs.length > 0 ? median(costs) : null,
    medianCostOfCapital: ofCapital.length > 0 ? median(ofCapital) : null,
    medianLsGrowth: lsEnds.length > 0 ? median(lsEnds) : null,
    medianDcaGrowth: dcaEnds.length > 0 ? median(dcaEnds) : null,
  }
}

// ─── Kết quả theo thời gian đã trôi qua kể từ đỉnh ───────────────────────────

/**
 * Chỉ xét những lần vào lệnh khi giá đã rời đỉnh ít nhất chừng này.
 *
 * Cần lọc, nếu không thì nhóm "0-3 tháng sau đỉnh" toàn là những ngày thị
 * trường đang lập đỉnh mới trong sóng tăng, tức không phải chuyện đang bàn.
 * Chọn 10% vì đó là mức vừa đủ để gọi là đã rời đỉnh, mà vẫn còn cỡ mẫu cho
 * quỹ Việt Nam. Lấy 30% thì E1VFVN30 rỗng mất hai nhóm đầu.
 */
export const MIN_DRAWDOWN_FOR_SINCE_PEAK = -0.20

export interface SincePeakBand {
  /** Số tháng tối thiểu kể từ đỉnh. */
  from: number
  /** Số tháng tối đa, 999 nghĩa là không giới hạn. */
  to: number
  label: string
}

export const SINCE_PEAK_BANDS: SincePeakBand[] = [
  { from: 0, to: 3, label: 'Dưới 3 tháng' },
  { from: 3, to: 6, label: '3 tới 6 tháng' },
  { from: 6, to: 12, label: '6 tới 12 tháng' },
  { from: 12, to: 18, label: '12 tới 18 tháng' },
  { from: 18, to: 999, label: 'Trên 18 tháng' },
]

export interface SincePeakRow {
  label: string
  from: number
  to: number
  scenarios: number
  episodes: number
  episodeStarts: string[]
  lsWinRate: number | null
  lsLossRate: number | null
  medianCost: number | null
  medianCostOfCapital: number | null
  medianLsGrowth: number | null
  medianDcaGrowth: number | null
}

/**
 * Ngày lập ra từng đỉnh chạy, để biết một ngày bất kỳ đã cách đỉnh bao lâu.
 */
function peakDateIndex(prices: PricePoint[]): Map<number, string> {
  const result = new Map<number, string>()
  let peak = 0
  for (const p of prices) {
    if (p.price > peak) {
      peak = p.price
      result.set(peak, p.date)
    }
  }
  return result
}

/**
 * Kết quả LS so với DCA, tách theo số tháng đã trôi qua kể từ đỉnh gần nhất.
 *
 * Vì sao cần bảng này bên cạnh bảng chia theo mức giảm: đo trên dữ liệu thật
 * thì mức giảm là biến yếu, còn thời gian kể từ đỉnh là biến mạnh. Cùng dải
 * "giảm 50 tới 60%" của Bitcoin, vào lệnh 2 tháng sau đỉnh thì một năm sau lỗ
 * 61%, vào lệnh 29 tháng sau đỉnh thì lãi 430%. Cùng độ sâu, kết quả ngược nhau.
 * Thứ tách hai kết quả đó ra là bear đã chạy được bao lâu.
 */
export function computeSincePeakBuckets(
  alignedPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  scenarios: LSvsDCAScenario[],
  holdingMonths: number,
): SincePeakRow[] {
  const empty: SincePeakRow[] = SINCE_PEAK_BANDS.map(b => ({
    label: b.label, from: b.from, to: b.to,
    scenarios: 0, episodes: 0, episodeStarts: [], lsWinRate: null, lsLossRate: null,
    medianCost: null, medianCostOfCapital: null,
    medianLsGrowth: null, medianDcaGrowth: null,
  }))

  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0 || scenarios.length === 0) return empty

  const prices = alignedPrices.get(validSlots[0]!.fundId)
  if (!prices || prices.length === 0) return empty

  const ddMap = drawdownFromRunningPeak(prices)
  const peakDates = peakDateIndex(prices)

  const grouped: LSvsDCAScenario[][] = SINCE_PEAK_BANDS.map(() => [])
  for (const s of scenarios) {
    const info = ddMap.get(s.startDate)
    if (!info || info.drawdown > MIN_DRAWDOWN_FOR_SINCE_PEAK) continue
    const pd = peakDates.get(info.peak)
    if (!pd) continue
    const months = (new Date(s.startDate).getTime() - new Date(pd).getTime()) / 86400000 / 30.44
    const bi = SINCE_PEAK_BANDS.findIndex(b => months >= b.from && months < b.to)
    if (bi < 0) continue
    grouped[bi]!.push(s)
  }

  return SINCE_PEAK_BANDS.map((b, bi) => {
    const list = grouped[bi]!
    if (list.length === 0) return empty[bi]!
    return { label: b.label, from: b.from, to: b.to, ...summarizeGroup(list, holdingMonths) }
  })
}
