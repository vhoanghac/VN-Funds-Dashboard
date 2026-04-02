import { describe, it, expect } from 'vitest'
import {
  weeklyReturns,
  cumulativeReturns,
  cagr,
  maxDrawdown,
  drawdownSeries,
  yearlyReturns,
  winRateAmong,
  rollingReturns,
  rollingAverage,
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
  it('produces (n - windowSize + 1) output points', () => {
    // period=6 months → windowSize = round(6 * 52/12) = round(26) = 26
    // 30 returns → 30 - 26 + 1 = 5 points
    const returns = makeReturns(
      Array.from({ length: 30 }, (_, i) => `2021-${String(i + 1).padStart(2, '0')}-01`),
      Array(30).fill(0.01),
    )
    const result = rollingReturns(returns, 6)
    expect(result).toHaveLength(5)
  })

  it('uses the last date of each window', () => {
    // period=6 → windowSize=26, 27 returns
    // First window: returns[0..25], last date = returns[25].date
    // Second window: returns[1..26], last date = returns[26].date
    const dates = Array.from({ length: 27 }, (_, i) => `2021-01-${String(i + 1).padStart(2, '0')}`)
    const returns = makeReturns(dates, Array(27).fill(0))
    const result = rollingReturns(returns, 6)

    expect(result[0]!.date).toBe(dates[25])
    expect(result[1]!.date).toBe(dates[26])
  })

  it('annualizes the window return correctly', () => {
    // period=12 months → windowSize=52
    // 53 returns all = +1%
    // window growth = 1.01^52, annualized = growth^(52/52) - 1 = 1.01^52 - 1 ≈ 67.77%
    const expectedGrowth = Math.pow(1.01, 52) - 1
    const dates = Array.from({ length: 53 }, (_, i) => {
      const d = new Date('2021-01-06')
      d.setDate(d.getDate() + i * 7)
      return d.toISOString().substring(0, 10)
    })
    const returns = makeReturns(dates, Array(53).fill(0.01))
    const result = rollingReturns(returns, 12)

    expect(result).toHaveLength(2)
    expect(result[0]!.value).toBeCloseTo(expectedGrowth, 6)
    expect(result[1]!.value).toBeCloseTo(expectedGrowth, 6)
  })

  it('returns 0% annualized for all-zero returns', () => {
    const dates = Array.from({ length: 27 }, (_, i) => `2021-01-${String(i + 1).padStart(2, '0')}`)
    const returns = makeReturns(dates, Array(27).fill(0))
    const result = rollingReturns(returns, 6)

    result.forEach(r => expect(r.value).toBeCloseTo(0, 10))
  })

  it('returns empty when not enough data for one window', () => {
    // period=12 → windowSize=52, only 10 returns → empty
    const returns = makeReturns(
      Array.from({ length: 10 }, (_, i) => `2021-01-${String(i + 1).padStart(2, '0')}`),
      Array(10).fill(0.01),
    )
    expect(rollingReturns(returns, 12)).toEqual([])
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
