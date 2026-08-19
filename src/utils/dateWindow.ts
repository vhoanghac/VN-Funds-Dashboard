/**
 * DATE WINDOW UTILITIES
 *
 * Two-pointer O(n) helpers để tìm index tương ứng với "N tháng lịch trước/sau"
 * một mốc thời gian, dùng chung cho mọi hàm rolling-window trong calculations.ts,
 * dca.ts, và lsVsDca.ts — trước đây 3 file này tự triển khai riêng, dễ drift.
 *
 * Cả 2 hàm dùng addMonthsClamped() thay vì Date.setMonth() trực tiếp, để
 * tránh lỗi tràn ngày: setMonth() trên ngày 29-31 có thể "tràn" sang tháng
 * sau nếu tháng đích ngắn hơn (vd "31/01" + 1 tháng = "31/02" không tồn tại,
 * JS tự cộng dồn thành 02-03, không phải cuối tháng 2 như mong đợi).
 */

/**
 * Cộng (hoặc trừ, nếu monthDelta âm) monthDelta tháng lịch vào thời điểm `time`,
 * clamp ngày về cuối tháng đích nếu tháng đích ngắn hơn ngày gốc (vd 31/01 + 1
 * tháng → 28/02 hoặc 29/02, không tràn sang tháng 3).
 */
export function addMonthsClamped(time: number, monthDelta: number): number {
  const d = new Date(time)
  const day = d.getDate()
  d.setDate(1) // tránh tràn ngày khi setMonth
  d.setMonth(d.getMonth() + monthDelta)
  const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, daysInTargetMonth))
  return d.getTime()
}

/**
 * Với mỗi index i, tìm index j sao cho date[j] là điểm gần nhất TẠI/SAU
 * đúng periodMonths tháng lịch TRƯỚC date[i] (two-pointer, O(n)). Trả về
 * -1 nếu chuỗi chưa đủ periodMonths tháng dữ liệu lùi lại.
 *
 * Dùng lùi theo LỊCH THÁNG (không phải số ngày xấp xỉ) để không lệch khi
 * dữ liệu thưa (weekly/monthly) — đúng bất kể input là daily hay weekly.
 */
export function rollingWindowStarts(dates: number[], periodMonths: number): number[] {
  const n = dates.length
  const starts = new Array<number>(n).fill(-1)
  if (n === 0) return starts

  const targetTimes = dates.map(t => addMonthsClamped(t, -periodMonths))

  let j = 0
  for (let i = 0; i < n; i++) {
    const targetTime = targetTimes[i]!
    if (dates[0]! > targetTime) continue // chuỗi chưa lùi xa đủ periodMonths tháng
    while (j < i && dates[j]! < targetTime) j++
    starts[i] = j
  }
  return starts
}

/**
 * Với mỗi index i, tìm index j đầu tiên sao cho date[j] >= date[i] + monthsAhead
 * tháng lịch SAU (two-pointer, O(n)). Trả về dates.length nếu không đủ dữ liệu
 * tương lai.
 */
export function monthsAheadIndex(dates: number[], monthsAhead: number): number[] {
  const n = dates.length
  const targets = dates.map(t => addMonthsClamped(t, monthsAhead))

  const result = new Array<number>(n).fill(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    if (j < i) j = i
    while (j < n && dates[j]! < targets[i]!) j++
    result[i] = j
  }
  return result
}

/** Đếm số cửa sổ không dùng chung ngày dữ liệu nào. */
export function countIndependentWindows(spanMonths: number, windowMonths: number): number {
  if (windowMonths <= 0 || spanMonths <= 0) return 0
  return Math.floor(spanMonths / windowMonths)
}
