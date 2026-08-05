import { describe, it, expect } from 'vitest'
import { computeMetrics, runRebalanceSensitivity } from './rebalanceSensitivity'
import type { PricePoint } from '../types'
import type { DCASlot } from './dca'

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

// ─── feePct (phí giao dịch mỗi lần tái cân bằng) ────────────────────────

function prices(values: number[]): PricePoint[] {
  const start = new Date(Date.UTC(2020, 0, 1))
  return values.map((v, i) => {
    const d = new Date(start.getTime() + i * 86400000)
    return {
      date: d.toISOString().substring(0, 10),
      price: v,
    }
  })
}

/**
 * Dựng chuỗi giá từ lợi nhuận mỗi ngày (điểm 0 = giá 100, điểm i>0 = điểm
 * trước × (1 + LNgày thứ i)). Trả đủ `points` điểm (>=30) để vượt ngưỡng
 * `firstFund.length < 30` trong runRebalanceSensitivity.
 */
function runWith(input: {
  feePct?: number
  schedule: 'daily' | 'quarterly' | 'yearly'
  fundANotReturn?: boolean
  dailyReturnA: number
  dailyReturnB: number
  points?: number
}) {
  const points = Math.max(input.points ?? 40, 30)
  const build = (daily: number): number[] => {
    const out: number[] = [100]
    for (let i = 1; i < points; i++) out.push(out[i - 1]! * (1 + daily))
    return out
  }
  const a = prices(build(input.dailyReturnA))
  const b = prices(build(input.dailyReturnB))
  const alignedPrices = new Map<string, PricePoint[]>()
  alignedPrices.set('A', a)
  alignedPrices.set('B', b)
  const slots: DCASlot[] = [
    { fundId: 'A', weight: 50 },
    { fundId: 'B', weight: 50 },
  ]
  return runRebalanceSensitivity({
    alignedPrices,
    slots,
    schedules: [input.schedule],
    absBand: null,
    relBand: null,
    feePct: input.feePct,
  })
}

describe('feePct (phí giao dịch mỗi lần tái cân bằng)', () => {
  it('fee = 0 thì kết quả không đổi so với không truyền feePct', () => {
    const r1 = runWith({ schedule: 'quarterly', dailyReturnA: 0.001, dailyReturnB: -0.0005 })
    const r2 = runWith({ feePct: 0, schedule: 'quarterly', dailyReturnA: 0.001, dailyReturnB: -0.0005 })
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    expect(r1!.variants.map(v => v.cagr)).toEqual(r2!.variants.map(v => v.cagr))
  })

  it('fee > 0 làm giảm CAGR của biến thể tái cân bằng, không đụng baseline không tái cân bằng', () => {
    const r0 = runWith({ schedule: 'daily', dailyReturnA: 0.002, dailyReturnB: -0.001 })
    const r1 = runWith({ feePct: 5, schedule: 'daily', dailyReturnA: 0.002, dailyReturnB: -0.001 })
    expect(r0).not.toBeNull()
    expect(r1).not.toBeNull()

    const none0 = r0!.variants.find(v => v.group === 'none')!
    const none1 = r1!.variants.find(v => v.group === 'none')!
    expect(none0.cagr).toBeCloseTo(none1.cagr, 10)

    const daily0 = r0!.variants.find(v => v.group === 'daily')!
    const daily1 = r1!.variants.find(v => v.group === 'daily')!
    expect(daily1.cagr).toBeLessThan(daily0.cagr)
  })

  it('tái cân bằng càng nhiều lần thì phí tổng càng lớn (daily tốn hơn yearly)', () => {
    const daily = runWith({ feePct: 1, schedule: 'daily', dailyReturnA: 0.002, dailyReturnB: -0.001 })
    const yearly = runWith({ feePct: 1, schedule: 'yearly', dailyReturnA: 0.002, dailyReturnB: -0.001 })
    expect(daily).not.toBeNull()
    expect(yearly).not.toBeNull()
    const d = daily!.variants.find(v => v.group === 'daily')!
    const y = yearly!.variants.find(v => v.group === 'yearly')!
    expect(d.rebalCount).toBeGreaterThan(y.rebalCount)
    expect(d.cagr).toBeLessThan(y.cagr)
  })

  it('phí trừ đúng trên phần tài sản lệch tỷ trọng (cả chiều bán lẫn mua = ×2)', () => {
    // Ngày 1: A tăng 10%, B không đổi → total = 0.5·1.1 + 0.5 = 1.05.
    // traded (phần thừa của A) = 0.5·1.1 − 1.05·0.5 = 0.025.
    // Phí = traded·feeRate·2 = 0.025·0.02·2 = 0.001 → total còn 1.049.
    // Những ngày sau không có lệch nữa (cả 2 đều 0%) nên không phát thêm phí.
    // Dựng thủ công 30 điểm: ngày 1 A nhảy +10%, sau đó phẳng; B phẳng cả kỳ.
    const a = prices((() => {
      const out: number[] = [100]
      for (let i = 1; i < 30; i++) out.push(out[i - 1]! * (i === 1 ? 1.1 : 1))
      return out
    })())
    const b = prices(Array.from({ length: 30 }, () => 100))
    const alignedPrices = new Map<string, PricePoint[]>()
    alignedPrices.set('A', a)
    alignedPrices.set('B', b)
    const r2 = runRebalanceSensitivity({
      alignedPrices,
      slots: [
        { fundId: 'A', weight: 50 },
        { fundId: 'B', weight: 50 },
      ],
      schedules: ['daily'],
      absBand: null,
      relBand: null,
      feePct: 2,
    })
    expect(r2).not.toBeNull()
    const v = r2!.variants.find(v => v.group === 'daily')!
    // Total cuối = 1.049 (không đổi sau ngày 1 vì không còn lệch).
    const years = 29 / 365.25
    expect(v.cagr).toBeCloseTo(Math.pow(1.049, 1 / years) - 1, 6)
  })

  it('band (ngưỡng lệch) cũng chịu phí đúng như lịch cố định', () => {
    // Dựng 30 điểm: A nhảy +10% ngày 1 rồi phẳng, B phẳng cả kỳ → vi phạm
    // ngưỡng tuyệt đối 1% ngay ngày 1 (drift 5 điểm %) → có 1 lần cân.
    const a = prices((() => {
      const out: number[] = [100]
      for (let i = 1; i < 30; i++) out.push(out[i - 1]! * (i === 1 ? 1.1 : 1))
      return out
    })())
    const b = prices(Array.from({ length: 30 }, () => 100))
    const alignedPrices = new Map<string, PricePoint[]>()
    alignedPrices.set('A', a)
    alignedPrices.set('B', b)
    const run = (feePct: number) => runRebalanceSensitivity({
      alignedPrices,
      slots: [
        { fundId: 'A', weight: 50 },
        { fundId: 'B', weight: 50 },
      ],
      schedules: [],
      absBand: { start: 1, step: 1, end: 1 },
      relBand: null,
      feePct,
    })

    const r0 = run(0)
    const r1 = run(2)
    expect(r0).not.toBeNull()
    expect(r1).not.toBeNull()
    const band0 = r0!.variants.find(v => v.group === 'band-abs')!
    const band1 = r1!.variants.find(v => v.group === 'band-abs')!
    expect(band0.rebalCount).toBe(1)
    // Phí ×2 đúng: traded = 0.025, fee 2% → total sau phí = 1.05 − 0.025·0.02·2 = 1.049.
    const years = 29 / 365.25
    expect(band1.cagr).toBeCloseTo(Math.pow(1.049, 1 / years) - 1, 6)
  })
})
