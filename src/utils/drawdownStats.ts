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
  /** ID ổn định trong một chuỗi, lấy từ ngày bắt đầu episode */
  episodeId: string
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
  /** Số ngày từ đỉnh đến đáy */
  timeToTroughDays: number
  /** Số ngày từ đáy đến khi hồi phục; null = chưa hồi phục */
  recoveryDays: number | null
  /** Mức drawdown trung bình trong thời gian đang dưới đỉnh */
  averageDrawdown: number
  /** Chuỗi điểm của episode, gồm mốc đỉnh và mốc hồi phục nếu có */
  points: DrawdownEpisodePoint[]
  /** true khi đã quay lại đỉnh cũ */
  recovered: boolean
}

export interface DrawdownEpisodePoint {
  date: string
  value: number
}

export type DrawdownEpisodeRanking =
  | 'deepest'
  | 'longest'
  | 'slowestRecovery'
  | 'fastestDecline'

export interface NumericSummary {
  minimum: number | null
  median: number | null
  average: number | null
  maximum: number | null
}

export interface DrawdownSummary {
  depth: NumericSummary
  timeToTroughDays: NumericSummary
  recoveryDays: NumericSummary
  totalDays: NumericSummary
  averageDrawdown: NumericSummary
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
  let drawdownSum = 0
  let drawdownCount = 0
  let episodePoints: DrawdownEpisodePoint[] = []

  const closeEpisode = (recoveryDate: string | null, lastDate: string): DrawdownEpisode => ({
    episodeId: peakDate,
    peakDate,
    troughDate,
    recoveryDate,
    depth,
    totalDays: daysBetween(peakDate, lastDate),
    timeToTroughDays: daysBetween(peakDate, troughDate),
    recoveryDays: recoveryDate === null ? null : daysBetween(troughDate, recoveryDate),
    averageDrawdown: drawdownCount > 0 ? drawdownSum / drawdownCount : 0,
    points: episodePoints,
    recovered: recoveryDate !== null,
  })

  for (const pt of drawdown) {
    if (pt.value >= AT_PEAK) {
      if (inEpisode) {
        // Hồi phục: đóng đợt hiện tại
        episodePoints.push({ date: pt.date, value: pt.value })
        episodes.push(closeEpisode(pt.date, pt.date))
        inEpisode = false
        depth = 0
        drawdownSum = 0
        drawdownCount = 0
        episodePoints = []
      }
      peakDate = pt.date
    } else {
      if (!inEpisode) {
        inEpisode = true
        troughDate = pt.date
        depth = pt.value
        drawdownSum = pt.value
        drawdownCount = 1
        episodePoints = [
          { date: peakDate, value: 0 },
          { date: pt.date, value: pt.value },
        ]
      } else if (pt.value < depth) {
        depth = pt.value
        troughDate = pt.date
        drawdownSum += pt.value
        drawdownCount += 1
        episodePoints.push({ date: pt.date, value: pt.value })
      } else {
        drawdownSum += pt.value
        drawdownCount += 1
        episodePoints.push({ date: pt.date, value: pt.value })
      }
    }
  }

  // Đợt cuối chưa hồi phục tính đến cuối chuỗi
  if (inEpisode) {
    const lastDate = drawdown[drawdown.length - 1]!.date
    episodes.push(closeEpisode(null, lastDate))
  }

  return episodes
    .filter(e => e.depth <= minDepth)
    .sort((a, b) => a.depth - b.depth)
}

/** Tách episode từ chuỗi giá trị tài khoản, không bị lẫn với drawdown TWRR. */
export function drawdownEpisodesFromValueSeries(
  valueSeries: ReturnPoint[],
  minDepth = -0.05,
): DrawdownEpisode[] {
  let peak = 0
  const drawdown: ReturnPoint[] = []

  for (const point of valueSeries) {
    if (!Number.isFinite(point.value) || point.value <= 0) continue
    if (point.value > peak) peak = point.value
    drawdown.push({
      date: point.date,
      value: peak > 0 ? point.value / peak - 1 : 0,
    })
  }

  return drawdownEpisodes(drawdown, minDepth)
}

/** Xếp episode theo một tiêu chí, giữ nguyên thứ tự tương đối khi bằng điểm. */
export function rankDrawdownEpisodes(
  episodes: DrawdownEpisode[],
  ranking: DrawdownEpisodeRanking,
): DrawdownEpisode[] {
  const candidates = ranking === 'slowestRecovery'
    ? episodes.filter(episode => episode.recoveryDays !== null)
    : episodes

  return candidates
    .map((episode, index) => ({ episode, index }))
    .sort((a, b) => {
      const left = a.episode
      const right = b.episode
      let comparison = 0

      if (ranking === 'deepest') comparison = left.depth - right.depth
      if (ranking === 'longest') comparison = right.totalDays - left.totalDays
      if (ranking === 'slowestRecovery') comparison = right.recoveryDays! - left.recoveryDays!
      if (ranking === 'fastestDecline') comparison = left.timeToTroughDays - right.timeToTroughDays

      return comparison || a.index - b.index
    })
    .map(item => item.episode)
}

/** Tóm tắt phân bố các đợt drawdown, giữ null cho nhóm chưa có dữ liệu. */
export function summarizeDrawdownEpisodes(episodes: DrawdownEpisode[]): DrawdownSummary {
  const summarize = (values: number[]): NumericSummary => {
    if (values.length === 0) {
      return { minimum: null, median: null, average: null, maximum: null }
    }
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!
    return {
      minimum: sorted[0]!,
      median,
      average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      maximum: sorted[sorted.length - 1]!,
    }
  }

  return {
    // Summary displays drawdown depth as a positive distance below the peak.
    depth: summarize(episodes.map(e => Math.abs(e.depth))),
    timeToTroughDays: summarize(episodes.map(e => e.timeToTroughDays)),
    recoveryDays: summarize(episodes.flatMap(e => e.recoveryDays === null ? [] : [e.recoveryDays])),
    totalDays: summarize(episodes.map(e => e.totalDays)),
    averageDrawdown: summarize(episodes.map(e => Math.abs(e.averageDrawdown))),
  }
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
 * Hệ số tăng cần có để quay lại đỉnh cũ từ một mức drawdown hiện tại.
 * Ví dụ: -20% cần tăng 1,25 lần, -50% cần tăng 2 lần.
 * Trả null khi chuỗi đã mất toàn bộ giá trị hoặc đầu vào không hợp lệ.
 */
export function recoveryMultipleFromDrawdown(drawdown: number): number | null {
  if (!Number.isFinite(drawdown) || drawdown <= -1) return null
  return 1 / (1 + Math.min(drawdown, 0))
}

/** Phần trăm tăng cần có để quay lại đỉnh cũ từ một mức drawdown. */
export function recoveryPercentFromDrawdown(drawdown: number): number | null {
  const multiple = recoveryMultipleFromDrawdown(drawdown)
  return multiple === null ? null : (multiple - 1) * 100
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
