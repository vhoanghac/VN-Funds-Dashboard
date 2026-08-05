import { describe, it, expect } from 'vitest'
import {
  compoundInterest,
  compoundInterestSeries,
  cagrFromValues,
  fundFeeErosion,
  fundFeeErosionSeries,
} from './calculators'
import {
  COMPOUND_INTEREST_GOLDEN,
  CAGR_GOLDEN,
  FUND_FEE_EROSION_GOLDEN,
} from '../__tests__/fixtures/calculators.fixture'

/**
 * Golden-file test cho Calculator Suite.
 *
 * Số golden trong fixture sinh ra từ vòng lặp tham chiếu, code gốc dùng công thức
 * đóng. Hai đường tính khác nhau nên test không tự xác nhận chính nó.
 *
 * Độ lệch dấu phẩy động giữa hai đường là cỡ 1e-15 tương đối, tức là dưới 0,0001
 * đồng ngay cả với con số hàng tỷ. Vì vậy tiền so tới 2 chữ số thập phân, còn tỷ
 * lệ (CAGR, erosionPct) so tới 9 chữ số.
 */
const MONEY_PRECISION = 2
const RATE_PRECISION = 9

describe('compoundInterest (golden)', () => {
  it.each(COMPOUND_INTEREST_GOLDEN)('$name', ({ input, expected }) => {
    const got = compoundInterest(input)
    expect(got.finalValue).toBeCloseTo(expected.finalValue, MONEY_PRECISION)
    expect(got.contributions).toBeCloseTo(expected.contributions, MONEY_PRECISION)
    expect(got.interestEarned).toBeCloseTo(expected.interestEarned, MONEY_PRECISION)
  })

  it('finalValue luôn bằng contributions cộng interestEarned', () => {
    for (const { input } of COMPOUND_INTEREST_GOLDEN) {
      const got = compoundInterest(input)
      expect(got.contributions + got.interestEarned).toBeCloseTo(got.finalValue, MONEY_PRECISION)
    }
  })

  it('bỏ trống monthlyContribution thì kết quả giống hệt truyền 0', () => {
    const withoutField = compoundInterest({ principal: 100_000_000, annualRate: 0.08, years: 20 })
    const withZero = compoundInterest({
      principal: 100_000_000,
      annualRate: 0.08,
      years: 20,
      monthlyContribution: 0,
    })
    expect(withoutField).toEqual(withZero)
  })

  it('góp cuối kỳ nên khoản tháng đầu chưa kịp sinh lời', () => {
    // Một tháng, góp 1 triệu vào cuối tháng đó. Khoản góp phải nguyên vẹn 1
    // triệu. Nếu ai sửa sang góp đầu kỳ, con số này lớn hơn ngay.
    const got = compoundInterest({
      principal: 0,
      annualRate: 0.12,
      years: 1 / 12,
      monthlyContribution: 1_000_000,
    })
    expect(got.finalValue).toBeCloseTo(1_000_000, MONEY_PRECISION)
    expect(got.interestEarned).toBeCloseTo(0, MONEY_PRECISION)
  })

  it('số năm bằng 0 hoặc âm thì tiền còn nguyên, không sinh lời', () => {
    for (const years of [0, -5]) {
      const got = compoundInterest({ principal: 100_000_000, annualRate: 0.08, years, monthlyContribution: 5_000_000 })
      expect(got).toEqual({ finalValue: 100_000_000, contributions: 100_000_000, interestEarned: 0 })
    }
  })
})

describe('compoundInterestSeries (biểu đồ)', () => {
  it('có đủ mốc từ năm 0 tới năm cuối', () => {
    for (const { input } of COMPOUND_INTEREST_GOLDEN) {
      const series = compoundInterestSeries(input)
      expect(series).toHaveLength(Math.floor(input.years) + 1)
      expect(series[0]!.year).toBe(0)
      expect(series[series.length - 1]!.year).toBe(Math.floor(input.years))
    }
  })

  it('mốc năm 0 là lúc chưa sinh lãi, đúng bằng vốn ban đầu', () => {
    for (const { input } of COMPOUND_INTEREST_GOLDEN) {
      const dauKy = compoundInterestSeries(input)[0]!
      expect(dauKy.finalValue).toBe(input.principal)
      expect(dauKy.contributions).toBe(input.principal)
      expect(dauKy.interestEarned).toBe(0)
    }
  })

  it('mốc cuối chuỗi khớp đúng kết quả bảng, đường vẽ không lệch số', () => {
    for (const { input, expected } of COMPOUND_INTEREST_GOLDEN) {
      const series = compoundInterestSeries(input)
      const cuoiKy = series[series.length - 1]!
      expect(cuoiKy.finalValue).toBeCloseTo(expected.finalValue, MONEY_PRECISION)
      expect(cuoiKy.contributions).toBeCloseTo(expected.contributions, MONEY_PRECISION)
      expect(cuoiKy.interestEarned).toBeCloseTo(expected.interestEarned, MONEY_PRECISION)
    }
  })

  it('lãi suất dương thì đường giá trị đi lên, không có năm nào tụt', () => {
    const series = compoundInterestSeries({ principal: 100_000_000, annualRate: 0.08, years: 20 })
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.finalValue).toBeGreaterThan(series[i - 1]!.finalValue)
    }
  })

  it('mỗi mốc đều thoả finalValue bằng contributions cộng interestEarned', () => {
    const series = compoundInterestSeries({
      principal: 100_000_000,
      annualRate: 0.08,
      years: 20,
      monthlyContribution: 5_000_000,
    })
    for (const point of series) {
      expect(point.contributions + point.interestEarned).toBeCloseTo(point.finalValue, MONEY_PRECISION)
    }
  })
})

describe('fundFeeErosionSeries (biểu đồ)', () => {
  it('có đủ mốc và mốc năm 0 chưa mất đồng phí nào', () => {
    for (const { input } of FUND_FEE_EROSION_GOLDEN) {
      const series = fundFeeErosionSeries(input)
      expect(series).toHaveLength(Math.floor(input.years) + 1)
      expect(series[0]!.feeLost).toBe(0)
      expect(series[0]!.finalValueWithFee).toBe(input.principal)
    }
  })

  it('mốc cuối chuỗi khớp đúng kết quả bảng', () => {
    for (const { input, expected } of FUND_FEE_EROSION_GOLDEN) {
      const series = fundFeeErosionSeries(input)
      const cuoiKy = series[series.length - 1]!
      expect(cuoiKy.finalValueNoFee).toBeCloseTo(expected.finalValueNoFee, MONEY_PRECISION)
      expect(cuoiKy.finalValueWithFee).toBeCloseTo(expected.finalValueWithFee, MONEY_PRECISION)
      expect(cuoiKy.erosionPct).toBeCloseTo(expected.erosionPct, RATE_PRECISION)
    }
  })

  it('khoảng cách hai đường nới rộng dần, năm sau mất nhiều hơn năm trước', () => {
    const series = fundFeeErosionSeries({
      principal: 100_000_000,
      growthRate: 0.10,
      feeRate: 0.02,
      years: 20,
    })
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.feeLost).toBeGreaterThan(series[i - 1]!.feeLost)
      expect(series[i]!.erosionPct).toBeGreaterThan(series[i - 1]!.erosionPct)
    }
  })

  it('feeLost luôn đúng bằng hiệu hai đường', () => {
    for (const { input } of FUND_FEE_EROSION_GOLDEN) {
      for (const point of fundFeeErosionSeries(input)) {
        expect(point.feeLost).toBeCloseTo(point.finalValueNoFee - point.finalValueWithFee, MONEY_PRECISION)
      }
    }
  })
})

describe('cagrFromValues (golden)', () => {
  it.each(CAGR_GOLDEN)('$name', ({ input, expected }) => {
    expect(cagrFromValues(input)).toBeCloseTo(expected, RATE_PRECISION)
  })

  it('kiểm chứng ngược: gộp CAGR đủ số năm phải quay lại đúng endValue', () => {
    for (const { input } of CAGR_GOLDEN) {
      const cagr = cagrFromValues(input)
      const rebuilt = input.startValue * Math.pow(1 + cagr, input.years)
      expect(rebuilt).toBeCloseTo(input.endValue, MONEY_PRECISION)
    }
  })

  it('trả 0 thay vì Infinity hoặc NaN ở các biên', () => {
    // Đây là lỗi Sharpe vô cực từng gặp ở commit 1ceb9de, lần này chặn trước.
    const canhBien = [
      { startValue: 0, endValue: 200_000_000, years: 5 },
      { startValue: -100_000_000, endValue: 200_000_000, years: 5 },
      { startValue: 100_000_000, endValue: 200_000_000, years: 0 },
      { startValue: 100_000_000, endValue: 200_000_000, years: -3 },
      { startValue: 100_000_000, endValue: -50_000_000, years: 5 },
    ]
    for (const input of canhBien) {
      const got = cagrFromValues(input)
      expect(Number.isFinite(got)).toBe(true)
      expect(got).toBe(0)
    }
  })
})

describe('fundFeeErosion (golden)', () => {
  it.each(FUND_FEE_EROSION_GOLDEN)('$name', ({ input, expected }) => {
    const got = fundFeeErosion(input)
    expect(got.finalValueNoFee).toBeCloseTo(expected.finalValueNoFee, MONEY_PRECISION)
    expect(got.finalValueWithFee).toBeCloseTo(expected.finalValueWithFee, MONEY_PRECISION)
    expect(got.erosionPct).toBeCloseTo(expected.erosionPct, RATE_PRECISION)
  })

  it('phí trừ trên NAV: erosionPct rút gọn đúng bằng 1 − (1 − feeRate)^years', () => {
    // Canh chặn đúng chỗ dễ sửa sai nhất. Nếu ai đổi sang trừ thẳng
    // growthRate − feeRate thì đẳng thức này gãy ngay.
    for (const { input } of FUND_FEE_EROSION_GOLDEN) {
      const got = fundFeeErosion(input)
      const rutGon = 1 - Math.pow(1 - input.feeRate, input.years)
      expect(got.erosionPct).toBeCloseTo(rutGon, RATE_PRECISION)
    }
  })

  it('erosionPct không đổi khi vốn hoặc tỷ suất sinh lời đổi', () => {
    const base = fundFeeErosion({ principal: 100_000_000, growthRate: 0.10, feeRate: 0.02, years: 20 })
    const vonKhac = fundFeeErosion({ principal: 7_000_000_000, growthRate: 0.10, feeRate: 0.02, years: 20 })
    const loiKhac = fundFeeErosion({ principal: 100_000_000, growthRate: 0.03, feeRate: 0.02, years: 20 })
    expect(vonKhac.erosionPct).toBeCloseTo(base.erosionPct, RATE_PRECISION)
    expect(loiKhac.erosionPct).toBeCloseTo(base.erosionPct, RATE_PRECISION)
  })

  it('có phí thì tài sản cuối luôn thấp hơn không phí', () => {
    for (const { input } of FUND_FEE_EROSION_GOLDEN) {
      const got = fundFeeErosion(input)
      if (input.feeRate > 0) {
        expect(got.finalValueWithFee).toBeLessThan(got.finalValueNoFee)
        expect(got.erosionPct).toBeGreaterThan(0)
      } else {
        expect(got.finalValueWithFee).toBeCloseTo(got.finalValueNoFee, MONEY_PRECISION)
      }
    }
  })

  it('số năm bằng 0 hoặc âm thì chưa mất gì', () => {
    for (const years of [0, -5]) {
      const got = fundFeeErosion({ principal: 100_000_000, growthRate: 0.10, feeRate: 0.02, years })
      expect(got).toEqual({
        finalValueNoFee: 100_000_000,
        finalValueWithFee: 100_000_000,
        erosionPct: 0,
      })
    }
  })

  it('vốn bằng 0 thì erosionPct trả 0, không trả NaN', () => {
    const got = fundFeeErosion({ principal: 0, growthRate: 0.10, feeRate: 0.02, years: 20 })
    expect(Number.isFinite(got.erosionPct)).toBe(true)
    expect(got.erosionPct).toBe(0)
  })
})
