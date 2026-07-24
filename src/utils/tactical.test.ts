import { describe, it, expect } from 'vitest'
import { computeSMA, computeEMA, computeRSI, computeIndicator, simulateTacticalSwitching, runTacticalBacktest } from './tactical'
import type { PricePoint } from '../types'

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
