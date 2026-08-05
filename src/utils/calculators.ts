/**
 * Lõi tính toán cho Calculator Suite (tab "Máy tính").
 *
 * File này thuần tính toán, không import React hay recharts. `corePurity.test.ts`
 * quét cả thư mục `src/utils/` nên quy tắc đó tự động có hiệu lực ở đây.
 *
 * Mọi tỷ lệ nhận vào đều là số thập phân: 0.08 nghĩa là 8%/năm.
 */

export interface CompoundInterestInput {
  /** Vốn ban đầu, đơn vị đồng */
  principal: number
  /** Tỷ suất sinh lời mỗi năm, dạng thập phân (0.08 = 8%/năm) */
  annualRate: number
  years: number
  /** Số tiền góp thêm mỗi tháng. Để 0 thì thành lãi kép thuần. */
  monthlyContribution?: number
}

export interface CompoundInterestResult {
  finalValue: number
  /** Tổng số tiền bỏ ra: vốn ban đầu cộng toàn bộ tiền góp thêm */
  contributions: number
  /** Phần sinh ra nhờ lãi kép, bằng finalValue trừ contributions */
  interestEarned: number
}

/**
 * Lãi kép có góp thêm hàng tháng.
 *
 * Tiền góp vào CUỐI mỗi tháng (ordinary annuity), tức là khoản góp tháng đầu chỉ
 * bắt đầu sinh lời từ tháng thứ hai. Ai sửa về đầu kỳ (annuity due) thì kết quả
 * lệch lên, nhớ sửa cả golden test.
 *
 *   r = annualRate / 12
 *   n = years × 12
 *   finalValue = principal × (1+r)^n + monthlyContribution × [((1+r)^n − 1) / r]
 */
export function compoundInterest({
  principal,
  annualRate,
  years,
  monthlyContribution = 0,
}: CompoundInterestInput): CompoundInterestResult {
  // Kỳ hạn không dương thì chưa có gì xảy ra, tiền vẫn nguyên như lúc bỏ vào.
  if (years <= 0) {
    return { finalValue: principal, contributions: principal, interestEarned: 0 }
  }

  const r = annualRate / 12
  const n = years * 12
  const growth = Math.pow(1 + r, n)

  // r = 0 thì công thức annuity chia cho 0. Lãi suất bằng 0 nghĩa là tiền góp
  // nằm im, cộng thẳng lại là xong.
  const contributionValue = r === 0 ? monthlyContribution * n : monthlyContribution * ((growth - 1) / r)

  const finalValue = principal * growth + contributionValue
  const contributions = principal + monthlyContribution * n

  return {
    finalValue,
    contributions,
    interestEarned: finalValue - contributions,
  }
}

export interface CompoundInterestPoint {
  year: number
  /** Tiền bạn bỏ ra tính tới cuối năm này */
  contributions: number
  /** Phần lãi kép sinh ra tính tới cuối năm này */
  interestEarned: number
  finalValue: number
}

/**
 * Chuỗi giá trị từng năm để vẽ biểu đồ lãi kép.
 *
 * Mốc 0 là lúc mới bỏ vốn vào, chưa có lãi. Mỗi mốc sau gọi lại chính
 * `compoundInterest` với số năm tương ứng, nên đường biểu đồ và con số ở bảng
 * kết quả không bao giờ lệch nhau.
 */
export function compoundInterestSeries(input: CompoundInterestInput): CompoundInterestPoint[] {
  const soNam = Math.max(0, Math.floor(input.years))
  const points: CompoundInterestPoint[] = []
  for (let year = 0; year <= soNam; year++) {
    const { finalValue, contributions, interestEarned } = compoundInterest({ ...input, years: year })
    points.push({ year, contributions, interestEarned, finalValue })
  }
  return points
}

export interface CagrInput {
  startValue: number
  endValue: number
  years: number
}

/**
 * Quy đổi hai mốc giá trị thành tỷ suất sinh lời kép mỗi năm.
 *
 *   cagr = (endValue / startValue)^(1/years) − 1
 *
 * Trả về số thập phân: 0.1487 nghĩa là 14,87%/năm.
 *
 * Chặn 3 trường hợp cho ra Infinity hoặc NaN: vốn đầu kỳ bằng 0 hoặc âm, số năm
 * không dương, và giá trị cuối kỳ âm. Dashboard từng dính lỗi Sharpe vô cực nên
 * chỗ nào có phép chia và phép mũ là phải chặn trước.
 */
export function cagrFromValues({ startValue, endValue, years }: CagrInput): number {
  if (startValue <= 0 || years <= 0 || endValue < 0) return 0
  return Math.pow(endValue / startValue, 1 / years) - 1
}

export interface FundFeeErosionInput {
  principal: number
  /** Tỷ suất sinh lời gộp mỗi năm của quỹ, trước phí */
  growthRate: number
  /** Phí quỹ thu mỗi năm trên tài sản ròng, dạng thập phân (0.02 = 2%/năm) */
  feeRate: number
  years: number
}

export interface FundFeeErosionResult {
  finalValueNoFee: number
  finalValueWithFee: number
  /** Phần tài sản cuối kỳ bị phí lấy mất, dạng thập phân (0.332 = mất 33,2%) */
  erosionPct: number
}

/**
 * Phí quỹ ăn mòn bao nhiêu tài sản sau N năm.
 *
 *   finalValueNoFee   = principal × (1 + growthRate)^years
 *   finalValueWithFee = principal × [(1 + growthRate) × (1 − feeRate)]^years
 *   erosionPct        = 1 − finalValueWithFee / finalValueNoFee
 *
 * Vì sao NHÂN (1 − feeRate) chứ không trừ thẳng growthRate − feeRate: phí quỹ thu
 * trên tài sản ròng (NAV) mỗi năm, không phải trừ vào tỷ suất sinh lời. Hai đại
 * lượng khác bản chất, cộng trừ vào nhau là sai. Cách nhân này theo chuẩn CFAI,
 * cũng là cách Morningstar và Vanguard tính expense ratio drag.
 *
 * Hệ quả rút gọn: erosionPct = 1 − (1 − feeRate)^years, không phụ thuộc vào
 * principal lẫn growthRate. Phí 2%/năm trong 20 năm ăn mòn 33,2% tài sản cuối,
 * quỹ lời nhiều hay ít cũng vậy.
 */
export function fundFeeErosion({
  principal,
  growthRate,
  feeRate,
  years,
}: FundFeeErosionInput): FundFeeErosionResult {
  if (years <= 0) {
    return { finalValueNoFee: principal, finalValueWithFee: principal, erosionPct: 0 }
  }

  const finalValueNoFee = principal * Math.pow(1 + growthRate, years)
  const finalValueWithFee = principal * Math.pow((1 + growthRate) * (1 - feeRate), years)

  // Vốn bằng 0 hoặc quỹ mất sạch thì mẫu số bằng 0, không có gì để so tỷ lệ.
  const erosionPct = finalValueNoFee === 0 ? 0 : 1 - finalValueWithFee / finalValueNoFee

  return { finalValueNoFee, finalValueWithFee, erosionPct }
}

export interface FundFeeErosionPoint {
  year: number
  finalValueNoFee: number
  finalValueWithFee: number
  /** Khoảng cách giữa hai đường, tức phần phí đã lấy mất tới cuối năm này */
  feeLost: number
  erosionPct: number
}

/**
 * Chuỗi giá trị từng năm để vẽ biểu đồ phí ăn mòn.
 *
 * Cũng gọi lại `fundFeeErosion` ở từng mốc như bên lãi kép, để đường vẽ ra khớp
 * đúng con số ở bảng kết quả.
 */
export function fundFeeErosionSeries(input: FundFeeErosionInput): FundFeeErosionPoint[] {
  const soNam = Math.max(0, Math.floor(input.years))
  const points: FundFeeErosionPoint[] = []
  for (let year = 0; year <= soNam; year++) {
    const { finalValueNoFee, finalValueWithFee, erosionPct } = fundFeeErosion({ ...input, years: year })
    points.push({
      year,
      finalValueNoFee,
      finalValueWithFee,
      feeLost: finalValueNoFee - finalValueWithFee,
      erosionPct,
    })
  }
  return points
}
