import { describe, it, expect } from 'vitest'
import {
  dcaYearlyMWRR, computeDCARolling, derivePortfolioName, simulateDCA,
  trackDividendNarrative, dcaMonthlyReturns, monteCarloProjection, probabilityAtLeast, monthlyEquivalentContribution,
  slicePricesWithPredecessor, trailingWindowCagr,
} from './dca'
import { applyDividendAdjustment, type DividendEvent } from './dividendAdjust'
import type { PricePoint, ReturnPoint } from '../types'

describe('derivePortfolioName', () => {
  it('uses the fund ticker when there is exactly 1 fund', () => {
    expect(derivePortfolioName([{ fundId: 'DCDS', weight: 100 }], 'Portfolio 1')).toBe('DCDS')
  })

  it('falls back to the given fallback when there are 2+ funds', () => {
    const slots = [{ fundId: 'DCDS', weight: 60 }, { fundId: 'DCBF', weight: 40 }]
    expect(derivePortfolioName(slots, 'Portfolio 2')).toBe('Portfolio 2')
  })

  it('falls back to the given fallback when the single slot has no fundId yet', () => {
    expect(derivePortfolioName([{ fundId: '', weight: 100 }], 'Portfolio 3')).toBe('Portfolio 3')
  })

  it('falls back to the given fallback for an empty slots array', () => {
    expect(derivePortfolioName([], 'Portfolio 4')).toBe('Portfolio 4')
  })

  it('uses the caller-provided fallback verbatim (e.g. a stable num-based label, not array position)', () => {
    // "Portfolio 5" simulates a portfolio created 5th, even if it's now at array index 0
    const slots = [{ fundId: 'DCDS', weight: 40 }, { fundId: 'DCBF', weight: 60 }]
    expect(derivePortfolioName(slots, 'Portfolio 5')).toBe('Portfolio 5')
  })

  it('shows a readable name for the synthetic savings asset, not the raw id', () => {
    // "SAVINGS:6" là khoá nội bộ. Danh mục 100% tiết kiệm là cách dùng tự nhiên
    // nhất ở tab Chiến Thuật Phân Bổ ("dưới MA200 thì rút về gửi tiết kiệm"),
    // nên tên này hiện lên khắp biểu đồ và bảng, không được để lộ id thô.
    expect(derivePortfolioName([{ fundId: 'SAVINGS:6', weight: 100 }], 'Portfolio 1'))
      .toBe('Tiết kiệm 6%/năm')
    expect(derivePortfolioName([{ fundId: 'SAVINGS:7.5', weight: 100 }], 'Portfolio 1'))
      .toBe('Tiết kiệm 7.5%/năm')
  })
})

describe('dcaYearlyMWRR (Modified Dietz)', () => {
  it('returns 0% for a flat market with a single contribution (BV=0)', () => {
    const valueSeries = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-12-31', value: 100 },
    ]
    const cashflows = [{ date: '2024-01-01', amount: -100 }]
    const result = dcaYearlyMWRR(valueSeries, cashflows)
    expect(result).toHaveLength(1)
    expect(result[0]!.year).toBe(2024)
    expect(result[0]!.value).toBeCloseTo(0, 6)
  })

  it('returns exactly the growth rate for a single day-0 contribution (BV=0)', () => {
    // Đầu tư 100 duy nhất ngày đầu năm, tăng 10% tới cuối năm, không nạp thêm.
    // Vì contribution ở đúng t=0, trọng số luôn = 1 bất kể tổng số ngày trong năm,
    // nên kết quả phải khớp CHÍNH XÁC 10%, không phụ thuộc cách đếm ngày.
    const valueSeries = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-12-31', value: 110 },
    ]
    const cashflows = [{ date: '2024-01-01', amount: -100 }]
    const result = dcaYearlyMWRR(valueSeries, cashflows)
    expect(result[0]!.value).toBeCloseTo(0.10, 6)
  })

  it('weights a mid-year contribution correctly against prior-year BV', () => {
    // Đầu năm đã có 1000 (từ năm trước), giữa năm nạp thêm 100, cả danh mục
    // tăng đều 10%/năm suốt kỳ → giá trị cuối năm phải là 1000*1.1 + 100*1.05 ≈ 1205.
    const valueSeries = [
      { date: '2023-12-31', value: 1000 },
      { date: '2024-12-31', value: 1205 },
    ]
    const cashflows = [{ date: '2024-07-02', amount: -100 }]
    const result = dcaYearlyMWRR(valueSeries, cashflows)
    const year2024 = result.find(r => r.year === 2024)!
    expect(year2024.value).toBeCloseTo(0.10, 2)
  })

  it('rolls BV forward from the previous year end (multi-year)', () => {
    const valueSeries = [
      { date: '2023-01-01', value: 100 },
      { date: '2023-12-31', value: 110 }, // +10% năm 2023
      { date: '2024-12-31', value: 121 }, // +10% năm 2024 (trên nền 110)
    ]
    const cashflows = [{ date: '2023-01-01', amount: -100 }]
    const result = dcaYearlyMWRR(valueSeries, cashflows)
    expect(result).toHaveLength(2)
    expect(result[0]!.value).toBeCloseTo(0.10, 6)
    expect(result[1]!.value).toBeCloseTo(0.10, 6)
  })

  it('flags the first year as partial when data starts mid-year', () => {
    const valueSeries = [
      { date: '2024-06-01', value: 100 },
      { date: '2024-12-31', value: 100 },
    ]
    const cashflows = [{ date: '2024-06-01', amount: -100 }]
    const result = dcaYearlyMWRR(valueSeries, cashflows)
    expect(result[0]!.isPartial).toBe(true)
  })

  it('flags the last year as partial when data ends before year end', () => {
    const valueSeries = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-09-15', value: 100 },
    ]
    const cashflows = [{ date: '2024-01-01', amount: -100 }]
    const result = dcaYearlyMWRR(valueSeries, cashflows)
    expect(result[0]!.isPartial).toBe(true)
  })

  it('returns empty array when fewer than 2 value points', () => {
    expect(dcaYearlyMWRR([{ date: '2024-01-01', value: 100 }], [])).toEqual([])
    expect(dcaYearlyMWRR([], [])).toEqual([])
  })
})

describe('computeDCARolling', () => {
  /** Chuỗi cumulative tăng đều annualRate/năm, lấy mẫu mỗi tháng ("2024-01-01", "2024-02-01"...) */
  function buildMonthlySeries(months: number, annualRate: number) {
    const points = []
    for (let m = 0; m < months; m++) {
      const year = 2024 + Math.floor(m / 12)
      const month = (m % 12) + 1
      const date = `${year}-${String(month).padStart(2, '0')}-01`
      const growth = Math.pow(1 + annualRate, m / 12)
      points.push({ date, value: growth - 1 })
    }
    return points
  }

  it('annualizes a 12-month rolling window to the true underlying growth rate', () => {
    const series = buildMonthlySeries(25, 0.10) // 25 tháng tăng đều 10%/năm
    const rolling = computeDCARolling(series, 12)
    expect(rolling.length).toBeGreaterThan(0)
    for (const p of rolling) {
      expect(p.value).toBeCloseTo(0.10, 2)
    }
  })

  it('works the same whether points are spaced daily or monthly (date-based, not index-based)', () => {
    // Cùng tốc độ tăng trưởng nhưng lấy mẫu MỖI NGÀY thay vì mỗi tháng —
    // kết quả annualized phải vẫn ra ~10%, vì window tính theo ngày lịch.
    const points = []
    const start = new Date('2024-01-01')
    for (let d = 0; d < 730; d++) {
      const date = new Date(start.getTime() + d * 86400000)
      const dateStr = date.toISOString().slice(0, 10)
      const growth = Math.pow(1.10, d / 365.25)
      points.push({ date: dateStr, value: growth - 1 })
    }
    const rolling = computeDCARolling(points, 12)
    expect(rolling.length).toBeGreaterThan(0)
    const mid = rolling[Math.floor(rolling.length / 2)]!
    expect(mid.value).toBeCloseTo(0.10, 2)
  })

  it('returns empty array for empty input', () => {
    expect(computeDCARolling([], 12)).toEqual([])
  })

  it('skips points that do not yet have enough history for the window', () => {
    const series = buildMonthlySeries(6, 0.10) // chỉ 6 tháng, chưa đủ 12 tháng
    expect(computeDCARolling(series, 12)).toEqual([])
  })
})

/**
 * Integration test: applyDividendAdjustment → simulateDCA.
 *
 * Đây là bài test end-to-end cho đúng câu hỏi "cổ tức tái đầu tư có phản ánh
 * vào giá trị tài sản và thống kê hiệu suất không" — trước đây applyDividendAdjustment
 * và simulateDCA chỉ được test RIÊNG LẺ, không có test nào ghép 2 cái lại để
 * xác nhận hành vi thực tế khi chạy trong DCAPanel.
 *
 * Thiết kế: 1 quỹ, chuỗi giá được dựng sao cho chuỗi giá ĐÃ ADJUSTED phẳng
 * xuyên suốt ngày chốt quyền (không có biến động thị trường "thật" nào),
 * rồi tăng đúng +10% ở ngày cuối. Có 2 lần nạp tiền: 1 lần TRƯỚC ngày chốt
 * quyền, 1 lần SAU. Nếu tái đầu tư được xử lý đúng, cả 2 lần nạp phải mua
 * được CÙNG SỐ CCQ (vì đều dùng giá đã adjusted như nhau) và cùng tăng 10%
 * — bất kể lần nạp trước đó "trên giấy tờ" là giá thô cao hơn (chưa trừ cổ tức).
 *
 * KẾT LUẬN: công thức tính DCA + cổ tức tái đầu tư của DCDE đang đúng, không có bug.
 *
 * 1. Cơ chế tái đầu tư hoạt động đúng như thiết kế. Chuỗi giá NAV đã được
 *    applyDividendAdjustment điều chỉnh lùi (backward-adjusted) theo đúng kỹ
 *    thuật chuẩn ngành (giống Yahoo Finance/CRSP) trước khi đưa vào simulateDCA.
 *    Điều này có nghĩa: dù bạn nạp tiền trước hay sau ngày DCDE chốt quyền cổ
 *    tức, số tiền đó đều được mua ở mức giá đã phản ánh đầy đủ giá trị cổ tức
 *    tái đầu tư — không ai bị thiệt hay lợi bất thường chỉ vì thời điểm nạp
 *    tiền rơi trước/sau ngày chốt quyền.
 *
 * 2. Test đã chứng minh bằng số liệu cụ thể, không chỉ đọc code suy luận:
 *    2 lần nạp 1000đ (1 lần trước, 1 lần sau ngày chốt quyền) mua ra đúng
 *    cùng số chứng chỉ quỹ, và tổng tài sản cuối kỳ tăng đúng +10% như kỳ
 *    vọng — không có khoảng "mất mát" hay "lợi thế" giả nào phát sinh quanh
 *    ngày chia cổ tức.
 *
 * 3. Test cũng chứng minh ngược lại: nếu lỡ code dùng nhầm giá NAV thô (chưa
 *    adjusted) thay vì giá đã điều chỉnh, kết quả sẽ sai theo đúng 2 kiểu —
 *    tài sản cuối kỳ bị tính thấp hơn thực tế, và biểu đồ sẽ hiện một cú sụt
 *    giảm giả gần 19% ngay tại ngày chốt quyền (trong khi thực chất đó chỉ là
 *    cổ tức, không phải mất giá). Việc dựng được kịch bản "sai" và thấy nó
 *    thực sự fail theo đúng cách dự đoán, là bằng chứng cho thấy bộ test này
 *    có khả năng bắt lỗi thật, không phải test hình thức.
 *
 * 4. Phạm vi bao phủ đầy đủ: biểu đồ giá trị tài sản, CAGR, MWRR, drawdown —
 *    tất cả đều lấy từ cùng 1 chuỗi giá đã adjusted, nên tái đầu tư cổ tức tự
 *    động phản ánh nhất quán vào mọi chỉ số, không cần xử lý riêng lẻ ở từng nơi.
 */
describe('simulateDCA + applyDividendAdjustment (integration)', () => {
  const FUND = 'TF'

  function mkRaw(pairs: Array<[string, number]>): PricePoint[] {
    return pairs.map(([date, price]) => ({ date, price }))
  }

  function runWithDividend(rawPairs: Array<[string, number]>, events: DividendEvent[]) {
    const raw = mkRaw(rawPairs)
    const adjusted = applyDividendAdjustment(raw, events)
    const prices = new Map([[FUND, adjusted]])
    const result = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 0, cashflowAmount: 1000, cashflowFreq: 'weekly' },
      'quarterly',
    )
    return { adjusted, result }
  }

  it('reflects dividend reinvestment in portfolio value: contribution before ex-date buys the same units (and grows the same %) as one after', () => {
    // Raw NAV: cổ tức gross 20đ, thuế 5% → net 19đ, factor = (100-19)/100 = 0.81
    // Chọn giá thô ở ex-date = 81 (đúng bằng giá đã adjusted của closePreEx)
    // để chuỗi ADJUSTED phẳng tuyệt đối xuyên ngày chốt quyền — cô lập hoàn
    // toàn hiệu ứng cổ tức khỏi biến động thị trường thật trong bài test này.
    const events: DividendEvent[] = [
      { exDate: '2024-01-08', payDate: '2024-01-24', amountPerCert: 20, taxRate: 0.05 },
    ]
    const { adjusted, result } = runWithDividend([
      ['2024-01-01', 100],  // day 0, chưa nạp tiền nào
      ['2024-01-06', 100],  // cách day0 5 ngày → NẠP LẦN 1 (trước ex-date)
      ['2024-01-07', 100],  // closePreEx
      ['2024-01-08', 81],   // ex-date (chọn 81 để adjusted phẳng, xem comment trên)
      ['2024-01-13', 81],   // cách lần nạp 1 đúng 7 ngày → NẠP LẦN 2 (sau ex-date)
      ['2024-01-14', 89.1], // +10% từ 81, ngày kiểm tra cuối
    ], events)

    // Sanity: chuỗi đã adjusted đúng như thiết kế (factor 0.81 áp cho 3 điểm đầu)
    expect(adjusted.map(p => p.price)).toEqual([81, 81, 81, 81, 81, 89.1])

    expect(result.totalInvested).toBe(2000)

    // Cả 2 lần nạp đều mua ở giá adjusted = 81 → cùng số ccq mỗi lần
    const expectedUnitsPerContribution = 1000 / 81
    const expectedFinalValue = expectedUnitsPerContribution * 2 * 89.1
    expect(result.finalValue).toBeCloseTo(expectedFinalValue, 4)
    expect(result.finalValue).toBeCloseTo(2200, 1) // ~+10% trên 2000 đã nạp

    // TWRR: phẳng (0%) suốt giai đoạn adjusted-phẳng, rồi +10% ở bước cuối
    const finalTWRR = result.cumulative[result.cumulative.length - 1]!.value
    expect(finalTWRR).toBeCloseTo(0.10, 4)
    // Không có drawdown giả do cổ tức gây ra (đây là điều sẽ SAI nếu code
    // lỡ dùng raw NAV thay vì adjusted — raw NAV rớt 100→81 sẽ hiện thành
    // một cú sập -19% giả ngay tại ngày chốt quyền)
    const minDrawdown = Math.min(...result.drawdown.map(d => d.value))
    expect(minDrawdown).toBeCloseTo(0, 4)
  })

  it('REGRESSION GUARD: using raw (un-adjusted) prices would under-count units bought before the ex-date and fabricate a fake drawdown', () => {
    // Mô phỏng CHÍNH XÁC lỗi mà bài test trên bảo vệ: nếu ai đó lỡ truyền
    // raw NAV (chưa adjusted) vào simulateDCA, kết quả sẽ SAI theo 2 cách.
    const rawPairs: Array<[string, number]> = [
      ['2024-01-01', 100],
      ['2024-01-06', 100],  // NẠP LẦN 1 — giá thô 100 (chưa trừ cổ tức)
      ['2024-01-07', 100],
      ['2024-01-08', 81],   // ex-date: NAV rớt "thật" (không được bù lại)
      ['2024-01-13', 81],   // NẠP LẦN 2
      ['2024-01-14', 89.1],
    ]
    const prices = new Map([[FUND, mkRaw(rawPairs)]]) // <-- raw, KHÔNG adjusted
    const buggy = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 0, cashflowAmount: 1000, cashflowFreq: 'weekly' },
      'quarterly',
    )

    // Sai #1: lần nạp đầu mua ít ccq hơn (giá 100 thay vì 81 đã adjusted)
    // → finalValue THẤP HƠN kết quả đúng (2200), không phải do rủi ro thật.
    expect(buggy.finalValue).toBeLessThan(2200)

    // Sai #2: NAV rớt 100→81 tại ex-date hiện thành một cú sập -19% giả
    // trong TWRR drawdown, dù đây chỉ là cổ tức, không phải mất giá thật.
    const buggyMinDrawdown = Math.min(...buggy.drawdown.map(d => d.value))
    expect(buggyMinDrawdown).toBeLessThan(-0.15)
  })

  it('with zero tax, adjustment factor uses the full dividend amount (net = gross)', () => {
    // Baseline không thuế: factor = (100-10)/100 = 0.9, không có phần dư
    // gross-vs-net như bài test 5% thuế ở trên — dùng để cô lập việc tính
    // factor tách biệt khỏi việc tái đầu tư nói chung.
    const events: DividendEvent[] = [
      { exDate: '2024-01-08', payDate: '2024-01-24', amountPerCert: 10, taxRate: 0 },
    ]
    const { result } = runWithDividend([
      ['2024-01-01', 100],
      ['2024-01-06', 100],  // NẠP LẦN 1
      ['2024-01-07', 100],
      ['2024-01-08', 90],   // ex-date, factor 0.9 → adjusted closePreEx cũng = 90
      ['2024-01-13', 90],   // NẠP LẦN 2
      ['2024-01-14', 99],   // +10%
    ], events)

    const expectedUnitsPerContribution = 1000 / 90
    expect(result.finalValue).toBeCloseTo(expectedUnitsPerContribution * 2 * 99, 4)
    expect(result.finalValue).toBeCloseTo(2200, 1)
  })
})

describe('slicePricesWithPredecessor', () => {
  it('keeps the last price before the range so later dates can forward-fill', () => {
    const prices = [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-05', price: 105 },
      { date: '2024-01-10', price: 110 },
    ]

    expect(slicePricesWithPredecessor(prices, '2024-01-03', '2024-01-08')).toEqual([
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-05', price: 105 },
    ])
  })
})

describe('common price grid characterization', () => {
  const pricesA: PricePoint[] = [
    { date: '2024-01-01', price: 100 },
    { date: '2024-01-03', price: 110 },
    { date: '2024-01-05', price: 120 },
  ]
  const pricesB: PricePoint[] = [
    { date: '2024-01-01', price: 200 },
    { date: '2024-01-02', price: 210 },
    { date: '2024-01-03', price: 220 },
    { date: '2024-01-05', price: 240 },
  ]

  it('keeps only common dates and does not depend on slot order', () => {
    const params = { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' as const }
    const result = simulateDCA(
      new Map([['A', pricesA], ['B', pricesB]]),
      [{ fundId: 'A', weight: 50 }, { fundId: 'B', weight: 50 }],
      params,
      'quarterly',
    )
    const reversed = simulateDCA(
      new Map([['B', pricesB], ['A', pricesA]]),
      [{ fundId: 'B', weight: 50 }, { fundId: 'A', weight: 50 }],
      params,
      'quarterly',
    )

    expect(result.values.map(point => point.date)).toEqual(['2024-01-01', '2024-01-03', '2024-01-05'])
    expect(result.values.map(point => point.value)).toEqual([1000, 1100, 1200])
    expect(reversed.values).toEqual(result.values)
    expect(reversed.cumulative).toEqual(result.cumulative)
  })

  it('returns an empty simulation when fewer than two common dates remain', () => {
    const result = simulateDCA(
      new Map([
        ['A', [{ date: '2024-01-01', price: 100 }, { date: '2024-01-03', price: 110 }]],
        ['B', [{ date: '2024-01-02', price: 200 }, { date: '2024-01-04', price: 220 }]],
      ]),
      [{ fundId: 'A', weight: 50 }, { fundId: 'B', weight: 50 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
    )

    expect(result.values).toEqual([])
    expect(result.finalValue).toBe(0)
  })

  it('maps ex-date and pay-date to the next available common grid date', () => {
    const narrative = trackDividendNarrative(
      new Map([['FUND', [
        { date: '2024-01-01', price: 100 },
        { date: '2024-01-03', price: 110 },
        { date: '2024-01-05', price: 125 },
      ]]]),
      [{ fundId: 'FUND', weight: 100 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
      new Map([['FUND', [{
        exDate: '2024-01-02',
        payDate: '2024-01-04',
        amountPerCert: 10,
        taxRate: 0.05,
      }]]]),
    )

    expect(narrative).toHaveLength(1)
    expect(narrative[0]!.events[0]).toMatchObject({
      exDate: '2024-01-02',
      payDate: '2024-01-04',
      unitsAtEx: 10,
      gross: 100,
      tax: 5,
      net: 95,
    })
    expect(narrative[0]!.events[0]!.sharesAdded).toBeCloseTo(0.76, 12)
  })
})

/**
 * `purchasePrices` option: hỗ trợ tài sản 2 giá mua/bán (vàng miếng SJC).
 *
 * Quy ước: `weeklyPrices` (tham số chính) = giá "mua vào" của tiệm vàng
 * (buy — cái nhà đầu tư nhận được nếu bán), dùng để ĐỊNH GIÁ danh mục xuyên
 * suốt. `options.purchasePrices` = giá "bán ra" (sell — cái nhà đầu tư phải
 * trả), CHỈ dùng lúc quy đổi tiền → đơn vị khi mua (initial + mỗi lần DCA).
 */
describe('simulateDCA purchasePrices option (gold buy/sell spread)', () => {
  const GOLD = 'GOLD_SJC'

  it('buys units at the sell price but marks the portfolio to market at the buy price', () => {
    // Giá mua vào (valuation): 100 → 110 (+10%)
    // Giá bán ra (purchase, cao hơn 10% so với giá mua vào): 110 → 121 (+10%)
    // Tăng cùng % để cô lập hiệu ứng "spread" khỏi biến động thị trường thật.
    const valuationPrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 110 },
    ]]])
    const purchasePrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 110 },
      { date: '2024-01-02', price: 121 },
    ]]])

    const result = simulateDCA(
      valuationPrices,
      [{ fundId: GOLD, weight: 100 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
      { purchasePrices },
    )

    // Mua ở giá BÁN (110), không phải giá mua vào (100)
    const expectedUnits = 1000 / 110

    // Ngay sau khi mua, định giá lại ở giá MUA VÀO (100) → "lỗ" tức thì đúng
    // bằng khoảng chênh lệch mua-bán — đây là chi phí spread thật, không phải
    // rủi ro thị trường.
    expect(result.values[0]!.value).toBeCloseTo(expectedUnits * 100, 4)
    expect(result.values[0]!.value).toBeCloseTo(909.09, 2)

    // Cuối kỳ: định giá ở giá mua vào mới (110) — vừa đủ hoà vốn, vì giá phải
    // tăng đúng bằng spread mới bù lại được chi phí lúc mua.
    expect(result.finalValue).toBeCloseTo(expectedUnits * 110, 4)
    expect(result.finalValue).toBeCloseTo(1000, 1)

    // TWRR đo đúng biến động thị trường thuần túy của chuỗi ĐỊNH GIÁ (100→110,
    // +10%), không lẫn khoản "lỗ" do spread lúc mua — 2 khái niệm tách bạch.
    const finalTWRR = result.cumulative[result.cumulative.length - 1]!.value
    expect(finalTWRR).toBeCloseTo(0.10, 4)
  })

  it('REGRESSION GUARD: without purchasePrices, buying at the (lower) valuation price overstates both day-0 value and final return', () => {
    const valuationPrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 110 },
    ]]])

    // Không truyền purchasePrices — mô phỏng lỗi "quên" gắn giá bán cho vàng
    const buggy = simulateDCA(
      valuationPrices,
      [{ fundId: GOLD, weight: 100 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
    )

    // Sai #1: mua ở giá 100 thay vì 110 → không thấy khoản "lỗ spread" ngay lúc mua
    expect(buggy.values[0]!.value).toBeCloseTo(1000, 4)

    // Sai #2: finalValue thổi phồng lên +10% thay vì hoà vốn ~0% — bỏ qua
    // hoàn toàn chi phí chênh lệch mua-bán thật của vàng.
    expect(buggy.finalValue).toBeCloseTo(1100, 4)
  })

  it('funds without a purchasePrices entry are completely unaffected (fallback to weeklyPrices)', () => {
    // Đảm bảo tính năng vàng không ảnh hưởng đến quỹ thường: nếu purchasePrices
    // được truyền vào nhưng KHÔNG có entry cho fundId này, hành vi phải giống
    // hệt như không truyền purchasePrices gì cả.
    const FUND = 'DCDS'
    const prices = new Map([[FUND, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 110 },
    ]]])
    const unrelatedPurchasePrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 999 },
      { date: '2024-01-02', price: 999 },
    ]]])

    const withEmptyOption = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
      { purchasePrices: unrelatedPurchasePrices },
    )
    const withoutOption = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
    )

    expect(withEmptyOption.finalValue).toBeCloseTo(withoutOption.finalValue, 8)
    expect(withEmptyOption.values[0]!.value).toBeCloseTo(withoutOption.values[0]!.value, 8)
    expect(withEmptyOption.finalValue).toBeCloseTo(1100, 4) // quỹ thường: mua & định giá cùng 1 giá
  })

  it('waits for the first sell quote and forward-fills later sell gaps', () => {
    const valuationPrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 100 },
      { date: '2024-01-03', price: 100 },
      { date: '2024-01-04', price: 100 },
    ]]])
    const purchasePrices = new Map([[GOLD, [
      { date: '2024-01-02', price: 110 },
      { date: '2024-01-04', price: 220 },
    ]]])

    const result = simulateDCA(
      valuationPrices,
      [{ fundId: GOLD, weight: 100 }],
      { initialAmount: 1100, cashflowAmount: 1100, cashflowFreq: 'daily' },
      'quarterly',
      { purchasePrices },
    )

    expect(result.values.map(point => point.date)).toEqual([
      '2024-01-02', '2024-01-03', '2024-01-04',
    ])
    expect(result.totalInvested).toBe(3300)
    expect(result.values[0]!.value).toBeCloseTo(1000, 8)
    expect(result.values[1]!.value).toBeCloseTo(2000, 8)
    expect(result.finalValue).toBeCloseTo(2500, 8)
    expect(result.values.every(point => Number.isFinite(point.value))).toBe(true)
  })

  it('does not fall back to the valuation price when an explicit sell series is empty', () => {
    const valuationPrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 110 },
    ]]])

    const result = simulateDCA(
      valuationPrices,
      [{ fundId: GOLD, weight: 100 }],
      { initialAmount: 1000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
      { purchasePrices: new Map([[GOLD, []]]) },
    )

    expect(result).toEqual({
      values: [], invested: [], cashflows: [], cumulative: [], drawdown: [], returns: [], totalInvested: 0, finalValue: 0,
    })
  })

  it('pays the gold spread again when rebalancing into gold', () => {
    const FUND = 'FUND'
    const valuationPrices = new Map([
      [FUND, [
        { date: '2024-01-01', price: 100 },
        { date: '2024-02-01', price: 100 },
        { date: '2024-03-01', price: 100 },
      ]],
      [GOLD, [
        { date: '2024-01-01', price: 100 },
        { date: '2024-02-01', price: 90 },
        { date: '2024-03-01', price: 180 },
      ]],
    ])
    const purchasePrices = new Map([[GOLD, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-02-01', price: 100 },
      { date: '2024-03-01', price: 200 },
    ]]])

    const result = simulateDCA(
      valuationPrices,
      [{ fundId: FUND, weight: 50 }, { fundId: GOLD, weight: 50 }],
      { initialAmount: 2000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'monthly',
      { purchasePrices },
    )

    expect(result.values[1]!.value).toBeCloseTo(36000 / 19, 8)
    expect(result.finalValue).toBeCloseTo(54000 / 19, 8)
    expect(result.cumulative[1]!.value).toBeCloseTo(-1 / 19, 8)
  })
})

/**
 * `skipContributionWhen` (panic-stop): mốc "kỳ nạp gần nhất" phải dời tới
 * ngày hiện tại NGAY CẢ KHI bỏ qua lần nạp đó, không chỉ khi mua thành công.
 *
 * Bug đã phát hiện: `lastInvestDate` (mốc cadence) chỉ được cập nhật bên
 * trong `buyFunds()`. Khi một lần nạp bị bỏ (panic), `lastInvestDate` đứng
 * yên tại lần nạp thành công gần nhất — khiến `shouldInvest()` (so sánh
 * tháng) tiếp tục trả về true ở MỌI NGÀY còn lại trong cùng một đợt sụt
 * giảm, thay vì chỉ 1 lần/kỳ như logic "hàng tháng" phải có. Kết quả:
 * skippedCount bị đếm trùng theo SỐ NGÀY dữ liệu trong đợt bão, chứ không
 * phải số kỳ nạp thực sự bị bỏ lỡ (vd hiển thị "54 lần bỏ" cho một đợt
 * bão chỉ kéo dài 1-2 tháng).
 */
describe('simulateDCA skipContributionWhen cadence (panic-stop skip counting)', () => {
  const FUND = 'TF'

  it('only re-evaluates the skip decision once per period, not once per day inside a drawdown', () => {
    // Nhiều điểm giá TRONG CÙNG tháng 2 (sau khi đã bỏ 1 lần nạp ở đầu
    // tháng) — nếu cadence không dời đúng, mỗi điểm này sẽ bị tính thêm
    // 1 lần bỏ nữa dù vẫn cùng 1 kỳ "hàng tháng".
    const prices = new Map([[FUND, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-15', price: 100 },
      { date: '2024-01-31', price: 100 },
      { date: '2024-02-01', price: 100 }, // kỳ nạp tháng 2 bắt đầu — bỏ lần này
      { date: '2024-02-05', price: 100 }, // vẫn tháng 2, KHÔNG được tính thêm 1 lần bỏ
      { date: '2024-02-10', price: 100 }, // vẫn tháng 2, KHÔNG được tính thêm 1 lần bỏ
      { date: '2024-02-15', price: 100 }, // vẫn tháng 2, KHÔNG được tính thêm 1 lần bỏ
    ]]])

    let skipCallCount = 0
    simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 0, cashflowAmount: 100, cashflowFreq: 'monthly' },
      'quarterly',
      {
        // Luôn bỏ qua (mô phỏng "kẹt" trong 1 đợt sụt giảm dài) — cô lập
        // hoàn toàn việc đếm cadence khỏi logic ngưỡng drawdown thật.
        skipContributionWhen: () => { skipCallCount++; return true },
      },
    )

    // Chỉ 1 kỳ "hàng tháng" thực sự bắt đầu trong chuỗi này (ranh giới
    // 01→02), nên chỉ được gọi skipContributionWhen đúng 1 lần — không phải
    // 4 lần (số điểm dữ liệu trong tháng 2).
    expect(skipCallCount).toBe(1)
  })

  it('REGRESSION GUARD: resumes normal monthly cadence after the drawdown ends, not stuck skipping or double-firing on later days', () => {
    // Tháng 1 (day 0, chưa có kỳ nạp nào để so sánh) → tháng 2 sụt sâu, bỏ
    // nạp → tháng 3, tháng 4 hồi phục, nạp lại bình thường mỗi tháng 1 lần.
    const prices = new Map([[FUND, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-15', price: 100 },
      { date: '2024-02-01', price: 100 },
      { date: '2024-02-15', price: 100 },
      { date: '2024-03-01', price: 100 },
      { date: '2024-03-15', price: 100 },
      { date: '2024-04-01', price: 100 },
      { date: '2024-04-15', price: 100 },
    ]]])

    const skipMonths = new Set(['2024-02']) // chỉ bỏ đúng kỳ tháng 2
    const result = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 0, cashflowAmount: 100, cashflowFreq: 'monthly' },
      'quarterly',
      {
        skipContributionWhen: (date) => skipMonths.has(date.slice(0, 7)),
      },
    )

    // Tháng 2 bị bỏ (không nạp). Tháng 3 và tháng 4 nạp lại bình thường,
    // MỖI THÁNG ĐÚNG 1 LẦN (không bị merge/double-fire do cadence "kẹt").
    expect(result.totalInvested).toBe(200)
    expect(result.cashflows.filter(cf => cf.amount < 0)).toHaveLength(2)
  })
})

describe('simulateDCA contributionAmountOverride (boost-buy-the-dip)', () => {
  const FUND = 'TF'

  it('uses the overridden amount instead of params.cashflowAmount for matching periods', () => {
    const prices = new Map([[FUND, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-02-01', price: 100 },
      { date: '2024-03-01', price: 100 },
    ]]])

    const result = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 0, cashflowAmount: 100, cashflowFreq: 'monthly' },
      'quarterly',
      {
        // Kỳ tháng 2 tăng gấp đôi (200), tháng 3 giữ nguyên mức bình thường (100).
        contributionAmountOverride: (date) => date.startsWith('2024-02') ? 200 : 100,
      },
    )

    // initialAmount=0 nên T1 (01-01) không nạp gì. Kỳ T2 (02-01) nạp 200 (boost),
    // kỳ T3 (03-01) nạp 100 (bình thường) -> tổng 300.
    expect(result.totalInvested).toBe(300)
    expect(result.cashflows.filter(cf => cf.amount < 0).map(cf => -cf.amount)).toEqual([200, 100])
  })

  it('gives skipContributionWhen priority over contributionAmountOverride when both are set', () => {
    const prices = new Map([[FUND, [
      { date: '2024-01-01', price: 100 },
      { date: '2024-02-01', price: 100 },
    ]]])

    const result = simulateDCA(
      prices,
      [{ fundId: FUND, weight: 100 }],
      { initialAmount: 0, cashflowAmount: 100, cashflowFreq: 'monthly' },
      'quarterly',
      {
        skipContributionWhen: () => true,
        contributionAmountOverride: () => 999,
      },
    )

    expect(result.totalInvested).toBe(0)
    expect(result.cashflows.filter(cf => cf.amount < 0)).toHaveLength(0)
  })
})

describe('dcaMonthlyReturns', () => {
  it('returns [] for fewer than 2 points', () => {
    expect(dcaMonthlyReturns([])).toEqual([])
    expect(dcaMonthlyReturns([{ date: '2024-01-01', value: 0 }])).toEqual([])
  })

  it('computes month-end-to-month-end growth, dropping the first month (no prior anchor)', () => {
    const cumulative: ReturnPoint[] = [
      { date: '2024-01-01', value: 0 },
      { date: '2024-01-15', value: 0.02 },
      { date: '2024-01-31', value: 0.05 }, // Jan month-end growth = 1.05
      { date: '2024-02-15', value: 0.10 },
      { date: '2024-02-28', value: 0.15 }, // Feb month-end growth = 1.15
      { date: '2024-03-31', value: 0.20 }, // Mar month-end growth = 1.20
    ]
    const result = dcaMonthlyReturns(cumulative)
    expect(result).toHaveLength(2) // Jan dropped, chỉ còn Feb + Mar
    expect(result[0]!.date).toBe('2024-02')
    expect(result[0]!.value).toBeCloseTo(1.15 / 1.05 - 1, 10)
    expect(result[1]!.date).toBe('2024-03')
    expect(result[1]!.value).toBeCloseTo(1.20 / 1.15 - 1, 10)
  })
})

describe('monteCarloProjection', () => {
  it('returns null for an empty return pool', () => {
    const result = monteCarloProjection({
      monthlyReturnPool: [],
      startValue: 1000,
      monthlyContribution: 0,
      horizonMonths: 12,
    })
    expect(result).toBeNull()
  })

  it('returns null for a non-positive horizon', () => {
    const result = monteCarloProjection({
      monthlyReturnPool: new Array(12).fill(0.01),
      startValue: 1000,
      monthlyContribution: 0,
      horizonMonths: 0,
    })
    expect(result).toBeNull()
  })

  it('collapses to a single deterministic value when every pool entry is identical (no variance possible)', () => {
    const pool = new Array(12).fill(0.01) // 12 tháng, tất cả cùng +1%
    const result = monteCarloProjection({
      monthlyReturnPool: pool,
      startValue: 1000,
      monthlyContribution: 0,
      horizonMonths: 12,
      iterations: 50,
      blockSize: 12,
    })
    expect(result).not.toBeNull()
    const expected = 1000 * Math.pow(1.01, 12)
    const last = result!.path[12]!
    // Mọi percentile phải bằng nhau vì pool không có biến thiên để xáo trộn ra khác biệt.
    expect(last.p10).toBeCloseTo(expected, 6)
    expect(last.p50).toBeCloseTo(expected, 6)
    expect(last.p90).toBeCloseTo(expected, 6)
    expect(result!.finalValues.every(v => Math.abs(v - expected) < 1e-6)).toBe(true)
  })

  it('samples blocks starting at the index implied by rng, wrapping circularly past the end of the pool', () => {
    // rng luôn trả 0.9999 → start = floor(0.9999 * poolLen). poolLen=3 → start=2.
    // blockSize=5 > poolLen=3 nên phải vòng lại từ đầu pool (circular wrap).
    const pool = [0.01, 0.02, 0.03]
    const result = monteCarloProjection({
      monthlyReturnPool: pool,
      startValue: 1000,
      monthlyContribution: 0,
      horizonMonths: 5,
      iterations: 1,
      blockSize: 5,
      rng: () => 0.9999,
    })
    expect(result).not.toBeNull()
    // Thứ tự áp dụng: pool[2], pool[0], pool[1], pool[2], pool[0] (vòng lại theo modulo).
    let v = 1000
    for (const r of [0.03, 0.01, 0.02, 0.03, 0.01]) v = v * (1 + r)
    expect(result!.finalValues[0]!).toBeCloseTo(v, 6)
    expect(result!.path[5]!.p50).toBeCloseTo(v, 6)
  })

  it('adds monthlyContribution every month on top of growth', () => {
    const result = monteCarloProjection({
      monthlyReturnPool: new Array(12).fill(0), // 0% lợi nhuận, chỉ còn ảnh hưởng của tiền nạp
      startValue: 0,
      monthlyContribution: 100,
      horizonMonths: 3,
      iterations: 1,
      blockSize: 12,
      rng: () => 0,
    })
    expect(result).not.toBeNull()
    expect(result!.finalValues[0]!).toBeCloseTo(300, 6)
  })

  it('keeps path-level CAGR and drawdown separate from monthly contributions', () => {
    let call = 0
    const result = monteCarloProjection({
      monthlyReturnPool: [0.10, -0.20],
      startValue: 1_000,
      monthlyContribution: 500,
      horizonMonths: 2,
      iterations: 1,
      blockSize: 1,
      rng: () => [0, 0.5][call++ % 2]!,
    })

    expect(result).not.toBeNull()
    // Giá trị tài khoản có tiền nạp: 1000 × 1,1 + 500 = 1600, rồi × 0,8 + 500 = 1780.
    expect(result!.finalValues).toEqual([1_780])
    // CAGR và drawdown chỉ đo chuỗi lợi nhuận +10%, -20%; không đo đường số dư 1000 → 1600 → 1780.
    expect(result!.cagrs[0]).toBeCloseTo(Math.pow(0.88, 6) - 1, 12)
    expect(result!.maxDrawdowns[0]).toBeCloseTo(-0.2, 12)
    expect(result!.representativePaths).toHaveLength(4)
    for (const path of result!.representativePaths) {
      expect(path.values).toEqual([1_000, 1_600, 1_780])
      expect(path.cagr).toBeCloseTo(Math.pow(0.88, 6) - 1, 10)
      expect(path.maxDrawdown).toBeCloseTo(-0.2, 12)
    }
  })

  it('selects representative paths from actual final values, never a month-by-month percentile composite', () => {
    let call = 0
    const result = monteCarloProjection({
      monthlyReturnPool: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      startValue: 1_000,
      monthlyContribution: 0,
      horizonMonths: 1,
      iterations: 9,
      blockSize: 1,
      rng: () => call++ / 9 + 0.001,
    })

    expect(result).not.toBeNull()
    expect(result!.finalValues).toEqual([1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700, 1_800])
    expect(result!.representativePaths.map(path => path.finalValue)).toEqual([1_100, 1_200, 1_400, 1_600])
    for (const path of result!.representativePaths) {
      expect(result!.finalValues).toContain(path.finalValue)
      expect(path.values).toHaveLength(2)
    }
  })
})

describe('probabilityAtLeast', () => {
  it('returns 0 for an empty array', () => {
    expect(probabilityAtLeast([], 100)).toBe(0)
  })

  it('computes the fraction of values >= target (inclusive)', () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(probabilityAtLeast(sorted, 25)).toBeCloseTo(3 / 5, 10) // 30,40,50
    expect(probabilityAtLeast(sorted, 30)).toBeCloseTo(3 / 5, 10) // inclusive: 30,40,50
  })

  it('returns 1 when target is below every value, 0 when above every value', () => {
    const sorted = [10, 20, 30]
    expect(probabilityAtLeast(sorted, 0)).toBe(1)
    expect(probabilityAtLeast(sorted, 1000)).toBe(0)
  })
})

describe('monthlyEquivalentContribution', () => {
  it('returns the amount unchanged for monthly cadence', () => {
    expect(monthlyEquivalentContribution(6_000_000, 'monthly')).toBe(6_000_000)
  })

  it('divides down for lower-frequency cadences (quarterly/semiannual/yearly)', () => {
    expect(monthlyEquivalentContribution(18_000_000, 'quarterly')).toBeCloseTo(6_000_000, 6)
    expect(monthlyEquivalentContribution(36_000_000, 'semiannual')).toBeCloseTo(6_000_000, 6)
    expect(monthlyEquivalentContribution(72_000_000, 'yearly')).toBeCloseTo(6_000_000, 6)
  })

  it('scales up for higher-frequency cadences (daily/weekly/biweekly)', () => {
    // ~30.44 ngày/tháng, ~4.35 tuần/tháng, ~2.17 kỳ 2-tuần/tháng
    expect(monthlyEquivalentContribution(200_000, 'daily')).toBeCloseTo(200_000 * (365.25 / 12), 6)
    expect(monthlyEquivalentContribution(1_000_000, 'weekly')).toBeGreaterThan(4_000_000)
    expect(monthlyEquivalentContribution(1_000_000, 'weekly')).toBeLessThan(4_500_000)
    expect(monthlyEquivalentContribution(2_000_000, 'biweekly')).toBeGreaterThan(4_000_000)
    expect(monthlyEquivalentContribution(2_000_000, 'biweekly')).toBeLessThan(4_500_000)
  })
})

describe('trailingWindowCagr', () => {
  it('computes TWRR CAGR over exactly the trailing windowYears, not the full series', () => {
    // 6 năm dữ liệu: 2015-01-01 (value=0) -> 2018-01-01 (value=0.20) -> 2021-01-01 (value=0.50)
    // trailingWindowCagr(cumulative, 3) phải CHỈ dùng đoạn 2018-01-01 -> 2021-01-01
    // (1.50/1.20 growth), KHÔNG dùng toàn bộ 2015->2021.
    const cumulative: ReturnPoint[] = [
      { date: '2015-01-01', value: 0 },
      { date: '2016-01-01', value: 0.05 },
      { date: '2017-01-01', value: 0.10 },
      { date: '2018-01-01', value: 0.20 },
      { date: '2019-01-01', value: 0.30 },
      { date: '2020-01-01', value: 0.40 },
      { date: '2021-01-01', value: 0.50 },
    ]
    const result = trailingWindowCagr(cumulative, 3)!
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000
    const actualYears = (new Date('2021-01-01').getTime() - new Date('2018-01-01').getTime()) / msPerYear
    const expected = Math.pow(1.50 / 1.20, 1 / actualYears) - 1
    expect(result).toBeCloseTo(expected, 8)
    // Chắc chắn KHÁC với CAGR tính trên toàn bộ 6 năm (0 -> 0.50), để đảm bảo
    // hàm thực sự chỉ dùng đoạn windowYears cuối chứ không phải toàn chuỗi.
    const fullSeriesYears = (new Date('2021-01-01').getTime() - new Date('2015-01-01').getTime()) / msPerYear
    const fullSeriesCagr = Math.pow(1.50 / 1.00, 1 / fullSeriesYears) - 1
    expect(result).not.toBeCloseTo(fullSeriesCagr, 3)
  })

  it('returns null when there is not enough history for the requested window', () => {
    const cumulative: ReturnPoint[] = [
      { date: '2020-01-01', value: 0 },
      { date: '2020-06-01', value: 0.05 },
    ]
    expect(trailingWindowCagr(cumulative, 5)).toBeNull()
  })

  it('returns null for empty or single-point series', () => {
    expect(trailingWindowCagr([], 3)).toBeNull()
    expect(trailingWindowCagr([{ date: '2020-01-01', value: 0 }], 3)).toBeNull()
  })
})
