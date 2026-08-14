/**
 * Detector red flag thuần cho tab Phân Tích Quỹ (core-purity: không import React).
 *
 * Mỗi detector nhận một chuỗi kỳ (RedFlagPoint[]) đã được gom từ các parser sẵn có,
 * tính verdict theo ngưỡng giải thích được. Verdict:
 *   OK      — bình thường
 *   WATCH   — cần chú ý
 *   DANGER  — nguy hiểm
 *   N/A     — thiếu dữ liệu (KHÔNG phải xanh; xanh giả là silent failure)
 *
 * Quan trọng: turnoverRate (2270) lưu tỉ lệ THÔ (6,84 = 684%), detector phải ×100.
 * Đây là bug từng xảy ra ở chart turnover (commit 850850c) — regression test canh.
 */

export type Verdict = 'OK' | 'WATCH' | 'DANGER' | 'N/A'

export type RedFlagId = 'machine' | 'relatedParty' | 'forcedSale' | 'cashPile'

/** Một kỳ dữ liệu đã parse, gom đủ field cho 4 detector. */
export interface RedFlagPoint {
  period: string
  /** 2270 portfolio turnover, lưu tỉ lệ thô (6.84 = 684%). */
  turnoverRate: number | null
  /** 2231 phí giao dịch chứng khoán. */
  brokerageFee: number | null
  /** 2225 phí quản lý. */
  managementFee: number | null
  /** 2282 tỉ lệ sở hữu công ty quản lý + bên liên quan (0-1). */
  relatedPartyOwnership: number | null
  /** 2281 số chứng chỉ lưu hành. */
  outstandingUnits: number | null
  /** 2239.3.2 thay đổi NAV do mua lại chứng chỉ (âm). */
  redemptionFlow: number | null
  /** 2235 lãi/lỗ thực hiện khi bán. */
  realizedGain: number | null
  /** allocation.cashValue — tiền mặt. */
  cashValue: number | null
  /** allocation.totalValue — tổng tài sản. */
  totalValue: number | null
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
export const RELATED_DROP_DANGER = 0.5 // rút ≥ 50% vị thế trong 6 tháng
export const RELATED_DROP_WATCH = 0.3
export const REDEMPTION_DANGER = 50_000_000_000 // VND
export const REDEMPTION_WATCH = 20_000_000_000
export const REALIZED_DANGER = -100_000_000_000 // lãi/lỗ thực hiện ≤ −100 tỷ
export const REALIZED_WATCH = -50_000_000_000
export const CASH_DANGER = 0.3 // tiền mặt / tổng tài sản
export const CASH_WATCH_HIGH = 0.2
export const CASH_WATCH_LOW = 0.05

/** Số kỳ lùi lại để tính Δ vị thế bên liên quan (6 tháng). */
const RELATED_LOOKBACK = 5

function formatPct(frac: number): string {
  return `${(frac * 100).toFixed(0)}%`
}

/** D1 — Cỗ máy giao dịch: turnover cao + phí môi giới gần bằng phí quản lý. */
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

/** D2 — Bên liên quan rút: vị thế tuyệt đối (2282 × 2281), Δ 6 tháng. */
function computeRelatedParty(points: RedFlagPoint[], i: number): Omit<RedFlagResult, 'id' | 'period'> {
  const p = points[i]!
  const prior = points[i - RELATED_LOOKBACK]
  const posNow =
    p.relatedPartyOwnership !== null && p.outstandingUnits !== null
      ? p.relatedPartyOwnership * p.outstandingUnits
      : null
  if (posNow === null || !prior || prior.relatedPartyOwnership === null || prior.outstandingUnits === null) {
    return { verdict: 'N/A', keyMetric: null, extra: null }
  }
  const posPrior = prior.relatedPartyOwnership * prior.outstandingUnits
  let drop = 0
  if (posPrior > 0) drop = (posPrior - posNow) / posPrior
  else if (posNow > 0) drop = 0 // từ 0 lên dương = tăng vị thế, không phải rút
  const danger = drop >= RELATED_DROP_DANGER
  const watch = drop >= RELATED_DROP_WATCH
  return {
    verdict: danger ? 'DANGER' : watch ? 'WATCH' : 'OK',
    keyMetric: drop,
    extra: formatPct(drop),
  }
}

/** D3 — Rút vốn buộc bán: mua lại lớn + lãi/lỗ thực hiện âm cùng tháng. */
function computeForcedSale(p: RedFlagPoint): Omit<RedFlagResult, 'id' | 'period'> {
  if (p.redemptionFlow === null || p.realizedGain === null) {
    return { verdict: 'N/A', keyMetric: null, extra: null }
  }
  const redemption = -p.redemptionFlow // 2239.3.2 âm → dương độ lớn
  const danger = redemption >= REDEMPTION_DANGER && p.realizedGain <= REALIZED_DANGER
  const watch = redemption >= REDEMPTION_WATCH && p.realizedGain <= REALIZED_WATCH
  return {
    verdict: danger ? 'DANGER' : watch ? 'WATCH' : 'OK',
    keyMetric: redemption,
    extra: null,
  }
}

/** D4 — Cọc tiền mặt: tiền mặt / tổng tài sản, quá cao hoặc quá căng. */
function computeCashPile(p: RedFlagPoint): Omit<RedFlagResult, 'id' | 'period'> {
  if (p.cashValue === null || p.totalValue === null || p.totalValue <= 0) {
    return { verdict: 'N/A', keyMetric: null, extra: null }
  }
  const ratio = p.cashValue / p.totalValue
  const verdict: Verdict =
    ratio > CASH_DANGER ? 'DANGER' : ratio >= CASH_WATCH_HIGH ? 'WATCH' : ratio > CASH_WATCH_LOW ? 'OK' : 'WATCH'
  return { verdict, keyMetric: ratio, extra: formatPct(ratio) }
}

/** Tính verdict cho điểm thứ `index` trong chuỗi (points xếp tăng dần theo kỳ). */
export function computeVerdictAt(id: RedFlagId, points: RedFlagPoint[], index: number): RedFlagResult {
  const p = points[index]
  if (!p) return { id, period: '', verdict: 'N/A', keyMetric: null, extra: null }
  let r: Omit<RedFlagResult, 'id' | 'period'>
  switch (id) {
    case 'machine':
      r = computeMachine(p)
      break
    case 'relatedParty':
      r = computeRelatedParty(points, index)
      break
    case 'forcedSale':
      r = computeForcedSale(p)
      break
    case 'cashPile':
      r = computeCashPile(p)
      break
  }
  return { id, period: p.period, ...r }
}

/** Verdict cho kỳ mới nhất trong chuỗi. */
export function redFlagSummary(id: RedFlagId, points: RedFlagPoint[]): RedFlagResult {
  return computeVerdictAt(id, points, points.length - 1)
}

/** Verdict từng kỳ (12 kỳ mới nhất) cho strip lịch sử. */
export function redFlagHistory(id: RedFlagId, points: RedFlagPoint[]): { period: string; verdict: Verdict }[] {
  const start = Math.max(0, points.length - 12)
  return points.slice(start).map((_, j) => {
    const i = start + j
    return { period: points[i]!.period, verdict: computeVerdictAt(id, points, i).verdict }
  })
}
