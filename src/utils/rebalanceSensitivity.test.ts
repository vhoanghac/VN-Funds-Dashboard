import { describe, it, expect } from 'vitest'
import { computeMetrics } from './rebalanceSensitivity'

describe('computeMetrics', () => {
  it('derives periodsPerYear from count/years instead of hard-coding 252 (BTC/gold portfolios trade ~365 days/year, not 252)', () => {
    // 3 kỳ, lợi nhuận +5%, -3%, +2%. Giả định 3 kỳ này trải trên 3/365 năm
    // (tức mật độ dữ liệu THỰC TẾ là 365 phiên/năm, kiểu BTC — không phải
    // 252 phiên/năm kiểu quỹ mở VN).
    const totals = new Float64Array([1, 1.05, 1.05 * 0.97, 1.05 * 0.97 * 1.02])
    const years = 3 / 365
    const result = computeMetrics(totals, years)

    // sum=0.04, sumSq=0.05^2+(-0.03)^2+0.02^2=0.0038, count=3
    // variance (mẫu, chia n-1=2) = (0.0038 - 0.04^2/3)/2 = 0.00163333...
    const mean = 0.04 / 3
    const variance = (0.0038 - (0.04 * 0.04) / 3) / 2
    const periodsPerYear = 365 // = count(3) / years(3/365)
    const expectedStdev = Math.sqrt(variance) * Math.sqrt(periodsPerYear)
    const expectedSharpe = (mean * periodsPerYear) / expectedStdev

    expect(result.stdev).toBeCloseTo(expectedStdev, 8)
    expect(result.sharpe).toBeCloseTo(expectedSharpe, 8)

    // Phải KHÁC hẳn con số nếu vẫn hard-code sqrt(252) như code cũ — nếu bug
    // quay lại, stdev sẽ khớp với oldStdev (dùng periodsPerYear=252) thay vì
    // expectedStdev (periodsPerYear=365), và test này sẽ fail vì assertion
    // trên KHÔNG match giá trị cũ.
    const oldStdev = Math.sqrt(variance) * Math.sqrt(252)
    expect(result.stdev).not.toBeCloseTo(oldStdev, 2)
  })

  it('matches the old hard-coded 252 behavior when data genuinely IS ~252 sessions/year (VN mutual funds)', () => {
    const totals = new Float64Array([1, 1.05, 1.05 * 0.97, 1.05 * 0.97 * 1.02])
    const years = 3 / 252 // mật độ 252 phiên/năm, kiểu quỹ mở VN
    const result = computeMetrics(totals, years)

    const variance = (0.0038 - (0.04 * 0.04) / 3) / 2
    const expectedStdev = Math.sqrt(variance) * Math.sqrt(252)
    expect(result.stdev).toBeCloseTo(expectedStdev, 8)
  })

  it('computes CAGR from total growth over the given years (unaffected by the annualization fix)', () => {
    const totals = new Float64Array([1, 1.1, 1.21])
    const years = 2
    const result = computeMetrics(totals, years)
    // (1.21/1)^(1/2) - 1 = 1.1 - 1 = 0.1
    expect(result.cagr).toBeCloseTo(0.1, 10)
  })

  it('computes max drawdown correctly (peak-to-trough on the totals path)', () => {
    // 1 -> 1.2 (đỉnh) -> 0.9 (đáy, dd = 0.9/1.2-1 = -0.25) -> 1.0
    const totals = new Float64Array([1, 1.2, 0.9, 1.0])
    const result = computeMetrics(totals, 1)
    expect(result.maxDrawdown).toBeCloseTo(-0.25, 10)
  })
})
