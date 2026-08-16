const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Số ngày giữa hai chuỗi ngày ISO "YYYY-MM-DD" (b - a), làm tròn.
 *
 * Chuỗi ngày không có múi giờ nên `new Date(...)` parse theo UTC, hiệu số luôn
 * là bội số đúng của 86400000. `Math.round` chỉ để chắn lệch do DST, khi ai đó
 * truyền nhầm chuỗi có kèm giờ.
 */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY)
}
