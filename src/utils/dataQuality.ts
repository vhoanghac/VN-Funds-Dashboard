/**
 * Data quality utils: phát hiện gap trong chuỗi giá tuần, đánh giá
 * độ tươi của data, và tính khoảng thời gian thực tế có thể so sánh
 * khi user chọn nhiều quỹ với start_date khác nhau.
 *
 * Triết lý: minh bạch giới hạn dữ liệu trước khi hiển thị số liệu đẹp.
 * Nhà đầu tư VN nên biết "data này có lỗ hổng ở đâu" trước khi ra quyết định.
 */
import type { PricePoint } from '../types'

/** Một lỗ hổng trong chuỗi giá tuần */
export interface DataGap {
  /** Ngày cuối có giá trước gap (cận trên của khoảng missing) */
  fromDate: string
  /** Ngày đầu có giá sau gap */
  toDate: string
  /** Số tuần ước lượng bị thiếu */
  weeksMissing: number
}

/**
 * Detect gap: khoảng giữa 2 tuần liên tiếp > ~2 tuần được coi là gap.
 * Weekly data thường cách nhau 7 ngày, cho phép dung sai 3 ngày cho
 * holiday hoặc slight drift. Threshold mặc định 14 ngày.
 */
export function detectGaps(
  weekly: PricePoint[],
  thresholdDays = 14,
): DataGap[] {
  const gaps: DataGap[] = []
  if (weekly.length < 2) return gaps

  const MS_PER_DAY = 24 * 60 * 60 * 1000

  for (let i = 1; i < weekly.length; i++) {
    const prev = weekly[i - 1]!
    const cur = weekly[i]!
    const days = (new Date(cur.date).getTime() - new Date(prev.date).getTime()) / MS_PER_DAY
    if (days > thresholdDays) {
      gaps.push({
        fromDate: prev.date,
        toDate: cur.date,
        weeksMissing: Math.round(days / 7) - 1,
      })
    }
  }

  return gaps
}

export interface FundQualityReport {
  id: string
  startDate: string
  endDate: string
  gaps: DataGap[]
  /** Ngày quỹ có giá đầu tiên so với dateFrom user chọn; null nếu coverage đủ */
  startsAfterRequested: boolean
  /** Ngày quỹ có giá cuối so với dateTo user chọn */
  endsBeforeRequested: boolean
  /** Số ngày tính từ endDate tới hôm nay */
  daysStale: number
}

/**
 * Build report cho một quỹ: gap, coverage vs user request, freshness.
 *
 * @param requestedFrom  dateFrom user chọn (null = dùng start tự nhiên)
 * @param requestedTo    dateTo user chọn
 * @param today          ngày "hôm nay" để tính freshness (inject cho test)
 */
export function buildFundQualityReport(
  id: string,
  weekly: PricePoint[],
  requestedFrom: string | null,
  requestedTo: string | null,
  today: Date = new Date(),
): FundQualityReport | null {
  if (weekly.length === 0) return null

  const startDate = weekly[0]!.date
  const endDate = weekly[weekly.length - 1]!.date
  const gaps = detectGaps(weekly)

  const startsAfterRequested = requestedFrom !== null && startDate > requestedFrom
  const endsBeforeRequested = requestedTo !== null && endDate < requestedTo

  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const daysStale = Math.floor(
    (today.getTime() - new Date(endDate).getTime()) / MS_PER_DAY,
  )

  return {
    id,
    startDate,
    endDate,
    gaps,
    startsAfterRequested,
    endsBeforeRequested,
    daysStale,
  }
}
