/**
 * Lấy phần tử ở percentile p (0-1) từ mảng đã sắp tăng dần (nội suy tuyến tính).
 *
 * Cố ý trả 0 cho mảng rỗng, giữ nguyên hành vi của hai bản gốc ở dca.ts và
 * RollingReturnChart.tsx khi gộp. Gọi với p ngoài [0,1] hoặc NaN sẽ trả NaN.
 */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]!
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  const frac = idx - lo
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac
}
