/**
 * tactical.ts: engine cho tab "Chiến thuật phân bổ" — chuyển đổi giữa 2 danh
 * mục (Allocation A / Allocation B) dựa trên tín hiệu từ MỘT chỉ báo kỹ thuật
 * (SMA, EMA, hoặc RSI) tính trên 1 ticker do người dùng chọn.
 *
 * Ý tưởng tham khảo từ testfol.io Tactical Allocation, nhưng thu hẹp có chủ
 * đích: đúng 1 chỉ báo tại 1 thời điểm (không phải nhiều tín hiệu kết hợp),
 * đúng 2 trạng thái (không có danh sách allocation ưu tiên/fallback nhiều
 * tầng), độ trễ thực thi CỐ ĐỊNH T+1 (tránh look-ahead bias — tín hiệu tính ở
 * giá đóng cửa hôm nay chỉ có hiệu lực từ phiên giao dịch kế tiếp).
 *
 * Với SMA/EMA: tín hiệu = Giá cắt lên/xuống đường trung bình động (band ±X%
 * quanh đường trung bình). Với RSI: tín hiệu = RSI cắt lên/xuống mốc trung
 * tính 50 (band ±X% quanh 50) — dùng lại đúng công thức band nhân theo % để
 * không cần một khái niệm "vùng đệm" riêng cho từng loại chỉ báo.
 *
 * Mỗi Allocation có thể là danh mục NHIỀU quỹ (tái dùng PortfolioCard + toàn
 * bộ engine simulateDCA đã có sẵn để tính chuỗi lợi nhuận riêng của từng
 * allocation), engine ở đây chỉ lo phần "chuyển đổi giữa 2 chuỗi lợi nhuận
 * đó theo tín hiệu", không tự tính lại rebalance nội bộ của từng allocation.
 */
import type { PricePoint, ReturnPoint, RebalanceFrequency } from '../types'
import { simulateDCA, type DCASlot } from './dca'
import { alignFundsToCommonGridDaily } from './weeklyResample'

// ─── SMA ─────────────────────────────────────────────────────────

export interface SmaPoint {
  date: string
  price: number
  /** null trong giai đoạn "khởi động" — chưa đủ `window` ngày dữ liệu trước đó. */
  sma: number | null
}

/** SMA(window) tính bằng rolling sum O(n). sma[i] = null nếu i < window - 1. */
export function computeSMA(prices: PricePoint[], window: number): SmaPoint[] {
  const result: SmaPoint[] = []
  let sum = 0
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i]!.price
    if (i >= window) sum -= prices[i - window]!.price
    const sma = i >= window - 1 ? sum / window : null
    result.push({ date: prices[i]!.date, price: prices[i]!.price, sma })
  }
  return result
}

// ─── EMA ─────────────────────────────────────────────────────────

export type IndicatorType = 'SMA' | 'EMA' | 'RSI'

export interface IndicatorPoint {
  date: string
  price: number
  /** SMA/EMA: cùng đơn vị giá. RSI: thang 0-100. null trong giai đoạn khởi động. */
  value: number | null
}

/** EMA(window): seed = SMA của `window` điểm đầu, sau đó làm mượt với hệ số k=2/(window+1). */
export function computeEMA(prices: PricePoint[], window: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  const k = 2 / (window + 1)
  let sum = 0
  let ema: number | null = null
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i]!.price
    if (i < window - 1) {
      sum += price
    } else if (i === window - 1) {
      sum += price
      ema = sum / window
    } else {
      ema = price * k + ema! * (1 - k)
    }
    result.push({ date: prices[i]!.date, price, value: ema })
  }
  return result
}

// ─── RSI ─────────────────────────────────────────────────────────

/** RSI(window) kiểu Wilder: trung bình tăng/giảm mượt hoá dần (không phải rolling window đơn thuần), thang 0-100. */
export function computeRSI(prices: PricePoint[], window: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      result.push({ date: prices[i]!.date, price: prices[i]!.price, value: null })
      continue
    }
    const delta = prices[i]!.price - prices[i - 1]!.price
    const gain = Math.max(delta, 0)
    const loss = Math.max(-delta, 0)
    let value: number | null = null
    if (i < window) {
      avgGain += gain / window
      avgLoss += loss / window
    } else if (i === window) {
      avgGain += gain / window
      avgLoss += loss / window
      value = rsiFromAvg(avgGain, avgLoss)
    } else {
      avgGain = (avgGain * (window - 1) + gain) / window
      avgLoss = (avgLoss * (window - 1) + loss) / window
      value = rsiFromAvg(avgGain, avgLoss)
    }
    result.push({ date: prices[i]!.date, price: prices[i]!.price, value })
  }
  return result
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Dispatcher: chọn cách tính chỉ báo theo loại người dùng chọn. */
export function computeIndicator(prices: PricePoint[], type: IndicatorType, window: number): IndicatorPoint[] {
  if (type === 'EMA') return computeEMA(prices, window)
  if (type === 'RSI') return computeRSI(prices, window)
  return computeSMA(prices, window).map(p => ({ date: p.date, price: p.price, value: p.sma }))
}

// ─── Tín hiệu + mô phỏng chuyển đổi ──────────────────────────────

export type AllocationId = 'A' | 'B'

/**
 * Bao lâu thì nhìn giá một lần để chốt tín hiệu.
 *
 * Đây là tham số ăn vào kết quả mạnh nhất của cả tab, mạnh hơn hẳn vùng đệm hay phí.
 * Đo trên E1VFVN30 với SMA200 và tiết kiệm 7%, cùng bộ dữ liệu, chỉ đổi mỗi chỗ này:
 * chốt cuối tháng cho 11 lệnh và CAGR 13,9%, chốt mỗi phiên cho 27 lệnh và CAGR 8,2%,
 * trong khi mua giữ luôn là 11,5%. Chốt thưa thì thắng mua giữ, chốt dày thì thua đậm.
 *
 * Lý do: chốt cuối tháng mỗi năm chỉ nhìn giá 12 lần, mọi dao động trong tháng không
 * cách nào làm nó đổi ý. Chốt mỗi phiên thì ăn trọn từng cú bật giả một.
 */
export type SignalFrequency = 'daily' | 'weekly' | 'monthly'

export interface TacticalSwitchEvent {
  date: string
  from: AllocationId
  to: AllocationId
  valueBeforeCost: number
  costPaid: number
}

export interface TacticalSwitchResult {
  dates: string[]
  strategyValue: number[]
  /** Allocation đang thực sự nắm giữ trong NGÀY đó (đã áp độ trễ T+1). */
  activeAllocation: AllocationId[]
  switches: TacticalSwitchEvent[]
  /** Tín hiệu tính từ giá đóng cửa ngày CUỐI CÙNG có dữ liệu — chưa áp dụng
   * độ trễ, tức là "nếu giữ kỷ luật, phiên kế tiếp nên chuyển sang allocation này". */
  currentSignal: AllocationId
}

/**
 * Vòng lặp chính: mỗi ngày t, xác định allocation nắm giữ = tín hiệu tại
 * ngày t-1 (T+1 lag), áp lợi nhuận tương ứng, và nếu allocation đổi so với
 * hôm qua thì trừ phí chuyển đổi TRƯỚC khi cộng lãi ngày đó (giả định: bán
 * xong, nộp phí, mua lại quỹ mới, rồi mới hưởng biến động trong ngày).
 *
 * `compareValue` vượt trên `upperThreshold` hoặc dưới `lowerThreshold` thì đổi
 * tín hiệu; ở giữa 2 ngưỡng thì giữ nguyên tín hiệu trước đó (chính khoảng
 * giữa 2 ngưỡng đóng vai trò "vùng đệm" chống nhấp nháy — không cần một tham
 * số % riêng). `bullishAbove` quyết định chiều: SMA/EMA dùng band ±X% quanh
 * đường trung bình (`upperThreshold`/`lowerThreshold` đổi theo ngày) với
 * true — vượt trên đường trung bình = xu hướng tăng = A. RSI quá mua/quá bán
 * dùng 2 mốc CỐ ĐỊNH (`upperThreshold`/`lowerThreshold` hằng số) với false —
 * đây là tín hiệu đảo chiều (mean-reversion): RSI quá bán (dưới mốc dưới) kỳ
 * vọng hồi phục = A; RSI quá mua (trên mốc trên) kỳ vọng điều chỉnh = B, tức
 * ngược chiều với band SMA/EMA. Tất cả mảng phải cùng độ dài, cùng lưới ngày,
 * và bắt đầu từ ngày chỉ báo có giá trị hợp lệ đầu tiên (không còn `null`).
 */
export function simulateTacticalSwitching(opts: {
  dates: string[]
  compareValue: number[]
  upperThreshold: number[]
  lowerThreshold: number[]
  bullishAbove?: boolean
  returnA: number[]
  returnB: number[]
  startValue: number
  switchCostPct: number
  /** Ngày nào được phép chốt tín hiệu. Bỏ trống thì ngày nào cũng chốt. */
  isCheckpoint?: boolean[]
}): TacticalSwitchResult {
  const { dates, compareValue, upperThreshold, lowerThreshold, returnA, returnB, startValue, switchCostPct, isCheckpoint } = opts
  const bullishAbove = opts.bullishAbove ?? true
  const n = dates.length

  const desiredSignal = (i: number, prevSignal: AllocationId | null): AllocationId => {
    // Ngoài ngày chốt thì không nhìn giá, giữ nguyên tín hiệu cũ. Ngày đầu tiên vẫn
    // phải chốt một lần dù rơi vào đâu, không thì cả backtest không có trạng thái nào.
    if (isCheckpoint && !isCheckpoint[i] && prevSignal) return prevSignal
    const upper = upperThreshold[i]!
    const lower = lowerThreshold[i]!
    if (compareValue[i]! > upper) return bullishAbove ? 'A' : 'B'
    if (compareValue[i]! < lower) return bullishAbove ? 'B' : 'A'
    // Giữa 2 ngưỡng: giữ nguyên trạng thái trước đó để tránh "nhấp nháy" tín
    // hiệu (whipsaw). Ngày đầu tiên (chưa có prevSignal) so với điểm giữa.
    if (prevSignal) return prevSignal
    const aboveMid = compareValue[i]! >= (upper + lower) / 2
    return bullishAbove ? (aboveMid ? 'A' : 'B') : (aboveMid ? 'B' : 'A')
  }

  const strategyValue = new Array<number>(n)
  const activeAllocation = new Array<AllocationId>(n)
  const switches: TacticalSwitchEvent[] = []
  const signalHistory = new Array<AllocationId>(n)

  signalHistory[0] = desiredSignal(0, null)
  activeAllocation[0] = signalHistory[0]!
  strategyValue[0] = startValue

  for (let t = 1; t < n; t++) {
    const held = signalHistory[t - 1]! // T+1: hôm nay giữ theo tín hiệu tính từ hôm qua
    activeAllocation[t] = held

    let v = strategyValue[t - 1]!
    if (held !== activeAllocation[t - 1]) {
      const cost = v * (switchCostPct / 100)
      switches.push({ date: dates[t]!, from: activeAllocation[t - 1]!, to: held, valueBeforeCost: v, costPaid: cost })
      v -= cost
    }
    const r = held === 'A' ? returnA[t]! : returnB[t]!
    strategyValue[t] = v * (1 + r)

    signalHistory[t] = desiredSignal(t, signalHistory[t - 1]!)
  }

  return {
    dates,
    strategyValue,
    activeAllocation,
    switches,
    currentSignal: signalHistory[n - 1]!,
  }
}

// ─── Orchestration: từ dữ liệu quỹ thô tới kết quả cuối ──────────

export interface TacticalBacktestInput {
  /** Giá thô (chưa align) của MỌI quỹ cần dùng: signal ticker + toàn bộ quỹ trong Allocation A và B. */
  rawPrices: Map<string, PricePoint[]>
  signalFundId: string
  indicatorType: IndicatorType
  period: number
  /** SMA/EMA: % biên độ quanh đường trung bình. Bỏ qua khi indicatorType='RSI'. */
  toleranceBandPct: number
  /** Bao lâu nhìn giá một lần để chốt tín hiệu. Mặc định 'daily' cho hợp bản cũ. */
  signalFrequency?: SignalFrequency
  /** RSI: mốc quá mua (vd 70) — RSI vượt lên trên → chuyển sang B. Mặc định 70. */
  rsiOverbought?: number
  /** RSI: mốc quá bán (vd 30) — RSI xuống dưới → chuyển sang A. Mặc định 30. */
  rsiOversold?: number
  allocationASlots: DCASlot[]
  allocationARebalFreq: RebalanceFrequency
  allocationBSlots: DCASlot[]
  allocationBRebalFreq: RebalanceFrequency
  startValue: number
  switchCostPct: number
  /** Giới hạn khoảng ngày backtest (đã tính theo "Tất cả"/"X năm qua" ở UI). */
  dateFrom?: string
  dateTo?: string
}

export interface TacticalBacktestResult {
  switching: TacticalSwitchResult
  indicatorSeries: IndicatorPoint[]
  /** Chuỗi tăng trưởng dạng cumulative (như dcaCagr/dcaMaxDrawdown kỳ vọng), value=0 tại ngày bắt đầu hiệu lực. */
  strategyCumulative: ReturnPoint[]
  buyHoldACumulative: ReturnPoint[]
  buyHoldBCumulative: ReturnPoint[]
  buyHoldAValue: number[]
  buyHoldBValue: number[]
  /** Ngày người dùng chọn (trước khi cắt bớt vì cần đủ dữ liệu tính chỉ báo). */
  requestedStartDate: string
  /** Ngày backtest thực sự bắt đầu có hiệu lực (đủ dữ liệu chỉ báo + đủ dữ liệu cả 2 allocation). */
  effectiveStartDate: string
}

/** Quy đổi chuỗi TWRR cumulative (ReturnPoint, value = tăng trưởng tích lũy) thành PricePoint (price = 1 + value) để chạy qua alignFundsToCommonGridDaily cùng các chuỗi giá khác. */
function cumulativeToPricePoints(cumulative: ReturnPoint[]): PricePoint[] {
  return cumulative.map(r => ({ date: r.date, price: 1 + r.value }))
}

/**
 * Ngày thứ Hai của tuần chứa `d`, dùng làm khoá gom nhóm theo tuần.
 *
 * Không dùng `getISOWeekKey` trong `weeklyResample.ts` (đã sửa đúng ranh giới ISO
 * 08/08/2026) vì lý do khác: hàm đó trả về khoá dạng "YYYY-WNN", còn ở đây cần trực
 * tiếp ngày thứ Hai (dùng làm mốc hiển thị/so khớp), nên tự tính cho gọn thay vì
 * quy đổi ngược từ khoá tuần.
 */
function mondayOfWeek(d: string): string {
  const dt = new Date(d + 'T00:00:00Z')
  const daysSinceMonday = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - daysSinceMonday)
  return dt.toISOString().slice(0, 10)
}

/**
 * Những ngày được phép chốt tín hiệu, tính trên chuỗi ngày GỐC của quỹ tín hiệu.
 *
 * Phải tính trên chuỗi gốc chứ không phải trên lưới ngày đã gộp, vì "cuối tháng" nghĩa
 * là PHIÊN GIAO DỊCH cuối cùng của tháng. Lấy theo lưới đã gộp thì ngày 31 rơi vào Chủ
 * nhật sẽ thành mốc chốt, mà hôm đó không có giá thật, chỉ là giá thứ Sáu lặp lại.
 */
export function signalCheckpointDates(prices: PricePoint[], freq: SignalFrequency): Set<string> {
  if (freq === 'daily') return new Set(prices.map(p => p.date))
  const keyOf = (d: string) => freq === 'monthly' ? d.slice(0, 7) : mondayOfWeek(d)
  const out = new Set<string>()
  for (let i = 0; i < prices.length; i++) {
    const isLastOfPeriod = i === prices.length - 1 || keyOf(prices[i + 1]!.date) !== keyOf(prices[i]!.date)
    if (isLastOfPeriod) out.add(prices[i]!.date)
  }
  return out
}

/**
 * Trải chỉ báo tính trên chuỗi ngày GỐC của quỹ tín hiệu (chỉ những ngày quỹ đó thực sự
 * có giá) lên một lưới ngày khác, rộng hơn, bằng forward-fill. Cùng cách giá được
 * forward-fill khi gộp lưới ngày ở `alignFundsToCommonGridDaily`.
 *
 * Lý do bắt buộc phải làm vậy thay vì tính thẳng SMA/EMA/RSI trên lưới ngày ĐÃ gộp: lưới
 * đã gộp có thể dày hơn hẳn số phiên giao dịch thật của quỹ tín hiệu, nếu một tài sản
 * khác trong cùng backtest sinh giá cho MỌI ngày lịch (điển hình: tiết kiệm ngân hàng,
 * xem `generateSavingsSeries`). Khi đó "N phiên" trong SMA(N) sẽ bị đếm nhầm thành "N
 * dòng của lưới đã gộp", tức gần với N ngày LỊCH chứ không phải N phiên giao dịch. Với
 * E1VFVN30 (68% ngày lịch là phiên giao dịch), SMA200 tính kiểu này chỉ còn dùng khoảng
 * 136 phiên thật, cửa sổ ngắn hơn hẳn 200 phiên như ý định ban đầu, tín hiệu đổi chiều
 * sớm và nhiều hơn thật sự.
 */
function forwardFillIndicatorOntoGrid(
  gridPoints: { date: string; price: number }[],
  nativeIndicator: IndicatorPoint[],
): IndicatorPoint[] {
  const nativeByDate = new Map(nativeIndicator.map(p => [p.date, p.value]))
  const out: IndicatorPoint[] = []
  let lastValue: number | null = null
  for (const gp of gridPoints) {
    const v = nativeByDate.get(gp.date)
    if (v !== undefined) lastValue = v
    out.push({ date: gp.date, price: gp.price, value: lastValue })
  }
  return out
}

export function runTacticalBacktest(input: TacticalBacktestInput): TacticalBacktestResult | null {
  const validA = input.allocationASlots.filter(s => s.fundId && s.weight > 0)
  const validB = input.allocationBSlots.filter(s => s.fundId && s.weight > 0)
  if (validA.length === 0 || validB.length === 0) return null
  if (!input.signalFundId || !input.rawPrices.has(input.signalFundId)) return null

  // Chỉ báo PHẢI tính trên chuỗi giá GỐC (chưa gộp lưới ngày) của quỹ tín
  // hiệu. Xem forwardFillIndicatorOntoGrid bên dưới để biết vì sao.
  const nativeSignalPrices = input.rawPrices.get(input.signalFundId)!
  if (nativeSignalPrices.length < input.period) return null
  const nativeIndicator = computeIndicator(nativeSignalPrices, input.indicatorType, input.period)

  // Lọc theo khoảng ngày yêu cầu TRƯỚC khi tính — chỉ báo cần dữ liệu TRƯỚC
  // ngày bắt đầu để "khởi động" nên vẫn cho phép dùng dữ liệu trước dateFrom
  // cho riêng bước tính chỉ báo (xử lý ở dưới bằng cách không cắt rawPrices ở đây).
  const dailyAligned = alignFundsToCommonGridDaily(input.rawPrices)

  const signalPrices = dailyAligned.get(input.signalFundId)
  if (!signalPrices) return null

  const dcaResultA = simulateDCA(
    dailyAligned, validA,
    { initialAmount: 1, cashflowAmount: 0, cashflowFreq: 'monthly' },
    input.allocationARebalFreq,
  )
  const dcaResultB = simulateDCA(
    dailyAligned, validB,
    { initialAmount: 1, cashflowAmount: 0, cashflowFreq: 'monthly' },
    input.allocationBRebalFreq,
  )
  if (dcaResultA.cumulative.length === 0 || dcaResultB.cumulative.length === 0) return null

  // Gộp 3 chuỗi (giá signal ticker, "giá" quy đổi từ cumulative A, B) về
  // cùng 1 lưới ngày, forward-fill — dùng lại đúng hàm align đã có.
  const merged = alignFundsToCommonGridDaily(new Map([
    ['__signal__', signalPrices],
    ['__A__', cumulativeToPricePoints(dcaResultA.cumulative)],
    ['__B__', cumulativeToPricePoints(dcaResultB.cumulative)],
  ]))
  const mSignal = merged.get('__signal__')!
  const mA = merged.get('__A__')!
  const mB = merged.get('__B__')!

  // commonStart = ngày muộn nhất trong 3 điểm bắt đầu (giống pattern ở rebalanceSensitivity.ts)
  const commonStart = [mSignal[0]?.date, mA[0]?.date, mB[0]?.date]
    .filter((d): d is string => !!d)
    .reduce((a, b) => (a > b ? a : b), '')
  const trimmedSignal = mSignal.filter(p => p.date >= commonStart)
  const trimmedA = mA.filter(p => p.date >= commonStart)
  const trimmedB = mB.filter(p => p.date >= commonStart)
  const n = trimmedSignal.length
  if (n !== trimmedA.length || n !== trimmedB.length || n < input.period + 5) return null

  const requestedStartDate = input.dateFrom || commonStart

  // Trải chỉ báo (đã tính trên chuỗi GỐC ở đầu hàm) lên lưới ngày chung bằng
  // forward-fill, thay vì tính lại trên `trimmedSignal`. Tính trên TOÀN BỘ
  // chuỗi (kể cả trước dateFrom) để có đủ "khởi động", rồi mới cắt về đúng
  // khoảng ngày backtest hiệu lực.
  const indicatorAll = forwardFillIndicatorOntoGrid(trimmedSignal, nativeIndicator)
  const firstValidIdx = indicatorAll.findIndex(p => p.value !== null)
  if (firstValidIdx === -1) return null

  let effectiveStartIdx = firstValidIdx
  if (input.dateFrom) {
    const requestedIdx = indicatorAll.findIndex(p => p.date >= input.dateFrom!)
    // dateFrom nằm SAU toàn bộ dữ liệu hiện có (không tìm thấy ngày nào >=
    // dateFrom) — phải báo "không có dữ liệu", không được lặng lẽ Math.max
    // về firstValidIdx rồi chạy backtest trên toàn bộ lịch sử như thể người
    // dùng không hề giới hạn ngày bắt đầu.
    if (requestedIdx === -1) return null
    effectiveStartIdx = Math.max(firstValidIdx, requestedIdx)
  }
  if (effectiveStartIdx >= n) return null

  let endIdx = n - 1
  if (input.dateTo) {
    for (let i = n - 1; i >= 0; i--) {
      if (trimmedSignal[i]!.date <= input.dateTo) { endIdx = i; break }
    }
  }
  if (endIdx <= effectiveStartIdx) return null

  const dates = trimmedSignal.slice(effectiveStartIdx, endIdx + 1).map(p => p.date)
  const indicatorSeries = indicatorAll.slice(effectiveStartIdx, endIdx + 1)

  // RSI: so sánh trực tiếp với 2 mốc quá mua/quá bán CỐ ĐỊNH, tín hiệu đảo
  // chiều (mean-reversion). SMA/EMA: so sánh giá với band ±X% quanh đường
  // trung bình (đổi theo ngày), tín hiệu thuận chiều (trend-following).
  const compareValue = input.indicatorType === 'RSI'
    ? indicatorSeries.map(p => p.value!)
    : indicatorSeries.map(p => p.price)
  const bullishAbove = input.indicatorType !== 'RSI'
  const upperThreshold = input.indicatorType === 'RSI'
    ? indicatorSeries.map(() => input.rsiOverbought ?? 70)
    : indicatorSeries.map(p => p.value! * (1 + input.toleranceBandPct / 100))
  const lowerThreshold = input.indicatorType === 'RSI'
    ? indicatorSeries.map(() => input.rsiOversold ?? 30)
    : indicatorSeries.map(p => p.value! * (1 - input.toleranceBandPct / 100))

  const returnAAll = growthToReturns(trimmedA.map(p => p.price))
  const returnBAll = growthToReturns(trimmedB.map(p => p.price))
  const returnA = returnAAll.slice(effectiveStartIdx, endIdx + 1)
  const returnB = returnBAll.slice(effectiveStartIdx, endIdx + 1)
  // Ngày đầu tiên của lát cắt không có "lợi nhuận so với hôm qua" hợp lệ
  // (vì hôm qua nằm ngoài lát cắt) — gán 0 để ngày đầu không tăng/giảm.
  returnA[0] = 0
  returnB[0] = 0

  const checkpointSet = signalCheckpointDates(nativeSignalPrices, input.signalFrequency ?? 'daily')
  const isCheckpoint = dates.map(d => checkpointSet.has(d))

  const switching = simulateTacticalSwitching({
    dates, compareValue, upperThreshold, lowerThreshold, bullishAbove, returnA, returnB,
    startValue: input.startValue,
    switchCostPct: input.switchCostPct,
    isCheckpoint,
  })

  const buyHoldAValue = compoundFromReturns(returnA, input.startValue)
  const buyHoldBValue = compoundFromReturns(returnB, input.startValue)

  const toCumulative = (values: number[]): ReturnPoint[] =>
    values.map((v, i) => ({ date: dates[i]!, value: v / values[0]! - 1 }))

  return {
    switching,
    indicatorSeries,
    strategyCumulative: toCumulative(switching.strategyValue),
    buyHoldACumulative: toCumulative(buyHoldAValue),
    buyHoldBCumulative: toCumulative(buyHoldBValue),
    buyHoldAValue,
    buyHoldBValue,
    requestedStartDate,
    effectiveStartDate: dates[0]!,
  }
}

// ─── Phân rã lợi thế ──────────────────────────────────────────────

export interface AdvantageSegment {
  from: string
  to: string
  allocation: AllocationId
  /** Số phiên trong đoạn (không tính phiên biên chung với đoạn kế tiếp). */
  days: number
  /** Hệ số đóng góp của riêng đoạn này vào tỉ lệ strategy/baseline cuối cùng. Nhân dồn
   * tất cả các đoạn lại đúng bằng `totalFactor`. >1 nghĩa là đoạn này kéo chiến thuật lại
   * gần/vượt baseline hơn, <1 nghĩa là đoạn này kéo lùi. */
  factor: number
}

export interface AdvantageDecomposition {
  segments: AdvantageSegment[]
  /** = strategyValue cuối / baselineValue cuối (khi 2 chuỗi xuất phát cùng giá trị đầu). */
  totalFactor: number
  /** Tỉ trọng của đoạn đóng lớn nhất trong TOÀN BỘ phần dương (0-1), null nếu không có
   * đoạn nào dương. Dùng để cảnh báo kiểu: một đoạn chiếm hơn nửa lợi thế. */
  topPositiveShare: number | null
}

/**
 * Phân rã tỉ lệ strategyValue/baselineValue cuối kỳ thành tích các hệ số theo từng đoạn
 * giữ nguyên 1 allocation, để trả lời "lợi thế của chiến thuật đến từ đoạn nào".
 *
 * Biên giữa 2 đoạn liên tiếp CHUNG một điểm (điểm cuối đoạn trước = điểm đầu đoạn sau),
 * không phải liền kề rời nhau. Nhờ vậy tích các `factor` telescope đúng bằng
 * strategyValue[cuối]/strategyValue[đầu] chia baselineValue[cuối]/baselineValue[đầu], không
 * lệch đi đâu cả. Cắt rời từng đoạn kiểu [0..k], [k+1..n-1] sẽ làm tích sai vì hai đầu đoạn
 * không nối liền giá trị.
 *
 * `strategyValue` và `baselineValue` phải cùng lưới ngày với `dates`, cùng độ dài với
 * `activeAllocation`. Điển hình: baselineValue = mua-giữ-luôn allocation A (buyHoldAValue).
 */
export function decomposeAdvantage(
  dates: string[],
  strategyValue: number[],
  baselineValue: number[],
  activeAllocation: AllocationId[],
): AdvantageDecomposition {
  const n = dates.length
  const segments: AdvantageSegment[] = []
  let segStartIdx = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || activeAllocation[i] !== activeAllocation[segStartIdx]) {
      const segEndIdx = Math.min(i, n - 1)
      const factor = (strategyValue[segEndIdx]! / strategyValue[segStartIdx]!)
        / (baselineValue[segEndIdx]! / baselineValue[segStartIdx]!)
      segments.push({
        from: dates[segStartIdx]!,
        to: dates[segEndIdx]!,
        allocation: activeAllocation[segStartIdx]!,
        days: segEndIdx - segStartIdx,
        factor,
      })
      segStartIdx = i
    }
  }

  const totalFactor = segments.reduce((p, s) => p * s.factor, 1)

  const positiveLogs = segments.filter(s => s.factor > 1).map(s => Math.log(s.factor))
  const positiveLogSum = positiveLogs.reduce((a, b) => a + b, 0)
  const topPositiveShare = positiveLogSum > 0 ? Math.max(...positiveLogs) / positiveLogSum : null

  return { segments, totalFactor, topPositiveShare }
}

function growthToReturns(growth: number[]): number[] {
  const r = new Array<number>(growth.length)
  r[0] = 0
  for (let i = 1; i < growth.length; i++) {
    const prev = growth[i - 1]!
    r[i] = prev > 0 ? growth[i]! / prev - 1 : 0
  }
  return r
}

function compoundFromReturns(returns: number[], startValue: number): number[] {
  const v = new Array<number>(returns.length)
  v[0] = startValue
  for (let i = 1; i < returns.length; i++) {
    v[i] = v[i - 1]! * (1 + returns[i]!)
  }
  return v
}
