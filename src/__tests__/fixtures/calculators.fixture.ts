/**
 * GOLDEN FIXTURE cho Calculator Suite (src/utils/calculators.ts).
 *
 * Mọi con số `expected` dưới đây sinh ra từ script tham chiếu độc lập, mô phỏng
 * từng tháng (lãi kép) và từng năm (phí quỹ) bằng vòng lặp, KHÔNG dùng công thức
 * đóng như code gốc. Nhờ vậy test không tự xác nhận chính nó: nếu công thức đóng
 * bị sửa lệch, vòng lặp tham chiếu vẫn giữ nguyên số cũ và test đỏ ngay.
 *
 * Ba công thức được canh (bản gốc ghi ở TODOS.md mục Bước 1):
 *   compoundInterest: góp CUỐI kỳ, ordinary annuity
 *   cagrFromValues:   (end/start)^(1/years) − 1
 *   fundFeeErosion:   phí nhân (1 − feeRate) mỗi năm trên NAV, chuẩn CFAI
 */

export interface CompoundInterestGoldenCase {
  name: string
  input: { principal: number; annualRate: number; years: number; monthlyContribution?: number }
  expected: { finalValue: number; contributions: number; interestEarned: number }
}

export const COMPOUND_INTEREST_GOLDEN: CompoundInterestGoldenCase[] = [
  {
    // Bộ default của UI: 100 triệu, 8%/năm, 20 năm, không góp thêm.
    name: 'lãi kép thuần 100tr / 8%/năm / 20 năm',
    input: { principal: 100_000_000, annualRate: 0.08, years: 20, monthlyContribution: 0 },
    expected: {
      finalValue: 492_680_277.08096963,
      contributions: 100_000_000,
      interestEarned: 392_680_277.08096963,
    },
  },
  {
    // Góp thêm 5 triệu mỗi tháng suốt 240 tháng. Tiền góp (1,2 tỷ) lớn hơn nhiều
    // so với vốn ban đầu nên phần annuity chiếm phần lớn giá trị cuối.
    name: 'có góp thêm 5tr/tháng, 100tr / 8%/năm / 20 năm',
    input: { principal: 100_000_000, annualRate: 0.08, years: 20, monthlyContribution: 5_000_000 },
    expected: {
      finalValue: 3_437_782_355.1882734,
      contributions: 1_300_000_000,
      interestEarned: 2_137_782_355.1882734,
    },
  },
  {
    // Biên r = 0: công thức annuity chia cho 0, phải rẽ nhánh. Lãi suất bằng 0
    // thì tiền nằm im, giá trị cuối đúng bằng tổng tiền bỏ vào.
    name: 'biên lãi suất 0%: tiền góp nằm im, không sinh lời',
    input: { principal: 50_000_000, annualRate: 0, years: 10, monthlyContribution: 1_000_000 },
    expected: { finalValue: 170_000_000, contributions: 170_000_000, interestEarned: 0 },
  },
  {
    // Gộp theo tháng nên 12%/năm ra 12,68%, không phải đúng 12%.
    name: 'gộp theo tháng: 12%/năm danh nghĩa ra 12,68% thực nhận',
    input: { principal: 10_000_000, annualRate: 0.12, years: 1 },
    expected: {
      finalValue: 11_268_250.301319696,
      contributions: 10_000_000,
      interestEarned: 1_268_250.301319696,
    },
  },
]

export interface CagrGoldenCase {
  name: string
  input: { startValue: number; endValue: number; years: number }
  expected: number
}

export const CAGR_GOLDEN: CagrGoldenCase[] = [
  {
    // Bộ default của UI. Nhân đôi sau 5 năm ra 14,87%/năm.
    name: 'gấp đôi sau 5 năm',
    input: { startValue: 100_000_000, endValue: 200_000_000, years: 5 },
    expected: 0.148698355,
  },
  {
    // Lỗ cũng phải ra số âm đúng, không chặn về 0.
    name: 'lỗ 20% sau 3 năm ra CAGR âm',
    input: { startValue: 100_000_000, endValue: 80_000_000, years: 3 },
    expected: -0.0716822333,
  },
  {
    name: 'đứng yên thì CAGR bằng 0',
    input: { startValue: 100_000_000, endValue: 100_000_000, years: 10 },
    expected: 0,
  },
]

export interface FundFeeErosionGoldenCase {
  name: string
  input: { principal: number; growthRate: number; feeRate: number; years: number }
  expected: { finalValueNoFee: number; finalValueWithFee: number; erosionPct: number }
}

export const FUND_FEE_EROSION_GOLDEN: FundFeeErosionGoldenCase[] = [
  {
    // Bộ default của UI: 100 triệu, quỹ lời 10%/năm, phí 2%/năm, 20 năm.
    // Phí lấy mất 223,6 triệu, tức 33,2% tài sản cuối.
    name: 'default 100tr / lời 10% / phí 2% / 20 năm',
    input: { principal: 100_000_000, growthRate: 0.10, feeRate: 0.02, years: 20 },
    expected: {
      finalValueNoFee: 672_749_994.9325612,
      finalValueWithFee: 449_133_259.6151771,
      erosionPct: 0.3323920282,
    },
  },
  {
    // Cùng phí, cùng số năm, quỹ lời ít hơn hẳn (5% thay vì 10%). erosionPct
    // vẫn y nguyên 33,2%. Đây là hệ quả của cách nhân (1 − feeRate): tỷ lệ ăn
    // mòn không phụ thuộc quỹ lời bao nhiêu. Nếu ai sửa thành trừ thẳng
    // growthRate − feeRate thì case này lệch ngay.
    name: 'quỹ lời 5% thay vì 10%, tỷ lệ ăn mòn không đổi',
    input: { principal: 100_000_000, growthRate: 0.05, feeRate: 0.02, years: 20 },
    expected: {
      finalValueNoFee: 265_329_770.51444212,
      finalValueWithFee: 177_136_269.93939134,
      erosionPct: 0.3323920282,
    },
  },
  {
    name: 'biên phí 0%: hai giá trị bằng nhau, không ăn mòn',
    input: { principal: 100_000_000, growthRate: 0.10, feeRate: 0, years: 20 },
    expected: {
      finalValueNoFee: 672_749_994.9325612,
      finalValueWithFee: 672_749_994.9325612,
      erosionPct: 0,
    },
  },
]
