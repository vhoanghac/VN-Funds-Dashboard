/**
 * Tiện ích dùng chung cho các chart Recharts.
 *
 * Trước đây mỗi chart tự khai báo lại mergeAllSeries, getYearTicks,
 * formatTooltipDate, hằng màu baseline/dimmed... thành 4-5 bản sao. Bug trục y
 * tháng 08/2026 phải sửa 3 lần vì domain clamp nằm riêng từng file. Gom về đây
 * để: một chỗ sửa, mọi chart ăn theo (locality), và mỗi hàm thuần có golden test.
 *
 * File này nằm trong src/utils/ nên TUYỆT ĐỐI không import React/Recharts
 * (corePurity.test.ts canh ranh giới này). Mọi thứ ở đây là hàm thuần.
 */

/**
 * Gộp nhiều chuỗi theo ngày thành một bảng dòng, mỗi ngày một hàng, mỗi series
 * một cột. Kết quả sắp theo timestamp tăng dần. Dùng cho chart nhiều đường
 * (Lợi nhuận tích lũy, Drawdown, Rolling returns).
 */
export function mergeAllSeries(
  allSeries: { name: string; data: { date: string; value: number }[] }[],
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()
  for (const s of allSeries) {
    for (const p of s.data) {
      const ex = map.get(p.date) || { date: p.date, timestamp: new Date(p.date).getTime() }
      ex[s.name] = p.value
      map.set(p.date, ex)
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (a.timestamp as number) - (b.timestamp as number),
  )
}

/**
 * Chọn một timestamp đại diện cho mỗi năm (điểm đầu tiên của năm) làm tick trục X.
 * Nhận Record<string, unknown> (dữ liệu gộp nhiều series) hoặc { timestamp: number }
 * (dữ liệu một series) — cả hai đều có field timestamp.
 */
export function getYearTicks(data: Array<{ timestamp?: unknown }>): number[] {
  const seen = new Set<number>()
  const ticks: number[] = []
  for (const d of data) {
    const ts = Number(d.timestamp)
    const year = new Date(ts).getFullYear()
    if (!seen.has(year)) {
      seen.add(year)
      ticks.push(ts)
    }
  }
  return ticks
}

/** Timestamp → năm (ví dụ dùng cho tick trục X). */
export function formatYear(ts: number): string {
  return new Date(ts).getFullYear().toString()
}

/** Timestamp → dd/mm/yyyy (tooltip chart theo ngày). */
export function formatTooltipDate(ts: number): string {
  const d = new Date(ts)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

/** Số thập phân (0.05) → "5.0%" (tick trục Y). */
export function formatPercent(v: number, digits = 1): string {
  return (v * 100).toFixed(digits) + '%'
}

/** Số thập phân (0.05) → "5.00%" (tooltip). */
export function formatPercentFull(v: number): string {
  return (v * 100).toFixed(2) + '%'
}

/** Màu đường baseline (mốc 0) chung cho mọi chart. */
export const BASELINE_COLOR = '#7A7574'

/** Màu đường/legend khi bị bấm làm mờ. */
export const DIMMED_COLOR = '#CBD5E1'
