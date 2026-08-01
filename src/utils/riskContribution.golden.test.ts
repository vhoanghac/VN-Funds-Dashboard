import { describe, it, expect } from 'vitest'
import { riskContribution } from './calculations'
import { RISK_CONTRIBUTION_GOLDEN } from '../__tests__/fixtures/riskContribution.fixture'

/**
 * Golden-file test cho riskContribution.
 *
 * Đầu vào cố định → đầu ra golden đã kiểm chứng độc lập (fixture cùng thư mục).
 * Bảo hiểm chống refactor: công thức covariance rất dễ sai dấu hoặc lệch tổng,
 * một lần sửa không cẩn thận là lệch ngay mà không ai nhìn ra.
 */
describe('riskContribution (golden)', () => {
  it.each(RISK_CONTRIBUTION_GOLDEN)('$name', ({ returnsA, returnsB, weightA, weightB, expected }) => {
    const got = riskContribution(
      returnsA.map((value, i) => ({ date: `2021-01-${String(i + 1).padStart(2, '0')}`, value })),
      returnsB.map((value, i) => ({ date: `2021-01-${String(i + 1).padStart(2, '0')}`, value })),
      weightA,
      weightB,
    )
    expect(got.contribA).toBeCloseTo(expected.contribA, 9)
    expect(got.contribB).toBeCloseTo(expected.contribB, 9)
  })

  it('tổng đóng góp rủi ro xấp xỉ 1 (chia trọn phần rủi ro danh mục)', () => {
    for (const { returnsA, returnsB, weightA, weightB } of RISK_CONTRIBUTION_GOLDEN) {
      const got = riskContribution(
        returnsA.map((value, i) => ({ date: `2021-01-${String(i + 1).padStart(2, '0')}`, value })),
        returnsB.map((value, i) => ({ date: `2021-01-${String(i + 1).padStart(2, '0')}`, value })),
        weightA,
        weightB,
      )
      expect(got.contribA + got.contribB).toBeCloseTo(1, 9)
    }
  })

  it('trả về 0 khi chuỗi quá ngắn (< 2 điểm)', () => {
    const one = [{ date: '2021-01-01', value: 0.01 }]
    expect(riskContribution(one, one, 0.5, 0.5)).toEqual({ contribA: 0, contribB: 0 })
  })

  it('trả về 0 khi cả hai tỷ trọng bằng 0', () => {
    const a = [{ date: '2021-01-01', value: 0.01 }, { date: '2021-01-08', value: -0.01 }]
    expect(riskContribution(a, a, 0, 0)).toEqual({ contribA: 0, contribB: 0 })
  })
})
