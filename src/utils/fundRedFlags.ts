/**
 * Detector red flag thuần cho tab Phân Tích Quỹ (core-purity: không import React).
 *
 * Nhận một chuỗi kỳ (RedFlagPoint[]) đã được gom từ các parser sẵn có, tính verdict
 * theo ngưỡng giải thích được. Verdict:
 *   OK      — bình thường
 *   WATCH   — cần chú ý
 *   DANGER  — nguy hiểm
 *   N/A     — thiếu dữ liệu (KHÔNG phải xanh; xanh giả là silent failure)
 *
 * Detector hiện tại:
 *   machine — Cỗ máy giao dịch: turnover cao + phí môi giới gần bằng phí quản lý.
 *
 * Quan trọng: turnoverRate (2270) lưu tỉ lệ THÔ (6,84 = 684%), detector phải ×100.
 * Đây là bug từng xảy ra ở chart turnover (commit 850850c) — regression test canh.
 */

export type Verdict = 'OK' | 'WATCH' | 'DANGER' | 'N/A'

export type RedFlagId = 'machine'

/** Một kỳ dữ liệu đã parse, gom đủ field cho detector machine. */
export interface RedFlagPoint {
  period: string
  /** 2270 portfolio turnover, lưu tỉ lệ thô (6.84 = 684%). */
  turnoverRate: number | null
  /** 2231 phí giao dịch chứng khoán. */
  brokerageFee: number | null
  /** 2225 phí quản lý. */
  managementFee: number | null
}

export interface RedFlagResult {
  id: RedFlagId
  period: string
  verdict: Verdict
  /** Chỉ số chính (đơn vị tùy detector, component tự định dạng). */
  keyMetric: number | null
  /** Chỉ số phụ đã format dạng text (vd "63%"). */
  extra: string | null
}

// ── Ngưỡng (hằng số dễ chỉnh) ──────────────────────────────────────────────
export const TURNOVER_DANGER = 500 // %
export const TURNOVER_WATCH = 300 // %
export const MG_RATIO_DANGER = 0.8 // phí môi giới / phí quản lý
export const MG_RATIO_WATCH = 0.5

function formatPct(frac: number): string {
  return `${(frac * 100).toFixed(0)}%`
}

/** Cỗ máy giao dịch: turnover cao + phí môi giới gần bằng phí quản lý. */
function computeMachine(p: RedFlagPoint): Omit<RedFlagResult, 'id' | 'period'> {
  const turnoverPct = p.turnoverRate === null ? null : p.turnoverRate * 100
  if (turnoverPct === null) {
    return { verdict: 'N/A', keyMetric: null, extra: null }
  }
  let ratio: number | null = null
  if (p.brokerageFee !== null && p.managementFee !== null && p.managementFee > 0) {
    ratio = p.brokerageFee / p.managementFee
  }
  const danger = turnoverPct >= TURNOVER_DANGER || (ratio !== null && ratio >= MG_RATIO_DANGER)
  const watch = turnoverPct >= TURNOVER_WATCH || (ratio !== null && ratio >= MG_RATIO_WATCH)
  return {
    verdict: danger ? 'DANGER' : watch ? 'WATCH' : 'OK',
    keyMetric: turnoverPct,
    extra: ratio === null ? null : formatPct(ratio),
  }
}

/** Tính verdict cho điểm thứ `index` trong chuỗi (points xếp tăng dần theo kỳ). */
export function computeVerdictAt(id: RedFlagId, points: RedFlagPoint[], index: number): RedFlagResult {
  const p = points[index]
  if (!p) return { id, period: '', verdict: 'N/A', keyMetric: null, extra: null }
  const r = computeMachine(p)
  return { id, period: p.period, ...r }
}

/** Verdict cho kỳ mới nhất trong chuỗi. */
export function redFlagSummary(id: RedFlagId, points: RedFlagPoint[]): RedFlagResult {
  return computeVerdictAt(id, points, points.length - 1)
}
