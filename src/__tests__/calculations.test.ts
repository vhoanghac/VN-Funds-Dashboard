import { describe, it, expect } from 'vitest'
import {
  weeklyReturns,
  cumulativeReturns,
  cagr,
  maxDrawdown,
  worstWeeklyReturn,
  worstMonthlyReturn,
  drawdownSeries,
  yearlyReturns,
  monthlyReturns,
  winRateAmong,
  rollingReturns,
  rollingAverage,
  availableRollingPeriods,
  rollingReturnDistribution,
  rollingCumulativeReturns,
  rollingAnnualizedStdev,
  rollingMaxDrawdown,
  rollingWinRate,
  rollingCumulativeReturnsMap,
  winRateAgainstRolledB,
  annualizedStdev,
} from '../utils/calculations'
import { simulateMultiFundPortfolio } from '../utils/portfolio'
import type { ReturnPoint, YearlyReturn } from '../types'

// ─── Helpers ────────────────────────────────────────────────

function makeReturns(dates: string[], values: number[]): ReturnPoint[] {
  return dates.map((date, i) => ({ date, value: values[i]! }))
}

// ─── weeklyReturns ───────────────────────────────────────────

describe('weeklyReturns', () => {
  it('computes price[i] / price[i-1] - 1 for each step', () => {
    // 100 → 110 = +10%, 110 → 99 = -11/110 = -10%, 99 → 108 = 9/99 ≈ +9.09%
    const dates = ['2021-01-01', '2021-01-08', '2021-01-15', '2021-01-22']
    const prices = [100, 110, 99, 108]
    const result = weeklyReturns(dates, prices)

    expect(result).toHaveLength(3)
    expect(result[0]!.date).toBe('2021-01-08')
    expect(result[0]!.value).toBeCloseTo(0.1, 10)
    expect(result[1]!.value).toBeCloseTo(-11 / 110, 10)
    expect(result[2]!.value).toBeCloseTo(9 / 99, 10)
  })

  it('returns empty for a single price', () => {
    expect(weeklyReturns(['2021-01-01'], [100])).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(weeklyReturns([], [])).toEqual([])
  })

  it('skips step where previous price is 0', () => {
    const dates = ['2021-01-01', '2021-01-08', '2021-01-15']
    const prices = [0, 100, 110]
    const result = weeklyReturns(dates, prices)
    // First step skipped (prev = 0), second step: 110/100 - 1 = 0.1
    expect(result).toHaveLength(1)
    expect(result[0]!.date).toBe('2021-01-15')
    expect(result[0]!.value).toBeCloseTo(0.1, 10)
  })
})

// ─── cumulativeReturns ───────────────────────────────────────

describe('cumulativeReturns', () => {
  it('compounds returns correctly', () => {
    // +10%, -10%, +25%
    // step1: 1.0 * 1.1 - 1 = 0.1
    // step2: 1.1 * 0.9 - 1 = 0.99 - 1 = -0.01
    // step3: 0.99 * 1.25 - 1 = 1.2375 - 1 = 0.2375
    const returns = makeReturns(
      ['2021-01-08', '2021-01-15', '2021-01-22'],
      [0.1, -0.1, 0.25],
    )
    const result = cumulativeReturns(returns)

    expect(result).toHaveLength(3)
    expect(result[0]!.value).toBeCloseTo(0.1, 10)
    expect(result[1]!.value).toBeCloseTo(-0.01, 10)
    expect(result[2]!.value).toBeCloseTo(0.2375, 10)
  })

  it('is geometric (not arithmetic) compounding', () => {
    // +50% then -50%: arithmetic avg = 0%, actual = -25%
    const returns = makeReturns(['2021-01-08', '2021-01-15'], [0.5, -0.5])
    const result = cumulativeReturns(returns)

    expect(result[1]!.value).toBeCloseTo(-0.25, 10) // not 0
  })

  it('prepends a 0% point when startDate is provided', () => {
    const returns = makeReturns(['2021-01-08', '2021-01-15'], [0.1, 0.2])
    const result = cumulativeReturns(returns, '2021-01-01')

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ date: '2021-01-01', value: 0 })
    expect(result[1]!.value).toBeCloseTo(0.1, 10)
  })

  it('returns empty for empty input', () => {
    expect(cumulativeReturns([])).toEqual([])
  })
})

// ─── cagr ────────────────────────────────────────────────────

describe('cagr', () => {
  it('is geometric not arithmetic: (+50%, -50%) ≠ 0%', () => {
    // growth = 1.5 * 0.5 = 0.75 → negative CAGR, not 0
    const returns = makeReturns(['2021-01-01', '2022-01-01'], [0.5, -0.5])
    const result = cagr(returns)

    expect(result).not.toBeNull()
    expect(result!).toBeLessThan(0) // definitely not 0%
    expect(result!).toBeCloseTo(-0.25, 1) // around -25%
  })

  it('annualizes correctly over ~10 years', () => {
    // 10 returns of +10% each, first date 2012-01-02, last date 2022-01-02
    // growth = 1.1^10 ≈ 2.5937
    // 3653 days / 365.25 = 9.9986 years
    // CAGR ≈ 10%
    const dates = [
      '2012-01-02', '2013-01-07', '2014-01-06', '2015-01-05', '2016-01-04',
      '2017-01-02', '2018-01-01', '2019-01-07', '2020-01-06', '2022-01-02',
    ]
    const result = cagr(makeReturns(dates, Array(10).fill(0.1)))

    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.1, 2) // ≈ 10%
  })

  it('returns null for empty returns', () => {
    expect(cagr([])).toBeNull()
  })

  it('returns null when start and end date are the same (0 years)', () => {
    const returns = makeReturns(['2021-01-01'], [0.1])
    expect(cagr(returns)).toBeNull()
  })
})

// ─── maxDrawdown ─────────────────────────────────────────────

describe('maxDrawdown', () => {
  it('computes peak-to-trough correctly', () => {
    // +50% then -50%: peak = 1.5, trough = 0.75, DD = 0.75/1.5 - 1 = -0.5
    const returns = makeReturns(['2021-01-08', '2021-01-15'], [0.5, -0.5])
    expect(maxDrawdown(returns)).toBeCloseTo(-0.5, 10)
  })

  it('resets peak when new high is reached', () => {
    // -10%, +20%, -5%
    // step1: growth=0.9, peak=1.0, dd=-0.1
    // step2: growth=1.08, peak=1.08, dd=0   ← new high, peak resets
    // step3: growth=1.026, peak=1.08, dd=1.026/1.08-1 ≈ -0.05
    // maxDD = -0.1 (from step 1, before the new high)
    const returns = makeReturns(
      ['2021-01-08', '2021-01-15', '2021-01-22'],
      [-0.1, 0.2, -0.05],
    )
    expect(maxDrawdown(returns)).toBeCloseTo(-0.1, 10)
  })

  it('picks the deepest drawdown across multiple troughs', () => {
    // +10%, -20%, +30%, -10%
    // growth: 1.1, 0.88, 1.144, 1.0296
    // peak:   1.1, 1.1,  1.144, 1.144
    // dd:     0,  -0.2,  0,    -0.0999...
    // maxDD = -0.2
    const returns = makeReturns(
      ['2021-01-08', '2021-01-15', '2021-01-22', '2021-01-29'],
      [0.1, -0.2, 0.3, -0.1],
    )
    expect(maxDrawdown(returns)).toBeCloseTo(-0.2, 10)
  })

  it('returns 0 for all positive returns', () => {
    const returns = makeReturns(['2021-01-08', '2021-01-15'], [0.1, 0.2])
    expect(maxDrawdown(returns)).toBe(0)
  })

  it('returns 0 for empty input', () => {
    expect(maxDrawdown([])).toBe(0)
  })
})

// ─── worstWeeklyReturn / worstMonthlyReturn ─────────────────

describe('worstWeeklyReturn / worstMonthlyReturn', () => {
  it('worstWeeklyReturn compounds a multi-day losing streak on DAILY data, not just the single worst day', () => {
    // 5 ngày liên tiếp -2%, rồi 2 ngày +1% — dữ liệu daily (cách nhau 1 ngày).
    // Tệ nhất 1 NGÀY = -2%. Nhưng tệ nhất cửa sổ 7-ngày-lịch phải gộp cả 5
    // ngày lỗ liên tiếp (span 4 ngày, nằm trong 7 ngày): 0.98^5 - 1 ≈ -9.61%.
    // Đây chính là bug đã sửa: code cũ coi "1 phần tử = 1 tuần" nên chỉ trả
    // về -2% (giống hệt kết quả của 1 ngày tệ nhất), thấp hơn thực tế >4 lần.
    const dates = ['2021-01-02', '2021-01-03', '2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08']
    const values = [-0.02, -0.02, -0.02, -0.02, -0.02, 0.01, 0.01]
    const returns = makeReturns(dates, values)
    const expected = Math.pow(0.98, 5) - 1 // ≈ -0.096079
    expect(worstWeeklyReturn(returns)).toBeCloseTo(expected, 6)
    // Phải khác xa (tệ hơn nhiều) so với "tệ nhất 1 ngày đơn lẻ" (-0.02) —
    // nếu bug quay lại (coi mỗi phần tử là 1 tuần), test này sẽ fail vì
    // worstWeeklyReturn sẽ chỉ trả về -0.02.
    expect(worstWeeklyReturn(returns)).toBeLessThan(-0.02)
  })

  it('worstWeeklyReturn does NOT merge two periods that are exactly 7 calendar days apart (genuinely-weekly input)', () => {
    // Dữ liệu weekly thật (cách nhau đúng 7 ngày): mỗi phần tử tự nó đã là
    // "1 tuần". Tệ nhất cửa sổ 7 ngày phải là tệ nhất TỪNG phần tử riêng lẻ
    // (-5%), KHÔNG được gộp 2 tuần liền kề lại thành cửa sổ 14 ngày (sẽ ra
    // một số sai khác, sâu hơn nhiều so với -5%).
    const dates = ['2021-01-01', '2021-01-08', '2021-01-15', '2021-01-22']
    const values = [0.03, -0.05, 0.02, -0.01]
    const returns = makeReturns(dates, values)
    expect(worstWeeklyReturn(returns)).toBeCloseTo(-0.05, 10)
  })

  it('worstMonthlyReturn compounds a ~28-day losing streak on daily data', () => {
    // 20 ngày liên tiếp -1%, rồi vài ngày phục hồi. Cửa sổ 28 ngày phải gộp
    // đủ 20 ngày lỗ đó: 0.99^20 - 1 ≈ -18.21%.
    const n = 25
    const dates = Array.from({ length: n }, (_, i) => {
      const d = new Date('2021-01-01')
      d.setDate(d.getDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const values = Array.from({ length: n }, (_, i) => (i < 20 ? -0.01 : 0.02))
    const returns = makeReturns(dates, values)
    const expected = Math.pow(0.99, 20) - 1 // ≈ -0.18209
    expect(worstMonthlyReturn(returns)).toBeCloseTo(expected, 6)
  })

  it('returns 0 for empty input', () => {
    expect(worstWeeklyReturn([])).toBe(0)
    expect(worstMonthlyReturn([])).toBe(0)
  })

  it('returns 0 when every return is positive', () => {
    const returns = makeReturns(
      ['2021-01-01', '2021-01-02', '2021-01-03'],
      [0.01, 0.02, 0.01],
    )
    expect(worstWeeklyReturn(returns)).toBe(0)
    expect(worstMonthlyReturn(returns)).toBe(0)
  })

  it('single negative point: worst window is just that point itself', () => {
    const returns = makeReturns(['2021-01-01'], [-0.03])
    expect(worstWeeklyReturn(returns)).toBeCloseTo(-0.03, 10)
    expect(worstMonthlyReturn(returns)).toBeCloseTo(-0.03, 10)
  })
})

// ─── drawdownSeries ──────────────────────────────────────────

describe('drawdownSeries', () => {
  it('produces correct drawdown at each point', () => {
    // -10%, +20%, -5%
    // growth: 0.9, 1.08, 1.026
    // peak:   1.0, 1.08, 1.08
    // dd:    -0.1,  0,  -0.05
    const returns = makeReturns(
      ['2021-01-08', '2021-01-15', '2021-01-22'],
      [-0.1, 0.2, -0.05],
    )
    const result = drawdownSeries(returns)

    expect(result).toHaveLength(3)
    expect(result[0]!.value).toBeCloseTo(-0.1, 10)
    expect(result[1]!.value).toBeCloseTo(0, 10)
    expect(result[2]!.value).toBeCloseTo(-0.05, 10)
  })

  it('prepends a 0% point when startDate is provided', () => {
    const returns = makeReturns(['2021-01-08'], [-0.1])
    const result = drawdownSeries(returns, '2021-01-01')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ date: '2021-01-01', value: 0 })
    expect(result[1]!.value).toBeCloseTo(-0.1, 10)
  })

  it('returns empty for empty input', () => {
    expect(drawdownSeries([])).toEqual([])
  })
})

// ─── yearlyReturns ───────────────────────────────────────────

describe('yearlyReturns', () => {
  it('groups returns by calendar year and compounds within year', () => {
    // 2020: +10%, +20% → growth = 1.1 * 1.2 = 1.32 → value = 0.32
    // 2021: +50%         → growth = 1.5         → value = 0.5
    const returns = makeReturns(
      ['2020-06-01', '2020-12-01', '2021-06-01'],
      [0.1, 0.2, 0.5],
    )
    const result = yearlyReturns(returns)

    expect(result).toHaveLength(2)
    expect(result[0]!.year).toBe(2020)
    expect(result[0]!.value).toBeCloseTo(0.32, 10)
    expect(result[1]!.year).toBe(2021)
    expect(result[1]!.value).toBeCloseTo(0.5, 10)
  })

  it('marks years with fewer than 48 returns as partial', () => {
    // First and last year with only 2 returns each → both partial
    const returns = makeReturns(
      ['2020-06-01', '2020-12-01', '2021-06-01', '2021-12-01'],
      [0.1, 0.1, 0.1, 0.1],
    )
    const result = yearlyReturns(returns)

    expect(result[0]!.isPartial).toBe(true)  // 2020: 2 returns < 48
    expect(result[1]!.isPartial).toBe(true)  // 2021: 2 returns < 48
  })

  it('marks years with 48+ returns as not partial', () => {
    // Build 50 weekly returns all in 2021
    const returns: ReturnPoint[] = []
    const date = new Date('2021-01-06')
    for (let i = 0; i < 50; i++) {
      returns.push({ date: date.toISOString().substring(0, 10), value: 0 })
      date.setDate(date.getDate() + 7)
    }
    const result = yearlyReturns(returns)

    // Single year with 50 returns — since it's both first and last year,
    // check the 48-week threshold: 50 >= 48 → not partial
    expect(result[0]!.isPartial).toBe(false)
  })

  it('returns empty for empty input', () => {
    expect(yearlyReturns([])).toEqual([])
  })
})

// ─── winRateAmong ────────────────────────────────────────────

describe('winRateAmong', () => {
  it('computes fraction of full years where fund is best', () => {
    // Year 2019: Fund0=10%, Fund1=15% → Fund1 wins
    // Year 2020: Fund0=20%, Fund1=10% → Fund0 wins
    // Year 2021: Fund0=15%, Fund1=20% → Fund1 wins
    const allYearly: YearlyReturn[][] = [
      [
        { year: 2019, value: 0.10, isPartial: false },
        { year: 2020, value: 0.20, isPartial: false },
        { year: 2021, value: 0.15, isPartial: false },
      ],
      [
        { year: 2019, value: 0.15, isPartial: false },
        { year: 2020, value: 0.10, isPartial: false },
        { year: 2021, value: 0.20, isPartial: false },
      ],
    ]

    expect(winRateAmong(allYearly, 0)).toBeCloseTo(1 / 3, 5) // wins 2020 only
    expect(winRateAmong(allYearly, 1)).toBeCloseTo(2 / 3, 5) // wins 2019, 2021
  })

  it('ignores partial years', () => {
    const allYearly: YearlyReturn[][] = [
      [
        { year: 2020, value: 0.5, isPartial: true },   // ignored
        { year: 2021, value: 0.1, isPartial: false },
      ],
      [
        { year: 2020, value: 0.1, isPartial: true },   // ignored
        { year: 2021, value: 0.2, isPartial: false },
      ],
    ]

    // Only 2021 counts: Fund1 wins → Fund0 = 0%, Fund1 = 100%
    expect(winRateAmong(allYearly, 0)).toBeCloseTo(0, 5)
    expect(winRateAmong(allYearly, 1)).toBeCloseTo(1, 5)
  })

  it('returns null when no full years overlap', () => {
    const allYearly: YearlyReturn[][] = [
      [{ year: 2020, value: 0.1, isPartial: true }],
      [{ year: 2020, value: 0.2, isPartial: true }],
    ]
    expect(winRateAmong(allYearly, 0)).toBeNull()
  })
})

// ─── rollingReturns ──────────────────────────────────────────

describe('rollingReturns', () => {
  it('looks back periodMonths calendar months, not a fixed index count', () => {
    // Weekly returns từ 2021-01-01 tới 2022-12-31 (2 năm), toàn +1%/tuần.
    // Với period=6 tháng, mỗi điểm phải lùi đúng ~6 tháng lịch để tính growth,
    // bất kể có bao nhiêu điểm dữ liệu rơi vào khoảng đó.
    const dates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2022-12-31'); d.setDate(d.getDate() + 7)) {
      dates.push(d.toISOString().slice(0, 10))
    }
    const returns = makeReturns(dates, Array(dates.length).fill(0.01))
    const result = rollingReturns(returns, 6)

    expect(result.length).toBeGreaterThan(0)
    // growth mỗi tuần +1%, ~26 tuần/6 tháng → annualize về đúng (1.01^52 - 1)
    const expectedAnnualized = Math.pow(1.01, 52) - 1
    for (const r of result) {
      expect(r.value).toBeCloseTo(expectedAnnualized, 1)
    }
  })

  it('returns 0% annualized for all-zero returns', () => {
    const dates = Array.from({ length: 60 }, (_, i) => `2021-01-${String((i % 27) + 1).padStart(2, '0')}`)
      .map((_, i) => {
        const d = new Date('2021-01-01')
        d.setDate(d.getDate() + i * 7)
        return d.toISOString().slice(0, 10)
      })
    const returns = makeReturns(dates, Array(dates.length).fill(0))
    const result = rollingReturns(returns, 6)

    expect(result.length).toBeGreaterThan(0)
    result.forEach(r => expect(r.value).toBeCloseTo(0, 10))
  })

  it('returns empty when not enough data for one window', () => {
    // Chỉ 10 tuần dữ liệu (~2.3 tháng), period=12 tháng → chưa đủ lịch sử
    const returns = makeReturns(
      Array.from({ length: 10 }, (_, i) => `2021-01-${String(i + 1).padStart(2, '0')}`),
      Array(10).fill(0.01),
    )
    expect(rollingReturns(returns, 12)).toEqual([])
  })

  it('gives the same annualized result whether points are daily or weekly (date-based, not index-based)', () => {
    const weeklyDates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2022-06-30'); d.setDate(d.getDate() + 7)) {
      weeklyDates.push(d.toISOString().slice(0, 10))
    }
    const dailyDates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2022-06-30'); d.setDate(d.getDate() + 1)) {
      dailyDates.push(d.toISOString().slice(0, 10))
    }
    const weeklyReturns_ = makeReturns(weeklyDates, Array(weeklyDates.length).fill(0.01))
    const dailyReturns_ = makeReturns(dailyDates, Array(dailyDates.length).fill(0.01 / 7))

    const weeklyResult = rollingReturns(weeklyReturns_, 6)
    const dailyResult = rollingReturns(dailyReturns_, 6)

    expect(weeklyResult.length).toBeGreaterThan(0)
    expect(dailyResult.length).toBeGreaterThan(0)
    // Cùng tốc độ tăng trưởng thực (1%/tuần ≈ (1%/7)/ngày), annualized phải ra gần giống nhau
    expect(dailyResult[dailyResult.length - 1]!.value).toBeCloseTo(weeklyResult[weeklyResult.length - 1]!.value, 1)
  })
})

// ─── rollingAverage ──────────────────────────────────────────

describe('rollingAverage', () => {
  it('computes the arithmetic mean of rolling values', () => {
    const rolling = makeReturns(['2021-01-01', '2021-02-01', '2021-03-01'], [0.1, 0.2, 0.3])
    expect(rollingAverage(rolling)).toBeCloseTo(0.2, 10)
  })

  it('returns null for empty input', () => {
    expect(rollingAverage([])).toBeNull()
  })
})

// ─── annualizedStdev ─────────────────────────────────────────

describe('availableRollingPeriods', () => {
  it('returns only periods that at least one fund can compute', () => {
    // 6 điểm cách 1 tháng → trải ~6 tháng, chu kỳ 12 trống
    const short = makeReturns(
      ['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01'],
      [0.01, 0.02, 0.03, 0.04, 0.05, 0.06],
    )
    // 18 điểm cách nhau ~1 tháng → trải ~18 tháng, đủ 12 nhưng chưa đủ 24
    const long: ReturnPoint[] = []
    const start = new Date('2023-01-01')
    for (let m = 0; m < 18; m++) {
      const d = new Date(start)
      d.setMonth(start.getMonth() + m)
      long.push({ date: d.toISOString().slice(0, 10), value: 0.01 })
    }
    const periods = [6, 12, 24]
    // short đủ 6; long đủ 6 và 12; không ai đủ 24
    const result = availableRollingPeriods([short, long], periods)
    expect(result).toContain(6)
    expect(result).toContain(12)
    expect(result).not.toContain(24)
  })

  it('returns empty when no fund has data', () => {
    expect(availableRollingPeriods([], [6, 12])).toEqual([])
    expect(availableRollingPeriods([[]], [6, 12])).toEqual([])
  })
})

// ─── rollingReturnDistribution ───────────────────────────────

describe('rollingReturnDistribution', () => {
  it('counts each observation into exactly one bucket, totals to 1', () => {
    // 10 quan sát trải đều cả 5 khoảng
    const values = [
      -0.02, -0.01, 0.0, 0.03, 0.05, 0.07, 0.10, 0.15, 0.20, 0.30,
    ]
    const pcts = rollingReturnDistribution(values)
    expect(pcts.length).toBe(5)
    expect(pcts[0]).toBeCloseTo(0.2, 10)  // Âm: 2/10
    expect(pcts[1]).toBeCloseTo(0.2, 10)  // 0–5%: 2/10 (0.0, 0.03)
    expect(pcts[2]).toBeCloseTo(0.2, 10)  // 5–10%: 2/10 (0.05, 0.07)
    expect(pcts[3]).toBeCloseTo(0.2, 10)  // 10–20%: 2/10 (0.10, 0.15)
    expect(pcts[4]).toBeCloseTo(0.2, 10)  // >20%: 2/10 (0.20, 0.30)
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  it('handles bucket boundaries as half-open [a, b), right bucket takes >= 0.20', () => {
    expect(rollingReturnDistribution([0])[1]).toBe(1)      // 0 → 0–5%
    expect(rollingReturnDistribution([0.05])[2]).toBe(1)   // 5% → 5–10%
    expect(rollingReturnDistribution([0.10])[3]).toBe(1)   // 10% → 10–20%
    expect(rollingReturnDistribution([0.20])[4]).toBe(1)   // 20% → >20%
    expect(rollingReturnDistribution([-0.0001])[0]).toBe(1) // âm nhỏ vẫn là Âm
  })

  it('returns all zeros for empty input', () => {
    expect(rollingReturnDistribution([])).toEqual([0, 0, 0, 0, 0])
  })
})

describe('annualizedStdev', () => {
  it('infers periods/year from the actual date span, not a fixed constant', () => {
    // 52 điểm weekly trải đúng 1 năm, độ lệch chuẩn mỗi tuần = 0.01
    const dates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2021-12-31'); d.setDate(d.getDate() + 7)) {
      dates.push(d.toISOString().slice(0, 10))
    }
    const values = dates.map((_, i) => (i % 2 === 0 ? 0.01 : -0.01))
    const weekly = annualizedStdev(makeReturns(dates, values))

    // Cùng biến động nhưng lấy mẫu DAILY (7x nhiều điểm hơn trong cùng 1 năm)
    // phải tự thích ứng periodsPerYear ~365 thay vì áp cứng sqrt(52)
    const dailyDates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2021-12-31'); d.setDate(d.getDate() + 1)) {
      dailyDates.push(d.toISOString().slice(0, 10))
    }
    const dailyValues = dailyDates.map((_, i) => (i % 2 === 0 ? 0.01 : -0.01))
    const daily = annualizedStdev(makeReturns(dailyDates, dailyValues))

    // periodsPerYear tự suy ra ~52 cho weekly, ~365 cho daily — annualized stdev
    // của daily phải lớn hơn hẳn weekly vì sqrt(365) > sqrt(52), dù stdev thô như nhau
    expect(daily).toBeGreaterThan(weekly)
  })

  it('returns 0 for fewer than 2 points', () => {
    expect(annualizedStdev([])).toBe(0)
    expect(annualizedStdev(makeReturns(['2021-01-01'], [0.01]))).toBe(0)
  })
})

// ─── rollingCumulativeReturns ────────────────────────────────

describe('rollingCumulativeReturns', () => {
  it('computes the correct cumulative growth over a calendar-month window', () => {
    const dates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2022-06-30'); d.setDate(d.getDate() + 7)) {
      dates.push(d.toISOString().slice(0, 10))
    }
    const returns = makeReturns(dates, Array(dates.length).fill(0.01))
    const result = rollingCumulativeReturns(returns, 6)

    expect(result.length).toBeGreaterThan(0)
    // ~26 tuần/6 tháng, +1%/tuần → growth ≈ 1.01^26 - 1
    const expected = Math.pow(1.01, 26) - 1
    for (const r of result) expect(r.value).toBeCloseTo(expected, 1)
  })

  it('returns empty array for empty input', () => {
    expect(rollingCumulativeReturns([], 6)).toEqual([])
  })
})

// ─── rollingMaxDrawdown ──────────────────────────────────────

describe('rollingMaxDrawdown', () => {
  it('finds the worst peak-to-trough decline within each calendar window', () => {
    // Tăng đều rồi sập 20% ở giữa, rồi tăng lại — chuỗi trải dài hơn 6 tháng
    // để có điểm đủ lịch sử lùi lại, rolling DD phải bắt được đúng cú sập.
    const dates = [
      '2021-01-01', '2021-02-01', '2021-03-01', '2021-04-01',
      '2021-05-01', '2021-06-01', '2021-07-01', '2021-08-01',
    ]
    const values = [0.05, 0.05, -0.20, 0.05, 0.05, 0.05, 0.05, 0.05]
    const returns = makeReturns(dates, values)
    const result = rollingMaxDrawdown(returns, 6)

    expect(result.length).toBeGreaterThan(0)
    const worst = Math.min(...result.map(r => r.value))
    expect(worst).toBeLessThan(-0.15) // bắt được cú sập ~20%
  })

  it('returns empty array for empty input', () => {
    expect(rollingMaxDrawdown([], 6)).toEqual([])
  })
})

// ─── rollingAnnualizedStdev ──────────────────────────────────

describe('rollingAnnualizedStdev', () => {
  it('produces a positive annualized stdev when returns actually vary', () => {
    const dates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2022-06-30'); d.setDate(d.getDate() + 7)) {
      dates.push(d.toISOString().slice(0, 10))
    }
    const values = dates.map((_, i) => (i % 2 === 0 ? 0.02 : -0.01))
    const returns = makeReturns(dates, values)
    const result = rollingAnnualizedStdev(returns, 6)

    expect(result.length).toBeGreaterThan(0)
    for (const r of result) expect(r.value).toBeGreaterThan(0)
  })

  it('returns empty array for empty input', () => {
    expect(rollingAnnualizedStdev([], 6)).toEqual([])
  })
})

// ─── rollingWinRate ───────────────────────────────────────────

describe('rollingWinRate', () => {
  it('counts windows where A beats B', () => {
    const dates: string[] = []
    for (let d = new Date('2021-01-01'); d <= new Date('2022-12-31'); d.setDate(d.getDate() + 7)) {
      dates.push(d.toISOString().slice(0, 10))
    }
    const a = makeReturns(dates, Array(dates.length).fill(0.02)) // A luôn tốt hơn
    const b = makeReturns(dates, Array(dates.length).fill(0.01))
    const { wins, total } = rollingWinRate(a, b, 6)

    expect(total).toBeGreaterThan(0)
    expect(wins).toBe(total) // A thắng B ở mọi cửa sổ
  })

  it('returns 0/0 when there is not enough history for one window', () => {
    const returns = makeReturns(['2021-01-01', '2021-01-08'], [0.01, 0.01])
    expect(rollingWinRate(returns, returns, 12)).toEqual({ wins: 0, total: 0 })
  })
})

// ─── rollingCumulativeReturnsMap / winRateAgainstRolledB ─────

describe('rollingCumulativeReturnsMap + winRateAgainstRolledB', () => {
  const dates: string[] = []
  for (let d = new Date('2021-01-01'); d <= new Date('2022-12-31'); d.setDate(d.getDate() + 7)) {
    dates.push(d.toISOString().slice(0, 10))
  }
  const a = makeReturns(dates, Array(dates.length).fill(0.02)) // A luôn tốt hơn
  const b = makeReturns(dates, Array(dates.length).fill(0.01))

  it('gives the same result as rollingWinRate when B is precomputed once', () => {
    const direct = rollingWinRate(a, b, 6)
    const rolledBMap = rollingCumulativeReturnsMap(b, 6)
    const viaPrecomputed = winRateAgainstRolledB(a, 6, rolledBMap)
    expect(viaPrecomputed).toEqual(direct)
  })

  it('the same precomputed B map can be reused against multiple A series', () => {
    const c = makeReturns(dates, Array(dates.length).fill(0.005)) // worse than B
    const rolledBMap = rollingCumulativeReturnsMap(b, 6)

    const aVsB = winRateAgainstRolledB(a, 6, rolledBMap)
    const cVsB = winRateAgainstRolledB(c, 6, rolledBMap)

    expect(aVsB.wins).toBe(aVsB.total)   // A always beats B
    expect(cVsB.wins).toBe(0)            // C always loses to B
  })

  it('returns 0/0 when the rolled B map is empty', () => {
    expect(winRateAgainstRolledB(a, 6, new Map())).toEqual({ wins: 0, total: 0 })
  })
})

// ─── simulateMultiFundPortfolio ──────────────────────────────

describe('simulateMultiFundPortfolio', () => {
  it('single fund 100% weight passes through returns unchanged', () => {
    const returns = makeReturns(['2021-01-08', '2021-01-15', '2021-01-22'], [0.1, -0.2, 0.3])
    const result = simulateMultiFundPortfolio([returns], [1.0], 'yearly')

    expect(result).toHaveLength(3)
    expect(result[0]!.value).toBeCloseTo(0.1, 10)
    expect(result[1]!.value).toBeCloseTo(-0.2, 10)
    expect(result[2]!.value).toBeCloseTo(0.3, 10)
  })

  it('two identical funds at 50/50 equals single fund return', () => {
    const r = makeReturns(['2021-01-08', '2021-01-15'], [0.1, 0.2])
    const result = simulateMultiFundPortfolio([r, r], [0.5, 0.5], 'yearly')

    expect(result[0]!.value).toBeCloseTo(0.1, 10)
    expect(result[1]!.value).toBeCloseTo(0.2, 10)
  })

  it('first period return equals weighted average of fund returns', () => {
    // Fund A: +10%, Fund B: +20%, weight 50/50
    // Expected: 0.5 * 0.1 + 0.5 * 0.2 = 0.15
    const fundA = makeReturns(['2021-01-08'], [0.1])
    const fundB = makeReturns(['2021-01-08'], [0.2])
    const result = simulateMultiFundPortfolio([fundA, fundB], [0.5, 0.5], 'yearly')

    expect(result[0]!.value).toBeCloseTo(0.15, 10)
  })

  it('rebalances at year boundary', () => {
    // Fund A: +100% in 2021, -50% in 2022 (doubles then halves)
    // Fund B: flat (0%) in both years
    // Weight: 50/50, yearly rebalancing
    //
    // After 2021: A = 1.0, B = 0.5, total = 1.5 (+50% return)
    //   → Rebalance: A = 0.75, B = 0.75
    // After 2022: A = 0.375, B = 0.75, total = 1.125 (-25% return)
    const fundA = makeReturns(['2021-06-01', '2022-06-01'], [1.0, -0.5])
    const fundB = makeReturns(['2021-06-01', '2022-06-01'], [0.0, 0.0])
    const result = simulateMultiFundPortfolio([fundA, fundB], [0.5, 0.5], 'yearly')

    expect(result[0]!.value).toBeCloseTo(0.5, 10)   // +50%
    expect(result[1]!.value).toBeCloseTo(-0.25, 10)  // -25% (after rebalance)
  })

  it('without rebalancing, weights drift naturally', () => {
    // Same funds as above, but dates within same year → no rebalance
    // Fund A: +100%, -50% — Fund B: 0%, 0% — 50/50 no rebalance
    //
    // After step 1: A = 1.0, B = 0.5, total = 1.5 (+50%)
    //   → No rebalance (same year)
    // After step 2: A = 0.5, B = 0.5, total = 1.0 → return = 1.0/1.5 - 1 = -0.3333...
    const fundA = makeReturns(['2021-03-01', '2021-09-01'], [1.0, -0.5])
    const fundB = makeReturns(['2021-03-01', '2021-09-01'], [0.0, 0.0])
    const result = simulateMultiFundPortfolio([fundA, fundB], [0.5, 0.5], 'yearly')

    expect(result[0]!.value).toBeCloseTo(0.5, 10)
    expect(result[1]!.value).toBeCloseTo(-1 / 3, 10) // ≠ -25%, drift not rebalanced
  })

  it('throws when return series have different lengths', () => {
    const fundA = makeReturns(['2021-01-08', '2021-01-15'], [0.1, 0.2])
    const fundB = makeReturns(['2021-01-08'], [0.1])
    expect(() => simulateMultiFundPortfolio([fundA, fundB], [0.5, 0.5], 'yearly')).toThrow()
  })

  it('returns empty for empty returns', () => {
    expect(simulateMultiFundPortfolio([], [], 'yearly')).toEqual([])
    expect(simulateMultiFundPortfolio([[]], [1.0], 'yearly')).toEqual([])
  })
})

// ─── monthlyReturns ───────────────────────────────────────────

describe('monthlyReturns', () => {
  it('groups weekly returns by calendar month and compounds', () => {
    // Tháng 1: 3 tuần, lần lượt +10%, +10%, +10% → 1.1^3 - 1
    // Tháng 2: 2 tuần, -5%, +5% → 0.95 * 1.05 - 1
    const returns = makeReturns([
      '2021-01-07', '2021-01-14', '2021-01-21',
      '2021-02-04', '2021-02-11',
    ], [0.10, 0.10, 0.10, -0.05, 0.05])
    const result = monthlyReturns(returns)

    expect(result).toHaveLength(2)
    expect(result[0]!.year).toBe(2021)
    expect(result[0]!.month).toBe(1)
    expect(result[0]!.value).toBeCloseTo(1.1 * 1.1 * 1.1 - 1, 10)
    expect(result[1]!.month).toBe(2)
    expect(result[1]!.value).toBeCloseTo(0.95 * 1.05 - 1, 10)
  })

  it('marks first and last month partial when data does not cover full month', () => {
    // Tháng 3 bắt đầu từ ngày 15, tháng 4 kết thúc ngày 20 → cả hai partial
    const returns = makeReturns([
      '2021-03-15', '2021-03-22', '2021-03-29',
      '2021-04-05', '2021-04-12', '2021-04-20',
    ], [0.01, 0.01, 0.01, 0.01, 0.01, 0.01])
    const result = monthlyReturns(returns)

    expect(result[0]!.isPartial).toBe(true)
    expect(result[1]!.isPartial).toBe(true)
  })

  it('does not flag middle months as partial', () => {
    const returns = makeReturns([
      '2021-01-15', '2021-01-22', '2021-01-29',
      '2021-02-05', '2021-02-12', '2021-02-19', '2021-02-26',
      '2021-03-05', '2021-03-12', '2021-03-19', '2021-03-26',
      '2021-04-15',
    ], [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02])
    const result = monthlyReturns(returns)

    expect(result).toHaveLength(4)
    expect(result[1]!.isPartial).toBe(false)
    expect(result[2]!.isPartial).toBe(false)
  })

  it('returns empty for empty input', () => {
    expect(monthlyReturns([])).toEqual([])
  })
})
