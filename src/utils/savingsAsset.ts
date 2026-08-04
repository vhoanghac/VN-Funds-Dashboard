import type { PricePoint } from '../types'

/**
 * Tài sản giả lập "tiết kiệm ngân hàng, lãi suất cố định", dùng để trộn
 * chung với ETF/quỹ trong danh mục DCA đa tài sản, thay vì ép người dùng
 * chọn DCBF (quỹ trái phiếu, có rủi ro NAV và phí quản lý riêng) làm đại
 * diện cho phần tiền gửi tiết kiệm.
 *
 * ID dạng "SAVINGS:<rate>" (vd "SAVINGS:6" = lãi suất 6%/năm cố định), mã
 * hoá lãi suất ngay trong id để tái dùng toàn bộ hạ tầng slot/weight/rebalance
 * hiện có mà không cần thêm field mới vào DCASlot.
 */
export const SAVINGS_ID_PREFIX = 'SAVINGS:'

/** Lãi suất mặc định khi người dùng vừa chọn "Tiết kiệm ngân hàng" trong danh sách quỹ. */
export const DEFAULT_SAVINGS_RATE = 6

/** Nhãn hiển thị trong danh sách chọn quỹ, dùng chung cho mọi mức lãi suất vì rate sửa bằng ô nhập riêng ngay cạnh weight. */
export const SAVINGS_OPTION_LABEL = 'Tiết kiệm ngân hàng (lãi suất cố định, tự nhập)'

export function savingsAssetId(ratePct: number): string {
  return `${SAVINGS_ID_PREFIX}${ratePct}`
}

export function isSavingsAssetId(id: string): boolean {
  return id.startsWith(SAVINGS_ID_PREFIX)
}

/** Đọc lại lãi suất (%) đã mã hoá trong id "SAVINGS:<rate>". NaN → 0. */
export function parseSavingsRate(id: string): number {
  const rate = Number(id.slice(SAVINGS_ID_PREFIX.length))
  return Number.isFinite(rate) ? rate : 0
}

/**
 * Sinh chuỗi giá hàng ngày cho tài sản tiết kiệm lãi kép cố định, từ
 * `fromDate` đến `toDate` (bao gồm cả hai đầu), gốc 100 tại `fromDate`.
 *
 * Lãi kép hàng ngày theo công thức đóng (không lặp từng ngày để tính), giả
 * định 365.25 ngày/năm — khớp với cách MONTHLY_FACTOR trong dca.ts quy đổi
 * lịch.
 */
export function generateSavingsSeries(ratePct: number, fromDate: string, toDate: string): PricePoint[] {
  const from = new Date(fromDate + 'T00:00:00Z')
  const to = new Date(toDate + 'T00:00:00Z')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return []

  const annualRate = ratePct / 100
  const points: PricePoint[] = []
  const msPerDay = 24 * 60 * 60 * 1000

  for (let t = from.getTime(); t <= to.getTime(); t += msPerDay) {
    const daysElapsed = (t - from.getTime()) / msPerDay
    const price = 100 * Math.pow(1 + annualRate, daysElapsed / 365.25)
    points.push({ date: new Date(t).toISOString().substring(0, 10), price })
  }
  return points
}
