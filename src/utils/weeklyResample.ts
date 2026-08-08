import type { PricePoint } from '../types'

/**
 * Resample daily prices to weekly by taking the last trading day
 * of each ISO week (typically Friday, but could be earlier if
 * Friday is a holiday).
 *
 * Groups by ISO week number, takes the last date in each group.
 */
export function resampleToWeekly(daily: PricePoint[]): PricePoint[] {
  if (daily.length === 0) return []

  const weekMap = new Map<string, PricePoint>()

  for (const point of daily) {
    const weekKey = getISOWeekKey(point.date)
    // Always keep the latest date in each week
    const existing = weekMap.get(weekKey)
    if (!existing || point.date > existing.date) {
      weekMap.set(weekKey, point)
    }
  }

  const weekly = Array.from(weekMap.values())
  weekly.sort((a, b) => a.date.localeCompare(b.date))

  return weekly.map(p => ({ date: p.date, price: p.price }))
}

/**
 * Returns "YYYY-WNN" key for ISO week grouping.
 */
/**
 * Align multiple funds' weekly prices to a common date grid.
 *
 * Different funds may have different "last trading days" within the same
 * ISO week (e.g., Fund A trades until Thursday, Fund B until Friday).
 * This causes chart lines to misalign because they have different x-values.
 *
 * Fix: for each ISO week, pick ONE representative date (the latest across
 * all funds), and remap every fund's price to that common date.
 */
export function alignFundsToCommonGrid(
  fundPrices: Map<string, PricePoint[]>,
): Map<string, PricePoint[]> {
  if (fundPrices.size <= 1) return fundPrices

  // Step 1: For each ISO week, find the latest date across all funds
  const weekToCommonDate = new Map<string, string>()
  for (const prices of fundPrices.values()) {
    for (const p of prices) {
      const wk = getISOWeekKey(p.date)
      const existing = weekToCommonDate.get(wk)
      if (!existing || p.date > existing) {
        weekToCommonDate.set(wk, p.date)
      }
    }
  }

  // Step 2: Sort weeks by their common date
  const sortedWeeks = Array.from(weekToCommonDate.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))

  // Step 3: Remap each fund's prices to the common dates. Quỹ có dữ liệu
  // thưa hơn (vd quỹ trái phiếu, không cập nhật NAV mỗi tuần) được
  // forward-fill bằng giá tuần gần nhất đã biết, thay vì bỏ hẳn tuần đó.
  // Nếu không forward-fill, một danh mục nhiều quỹ sẽ mất cả tuần khỏi
  // mô phỏng DCA chỉ vì 1 quỹ thiếu giá tuần đó (xem simulateDCA trong
  // utils/dca.ts — yêu cầu MỌI quỹ trong danh mục đều có giá mới tính là
  // tuần hợp lệ), khiến các danh mục nạp tiền không cùng số lần dù cùng
  // khoảng thời gian. Không fill trước ngày quỹ thực sự có dữ liệu đầu tiên.
  //
  // LƯU Ý: forward-fill ở đây KHÔNG giới hạn số ngày/tuần gap — khác với
  // alignWeeklySeries/alignMultiSeries (dateAlign.ts, dùng cho tab So Sánh/
  // Mô Phỏng) vốn giới hạn gap tối đa ~14 ngày rồi loại điểm nếu vượt quá.
  // Đây là chủ đích, không phải thiếu sót: tab DCA/LS-vs-DCA cần MỌI danh
  // mục đầu tư đúng cùng số lần trên cùng lưới ngày (công bằng khi so sánh
  // "nạp bao nhiêu lần"), nên chấp nhận forward-fill dài hơn thay vì loại
  // bỏ ngày. Ngược lại, tab so sánh quỹ ưu tiên tránh so sánh nhầm với giá
  // đã cũ (stale) nên thà loại điểm còn hơn hiển thị sai.
  const result = new Map<string, PricePoint[]>()
  for (const [fundId, prices] of fundPrices) {
    // Build ISO week → price for this fund
    const weekPrice = new Map<string, number>()
    for (const p of prices) {
      weekPrice.set(getISOWeekKey(p.date), p.price)
    }

    const aligned: PricePoint[] = []
    let lastKnownPrice: number | null = null
    for (const [wk, commonDate] of sortedWeeks) {
      const price = weekPrice.get(wk)
      if (price !== undefined) {
        lastKnownPrice = price
        aligned.push({ date: commonDate, price })
      } else if (lastKnownPrice !== null) {
        aligned.push({ date: commonDate, price: lastKnownPrice })
      }
      // lastKnownPrice vẫn null: quỹ chưa ra đời tại thời điểm này, không thêm điểm.
    }

    result.set(fundId, aligned)
  }

  return result
}

/**
 * Align multiple funds' DAILY prices to a common date grid (union of mọi
 * ngày giao dịch thực tế của tất cả quỹ), không gộp theo tuần ISO.
 *
 * Cùng ý tưởng forward-fill như alignFundsToCommonGrid (bản weekly): quỹ
 * thiếu giá ngày nào thì lấy giá gần nhất trước đó, đảm bảo mọi danh mục
 * (dù dùng quỹ nào) đều đầu tư trên CÙNG một lưới ngày — không có chuyện
 * danh mục A nạp tiền ngày này, danh mục B nạp ngày khác chỉ vì 1 quỹ
 * thiếu giá. Không fill trước ngày quỹ thực sự có dữ liệu đầu tiên.
 *
 * Cũng KHÔNG giới hạn gap (xem ghi chú trong alignFundsToCommonGrid ở trên) —
 * chủ đích cho tab DCA/LS-vs-DCA, khác với dateAlign.ts (tab so sánh).
 */
export function alignFundsToCommonGridDaily(
  fundPrices: Map<string, PricePoint[]>,
): Map<string, PricePoint[]> {
  if (fundPrices.size <= 1) return fundPrices

  // Union tất cả các ngày có giá ở bất kỳ quỹ nào
  const allDates = new Set<string>()
  for (const prices of fundPrices.values()) {
    for (const p of prices) allDates.add(p.date)
  }
  const sortedDates = Array.from(allDates).sort()

  const result = new Map<string, PricePoint[]>()
  for (const [fundId, prices] of fundPrices) {
    const priceByDate = new Map<string, number>()
    for (const p of prices) priceByDate.set(p.date, p.price)

    const aligned: PricePoint[] = []
    let lastKnownPrice: number | null = null
    for (const date of sortedDates) {
      const price = priceByDate.get(date)
      if (price !== undefined) {
        lastKnownPrice = price
        aligned.push({ date, price })
      } else if (lastKnownPrice !== null) {
        aligned.push({ date, price: lastKnownPrice })
      }
      // lastKnownPrice vẫn null: quỹ chưa ra đời tại thời điểm này, không thêm điểm.
    }

    result.set(fundId, aligned)
  }

  return result
}

export function getISOWeekKey(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z')

  // Chuẩn ISO 8601: dời về ngày thứ Năm của cùng tuần (Mon=1..Sun=7), vì
  // thứ Năm luôn thuộc đúng ISO year của tuần đó, kể cả khi tuần vắt qua
  // giao thừa dương lịch.
  const isoDayOfWeek = (date.getUTCDay() + 6) % 7 + 1
  date.setUTCDate(date.getUTCDate() + 4 - isoDayOfWeek)

  const isoYear = date.getUTCFullYear()
  const yearStart = Date.UTC(isoYear, 0, 1)
  const weekNumber = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7)

  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`
}
