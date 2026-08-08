import { describe, it, expect } from 'vitest'
import { computeSMA, computeEMA, computeRSI, computeIndicator, simulateTacticalSwitching, runTacticalBacktest, decomposeAdvantage, signalCheckpointDates } from './tactical'
import type { PricePoint } from '../types'
import type { AllocationId } from './tactical'

describe('computeSMA', () => {
  it('returns null before the window is full, then a rolling average', () => {
    const prices: PricePoint[] = [10, 20, 30, 40, 50].map((price, i) => ({ date: `2024-01-${i + 1}`, price }))
    const result = computeSMA(prices, 3)
    expect(result.map(p => p.sma)).toEqual([null, null, 20, 30, 40])
  })

  it('handles window=1 (SMA equals price itself)', () => {
    const prices: PricePoint[] = [10, 20, 30].map((price, i) => ({ date: `2024-01-${i + 1}`, price }))
    const result = computeSMA(prices, 1)
    expect(result.map(p => p.sma)).toEqual([10, 20, 30])
  })
})

describe('computeEMA', () => {
  it('seeds with the SMA of the first window, then smooths recursively with k=2/(window+1)', () => {
    // window=3 -> k=0.5. Seed tại i=2: (100+100+100)/3=100.
    // i=3: 200*0.5+100*0.5=150. i=4: 100*0.5+150*0.5=125. i=5: 100*0.5+125*0.5=112.5.
    const prices: PricePoint[] = [100, 100, 100, 200, 100, 100].map((price, i) => ({ date: `2024-01-${i + 1}`, price }))
    const result = computeEMA(prices, 3)
    expect(result.map(p => p.value)).toEqual([null, null, 100, 150, 125, 112.5])
  })
})

describe('computeRSI', () => {
  it('matches a hand-computed Wilder RSI for a small series', () => {
    // prices: 10,11,10,12,11,13 (window=3)
    // deltas: +1,-1,+2,-1,+2
    // i=1,2: tích luỹ avgGain/avgLoss (chưa đủ window) -> null
    // i=3 (=window): avgGain=(1+0+2)/3=1, avgLoss=(0+1+0)/3=1/3 -> RSI=100-100/(1+3)=75
    // i=4: avgGain=(1*2+0)/3=2/3, avgLoss=(1/3*2+1)/3=5/9 -> rs=1.2 -> RSI=100-100/2.2≈54.5455
    // i=5: avgGain=(2/3*2+2)/3=10/9, avgLoss=(5/9*2+0)/3=10/27 -> rs=3 -> RSI=100-100/4=75
    const prices: PricePoint[] = [10, 11, 10, 12, 11, 13].map((price, i) => ({ date: `2024-01-${i + 1}`, price }))
    const result = computeRSI(prices, 3)
    const values = result.map(p => p.value)
    expect(values[0]).toBeNull()
    expect(values[1]).toBeNull()
    expect(values[2]).toBeNull()
    expect(values[3]).toBeCloseTo(75, 6)
    expect(values[4]).toBeCloseTo(54.5455, 3)
    expect(values[5]).toBeCloseTo(75, 6)
  })

  it('returns 100 when there are no losses in the window', () => {
    const prices: PricePoint[] = [10, 11, 12, 13].map((price, i) => ({ date: `2024-01-${i + 1}`, price }))
    const result = computeRSI(prices, 2)
    expect(result[2]!.value).toBeCloseTo(100, 6)
    expect(result[3]!.value).toBeCloseTo(100, 6)
  })
})

describe('computeIndicator', () => {
  const prices: PricePoint[] = [10, 20, 30, 40, 50].map((price, i) => ({ date: `2024-01-${i + 1}`, price }))

  it('delegates to computeSMA for type SMA', () => {
    expect(computeIndicator(prices, 'SMA', 3).map(p => p.value)).toEqual(computeSMA(prices, 3).map(p => p.sma))
  })

  it('delegates to computeEMA for type EMA', () => {
    expect(computeIndicator(prices, 'EMA', 3).map(p => p.value)).toEqual(computeEMA(prices, 3).map(p => p.value))
  })

  it('delegates to computeRSI for type RSI', () => {
    expect(computeIndicator(prices, 'RSI', 3).map(p => p.value)).toEqual(computeRSI(prices, 3).map(p => p.value))
  })
})

describe('simulateTacticalSwitching', () => {
  const dates = ['d0', 'd1', 'd2', 'd3', 'd4']

  it('never switches when price stays above SMA the whole time', () => {
    const result = simulateTacticalSwitching({
      dates,
      compareValue: [110, 111, 112, 113, 114],
      upperThreshold: [100, 100, 100, 100, 100],
      lowerThreshold: [100, 100, 100, 100, 100],
      returnA: [0, 0.01, 0.01, 0.01, 0.01],
      returnB: [0, 0.05, 0.05, 0.05, 0.05],
      startValue: 1000,
      switchCostPct: 0,
    })
    expect(result.activeAllocation).toEqual(['A', 'A', 'A', 'A', 'A'])
    expect(result.switches).toHaveLength(0)
    expect(result.strategyValue[4]).toBeCloseTo(1000 * 1.01 ** 4, 6)
    expect(result.currentSignal).toBe('A')
  })

  it('applies the switch exactly one day AFTER the price crosses (T+1 lag), and charges the fee', () => {
    // Giá cắt xuống dưới SMA ở ngày index 2 (d2); vì T+1 nên phải tới ngày
    // d3 (index 3) mới thực sự chuyển allocation.
    const result = simulateTacticalSwitching({
      dates: ['d0', 'd1', 'd2', 'd3', 'd4'],
      compareValue: [110, 110, 90, 90, 90],
      upperThreshold: [100, 100, 100, 100, 100],
      lowerThreshold: [100, 100, 100, 100, 100],
      returnA: [0, 0, 0, 0, 0],
      returnB: [0, 0, 0, 0, 0],
      startValue: 1000,
      switchCostPct: 1,
    })
    expect(result.activeAllocation).toEqual(['A', 'A', 'A', 'B', 'B'])
    expect(result.switches).toHaveLength(1)
    expect(result.switches[0]).toMatchObject({ date: 'd3', from: 'A', to: 'B', valueBeforeCost: 1000, costPaid: 10 })
    // Sau phí 1% trên 1000 → 990, lợi nhuận 0% từ đó nên giữ nguyên 990.
    expect(result.strategyValue[3]).toBeCloseTo(990, 6)
    expect(result.strategyValue[4]).toBeCloseTo(990, 6)
    expect(result.currentSignal).toBe('B')
  })

  it('does not switch when the price dips inside the tolerance band around SMA', () => {
    // sma=100, tolerance=2% → band [98, 102]. Giá rơi xuống 99 vẫn nằm trong band.
    const result = simulateTacticalSwitching({
      dates: ['d0', 'd1', 'd2', 'd3'],
      compareValue: [110, 99, 99, 99],
      upperThreshold: [102, 102, 102, 102],
      lowerThreshold: [98, 98, 98, 98],
      returnA: [0, 0, 0, 0],
      returnB: [0, 0, 0, 0],
      startValue: 1000,
      switchCostPct: 1,
    })
    expect(result.activeAllocation).toEqual(['A', 'A', 'A', 'A'])
    expect(result.switches).toHaveLength(0)
    expect(result.currentSignal).toBe('A')
  })

  it('switches back and forth correctly across multiple crossings, charging a fee each time', () => {
    const result = simulateTacticalSwitching({
      dates: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5'],
      compareValue: [110, 90, 110, 90, 110, 110], // above, below, above, below, above, above
      upperThreshold: [100, 100, 100, 100, 100, 100],
      lowerThreshold: [100, 100, 100, 100, 100, 100],
      returnA: [0, 0, 0, 0, 0, 0],
      returnB: [0, 0, 0, 0, 0, 0],
      startValue: 1000,
      switchCostPct: 1,
    })
    // Tín hiệu (tính từ giá đóng cửa) theo từng ngày: A,B,A,B,A,A. Vì T+1,
    // holding ngày t = tín hiệu ngày t-1 → holding chỉ đổi từ index 2 trở đi
    // (d2..d5), 4 lần chuyển tổng cộng.
    expect(result.switches.length).toBe(4)
    expect(result.activeAllocation).toEqual(['A', 'A', 'B', 'A', 'B', 'A'])
  })

  it('inverts direction with bullishAbove=false (RSI mean-reversion: overbought -> B, oversold -> A)', () => {
    // Ngưỡng cố định 70/30. RSI=80 (quá mua, >70) -> tín hiệu B (đảo chiều,
    // KHÔNG phải A như band SMA/EMA thuận chiều). RSI=20 (quá bán, <30) -> A.
    const result = simulateTacticalSwitching({
      dates: ['d0', 'd1', 'd2', 'd3'],
      compareValue: [80, 80, 20, 20],
      upperThreshold: [70, 70, 70, 70],
      lowerThreshold: [30, 30, 30, 30],
      bullishAbove: false,
      returnA: [0, 0, 0, 0],
      returnB: [0, 0, 0, 0],
      startValue: 1000,
      switchCostPct: 0,
    })
    // Tín hiệu từng ngày: B,B,A,A. T+1 -> holding đổi từ index 2 trở đi.
    expect(result.activeAllocation).toEqual(['B', 'B', 'B', 'A'])
    expect(result.currentSignal).toBe('A')
  })

  it('holds the previous signal between the two thresholds (the gap itself is the anti-whipsaw buffer)', () => {
    const result = simulateTacticalSwitching({
      dates: ['d0', 'd1', 'd2', 'd3'],
      compareValue: [80, 50, 50, 50], // ngày 0 quá mua -> B, sau đó ở giữa 30-70 -> giữ B
      upperThreshold: [70, 70, 70, 70],
      lowerThreshold: [30, 30, 30, 30],
      bullishAbove: false,
      returnA: [0, 0, 0, 0],
      returnB: [0, 0, 0, 0],
      startValue: 1000,
      switchCostPct: 0,
    })
    expect(result.activeAllocation).toEqual(['B', 'B', 'B', 'B'])
    expect(result.switches).toHaveLength(0)
  })
})

describe('runTacticalBacktest', () => {
  function buildDailyPrices(startPrice: number, dailyReturn: number, days: number, startDate = '2020-01-01'): PricePoint[] {
    const out: PricePoint[] = []
    let price = startPrice
    const d = new Date(startDate)
    for (let i = 0; i < days; i++) {
      out.push({ date: d.toISOString().slice(0, 10), price })
      price = price * (1 + dailyReturn)
      d.setDate(d.getDate() + 1)
    }
    return out
  }

  it('returns null when there is not enough history to compute the indicator window', () => {
    const raw = new Map<string, PricePoint[]>([
      ['SIGNAL', buildDailyPrices(100, 0.0005, 50)],
      ['FUND_A', buildDailyPrices(100, 0.0006, 50)],
      ['FUND_B', buildDailyPrices(100, 0.0001, 50)],
    ])
    const result = runTacticalBacktest({
      rawPrices: raw,
      signalFundId: 'SIGNAL',
      indicatorType: 'SMA',
      period: 200,
      toleranceBandPct: 0,
      allocationASlots: [{ fundId: 'FUND_A', weight: 100 }],
      allocationARebalFreq: 'quarterly',
      allocationBSlots: [{ fundId: 'FUND_B', weight: 100 }],
      allocationBRebalFreq: 'quarterly',
      startValue: 1_000_000,
      switchCostPct: 0.5,
    })
    expect(result).toBeNull()
  })

  it('trims the effective start date forward past the SMA warm-up period', () => {
    const raw = new Map<string, PricePoint[]>([
      ['SIGNAL', buildDailyPrices(100, 0.0005, 400)],
      ['FUND_A', buildDailyPrices(100, 0.0006, 400)],
      ['FUND_B', buildDailyPrices(100, 0.0001, 400)],
    ])
    const result = runTacticalBacktest({
      rawPrices: raw,
      signalFundId: 'SIGNAL',
      indicatorType: 'SMA',
      period: 200,
      toleranceBandPct: 0,
      allocationASlots: [{ fundId: 'FUND_A', weight: 100 }],
      allocationARebalFreq: 'quarterly',
      allocationBSlots: [{ fundId: 'FUND_B', weight: 100 }],
      allocationBRebalFreq: 'quarterly',
      startValue: 1_000_000,
      switchCostPct: 0.5,
    })
    expect(result).not.toBeNull()
    // 200 ngày khởi động SMA -> ngày hiệu lực phải trễ hơn ngày đầu tiên (2020-01-01).
    expect(result!.effectiveStartDate > '2020-01-01').toBe(true)
    expect(result!.switching.dates.length).toBeGreaterThan(0)
    expect(result!.switching.dates[0]).toBe(result!.effectiveStartDate)
    expect(['A', 'B']).toContain(result!.switching.currentSignal)
  })

  it('returns null (not a silent full-history fallback) when dateFrom is beyond all available data', () => {
    // Dữ liệu chỉ có 400 ngày kể từ 2020-01-01 (~2021-02-03). dateFrom yêu
    // cầu 2025-01-01 — không tìm thấy ngày nào >= dateFrom trong chuỗi, nên
    // phải trả về null. Bug cũ: Math.max(firstValidIdx, -1) lặng lẽ quay về
    // firstValidIdx, chạy backtest trên TOÀN BỘ lịch sử như thể không hề có
    // dateFrom, thay vì báo "không có dữ liệu ở khoảng ngày yêu cầu".
    const raw = new Map<string, PricePoint[]>([
      ['SIGNAL', buildDailyPrices(100, 0.0005, 400)],
      ['FUND_A', buildDailyPrices(100, 0.0006, 400)],
      ['FUND_B', buildDailyPrices(100, 0.0001, 400)],
    ])
    const result = runTacticalBacktest({
      rawPrices: raw,
      signalFundId: 'SIGNAL',
      indicatorType: 'SMA',
      period: 50,
      toleranceBandPct: 2,
      dateFrom: '2025-01-01',
      allocationASlots: [{ fundId: 'FUND_A', weight: 100 }],
      allocationARebalFreq: 'quarterly',
      allocationBSlots: [{ fundId: 'FUND_B', weight: 100 }],
      allocationBRebalFreq: 'quarterly',
      startValue: 1_000_000,
      switchCostPct: 0.5,
    })
    expect(result).toBeNull()
  })

  it('computes the indicator window on the signal fund\'s own trading days, not on the merged grid (calendar-day dilution bug)', () => {
    // Quỹ tín hiệu SIG chỉ có giá vào các ngày giao dịch thật (thiếu 02/01,
    // mô phỏng một phiên nghỉ). Tài sản DENSE (đại diện cho tiết kiệm ngân
    // hàng, xem generateSavingsSeries) có giá ở MỌI ngày lịch, kể cả 02/01.
    // Khi gộp lưới ngày, 02/01 của SIG được forward-fill từ 01/01 để hiện thị
    // giá liên tục, đúng vậy. Nhưng chỉ báo TÍNH trên lưới đã gộp đó sẽ đếm nhầm
    // dòng lặp này là một "phiên" thật, làm cửa sổ SMA ngắn hơn ý định.
    const sigDates = ['2024-01-01', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07', '2024-01-08', '2024-01-09', '2024-01-10']
    const sigPrices = [10, 20, 30, 40, 40, 40, 40, 40, 40]
    const SIGNAL: PricePoint[] = sigDates.map((date, i) => ({ date, price: sigPrices[i]! }))

    const denseDates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07', '2024-01-08', '2024-01-09', '2024-01-10']
    const DENSE: PricePoint[] = denseDates.map(date => ({ date, price: 1 }))

    const raw = new Map<string, PricePoint[]>([
      ['SIGNAL', SIGNAL],
      ['DENSE', DENSE],
    ])
    const result = runTacticalBacktest({
      rawPrices: raw,
      signalFundId: 'SIGNAL',
      indicatorType: 'SMA',
      period: 3,
      toleranceBandPct: 0,
      allocationASlots: [{ fundId: 'SIGNAL', weight: 100 }],
      allocationARebalFreq: 'quarterly',
      allocationBSlots: [{ fundId: 'DENSE', weight: 100 }],
      allocationBRebalFreq: 'quarterly',
      startValue: 1_000_000,
      switchCostPct: 0,
    })
    expect(result).not.toBeNull()

    // SMA(3) đúng phải đợi đủ 3 PHIÊN THẬT của SIGNAL: 01/01 (10), 03/01 (20),
    // 04/01 (30) -> sẵn sàng từ 04/01, giá trị = (10+20+30)/3 = 20.
    // Bug cũ (tính trên lưới đã gộp, có dòng 02/01 forward-fill từ 01/01):
    // "3 dòng" đầu tiên là 01/01, 02/01(=10, lặp), 03/01 -> sẵn sàng SAI từ
    // 03/01, giá trị SAI = (10+10+20)/3 = 13,33.
    expect(result!.effectiveStartDate).toBe('2024-01-04')
    expect(result!.indicatorSeries[0]!.value).toBeCloseTo(20, 6)
  })

  it('also works with EMA and RSI indicator types', () => {
    const raw = new Map<string, PricePoint[]>([
      ['SIGNAL', buildDailyPrices(100, 0.0005, 400)],
      ['FUND_A', buildDailyPrices(100, 0.0006, 400)],
      ['FUND_B', buildDailyPrices(100, 0.0001, 400)],
    ])
    const emaResult = runTacticalBacktest({
      rawPrices: raw,
      signalFundId: 'SIGNAL',
      indicatorType: 'EMA',
      period: 50,
      toleranceBandPct: 2,
      allocationASlots: [{ fundId: 'FUND_A', weight: 100 }],
      allocationARebalFreq: 'quarterly',
      allocationBSlots: [{ fundId: 'FUND_B', weight: 100 }],
      allocationBRebalFreq: 'quarterly',
      startValue: 1_000_000,
      switchCostPct: 0.5,
    })
    expect(emaResult).not.toBeNull()

    const rsiResult = runTacticalBacktest({
      rawPrices: raw,
      signalFundId: 'SIGNAL',
      indicatorType: 'RSI',
      period: 14,
      toleranceBandPct: 0, // không dùng cho RSI, chỉ rsiOverbought/rsiOversold mới có ý nghĩa
      rsiOverbought: 70,
      rsiOversold: 30,
      allocationASlots: [{ fundId: 'FUND_A', weight: 100 }],
      allocationARebalFreq: 'quarterly',
      allocationBSlots: [{ fundId: 'FUND_B', weight: 100 }],
      allocationBRebalFreq: 'quarterly',
      startValue: 1_000_000,
      switchCostPct: 0.5,
    })
    expect(rsiResult).not.toBeNull()
    expect(rsiResult!.indicatorSeries.every(p => p.value === null || (p.value >= 0 && p.value <= 100))).toBe(true)
  })
})

describe('signalCheckpointDates', () => {
  /** Tháng 1/2024: bỏ bớt vài ngày cho giống lịch nghỉ thật. */
  const prices: PricePoint[] = [
    '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', // tuần 1, hết tuần ở thứ Sáu 05/01
    '2024-01-08', '2024-01-09', '2024-01-31',               // 31/01 là phiên cuối tháng 1
    '2024-02-01', '2024-02-02',                             // sang tháng 2
  ].map((date, i) => ({ date, price: 100 + i }))

  it('daily: mọi phiên đều là ngày chốt', () => {
    const s = signalCheckpointDates(prices, 'daily')
    expect(s.size).toBe(prices.length)
    for (const p of prices) expect(s.has(p.date)).toBe(true)
  })

  it('monthly: chỉ phiên GIAO DỊCH cuối cùng của mỗi tháng', () => {
    const s = signalCheckpointDates(prices, 'monthly')
    expect([...s].sort()).toEqual(['2024-01-31', '2024-02-02'])
  })

  it('weekly: chỉ phiên giao dịch cuối cùng của mỗi tuần', () => {
    const s = signalCheckpointDates(prices, 'weekly')
    // 05/01 là thứ Sáu, phiên cuối tuần đầu. 09/01 là phiên cuối trước khi nhảy sang
    // tuần của 31/01. 31/01 là phiên cuối tuần đó. 02/02 là phiên cuối cùng của chuỗi.
    expect(s.has('2024-01-05')).toBe(true)
    expect(s.has('2024-01-09')).toBe(true)
    expect(s.has('2024-02-02')).toBe(true)
    // Giữa tuần thì không chốt.
    expect(s.has('2024-01-03')).toBe(false)
    expect(s.has('2024-01-08')).toBe(false)
  })

  it('ngày cuối cùng của chuỗi luôn là ngày chốt, dù tháng/tuần chưa trọn', () => {
    for (const freq of ['weekly', 'monthly'] as const) {
      expect(signalCheckpointDates(prices, freq).has('2024-02-02')).toBe(true)
    }
  })
})

describe('simulateTacticalSwitching với isCheckpoint', () => {
  const dates = ['d0', 'd1', 'd2', 'd3', 'd4']
  const base = {
    dates,
    upperThreshold: [100, 100, 100, 100, 100],
    lowerThreshold: [100, 100, 100, 100, 100],
    returnA: [0, 0, 0, 0, 0],
    returnB: [0, 0, 0, 0, 0],
    startValue: 1_000_000,
    switchCostPct: 0,
  }
  // Giá vượt lên trên ngưỡng ở d1-d2 rồi rơi lại. Cú bật giữa kỳ đúng nghĩa.
  const compareValue = [90, 110, 110, 90, 90]

  it('không có isCheckpoint thì bắt luôn cú bật giữa kỳ (hành vi cũ)', () => {
    const r = simulateTacticalSwitching({ ...base, compareValue })
    expect(r.switches.length).toBeGreaterThan(0)
    expect(r.activeAllocation).toEqual(['B', 'B', 'A', 'A', 'B'])
  })

  it('chốt thưa thì bỏ qua cú bật giữa kỳ, không sinh lệnh nào', () => {
    // Chỉ chốt ở d0 và d4, lúc đó giá đều nằm dưới ngưỡng.
    const isCheckpoint = [true, false, false, false, true]
    const r = simulateTacticalSwitching({ ...base, compareValue, isCheckpoint })
    expect(r.switches).toHaveLength(0)
    expect(r.activeAllocation.every(a => a === 'B')).toBe(true)
  })

  it('vẫn đổi khi cú vượt ngưỡng rơi đúng vào ngày chốt', () => {
    const isCheckpoint = [true, false, true, false, true]
    const r = simulateTacticalSwitching({ ...base, compareValue, isCheckpoint })
    // Chốt ở d2 thấy giá 110 vượt ngưỡng nên đổi sang A, thực thi d3 (T+1).
    // Chốt ở d4 thấy giá rơi lại nên đổi về B, nhưng lệnh đó rơi vào d5 nằm ngoài
    // chuỗi, chưa kịp thành lệnh thật. Đó là lý do chỉ có đúng 1 lần chuyển.
    expect(r.switches).toHaveLength(1)
    expect(r.switches[0]!.date).toBe('d3')
    expect(r.switches[0]!.to).toBe('A')
    expect(r.currentSignal).toBe('B')
  })
})

describe('decomposeAdvantage', () => {
  it('returns a single segment with factor 1 when allocation never changes and strategy tracks baseline exactly', () => {
    const dates = ['d0', 'd1', 'd2']
    const allocation: AllocationId[] = ['A', 'A', 'A']
    const result = decomposeAdvantage(dates, [100, 105, 110], [100, 105, 110], allocation)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]!.factor).toBeCloseTo(1, 10)
    expect(result.totalFactor).toBeCloseTo(1, 10)
    expect(result.topPositiveShare).toBeNull()
  })

  it('splits into segments at each allocation change, with boundary points shared between neighbours', () => {
    const dates = ['d0', 'd1', 'd2', 'd3', 'd4']
    const allocation: AllocationId[] = ['A', 'A', 'B', 'B', 'B']
    const result = decomposeAdvantage(dates, [100, 100, 100, 100, 100], [100, 100, 90, 90, 100], allocation)
    expect(result.segments).toEqual([
      { from: 'd0', to: 'd2', allocation: 'A', days: 2, factor: expect.closeTo(100 / 90, 10) },
      { from: 'd2', to: 'd4', allocation: 'B', days: 2, factor: expect.closeTo(90 / 100, 10) },
    ])
  })

  it('telescopes: product of all segment factors equals strategyFinal/baselineFinal (start values equal)', () => {
    // Chuỗi bất kỳ, không cố ý cho ra số đẹp. Chỉ kiểm bất biến toán học.
    const dates = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5']
    const allocation: AllocationId[] = ['A', 'A', 'B', 'A', 'A', 'B']
    const strategyValue = [1_000_000, 1_020_000, 990_000, 1_050_000, 1_080_000, 1_040_000]
    const baselineValue = [1_000_000, 1_010_000, 1_005_000, 1_030_000, 1_060_000, 1_070_000]
    const result = decomposeAdvantage(dates, strategyValue, baselineValue, allocation)

    const productOfFactors = result.segments.reduce((p, s) => p * s.factor, 1)
    const directRatio = (strategyValue[5]! / strategyValue[0]!) / (baselineValue[5]! / baselineValue[0]!)
    expect(productOfFactors).toBeCloseTo(directRatio, 10)
    expect(result.totalFactor).toBeCloseTo(directRatio, 10)
  })

  it('computes topPositiveShare as the largest positive log-factor over the sum of all positive log-factors', () => {
    const dates = ['d0', 'd1', 'd2', 'd3']
    const allocation: AllocationId[] = ['A', 'B', 'A', 'A']
    // f1=2, f2=3, f3=0.5. Chỉ f1 và f2 dương, f3 âm nên không góp vào mẫu số.
    const strategyValue = [100, 200, 200, 200]
    const baselineValue = [100, 100, 100 / 3, 200 / 3]
    const result = decomposeAdvantage(dates, strategyValue, baselineValue, allocation)

    expect(result.segments[0]!.factor).toBeCloseTo(2, 6)
    expect(result.segments[1]!.factor).toBeCloseTo(3, 6)
    expect(result.segments[2]!.factor).toBeCloseTo(0.5, 6)
    expect(result.totalFactor).toBeCloseTo(3, 6)

    const expectedShare = Math.log(3) / (Math.log(2) + Math.log(3))
    expect(result.topPositiveShare).toBeCloseTo(expectedShare, 6)
  })

  it('returns topPositiveShare of 1 when there is exactly one positive segment among negative ones', () => {
    const dates = ['d0', 'd1', 'd2', 'd3']
    const allocation: AllocationId[] = ['A', 'B', 'A', 'A']
    const strategyValue = [100, 90, 180, 170]
    const baselineValue = [100, 100, 100, 105]
    const result = decomposeAdvantage(dates, strategyValue, baselineValue, allocation)
    const positiveCount = result.segments.filter(s => s.factor > 1).length
    expect(positiveCount).toBe(1)
    expect(result.topPositiveShare).toBeCloseTo(1, 10)
  })
})
