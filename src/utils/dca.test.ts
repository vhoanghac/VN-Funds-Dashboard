import { describe, it, expect } from 'vitest'
import { dcaYearlyMWRR, computeDCARolling, derivePortfolioName } from './dca'

describe('derivePortfolioName', () => {
  it('uses the fund ticker when there is exactly 1 fund', () => {
    expect(derivePortfolioName([{ fundId: 'DCDS', weight: 100 }], 1)).toBe('DCDS')
  })

  it('falls back to "Portfolio {num}" when there are 2+ funds', () => {
    const slots = [{ fundId: 'DCDS', weight: 60 }, { fundId: 'DCBF', weight: 40 }]
    expect(derivePortfolioName(slots, 2)).toBe('Portfolio 2')
  })

  it('falls back to "Portfolio {num}" when the single slot has no fundId yet', () => {
    expect(derivePortfolioName([{ fundId: '', weight: 100 }], 3)).toBe('Portfolio 3')
  })

  it('falls back to "Portfolio {num}" for an empty slots array', () => {
    expect(derivePortfolioName([], 4)).toBe('Portfolio 4')
  })

  it('uses the stable num, not array position, so removing other portfolios does not rename this one', () => {
    // num=5 simulates a portfolio created 5th, even if it's now at array index 0
    const slots = [{ fundId: 'DCDS', weight: 40 }, { fundId: 'DCBF', weight: 60 }]
    expect(derivePortfolioName(slots, 5)).toBe('Portfolio 5')
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
