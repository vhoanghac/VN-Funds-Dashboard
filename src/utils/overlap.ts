/**
 * Overlap analysis between two funds' stock holdings (tab "Overlap").
 *
 * Nguồn dữ liệu: `<fundId>_holdings.csv` (top-10 cổ phiếu) và
 * `<fundId>_industry.csv` (toàn bộ ngành), sinh bởi scripts/update_holdings.py.
 *
 * Lưu ý trung thực: holdings chỉ là TOP 10 cổ phiếu mỗi quỹ (giới hạn của API
 * fmarket/vnstock), nên mọi con số overlap đo trên top 10, không phải toàn bộ
 * danh mục. Ngành thì đầy đủ (industry_holding trả 100%).
 */

/** Một hàng trong <fundId>_holdings.csv */
export interface Holding {
  date: string // YYYY-MM-DD ngày báo cáo
  stockCode: string
  industry: string
  weightPct: number // % tỷ trọng trong NAV của quỹ
  /** Tổng giá trị cổ phiếu quỹ đang nắm (VND). Có thể 0 nếu nguồn không trả. */
  assetValue: number
}

/** Một hàng trong <fundId>_industry.csv */
export interface IndustryHolding {
  date: string
  industry: string
  weightPct: number
}

/** Kết quả so sánh overlap giữa 2 quỹ */
export interface OverlapResult {
  stocksA: Holding[]
  stocksB: Holding[]
  /** Các cổ phiếu xuất hiện ở cả A và B */
  overlap: Array<{
    stockCode: string
    industryA: string
    industryB: string
    weightA: number
    weightB: number
    minWeight: number
  }>
  /** Số công ty mỗi quỹ nắm */
  stockCountA: number
  stockCountB: number
  overlapCount: number
  /**
   * Tỷ trọng trùng = Σ min(wA, wB) trên cổ phiếu trùng.
   * Đo bằng điểm phần trăm của NAV (có thể hiểu như "đô la trùng trên 100đ".
   */
  weightedOverlapPct: number
  /** Σ wA của cổ phiếu trùng / Σ wA toàn bộ — phần danh mục A bị trùng */
  pctInA: number
  /** Σ wB của cổ phiếu trùng / Σ wB toàn bộ — phần danh mục B bị trùng */
  pctInB: number
  /** Σ wA của cổ phiếu trùng, tính bằng điểm % NAV (tuyệt đối, không chia top-10) */
  overlapInA: number
  /** Σ wB của cổ phiếu trùng, tính bằng điểm % NAV (tuyệt đối, không chia top-10) */
  overlapInB: number
  /** A nắm nhiều hơn B (chênh wA − wB dương), xếp giảm theo chênh lệch */
  overweightA: Array<{ stockCode: string; weightA: number; weightB: number; diff: number }>
  /** A nắm ít hơn B (chênh wA − wB âm), xếp tăng theo độ âm */
  underweightA: Array<{ stockCode: string; weightA: number; weightB: number; diff: number }>
}

/** Kết quả sector drift: chênh tỷ trọng ngành A − B */
export interface SectorDriftRow {
  industry: string
  weightA: number
  weightB: number
  drift: number // weightA - weightB (dương = A nặng hơn)
}

const ZERO = 1e-9

/**
 * Parse nội dung `<fundId>_holdings.csv` (cột: date,stock_code,industry,weight_pct,type_asset).
 * Chỉ lấy hàng mới nhất theo date (một CSV hiện chỉ có 1 kỳ, nhưng để sẵn
 * cho tương lai khi có nhiều kỳ).
 */
export function parseHoldingsCSV(csvText: string): Holding[] {
  const lines = csvText.trim().split('\n')
  if (lines.length <= 1) return []
  const header = lines[0]!.split(',').map(h => h.trim())
  const idxDate = header.indexOf('date')
  const idxCode = header.indexOf('stock_code')
  const idxInd = header.indexOf('industry')
  const idxW = header.indexOf('weight_pct')
  const idxVal = header.indexOf('asset_value')
  if (idxDate < 0 || idxCode < 0 || idxInd < 0 || idxW < 0) return []

  const rows: Holding[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',').map(c => c.trim())
    const w = parseFloat(cells[idxW] ?? '')
    if (Number.isNaN(w)) continue
    rows.push({
      date: cells[idxDate]!,
      stockCode: cells[idxCode]!,
      industry: cells[idxInd]!,
      weightPct: w,
      assetValue: idxVal >= 0 ? parseFloat(cells[idxVal] ?? '') || 0 : 0,
    })
  }
  if (rows.length === 0) return []

  // Chỉ lấy kỳ mới nhất
  const latest = rows.reduce((a, b) => (a.date > b.date ? a : b)).date
  return rows.filter(r => r.date === latest)
}

/** Parse `<fundId>_industry.csv` (date,industry,weight_pct) — chỉ kỳ mới nhất. */
export function parseIndustryCSV(csvText: string): IndustryHolding[] {
  const lines = csvText.trim().split('\n')
  if (lines.length <= 1) return []
  const header = lines[0]!.split(',').map(h => h.trim())
  const idxDate = header.indexOf('date')
  const idxInd = header.indexOf('industry')
  const idxW = header.indexOf('weight_pct')
  if (idxDate < 0 || idxInd < 0 || idxW < 0) return []

  const rows: IndustryHolding[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',').map(c => c.trim())
    const w = parseFloat(cells[idxW] ?? '')
    if (Number.isNaN(w)) continue
    rows.push({ date: cells[idxDate]!, industry: cells[idxInd]!, weightPct: w })
  }
  if (rows.length === 0) return []
  const latest = rows.reduce((a, b) => (a.date > b.date ? a : b)).date
  return rows.filter(r => r.date === latest)
}

/**
 * Tính overlap giữa holdings của quỹ A và B.
 * Bỏ qua nếu một bên không có dữ liệu → trả null (UI hiển thị cảnh báo).
 */
export function computeOverlap(stocksA: Holding[], stocksB: Holding[]): OverlapResult | null {
  if (stocksA.length === 0 || stocksB.length === 0) return null

  const byCodeB = new Map(stocksB.map(h => [h.stockCode, h]))
  const overlap: OverlapResult['overlap'] = []

  for (const a of stocksA) {
    const b = byCodeB.get(a.stockCode)
    if (b) {
      overlap.push({
        stockCode: a.stockCode,
        industryA: a.industry,
        industryB: b.industry,
        weightA: a.weightPct,
        weightB: b.weightPct,
        minWeight: Math.min(a.weightPct, b.weightPct),
      })
    }
  }
  overlap.sort((x, y) => y.minWeight - x.minWeight)

  const sumA = stocksA.reduce((s, h) => s + h.weightPct, 0)
  const sumB = stocksB.reduce((s, h) => s + h.weightPct, 0)

  const weightedOverlapPct = overlap.reduce((s, o) => s + o.minWeight, 0)
  const overlapInA = overlap.reduce((s, o) => s + o.weightA, 0)
  const overlapInB = overlap.reduce((s, o) => s + o.weightB, 0)

  // overweight: A nắm nhiều hơn B; underweight: A nắm ít hơn B
  const overweightA = overlap
    .filter(o => o.weightA - o.weightB > ZERO)
    .map(o => ({ stockCode: o.stockCode, weightA: o.weightA, weightB: o.weightB, diff: o.weightA - o.weightB }))
    .sort((x, y) => y.diff - x.diff)

  const underweightA = overlap
    .filter(o => o.weightB - o.weightA > ZERO)
    .map(o => ({ stockCode: o.stockCode, weightA: o.weightA, weightB: o.weightB, diff: o.weightA - o.weightB }))
    .sort((x, y) => x.diff - y.diff)

  return {
    stocksA,
    stocksB,
    overlap,
    stockCountA: stocksA.length,
    stockCountB: stocksB.length,
    overlapCount: overlap.length,
    weightedOverlapPct,
    pctInA: sumA > 0 ? overlapInA / sumA : 0,
    pctInB: sumB > 0 ? overlapInB / sumB : 0,
    overlapInA,
    overlapInB,
    overweightA,
    underweightA,
  }
}

/**
 * Sector drift: chênh tỷ trọng từng ngành giữa A và B (A − B).
 * Ngành chỉ có ở một bên: bên kia coi như 0%.
 * Xếp theo |drift| giảm dần.
 */
export function computeSectorDrift(
  industryA: IndustryHolding[],
  industryB: IndustryHolding[],
): SectorDriftRow[] {
  const wB = new Map(industryB.map(h => [h.industry, h.weightPct]))
  const seen = new Set<string>()
  const rows: SectorDriftRow[] = []

  for (const a of industryA) {
    rows.push({
      industry: a.industry,
      weightA: a.weightPct,
      weightB: wB.get(a.industry) ?? 0,
      drift: a.weightPct - (wB.get(a.industry) ?? 0),
    })
    seen.add(a.industry)
  }
  for (const b of industryB) {
    if (seen.has(b.industry)) continue
    rows.push({
      industry: b.industry,
      weightA: 0,
      weightB: b.weightPct,
      drift: -b.weightPct,
    })
  }

  return rows.sort((x, y) => Math.abs(y.drift) - Math.abs(x.drift))
}
