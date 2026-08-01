/**
 * GOLDEN FIXTURE cho riskContribution (src/utils/calculations.ts).
 *
 * Đầu vào là số liệu cố định, đầu ra là giá trị golden đã kiểm chứng độc lập
 * (script tham chiếu viết lại công thức covariance từ đầu, không dùng code gốc).
 * Mục đích: canh chặn refactor — nếu một lần sửa công thức làm lệch dù 1 phần
 * nghìn, test phải đỏ.
 *
 * Dữ liệu BTC/quỹ là 12 tuần lợi nhuận đầu tiên của cặp aligned
 * (BTC daily resample tuần, E1VFVN30 weekly), snapshot cố định — không đọc
 * CSV live để test không nhạy với ngày cập nhật dữ liệu.
 */
export interface RiskContributionGoldenCase {
  name: string
  returnsA: number[]
  returnsB: number[]
  weightA: number
  weightB: number
  expected: { contribA: number; contribB: number }
}

export const RISK_CONTRIBUTION_GOLDEN: RiskContributionGoldenCase[] = [
  {
    // Mẫu nhỏ tính tay được: A lệch nhiều hơn B nên gánh phần lớn rủi ro.
    // covAA≈0.00563, covBB≈0.00123, covAB≈0.00122, portSd≈0.05816,
    // contribA≈0.8916, contribB≈0.1084.
    name: 'tiny hand-computed',
    returnsA: [0.10, -0.05, 0.02],
    returnsB: [0.04, 0.01, -0.03],
    weightA: 0.7,
    weightB: 0.3,
    expected: { contribA: 0.8916428501034788, contribB: 0.10835714989652113 },
  },
  {
    name: 'BTC 2% (realistic)',
    returnsA: [
      -0.209483, 0.202441, -0.098917, -0.020169, 0.051486, 0.003517,
      0.104079, 0.053585, 0.045624, -0.061021, -0.090953, 0.095056,
    ],
    returnsB: [
      -0.020202, 0.000000, 0.020619, -0.010101, 0.010204, -0.030303,
      -0.010417, 0.021053, -0.020619, -0.052632, 0.022222, 0.021739,
    ],
    weightA: 0.02,
    weightB: 0.98,
    expected: { contribA: 0.024818314313953628, contribB: 0.9751816856860462 },
  },
  {
    name: 'BTC 5% (realistic)',
    returnsA: [
      -0.209483, 0.202441, -0.098917, -0.020169, 0.051486, 0.003517,
      0.104079, 0.053585, 0.045624, -0.061021, -0.090953, 0.095056,
    ],
    returnsB: [
      -0.020202, 0.000000, 0.020619, -0.010101, 0.010204, -0.030303,
      -0.010417, 0.021053, -0.020619, -0.052632, 0.022222, 0.021739,
    ],
    weightA: 0.05,
    weightB: 0.95,
    expected: { contribA: 0.0888681585851731, contribB: 0.9111318414148268 },
  },
  {
    name: 'BTC 10% (realistic)',
    returnsA: [
      -0.209483, 0.202441, -0.098917, -0.020169, 0.051486, 0.003517,
      0.104079, 0.053585, 0.045624, -0.061021, -0.090953, 0.095056,
    ],
    returnsB: [
      -0.020202, 0.000000, 0.020619, -0.010101, 0.010204, -0.030303,
      -0.010417, 0.021053, -0.020619, -0.052632, 0.022222, 0.021739,
    ],
    weightA: 0.1,
    weightB: 0.9,
    expected: { contribA: 0.2421721244436237, contribB: 0.7578278755563762 },
  },
]
