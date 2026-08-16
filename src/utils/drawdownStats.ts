/**
 * Thống kê chi tiết về drawdown (mức sụt giảm so với đỉnh), kiểu Testfolio:
 *   - drawdownEpisodes: tách chuỗi underwater thành từng "đợt sụt giảm" riêng
 *     (đỉnh → đáy → hồi phục) để liệt kê top các đợt lớn nhất.
 *   - avgDrawdown / longestDrawdownDays: 2 cột "Avg Drawdown" / "Longest
 *     Drawdown" trong bảng Statistics của Testfolio.
 *   - annualizedStdevFromCumulative: biến động (độ lệch chuẩn quy năm) từ chuỗi TWRR.
 *
 * Input là chuỗi drawdown TWRR (0 tại đỉnh, âm khi dưới đỉnh) do simulateDCA
 * trả về — đã loại noise cashflow nên phản ánh đúng "bão thị trường".
 */
import type { ReturnPoint } from '../types'
import { daysBetween } from './dateMath'

/** Ngưỡng coi như "đang ở đỉnh" (tránh sai số floating point quanh 0) */
const AT_PEAK = -1e-9

export interface DrawdownEpisode {
  /** Ngày cuối cùng còn ở đỉnh trước khi bắt đầu rơi */
  peakDate: string
  /** Ngày chạm đáy (drawdown sâu nhất trong đợt) */
  troughDate: string
  /** Ngày vượt lại đỉnh cũ; null = chưa hồi phục tính đến cuối kỳ */
  recoveryDate: string | null
  /** Mức sụt giảm sâu nhất của đợt (âm, vd -0.47) */
  depth: number
  /** Tổng số ngày dưới đỉnh: peak → recovery (hoặc → cuối kỳ nếu chưa hồi phục) */
  totalDays: number
}

/**
 * Tách chuỗi drawdown thành các đợt riêng biệt, sắp theo độ sâu giảm dần.
 * `minDepth` lọc bỏ các đợt rung lắc nhỏ (mặc định chỉ giữ đợt sụt ≥ 5%).
 */
export function drawdownEpisodes(
  drawdown: ReturnPoint[],
  minDepth = -0.05,
): DrawdownEpisode[] {
  if (drawdown.length === 0) return []

  const episodes: DrawdownEpisode[] = []
  let peakDate = drawdown[0]!.date
  let inEpisode = false
  let troughDate = ''
  let depth = 0

  for (const pt of drawdown) {
    if (pt.value >= AT_PEAK) {
      if (inEpisode) {
        // Hồi phục: đóng đợt hiện tại
        episodes.push({
          peakDate,
          troughDate,
          recoveryDate: pt.date,
          depth,
          totalDays: daysBetween(peakDate, pt.date),
        })
        inEpisode = false
        depth = 0
      }
      peakDate = pt.date
    } else {
      if (!inEpisode) {
        inEpisode = true
        troughDate = pt.date
        depth = pt.value
      } else if (pt.value < depth) {
        depth = pt.value
        troughDate = pt.date
      }
    }
  }

  // Đợt cuối chưa hồi phục tính đến cuối chuỗi
  if (inEpisode) {
    const lastDate = drawdown[drawdown.length - 1]!.date
    episodes.push({
      peakDate,
      troughDate,
      recoveryDate: null,
      depth,
      totalDays: daysBetween(peakDate, lastDate),
    })
  }

  return episodes
    .filter(e => e.depth <= minDepth)
    .sort((a, b) => a.depth - b.depth)
}

/**
 * Trung bình mức sụt giảm trên TẤT CẢ các ngày trong kỳ (ngày lập đỉnh mới
 * tính 0%). Cho biết mức "chìm dưới đỉnh" điển hình, thay vì chỉ điểm tệ nhất.
 */
export function avgDrawdown(drawdown: ReturnPoint[]): number | null {
  if (drawdown.length === 0) return null
  const sum = drawdown.reduce((s, p) => s + Math.min(p.value, 0), 0)
  return sum / drawdown.length
}

/**
 * Đợt dưới đỉnh dài nhất (ngày), tính từ lúc lập đỉnh đến khi vượt lại đỉnh đó.
 * Đợt chưa hồi phục vẫn được tính với độ dài đến cuối kỳ.
 * Không áp ngưỡng độ sâu: một đợt -3% kéo dài 2 năm vẫn là "dưới đỉnh 2 năm".
 */
export function longestDrawdownDays(drawdown: ReturnPoint[]): number | null {
  const episodes = drawdownEpisodes(drawdown, 0)
  if (episodes.length === 0) return null
  return Math.max(...episodes.map(e => e.totalDays))
}

/**
 * Độ lệch chuẩn quy năm của lợi nhuận theo kỳ quan sát, suy ra từ chuỗi TWRR
 * cumulative (bắt đầu 0). Hệ số quy năm lấy theo mật độ quan sát thực tế
 * (số điểm / số năm) thay vì hard-code 252, để không lệch khi dữ liệu có gap.
 */
export function annualizedStdevFromCumulative(cumulative: ReturnPoint[]): number | null {
  const n = cumulative.length
  if (n < 30) return null

  const years = daysBetween(cumulative[0]!.date, cumulative[n - 1]!.date) / 365.25
  if (years <= 0) return null

  const returns: number[] = []
  for (let i = 1; i < n; i++) {
    const prev = 1 + cumulative[i - 1]!.value
    const curr = 1 + cumulative[i]!.value
    if (prev > 0) returns.push(curr / prev - 1)
  }
  if (returns.length < 2) return null

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  const periodsPerYear = returns.length / years

  return Math.sqrt(variance) * Math.sqrt(periodsPerYear)
}
