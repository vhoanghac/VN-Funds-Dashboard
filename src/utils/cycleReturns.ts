/**
 * Lợi nhuận cắt theo hai khung thời gian khác nhau: năm dương lịch, và năm
 * nhiệm kỳ tổng thống Mỹ (20/1 tới 20/1).
 *
 * Lý do tồn tại: cùng một chuỗi giá, đổi cách cắt là đổi câu chuyện. Bitcoin
 * năm dương lịch 2021 tăng 57%, nhưng đo từ ngày Biden nhậm chức thì chỉ còn
 * 13%, vì đợt tăng đã chạy từ tháng 11/2020. Mốc 1/1 không có ý nghĩa gì với
 * thị trường, nó chỉ là thói quen kế toán.
 *
 * Module này chỉ tính số. Việc diễn giải để phần giao diện lo.
 */
import type { PricePoint } from '../types'

export type CycleMode = 'term' | 'calendar' | 'election'

export interface TermInfo {
  president: string
  /** CH = Cộng hoà, DC = Dân chủ */
  party: 'CH' | 'DC'
  /** Ngày nhậm chức, YYYY-MM-DD. Hiến pháp Mỹ ấn định trưa 20/1. */
  start: string
  /** Ngày bầu cử đưa người này lên, YYYY-MM-DD */
  election: string
}

/**
 * Các nhiệm kỳ tổng thống Mỹ. Chỉ cần đủ phủ khoảng dữ liệu đang có, thêm
 * nhiệm kỳ mới thì thêm một dòng.
 */
export const TERMS: TermInfo[] = [
  { president: 'Obama 2', party: 'DC', start: '2013-01-20', election: '2012-11-06' },
  { president: 'Trump 1', party: 'CH', start: '2017-01-20', election: '2016-11-08' },
  { president: 'Biden', party: 'DC', start: '2021-01-20', election: '2020-11-03' },
  { president: 'Trump 2', party: 'CH', start: '2025-01-20', election: '2024-11-05' },
]

/** Ngày halving Bitcoin đã diễn ra. Không đoán ngày halving tương lai. */
export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20']

export interface CyclePeriod {
  /** Khoá duy nhất, dùng làm React key */
  id: string
  president: string
  party: 'CH' | 'DC'
  /** Năm thứ mấy trong nhiệm kỳ, 1 tới 4 */
  yearInTerm: 1 | 2 | 3 | 4
  /** Nhãn hiển thị, vd "2017" hoặc "2017-2018" */
  label: string
  from: string
  to: string
  /** Trong khoảng này có halving không */
  hasHalving: boolean
  /** false khi dữ liệu chưa phủ hết khoảng */
  complete: boolean
  /**
   * Vì sao kỳ này không trọn vẹn. Hai lý do khác hẳn nhau nên không gộp:
   *
   * - `unfinished`: kỳ chưa kết thúc ngoài đời, vd nhiệm kỳ đang chạy.
   * - `truncated`: kỳ đã kết thúc từ lâu, chỉ là dữ liệu giá bắt đầu muộn hơn
   *   ngày mở kỳ. Gọi nó là "chưa xong" thì sai, nó xong rồi, mình thiếu số.
   */
  partial: null | 'unfinished' | 'truncated'
}

function partialReason(
  from: string, to: string, dataStart: string, dataEnd: string,
): CyclePeriod['partial'] {
  if (from < dataStart) return 'truncated'
  if (to > dataEnd) return 'unfinished'
  return null
}

export interface PeriodStat {
  period: CyclePeriod
  /** % từ đầu tới cuối kỳ. null khi không đủ dữ liệu. */
  close: number | null
  /** % của đỉnh cao nhất trong kỳ so với đầu kỳ */
  peak: number | null
  /** % từ đỉnh tới cuối kỳ, luôn âm hoặc bằng 0 */
  giveback: number | null
}

function addYears(date: string, n: number): string {
  const [y, rest] = [date.slice(0, 4), date.slice(4)]
  return `${Number(y) + n}${rest}`
}

/** Nhiệm kỳ đang chứa một ngày bất kỳ. */
function termAt(date: string): { term: TermInfo; yearInTerm: 1 | 2 | 3 | 4 } | null {
  for (let i = TERMS.length - 1; i >= 0; i--) {
    const term = TERMS[i]!
    if (date >= term.start) {
      const offset = Number(date.slice(0, 4)) - Number(term.start.slice(0, 4))
      const yearInTerm = (Math.min(Math.max(offset, 0), 3) + 1) as 1 | 2 | 3 | 4
      return { term, yearInTerm }
    }
  }
  return null
}

function hasHalvingIn(from: string, to: string): boolean {
  return HALVINGS.some(h => h >= from && h < to)
}

/**
 * Dựng danh sách kỳ theo khung đã chọn, chỉ giữ những kỳ mà dữ liệu chạm tới.
 *
 * @param dataStart ngày đầu tiên có giá
 * @param dataEnd   ngày cuối cùng có giá
 */
export function buildPeriods(
  mode: CycleMode,
  dataStart: string,
  dataEnd: string,
): CyclePeriod[] {
  const periods: CyclePeriod[] = []

  if (mode === 'term' || mode === 'election') {
    for (const [i, term] of TERMS.entries()) {
      const anchor = mode === 'term' ? term.start : term.election
      for (let y = 1; y <= 4; y++) {
        const from = addYears(anchor, y - 1)
        // Năm cuối của khung bầu cử khép lại đúng ngày bầu cử kế tiếp, không
        // phải ngày kỷ niệm, để các kỳ nối liền nhau không hở cũng không chồng.
        const nextElection = TERMS[i + 1]?.election
        const to = mode === 'election' && y === 4 && nextElection
          ? nextElection
          : addYears(anchor, y)
        if (to <= dataStart || from > dataEnd) continue
        periods.push({
          id: `${term.president}-${y}`,
          president: term.president,
          party: term.party,
          yearInTerm: y as 1 | 2 | 3 | 4,
          label: `${from.slice(0, 4)}-${to.slice(2, 4)}`,
          from,
          to,
          hasHalving: hasHalvingIn(from, to),
          complete: from >= dataStart && to <= dataEnd,
          partial: partialReason(from, to, dataStart, dataEnd),
        })
      }
    }
    return periods
  }

  const firstYear = Number(dataStart.slice(0, 4))
  const lastYear = Number(dataEnd.slice(0, 4))
  for (let year = firstYear; year <= lastYear; year++) {
    const from = `${year}-01-01`
    const to = `${year}-12-31`
    // Gán năm dương lịch vào nhiệm kỳ nào thì lấy mốc giữa năm cho khỏi lấn ranh.
    const at = termAt(`${year}-07-01`)
    if (!at) continue
    periods.push({
      id: `cal-${year}`,
      president: at.term.president,
      party: at.term.party,
      yearInTerm: at.yearInTerm,
      label: String(year),
      from,
      to,
      hasHalving: hasHalvingIn(from, to),
      complete: from >= dataStart && to <= dataEnd,
      partial: partialReason(from, to, dataStart, dataEnd),
    })
  }
  return periods
}

/**
 * Giá tại mốc bắt đầu: lấy giá gần nhất KHÔNG SAU ngày đó, để không nhìn trước
 * tương lai. Không có thì lấy giá đầu tiên sau đó.
 */
function priceAtStart(prices: PricePoint[], date: string): number | null {
  let before: number | null = null
  for (const p of prices) {
    if (p.date <= date) before = p.price
    else break
  }
  if (before !== null) return before
  const after = prices.find(p => p.date > date)
  return after ? after.price : null
}

/** Tính lợi nhuận của một chuỗi giá trong một kỳ. */
export function periodStat(
  prices: PricePoint[],
  period: CyclePeriod,
): Omit<PeriodStat, 'period'> {
  const base = priceAtStart(prices, period.from)
  const inside = prices.filter(p => p.date > period.from && p.date <= period.to)
  if (base === null || base <= 0 || inside.length === 0) {
    return { close: null, peak: null, giveback: null }
  }
  const last = inside[inside.length - 1]!.price
  const high = Math.max(...inside.map(p => p.price))
  return {
    close: (last / base - 1) * 100,
    peak: (high / base - 1) * 100,
    giveback: (last / high - 1) * 100,
  }
}

/** Gom kỳ theo năm thứ mấy trong nhiệm kỳ, để đếm được số lần quan sát. */
export function groupByYearInTerm(periods: CyclePeriod[]): Map<1 | 2 | 3 | 4, CyclePeriod[]> {
  const map = new Map<1 | 2 | 3 | 4, CyclePeriod[]>()
  for (const p of periods) {
    const list = map.get(p.yearInTerm) ?? []
    list.push(p)
    map.set(p.yearInTerm, list)
  }
  return map
}
