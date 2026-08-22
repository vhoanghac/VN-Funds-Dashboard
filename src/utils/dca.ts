import type { PortfolioSlot, PricePoint, ReturnPoint, RebalanceFrequency, YearlyReturn } from '../types'
import type { DividendEvent, DividendNarrativeStats } from './dividendAdjust'
import { daysBetween } from './dateMath'
import { rollingWindowStarts } from './dateWindow'
import { assetDisplayName } from './savingsAsset'
import { percentileSorted } from './stats'

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
      // If lastValue is null, this date is before the series starts, skip
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

export function isDCAFrequency(value: unknown): value is DCAFrequency {
  return value === 'daily' || value === 'weekly' || value === 'biweekly' ||
    value === 'monthly' || value === 'quarterly' || value === 'semiannual' ||
    value === 'yearly'
}

const MONTHLY_FACTOR: Record<DCAFrequency, number> = {
  daily: 365.25 / 12,
  weekly: 365.25 / 7 / 12,
  biweekly: 365.25 / 14 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  semiannual: 1 / 6,
  yearly: 1 / 12,
}

const REBALANCE_BISECTION_STEPS = 64

/**
 * Quy đổi số tiền nạp mỗi kỳ (theo tần suất bất kỳ) sang mức TƯƠNG ĐƯƠNG mỗi
 * tháng — dùng làm "monthlyContribution" cho các phép chiếu tương lai
 * (ProjectionBlock, MonteCarloBlock).
 *
 * KHÔNG dùng totalInvested/số tháng backtest để ước lượng: cách đó lẫn cả
 * "Số tiền đầu tiên" (vốn chỉ nạp một lần, không lặp lại) vào trung bình,
 * khiến con số bị kéo cao hơn số tiền nạp định kỳ thực tế người dùng đã nhập.
 */
export function monthlyEquivalentContribution(cashflowAmount: number, freq: DCAFrequency): number {
  return cashflowAmount * MONTHLY_FACTOR[freq]
}

export type DCASlot = PortfolioSlot

/**
 * Tên mặc định cho danh mục: nếu chỉ có 1 quỹ, hiển thị tên quỹ đó (vd "DCDS").
 * Nếu có nhiều hơn 1 quỹ, dùng "Portfolio {num}" — num là số cố định gắn với
 * danh mục lúc tạo (không đổi khi xoá danh mục khác), tránh trùng tên khi
 * nhiều danh mục đa quỹ xuất hiện trên cùng biểu đồ.
 *
 * Chỉ áp dụng khi tên chưa bị người dùng tự sửa tay (xem `isNameCustom`
 * trong PortfolioCardState).
 *
 * Với tài sản giả lập, id thô ("SAVINGS:6") không đọc ra nghĩa, nên đổi sang
 * tên hiển thị ("Tiết kiệm 6%/năm"). Mã quỹ thật thì giữ nguyên: "DCDS" vốn
 * đã là cái tên người dùng quen đọc.
 */
export function derivePortfolioName(slots: DCASlot[], fallback: string): string {
  if (slots.length === 1 && slots[0]!.fundId) return assetDisplayName(slots[0]!.fundId)
  return fallback
}

export interface DCAParams {
  initialAmount: number    // Initial lump sum
  cashflowAmount: number   // Amount per period
  cashflowFreq: DCAFrequency
}

export interface DCAResult {
  /** Portfolio value over time (absolute VND), includes cashflows (for MWRR / value chart) */
  values: { date: string; value: number }[]
  /** Total money invested over time */
  invested: { date: string; value: number }[]
  /** Individual cashflow events: { date, amount }, cho MWRR/IRR calculation */
  cashflows: { date: string; amount: number }[]
  /** TWRR cumulative return series, bỏ qua ảnh hưởng cashflows */
  cumulative: ReturnPoint[]
  /** TWRR drawdown series, tính từ TWRR growth, không phải raw portfolio value */
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

function allocateUnits(
  units: number[],
  amount: number,
  weights: number[],
  priceLookups: Map<string, number>[],
  date: string,
): void {
  for (let j = 0; j < units.length; j++) {
    const price = priceLookups[j]!.get(date)!
    units[j] = units[j]! + (amount * weights[j]!) / price
  }
}

interface CommonPriceGrid {
  dates: string[]
  priceLookups: Map<string, number>[]
}

function buildCommonPriceGrid(priceArrays: PricePoint[][]): CommonPriceGrid | null {
  if (priceArrays.some(arr => arr.length === 0)) return null

  const startDates = priceArrays.map(arr => arr[0]!.date)
  const endDates = priceArrays.map(arr => arr[arr.length - 1]!.date)
  const commonStart = startDates.reduce((a, b) => a > b ? a : b)
  const commonEnd = endDates.reduce((a, b) => a < b ? a : b)

  if (commonStart >= commonEnd) return null

  const priceLookups = priceArrays.map(arr => {
    const map = new Map<string, number>()
    for (const p of arr) map.set(p.date, p.price)
    return map
  })

  const dates: string[] = []
  for (const p of priceArrays[0]!) {
    if (p.date < commonStart || p.date > commonEnd) continue
    if (priceArrays.every((_, i) => priceLookups[i]!.has(p.date))) {
      dates.push(p.date)
    }
  }

  return dates.length >= 2 ? { dates, priceLookups } : null
}

function buildPurchasePriceGrid(
  dates: string[],
  fundIds: string[],
  valuationLookups: Map<string, number>[],
  purchasePrices: Map<string, PricePoint[]> | undefined,
): CommonPriceGrid | null {
  if (!purchasePrices || !fundIds.some(id => purchasePrices.has(id))) {
    return { dates, priceLookups: valuationLookups }
  }

  const overrides = fundIds.map(id => {
    const prices = purchasePrices.get(id)
    return prices ? [...prices].sort((a, b) => a.date.localeCompare(b.date)) : undefined
  })
  let start = dates[0]!

  for (const prices of overrides) {
    if (!prices) continue
    if (prices.length === 0) return null
    if (prices[0]!.date > start) start = prices[0]!.date
  }

  // Không có giá bán trước quote đầu tiên: lùi ngày bắt đầu, không fallback sang giá định giá.
  const purchaseDates = dates.filter(date => date >= start)
  if (purchaseDates.length < 2) return null

  const priceLookups: Map<string, number>[] = []
  for (let index = 0; index < fundIds.length; index++) {
    const prices = overrides[index]
    if (!prices) {
      priceLookups.push(valuationLookups[index]!)
      continue
    }

    const lookup = new Map<string, number>()
    let pointIndex = 0
    let latestPrice: number | null = null
    for (const date of purchaseDates) {
      while (pointIndex < prices.length && prices[pointIndex]!.date <= date) {
        latestPrice = prices[pointIndex]!.price
        pointIndex++
      }
      if (latestPrice === null) return null
      lookup.set(date, latestPrice)
    }
    priceLookups.push(lookup)
  }

  return { dates: purchaseDates, priceLookups }
}

/** Keeps the last quote before a requested date so later dates can forward-fill from it. */
export function slicePricesWithPredecessor(
  prices: PricePoint[],
  from: string,
  to: string,
): PricePoint[] {
  let predecessor: PricePoint | undefined
  const sliced: PricePoint[] = []

  for (const point of prices) {
    if (point.date < from) {
      predecessor = point
      continue
    }
    if (point.date > to) break
    sliced.push(point)
  }

  return predecessor ? [predecessor, ...sliced] : sliced
}

function valueUnits(
  units: number[],
  priceLookups: Map<string, number>[],
  date: string,
): number {
  let total = 0
  for (let j = 0; j < units.length; j++) {
    total += units[j]! * priceLookups[j]!.get(date)!
  }
  return total
}

function rebalanceUnits(
  units: number[],
  weights: number[],
  priceLookups: Map<string, number>[],
  date: string,
  purchaseLookups: Map<string, number>[] = priceLookups,
): void {
  const totalValue = valueUnits(units, priceLookups, date)
  if (totalValue <= 0) return

  let hasSpread = false
  for (let j = 0; j < units.length; j++) {
    if (purchaseLookups[j]!.get(date)! !== priceLookups[j]!.get(date)!) {
      hasSpread = true
      break
    }
  }
  if (!hasSpread) {
    for (let j = 0; j < units.length; j++) {
      const price = priceLookups[j]!.get(date)!
      units[j] = (totalValue * weights[j]!) / price
    }
    return
  }

  // Post-trade value plus the spread paid on buy legs must equal pre-trade value.
  let low = 0
  let high = totalValue
  for (let step = 0; step < REBALANCE_BISECTION_STEPS; step++) {
    const targetValue = (low + high) / 2
    let requiredValue = targetValue

    for (let j = 0; j < units.length; j++) {
      const bid = priceLookups[j]!.get(date)!
      const ask = purchaseLookups[j]!.get(date)!
      const boughtUnits = (targetValue * weights[j]!) / bid - units[j]!
      if (boughtUnits > 0) requiredValue += (ask - bid) * boughtUnits
    }

    if (requiredValue > totalValue) high = targetValue
    else low = targetValue
  }

  const targetValue = (low + high) / 2
  for (let j = 0; j < units.length; j++) {
    const price = priceLookups[j]!.get(date)!
    units[j] = (targetValue * weights[j]!) / price
  }
}

/**
 * Optional knobs for behavioral variants of DCA (e.g. panic-stop during bear markets).
 *
 * - skipContributionWhen: predicate called at each potential contribution date.
 *   Nhận current TWRR drawdown (âm khi dưới đỉnh, 0 khi ở đỉnh), return true để bỏ
 *   lần nạp đó. Mô phỏng hành vi retail "thấy đỏ là dừng nạp". Không áp dụng cho
 *   initial investment (day 0).
 * - contributionAmountOverride: hàm trả về SỐ TIỀN thực nạp cho kỳ đó (mặc định
 *   = params.cashflowAmount nếu không cung cấp). Dùng cho biến thể ngược lại
 *   với skip: "tăng tiền khi thấy đỏ" (mua thêm khi giảm sâu). Nếu cả 2 hook
 *   đều set, skipContributionWhen được ưu tiên (bỏ qua = 0 đồng, bất kể override).
 */
export interface DCASimulateOptions {
  skipContributionWhen?: (date: string, currentDrawdown: number) => boolean
  contributionAmountOverride?: (date: string, currentDrawdown: number) => number
  /**
   * Giá dùng để QUY ĐỔI TIỀN THÀNH ĐƠN VỊ khi mua (initial amount, mỗi lần DCA
   * và phần mua khi tái cân bằng),
   * CHỈ cho những fundId có mặt trong map này — các quỹ khác (không có entry,
   * tức tuyệt đại đa số quỹ mở/ETF) vẫn dùng đúng `dailyPrices` như trước,
   * hành vi không đổi.
   *
   * Dùng cho tài sản có 2 giá mua/bán như vàng miếng SJC: mua ở giá "bán ra"
   * (sell — cái nhà đầu tư phải trả), còn `dailyPrices` (dùng để định giá danh
   * mục / rebalance / so sánh hiệu suất xuyên suốt) là giá "mua vào" (buy —
   * cái nhà đầu tư nhận được nếu bán). Bắt đúng chi phí chênh lệch mua-bán thật,
   * thay vì giả định vàng cũng chỉ có 1 giá như quỹ mở/ETF.
   */
  purchasePrices?: Map<string, PricePoint[]>
}

/**
 * Simulate DCA for a single portfolio.
 *
 * Uses DAILY price data (mọi ngày giao dịch thực tế, đã align qua
 * alignFundsToCommonGridDaily) — không resample về tuần.
 * Matches the Compare/Simulate tabs: unified date grid across all tabs.
 *
 * @param dailyPrices - Map of fundId → PricePoint[] (daily prices, sorted by date)
 * @param slots - Fund allocations with weights (must sum to 100)
 * @param params - DCA parameters (initial amount, cashflow, frequency)
 * @param rebalFreq - How often to rebalance weights
 * @param options - Behavioral knobs (skip predicate for panic-stop variants, etc.)
 */
export function simulateDCA(
  dailyPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  params: DCAParams,
  rebalFreq: RebalanceFrequency,
  options?: DCASimulateOptions,
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
  const priceArrays = fundIds.map(id => dailyPrices.get(id) || [])

  const commonGrid = buildCommonPriceGrid(priceArrays)
  if (!commonGrid) {
    return { values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [], totalInvested: 0, finalValue: 0 }
  }
  const purchaseGrid = buildPurchasePriceGrid(
    commonGrid.dates,
    fundIds,
    commonGrid.priceLookups,
    options?.purchasePrices,
  )
  if (!purchaseGrid) {
    return { values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [], totalInvested: 0, finalValue: 0 }
  }
  const { dates: allDates, priceLookups: purchaseLookups } = purchaseGrid
  const priceLookups = commonGrid.priceLookups

  // ── Run DCA simulation ──
  // Note: giá dailyPrices vào đây ĐÃ được dividend-adjusted ở layer CSV loader
  // (xem src/utils/dividendAdjust.ts). Nên phần hiệu suất TWRR/MWRR tính
  // trực tiếp trên giá adjusted sẽ tự động phản ánh giả định tái đầu tư cổ
  // tức sau thuế. Không cần xử lý ex-date/pay-date ở đây nữa.
  const units = new Array(fundIds.length).fill(0)
  let totalInvested = 0
  let lastInvestDate = ''

  // MWRR series (portfolio value includes cashflows)
  const values: { date: string; value: number }[] = []
  const invested: { date: string; value: number }[] = []
  const cashflows: { date: string; amount: number }[] = []

  // TWRR series (ignores cashflows effect, pure investment performance)
  const twrrDailyReturns: ReturnPoint[] = []
  const cumulative: ReturnPoint[] = []
  const drawdown: ReturnPoint[] = []

  // Helper: buy funds with a given amount (dùng giá MUA-VÀO của người mua —
  // tức priceLookups cho quỹ thường, purchaseLookups/giá "bán ra" cho vàng)
  function buyFunds(amount: number, dateIdx: number) {
    const date = allDates[dateIdx]!
    allocateUnits(units, amount, weights, purchaseLookups, date)
    totalInvested += amount
    lastInvestDate = date
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
  let prevEndValue = totalInvested > 0 ? valueUnits(units, priceLookups, allDates[0]!) : 0

  // Record day 0
  values.push({ date: allDates[0]!, value: prevEndValue })
  invested.push({ date: allDates[0]!, value: totalInvested })
  cumulative.push({ date: allDates[0]!, value: 0 })  // 0% return on day 0
  drawdown.push({ date: allDates[0]!, value: 0 })

  for (let i = 1; i < allDates.length; i++) {
    const date = allDates[i]!

    // ── TWRR Step 1: compute value BEFORE any cashflow today ──
    // This reflects pure market movement since yesterday's close
    const valueBeforeCashflow = valueUnits(units, priceLookups, date)

    // Daily TWRR return = market movement only (before adding new money)
    let marketReturn = 0
    if (prevEndValue > 0) {
      marketReturn = valueBeforeCashflow / prevEndValue - 1
    }
    const growthAfterMarket = twrrGrowth * (1 + marketReturn)

    // ── Step 2: DCA cashflow (add new money AFTER computing return) ──
    if (params.cashflowAmount > 0) {
      const investDate = lastInvestDate || allDates[0]!
      if (shouldInvest(investDate, date, params.cashflowFreq)) {
        // Panic-stop hook: cho biến thể hành vi (vd: dừng nạp khi DD < -20%).
        // DD dùng ở đây là TWRR drawdown hiện tại (sau khi đã chain-link return hôm nay).
        // Retail đọc giá đóng cửa, thấy âm, rồi quyết định không nạp.
        const currentDD = twrrPeak > 0 ? (growthAfterMarket / twrrPeak - 1) : 0
        const shouldSkip = options?.skipContributionWhen?.(date, currentDD) ?? false
        if (!shouldSkip) {
          const amount = options?.contributionAmountOverride?.(date, currentDD) ?? params.cashflowAmount
          buyFunds(amount, i)
          cashflows.push({ date, amount: -amount })
        } else {
          // Vẫn phải dời mốc "kỳ nạp gần nhất" tới ngày hôm nay dù bỏ qua lần
          // này — nếu không, investDate ở trên cứ đứng yên tại lần nạp thành
          // công gần nhất, khiến shouldInvest() cứ trả về true MỌI NGÀY còn
          // lại trong cả giai đoạn sụt giảm (không chỉ 1 lần/kỳ), làm
          // skippedCount bị đếm trùng hàng chục lần cho một đợt bão duy nhất.
          lastInvestDate = date
        }
      }
    }

    // ── Step 3: Rebalance check ──
    let portfolioValue = totalInvested > 0 ? valueUnits(units, priceLookups, date) : 0
    let rebalanceFactor = 1
    if (totalInvested > 0) {
      if (shouldRebalForDCA(prevDateForRebal, date, rebalFreq)) {
        const valueBeforeRebalance = portfolioValue
        rebalanceUnits(units, weights, priceLookups, date, purchaseLookups)
        portfolioValue = valueUnits(units, priceLookups, date)
        if (valueBeforeRebalance > 0) rebalanceFactor = portfolioValue / valueBeforeRebalance
      }
    }
    prevDateForRebal = date

    // ── Record MWRR portfolio value (AFTER cashflow) ──
    values.push({ date, value: portfolioValue })
    invested.push({ date, value: totalInvested })

    // ── Record TWRR cumulative return ──
    const dailyReturn = (1 + marketReturn) * rebalanceFactor - 1
    twrrDailyReturns.push({ date, value: dailyReturn })
    twrrGrowth *= 1 + dailyReturn
    cumulative.push({ date, value: twrrGrowth - 1 })

    // ── Record TWRR drawdown ──
    if (twrrGrowth > twrrPeak) twrrPeak = twrrGrowth
    drawdown.push({ date, value: twrrGrowth / twrrPeak - 1 })

    // Update prevEndValue for next day's TWRR calculation
    prevEndValue = portfolioValue
  }

  // Dữ liệu đã ở dạng chuỗi TWRR daily returns, dùng trực tiếp (không cần resample gì thêm)
  const dailyReturnsOut = twrrDailyReturns

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
    returns: dailyReturnsOut,
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
 * CAGR của chuỗi TWRR tích lũy, quy năm theo ngày thực (365,25 ngày).
 *
 * Cách quy năm giống cagr() trong calculations.ts: lấy ngày đầu và ngày cuối
 * của chuỗi, không giả định 52 điểm/năm. Khác nhau ở đầu vào: cagr() nhận lợi
 * nhuận từng kỳ rồi nhân gộp, hàm này nhận chuỗi cumulative TWRR nên chỉ cần
 * giá trị điểm cuối (1 + growth) là tính được.
 *
 * Công thức: (twrrGrowth)^(1/years) - 1
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
 * "CAGR nhà đầu tư" — quy năm lợi nhuận tích lũy dựa trên finalValue/totalInvested,
 * giả định (sai) toàn bộ vốn đã hoạt động từ ngày đầu tiên. Thấp hơn dcaCagr() vì
 * phần lớn vốn DCA chỉ mới nạp gần đây. Dùng để đối chiếu với MWRR trong bảng thống
 * kê — không dùng để chiếu tương lai (xem projectionData trong DCAPanel.tsx).
 */
export function investorCagr(
  cumulative: ReturnPoint[],
  totalInvested: number,
  finalValue: number,
): number | null {
  if (cumulative.length < 2 || totalInvested <= 0 || finalValue <= 0) return null

  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years = (new Date(cumulative[cumulative.length - 1]!.date).getTime() -
    new Date(cumulative[0]!.date).getTime()) / msPerYear
  if (years <= 0) return null

  return Math.pow(finalValue / totalInvested, 1 / years) - 1
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

  // Find first/last date in year + last cumulative value for each year
  const yearEnd = new Map<number, number>() // year → (1 + cumulative.value) at year end
  const yearFirstDate = new Map<number, string>()
  const yearLastDate = new Map<number, string>()

  for (const p of cumulative) {
    const year = parseInt(p.date.substring(0, 4), 10)
    // Always overwrite. Cumulative is sorted, so last write = last date in year
    yearEnd.set(year, 1 + p.value)
    yearLastDate.set(year, p.date)
    if (!yearFirstDate.has(year)) yearFirstDate.set(year, p.date)
  }

  const years = Array.from(yearEnd.keys()).sort((a, b) => a - b)
  const firstYear = years[0]!
  const lastYear = years[years.length - 1]!
  const result: YearlyReturn[] = []

  for (let i = 0; i < years.length; i++) {
    const year = years[i]!
    const growthAtEnd = yearEnd.get(year)!
    const growthAtPrevEnd = i === 0 ? 1.0 : yearEnd.get(years[i - 1]!)!
    const yearReturn = growthAtEnd / growthAtPrevEnd - 1

    // Dữ liệu resample theo tuần lẫn daily đều hiếm khi có điểm đúng ngày
    // 01/01 hoặc 31/12 — chỉ tính "năm chưa trọn" khi lệch nhiều (>20 ngày),
    // và chỉ xét năm ĐẦU/CUỐI của toàn kỳ (không phụ thuộc mật độ dữ liệu).
    const isPartial =
      (year === firstYear && daysBetween(`${year}-01-01`, yearFirstDate.get(year)!) > 20) ||
      (year === lastYear && daysBetween(yearLastDate.get(year)!, `${year}-12-31`) > 20)

    result.push({ year, value: yearReturn, isPartial })
  }

  return result
}

export interface YearlyMWRR {
  year: number
  /** decimal; null nếu không tính được (mẫu số bằng 0, vd danh mục rỗng suốt năm) */
  value: number | null
  isPartial: boolean
  /** Giá trị danh mục (đã gồm cashflow) tại điểm cuối cùng của năm này */
  endValue: number
}

/**
 * Modified Dietz method: return có tính đến dòng tiền (money-weighted) cho
 * từng năm — đo đúng hiệu suất DANH MỤC CỦA NHÀ ĐẦU TƯ, khác với TWRR
 * (dcaYearlyReturns) vốn đo hiệu suất bản thân quỹ, bất kể bạn nạp bao
 * nhiêu/khi nào.
 *
 * Ý tưởng: tiền nạp càng sớm trong năm càng được tính trọng số cao (có
 * nhiều thời gian sinh lời hơn), nạp cuối năm gần như chưa kịp sinh lời.
 *
 *   R = (EV − BV − netContrib) / (BV + Σ contrib_i × (1 − t_i/T))
 *
 * Đây là công thức chuẩn GIPS để tính return có dòng tiền cho kỳ ngắn,
 * không cần giải lặp (khác Newton-Raphson của dcaMWRR), nên luôn ra kết
 * quả ổn định dù mỗi năm chỉ có ~12 lần nạp tiền.
 *
 * @param valueSeries Giá trị danh mục theo thời gian (đã gồm cashflow, từ simulateDCA)
 * @param cashflows Toàn bộ cashflows từ simulateDCA (âm = nạp tiền, dòng cuối
 *   dương = finalValue tổng — sẽ tự bị loại vì chỉ lọc amount < 0)
 */
export function dcaYearlyMWRR(
  valueSeries: { date: string; value: number }[],
  cashflows: { date: string; amount: number }[],
): YearlyMWRR[] {
  if (valueSeries.length < 2) return []

  const years = Array.from(
    new Set(valueSeries.map(p => parseInt(p.date.slice(0, 4), 10))),
  ).sort((a, b) => a - b)

  // Chỉ các đợt nạp tiền thật (âm) — dòng "final value" tổng (dương) tự bị loại
  const contributions = cashflows.filter(cf => cf.amount < 0)

  const firstYear = years[0]!
  const lastYear = years[years.length - 1]!

  const results: YearlyMWRR[] = []
  for (const year of years) {
    const yearStartStr = `${year}-01-01`
    const yearEndStr = `${year}-12-31`

    const priorPoints = valueSeries.filter(p => p.date < yearStartStr)
    const bvPoint = priorPoints.length > 0 ? priorPoints[priorPoints.length - 1]! : null
    const BV = bvPoint ? bvPoint.value : 0
    const periodStartDate = bvPoint
      ? bvPoint.date
      : (valueSeries.find(p => p.date >= yearStartStr)?.date ?? yearStartStr)

    const yearPoints = valueSeries.filter(p => p.date >= yearStartStr && p.date <= yearEndStr)
    if (yearPoints.length === 0) continue
    const EV = yearPoints[yearPoints.length - 1]!.value
    const periodEndDate = yearPoints[yearPoints.length - 1]!.date

    const totalDays = Math.max(1, daysBetween(periodStartDate, periodEndDate))

    // Dữ liệu resample theo tuần nên hiếm khi có điểm đúng ngày 01/01 hoặc
    // 31/12 (lệch vài ngày vì cuối tuần/lễ) — chỉ tính là "năm chưa trọn"
    // khi lệch nhiều (>20 ngày), và chỉ xét năm ĐẦU/CUỐI của toàn kỳ so sánh,
    // tránh báo nhầm hàng loạt năm giữa kỳ.
    const isPartial =
      (year === firstYear && daysBetween(yearStartStr, periodStartDate) > 20) ||
      (year === lastYear && daysBetween(periodEndDate, yearEndStr) > 20)

    const yearContribs = contributions
      .filter(cf => cf.date >= periodStartDate && cf.date <= periodEndDate)
      .map(cf => ({ date: cf.date, amount: -cf.amount })) // dương = tiền thêm vào danh mục

    const netContrib = yearContribs.reduce((s, c) => s + c.amount, 0)
    const weightedContrib = yearContribs.reduce((s, c) => {
      const t = daysBetween(periodStartDate, c.date)
      return s + c.amount * (1 - t / totalDays)
    }, 0)

    const denominator = BV + weightedContrib
    const value = denominator !== 0 ? (EV - BV - netContrib) / denominator : null

    results.push({ year, value, isPartial, endValue: EV })
  }

  return results
}

export function computeDCARolling(
  cumulative: ReturnPoint[],
  periodMonths: number,
): ReturnPoint[] {
  if (cumulative.length === 0) return []

  const dates = cumulative.map(p => new Date(p.date).getTime())
  // Two-pointer dùng chung với calculations.ts/lsVsDca.ts (xem dateWindow.ts):
  // lùi đúng theo LỊCH THÁNG (vd 12 tháng trước 15/03 là 15/03 năm trước),
  // không dùng số ngày xấp xỉ — tháng thực dài 28-31 ngày khác nhau, xấp xỉ
  // cố định sẽ lệch dần khi dữ liệu thưa (monthly/quarterly rebalance...).
  const starts = rollingWindowStarts(dates, periodMonths)

  const raw: ReturnPoint[] = []
  for (let i = 0; i < cumulative.length; i++) {
    const j = starts[i]!
    if (j < 0) continue // chuỗi chưa lùi xa đủ periodMonths tháng

    const growthNow = 1 + cumulative[i]!.value
    const growthPast = 1 + cumulative[j]!.value
    if (growthPast > 0) {
      const periodGrowth = growthNow / growthPast
      const annualized = Math.pow(periodGrowth, 12 / periodMonths) - 1
      raw.push({ date: cumulative[i]!.date, value: annualized })
    }
  }

  // Downsample cho chart (tối đa ~200 điểm), luôn giữ điểm cuối cùng
  if (raw.length <= 200) return raw
  const sampleStep = Math.max(1, Math.floor(raw.length / 200))
  const result: ReturnPoint[] = []
  for (let i = 0; i < raw.length; i += sampleStep) result.push(raw[i]!)
  if (result[result.length - 1] !== raw[raw.length - 1]) {
    result.push(raw[raw.length - 1]!)
  }
  return result
}

/**
 * Thống kê "bão" (drawdown) trong hành trình DCA.
 *
 * Retail VN không cảm nhận được "TWRR drawdown". Họ cảm nhận trực tiếp:
 *   "Lúc tệ nhất, tài sản sụt bao nhiêu % so với đỉnh?"
 *   "Mất bao lâu để hồi phục?"
 *   "Có rơi vào giai đoạn bear market lịch sử nào không?"
 *
 * Dùng TWRR drawdown (đã loại ảnh hưởng cashflow) vì đó mới là "bão thị trường thật",
 * không phải ảo giác do tiền mới nạp che lấp.
 */
export interface DCAStormStats {
  /** Drawdown tệ nhất (số âm, vd -0.23 = -23%) */
  maxDrawdown: number
  /** YYYY-MM-DD ngày chạm đáy drawdown (hoặc '' nếu không có data) */
  maxDDDate: string
  /** YYYY-MM-DD ngày peak trước đáy */
  maxDDPeakDate: string
  /** Số tháng từ đáy về lại peak cũ (null = chưa hồi phục) */
  recoveryMonths: number | null
  /** Số "cơn bão": số lần drawdown chạm ≤ -10% rồi hồi phục về gần peak */
  stormsCount: number
  /** Trùng với giai đoạn bear lịch sử VN nào (nếu có) */
  inBearPeriod: 'bear2018' | 'covid2020' | 'bear2022' | null
}

export function dcaStormStats(
  drawdown: ReturnPoint[],
  cumulative: ReturnPoint[],
): DCAStormStats {
  const empty: DCAStormStats = {
    maxDrawdown: 0, maxDDDate: '', maxDDPeakDate: '',
    recoveryMonths: null, stormsCount: 0, inBearPeriod: null,
  }
  if (drawdown.length === 0 || cumulative.length === 0) return empty

  // Tìm drawdown tệ nhất
  let maxDD = 0
  let maxDDIdx = 0
  for (let i = 0; i < drawdown.length; i++) {
    if (drawdown[i]!.value < maxDD) {
      maxDD = drawdown[i]!.value
      maxDDIdx = i
    }
  }

  // Peak trước đáy (dùng cumulative để có growth factor)
  let peakIdx = 0
  let peakVal = -Infinity
  for (let i = 0; i <= maxDDIdx; i++) {
    const g = 1 + cumulative[i]!.value
    if (g > peakVal) { peakVal = g; peakIdx = i }
  }

  // Hồi phục: idx đầu tiên sau đáy mà cumulative >= peakVal cũ
  let recoveryIdx = -1
  for (let i = maxDDIdx + 1; i < cumulative.length; i++) {
    if (1 + cumulative[i]!.value >= peakVal) { recoveryIdx = i; break }
  }

  const recoveryMonths = recoveryIdx >= 0
    ? monthsBetween(drawdown[maxDDIdx]!.date, cumulative[recoveryIdx]!.date)
    : null

  // Đếm bão: DD chạm ≤ -10% rồi hồi về ≥ -2% thì đếm 1 cơn
  let stormsCount = 0
  let inStorm = false
  for (const p of drawdown) {
    if (!inStorm && p.value <= -0.10) { inStorm = true; stormsCount++ }
    else if (inStorm && p.value >= -0.02) { inStorm = false }
  }

  // Detect bear period (dựa vào ngày chạm đáy)
  const ddDate = drawdown[maxDDIdx]!.date
  let inBearPeriod: DCAStormStats['inBearPeriod'] = null
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

function monthsBetween(d1: string, d2: string): number {
  const a = new Date(d1)
  const b = new Date(d2)
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()))
}

/**
 * Compute Profit Factor from daily TWRR returns.
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

/**
 * Tính rolling CAGR cho từng cửa sổ N năm trên TWRR cumulative series.
 *
 * Dùng để trả lời: "nếu bạn bắt đầu đầu tư quỹ này ở các thời điểm khác nhau
 * và giữ N năm, CAGR sẽ như thế nào?", chống luck bias.
 *
 * Không phải DCA CAGR (vì DCA có dòng tiền phức tạp), mà là CAGR của chính
 * quỹ trong mọi chu kỳ N năm. Đủ để cho user thấy phân phối kết quả lịch sử.
 */
export interface RollingCAGRPoint {
  startDate: string
  endDate: string
  cagr: number
}

export function rollingCAGR(
  cumulative: ReturnPoint[],
  windowYears: number,
): RollingCAGRPoint[] {
  if (cumulative.length === 0 || windowYears <= 0) return []

  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const windowMs = windowYears * msPerYear

  // cumulative.value = total return % from day 0 (vd 0.5 = +50%)
  // growth factor = 1 + value
  const results: RollingCAGRPoint[] = []

  // Sample mỗi tháng một điểm start để không tạo quá nhiều data points
  let lastSampledMonth = ''
  for (let i = 0; i < cumulative.length; i++) {
    const startPt = cumulative[i]!
    const startMonth = startPt.date.slice(0, 7)
    if (startMonth === lastSampledMonth) continue
    lastSampledMonth = startMonth

    const startTime = new Date(startPt.date).getTime()
    const targetTime = startTime + windowMs

    // Tìm điểm gần target nhất (không vượt target quá xa)
    let endIdx = -1
    for (let j = i + 1; j < cumulative.length; j++) {
      if (new Date(cumulative[j]!.date).getTime() >= targetTime) {
        endIdx = j
        break
      }
    }
    if (endIdx === -1) break // Hết data, không đủ N năm cho các start sau

    const endPt = cumulative[endIdx]!
    const startGrowth = 1 + startPt.value
    const endGrowth = 1 + endPt.value
    if (startGrowth <= 0) continue

    const actualYears =
      (new Date(endPt.date).getTime() - startTime) / msPerYear
    if (actualYears <= 0) continue

    const cagr = Math.pow(endGrowth / startGrowth, 1 / actualYears) - 1

    results.push({
      startDate: startPt.date,
      endDate: endPt.date,
      cagr,
    })
  }

  return results
}

/**
 * TWRR CAGR của đúng `windowYears` năm CUỐI CÙNG trong chuỗi `cumulative`
 * (nếu đủ dữ liệu). Dùng làm "vị trí thực tế của bạn" khi so với phân phối
 * rollingCAGR cùng windowYears trong RollingReturnBlock — cùng công thức
 * (TWRR) và cùng độ dài kỳ nên percentile mới thực sự so sánh được. Khác
 * với cách cũ (dùng CAGR kiểu nhà đầu tư tính trên TOÀN BỘ kỳ backtest —
 * có thể dài/ngắn hơn windowYears rất nhiều, lại theo công thức khác hẳn
 * TWRR — khiến việc xếp percentile không có ý nghĩa thống kê).
 */
export function trailingWindowCagr(cumulative: ReturnPoint[], windowYears: number): number | null {
  if (cumulative.length < 2 || windowYears <= 0) return null

  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const endPt = cumulative[cumulative.length - 1]!
  const endTime = new Date(endPt.date).getTime()
  const targetStartTime = endTime - windowYears * msPerYear

  // Không đủ lịch sử lùi xa đủ windowYears năm: điểm sớm nhất của chuỗi vẫn
  // còn sau mốc mục tiêu.
  if (new Date(cumulative[0]!.date).getTime() > targetStartTime) return null

  // Điểm đầu tiên có ngày >= targetStartTime...
  let k = cumulative.length - 1
  for (let i = 0; i < cumulative.length; i++) {
    if (new Date(cumulative[i]!.date).getTime() >= targetStartTime) { k = i; break }
  }
  // ...rồi so với điểm NGAY TRƯỚC nó, chọn điểm nào GẦN targetStartTime hơn.
  // Cần bước này vì msPerYear=365.25 chỉ là xấp xỉ (năm nhuận lệch lên tới
  // ~6 giờ so với 1 năm lịch thật) — nếu dữ liệu thưa (vd chỉ 1 điểm/năm) và
  // mốc mục tiêu rơi trúng ranh giới đó, tìm "điểm đầu tiên >= target" một
  // cách cứng nhắc có thể chọn nhầm sang điểm SAU đó nguyên 1 năm.
  let startIdx = k
  if (k > 0) {
    const distK = Math.abs(new Date(cumulative[k]!.date).getTime() - targetStartTime)
    const distPrev = Math.abs(new Date(cumulative[k - 1]!.date).getTime() - targetStartTime)
    if (distPrev < distK) startIdx = k - 1
  }
  if (startIdx >= cumulative.length - 1) return null

  const startPt = cumulative[startIdx]!
  const startGrowth = 1 + startPt.value
  const endGrowth = 1 + endPt.value
  if (startGrowth <= 0) return null

  const actualYears = (endTime - new Date(startPt.date).getTime()) / msPerYear
  if (actualYears <= 0) return null

  return Math.pow(endGrowth / startGrowth, 1 / actualYears) - 1
}

/** Gom rolling CAGR thành histogram buckets. */
export function histogramBuckets(
  values: number[],
  bucketSize: number = 0.02, // 2%
): { min: number; max: number; center: number; count: number }[] {
  if (values.length === 0) return []

  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const minBucket = Math.floor(minV / bucketSize) * bucketSize
  const maxBucket = Math.ceil(maxV / bucketSize) * bucketSize

  const buckets: { min: number; max: number; center: number; count: number }[] = []
  for (let b = minBucket; b < maxBucket + bucketSize / 2; b += bucketSize) {
    buckets.push({
      min: b,
      max: b + bucketSize,
      center: b + bucketSize / 2,
      count: 0,
    })
  }

  for (const v of values) {
    const idx = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor((v - minBucket) / bucketSize)),
    )
    buckets[idx]!.count++
  }

  return buckets
}

/**
 * Tính chuỗi lợi nhuận HÀNG THÁNG từ TWRR cumulative series, dùng làm "pool"
 * để block-bootstrap cho Monte Carlo (xem monteCarloProjection bên dưới).
 *
 * Mỗi tháng lấy điểm cuối cùng trong tháng đó làm mốc growth factor
 * (1 + cumulative.value), rồi tính lợi nhuận = growth(tháng này) / growth(tháng
 * trước) - 1. Bỏ tháng đầu tiên vì không có mốc trước đó để so sánh (tránh tạo
 * ra một "lợi nhuận" giả từ một đoạn tháng không trọn vẹn).
 */
export function dcaMonthlyReturns(cumulative: ReturnPoint[]): ReturnPoint[] {
  if (cumulative.length < 2) return []

  const monthEnd = new Map<string, number>() // "YYYY-MM" → growth factor tại cuối tháng
  const order: string[] = []
  for (const p of cumulative) {
    const ym = p.date.slice(0, 7)
    if (!monthEnd.has(ym)) order.push(ym)
    monthEnd.set(ym, 1 + p.value) // cumulative đã sắp tăng dần theo ngày → lần ghi cuối = cuối tháng
  }

  const result: ReturnPoint[] = []
  for (let i = 1; i < order.length; i++) {
    const ym = order[i]!
    const growthEnd = monthEnd.get(ym)!
    const growthPrev = monthEnd.get(order[i - 1]!)!
    if (growthPrev <= 0) continue
    result.push({ date: ym, value: growthEnd / growthPrev - 1 })
  }
  return result
}

export interface MonteCarloPathPoint {
  month: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface MonteCarloRepresentativePath {
  /** Percentile của giá trị tài khoản cuối kỳ dùng để chọn path này. */
  percentile: number
  /** Giá trị tài khoản theo từng tháng, bao gồm tháng 0 là giá trị hiện tại. */
  values: number[]
  finalValue: number
  /** CAGR của path lợi nhuận, tách khỏi các khoản góp tiền hằng tháng. */
  cagr: number
  /** Drawdown lớn nhất của path lợi nhuận, tách khỏi các khoản góp tiền hằng tháng. */
  maxDrawdown: number
}

export interface MonteCarloResult {
  /** Dải phân phối theo từng tháng (month 0 = hiện tại), dùng vẽ fan chart. */
  path: MonteCarloPathPoint[]
  /** Giá trị cuối kỳ của mọi kịch bản, đã sắp tăng dần — dùng tính percentile/xác suất. */
  finalValues: number[]
  /** CAGR của mọi path lợi nhuận, đã sắp tăng dần — dùng vẽ phân phối CAGR. */
  cagrs: number[]
  /** Maximum drawdown của mọi path lợi nhuận, đã sắp tăng dần — dùng vẽ phân phối drawdown. */
  maxDrawdowns: number[]
  /** Bốn path thật, chọn theo percentile của giá trị tài khoản cuối kỳ. */
  representativePaths: MonteCarloRepresentativePath[]
}

const DEFAULT_BLOCK_SIZE = 12
const DEFAULT_ITERATIONS = 1000

/**
 * Block-bootstrap Monte Carlo: xáo trộn ngẫu nhiên các khối N-tháng lợi nhuận
 * lịch sử (block mặc định = 12 tháng, giữ nguyên thứ tự bên trong khối để bảo
 * toàn phần nào tính tự tương quan/momentum thật của quỹ, khác với xáo trộn
 * từng tháng độc lập), nối lại thành hàng nghìn kịch bản tương lai.
 *
 * Mỗi kịch bản: chọn ngẫu nhiên 1 điểm bắt đầu trong pool, lấy blockSize tháng
 * liên tiếp (vòng lại từ đầu pool nếu chạm cuối — "circular block bootstrap"),
 * áp dụng lần lượt vào công thức DCA tiêu chuẩn v = v×(1+r) + góp mỗi tháng,
 * lặp lại tới khi đủ horizonMonths. Lặp lại toàn bộ quá trình `iterations` lần.
 *
 * Trả về null nếu pool rỗng — không có gì để xáo trộn. Việc pool "đủ dài để
 * đáng tin" (vd tối thiểu 12 tháng) là quyết định UX, để caller tự quyết định
 * (xem MonteCarloBlock.tsx) — hàm này chỉ đảm bảo đúng toán học với pool có ít
 * nhất 1 phần tử, vòng lại (modulo) khi blockSize vượt quá độ dài pool.
 */
export function monteCarloProjection(opts: {
  monthlyReturnPool: number[]
  startValue: number
  monthlyContribution: number
  horizonMonths: number
  iterations?: number
  blockSize?: number
  /** Injectable cho test tất định; mặc định Math.random. */
  rng?: () => number
}): MonteCarloResult | null {
  const {
    monthlyReturnPool: pool,
    startValue,
    monthlyContribution,
    horizonMonths,
    iterations = DEFAULT_ITERATIONS,
    blockSize = DEFAULT_BLOCK_SIZE,
    rng = Math.random,
  } = opts

  const poolLen = pool.length
  if (poolLen === 0 || horizonMonths <= 0 || iterations <= 0) {
    return null
  }

  const effectiveBlockSize = Math.max(1, Math.floor(blockSize))

  // matrix[month][iteration] — cột theo tháng để tính percentile cho fan chart.
  const matrix: number[][] = Array.from({ length: horizonMonths + 1 }, () => new Array(iterations))
  const scenarios: MonteCarloRepresentativePath[] = []
  for (let it = 0; it < iterations; it++) {
    matrix[0]![it] = startValue
  }

  for (let it = 0; it < iterations; it++) {
    let v = startValue
    let growth = 1
    let peakGrowth = 1
    let maxDrawdown = 0
    let built = 0
    const values = [startValue]
    while (built < horizonMonths) {
      const start = Math.floor(rng() * poolLen)
      const take = Math.min(effectiveBlockSize, horizonMonths - built)
      for (let k = 0; k < take; k++) {
        const r = pool[(start + k) % poolLen]!
        growth *= 1 + r
        if (growth > peakGrowth) peakGrowth = growth
        maxDrawdown = Math.min(maxDrawdown, growth / peakGrowth - 1)
        v = v * (1 + r) + monthlyContribution
        built++
        matrix[built]![it] = v
        values.push(v)
      }
    }
    scenarios.push({
      percentile: 0,
      values,
      finalValue: v,
      cagr: Math.pow(growth, 12 / horizonMonths) - 1,
      maxDrawdown,
    })
  }

  const path: MonteCarloPathPoint[] = matrix.map((monthValues, month) => {
    const sorted = [...monthValues].sort((a, b) => a - b)
    return {
      month,
      p10: percentileSorted(sorted, 0.10),
      p25: percentileSorted(sorted, 0.25),
      p50: percentileSorted(sorted, 0.50),
      p75: percentileSorted(sorted, 0.75),
      p90: percentileSorted(sorted, 0.90),
    }
  })

  const finalValues = [...matrix[horizonMonths]!].sort((a, b) => a - b)
  const cagrs = scenarios.map(s => s.cagr).sort((a, b) => a - b)
  const maxDrawdowns = scenarios.map(s => s.maxDrawdown).sort((a, b) => a - b)
  const scenariosByFinalValue = [...scenarios].sort((a, b) => a.finalValue - b.finalValue)
  const representativePaths = [0.10, 0.25, 0.50, 0.75].map(percentile => {
    const target = percentileSorted(finalValues, percentile)
    const closest = scenariosByFinalValue.reduce((best, scenario) => (
      Math.abs(scenario.finalValue - target) < Math.abs(best.finalValue - target) ? scenario : best
    ))
    return { ...closest, percentile }
  })

  return { path, finalValues, cagrs, maxDrawdowns, representativePaths }
}

/** Tỷ lệ kịch bản đạt >= target, trong mảng finalValues đã sắp tăng dần. */
export function probabilityAtLeast(sortedFinalValues: number[], target: number): number {
  const n = sortedFinalValues.length
  if (n === 0) return 0
  let lo = 0, hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedFinalValues[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return (n - lo) / n
}

/**
 * Shadow simulation chỉ để kể chuyện cổ tức.
 *
 * Chạy song song với simulateDCA chính (vốn dùng adjusted NAV để tính TWRR/MWRR).
 * Hàm này dùng RAW NAV từ nguồn dữ liệu nên số ccq, tiền cổ tức, số ccq mua thêm
 * khớp với sao kê tài khoản thực tế của nhà đầu tư.
 *
 * Mô hình:
 *   - Buy ở giá raw tại cashflow date.
 *   - Ex-date: ghi nhận pending = units × amountPerCert.
 *   - Pay-date: nhận gross × (1 - tax) tiền ròng, mua thêm ccq ở raw NAV ngày đó.
 *   - Rebalance như simulateDCA.
 *
 * Chỉ trả về stats cho các quỹ thực sự có chi trả trong kỳ.
 */
export function trackDividendNarrative(
  rawWeeklyPrices: Map<string, PricePoint[]>,
  slots: DCASlot[],
  params: DCAParams,
  rebalFreq: RebalanceFrequency,
  dividends: Map<string, DividendEvent[]>,
  purchasePrices?: Map<string, PricePoint[]>,
): DividendNarrativeStats[] {
  const validSlots = slots.filter(s => s.fundId && s.weight > 0)
  if (validSlots.length === 0) return []

  const totalWeight = validSlots.reduce((s, x) => s + x.weight, 0)
  const weights = validSlots.map(s => s.weight / totalWeight)
  const fundIds = validSlots.map(s => s.fundId)

  // Bỏ qua nếu không quỹ nào trong portfolio có dividend
  if (!fundIds.some(id => dividends.has(id))) return []

  const priceArrays = fundIds.map(id => rawWeeklyPrices.get(id) || [])
  if (priceArrays.some(a => a.length === 0)) return []

  const commonGrid = buildCommonPriceGrid(priceArrays)
  if (!commonGrid) return []
  const purchaseGrid = buildPurchasePriceGrid(
    commonGrid.dates,
    fundIds,
    commonGrid.priceLookups,
    purchasePrices,
  )
  if (!purchaseGrid) return []
  const { dates: allDates, priceLookups: purchaseLookups } = purchaseGrid
  const priceLookups = commonGrid.priceLookups

  // Schedule dividend events trên weekly grid
  interface ScheduleEntry {
    fundIdx: number; fundId: string; exIdx: number; payIdx: number
    exDate: string; payDate: string
    amountPerCert: number; taxRate: number
    unitsAtEx: number  // set ở ex-date
  }
  const schedule: ScheduleEntry[] = []
  for (let j = 0; j < fundIds.length; j++) {
    const evs = dividends.get(fundIds[j]!)
    if (!evs) continue
    for (const ev of evs) {
      if (ev.exDate <= allDates[0]!) continue
      if (ev.payDate > allDates[allDates.length - 1]!) continue
      let exIdx = -1
      for (let i = 0; i < allDates.length; i++) {
        if (allDates[i]! >= ev.exDate) { exIdx = i; break }
      }
      if (exIdx < 1) continue
      let payIdx = -1
      for (let i = exIdx; i < allDates.length; i++) {
        if (allDates[i]! >= ev.payDate) { payIdx = i; break }
      }
      if (payIdx === -1) continue
      schedule.push({
        fundIdx: j, fundId: fundIds[j]!,
        exIdx, payIdx,
        exDate: ev.exDate, payDate: ev.payDate,
        amountPerCert: ev.amountPerCert, taxRate: ev.taxRate,
        unitsAtEx: 0,
      })
    }
  }
  if (schedule.length === 0) return []

  const units = new Array(fundIds.length).fill(0)
  const pending = new Array(fundIds.length).fill(0)
  const stats = new Map<string, DividendNarrativeStats>()
  let totalInvested = 0
  let lastInvestDate = ''

  function buy(amount: number, dateIdx: number) {
    const date = allDates[dateIdx]!
    allocateUnits(units, amount, weights, purchaseLookups, date)
    totalInvested += amount
    lastInvestDate = date
  }
  if (params.initialAmount > 0) buy(params.initialAmount, 0)
  let prevDateForRebal = allDates[0]!

  for (let i = 1; i < allDates.length; i++) {
    const date = allDates[i]!

    // Ex-date: snapshot units (ghi nhận units đúng đợt này để hiển thị per-event)
    for (const dv of schedule) {
      if (dv.exIdx === i) {
        dv.unitsAtEx = units[dv.fundIdx]!
        pending[dv.fundIdx]! += units[dv.fundIdx]! * dv.amountPerCert
      }
    }
    // Pay-date: trả tiền, trừ thuế, tái đầu tư
    for (const dv of schedule) {
      if (dv.payIdx === i) {
        const gross = dv.unitsAtEx * dv.amountPerCert
        if (gross > 0) {
          const tax = gross * dv.taxRate
          const net = gross - tax
          const reinvestPrice = priceLookups[dv.fundIdx]!.get(date)!
          const sharesAdded = net / reinvestPrice
          units[dv.fundIdx]! += sharesAdded
          pending[dv.fundIdx]! -= gross

          let s = stats.get(dv.fundId)
          if (!s) {
            s = { fundId: dv.fundId, eventCount: 0, events: [], totalGross: 0, totalTax: 0, totalNet: 0, totalSharesAdded: 0 }
            stats.set(dv.fundId, s)
          }
          s.eventCount++
          s.events.push({
            exDate: dv.exDate,
            payDate: dv.payDate,
            unitsAtEx: dv.unitsAtEx,
            gross, tax, net, sharesAdded,
          })
          s.totalGross += gross
          s.totalTax += tax
          s.totalNet += net
          s.totalSharesAdded += sharesAdded
        }
      }
    }

    // Cashflow
    if (params.cashflowAmount > 0) {
      const investDate = lastInvestDate || allDates[0]!
      if (shouldInvest(investDate, date, params.cashflowFreq)) {
        buy(params.cashflowAmount, i)
      }
    }

    // Rebalance
    if (totalInvested > 0 && shouldRebalForDCA(prevDateForRebal, date, rebalFreq)) {
      rebalanceUnits(units, weights, priceLookups, date, purchaseLookups)
    }
    prevDateForRebal = date
  }

  return Array.from(stats.values())
}
