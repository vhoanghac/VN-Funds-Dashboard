/**
 * Overlap analysis between two funds' stock holdings (tab "Overlap").
 *
 * Nguồn dữ liệu: `holdings/<fundId>_holdings.csv` (danh mục đầy đủ: cổ phiếu, trái phiếu,
 * tiền mặt, tài sản khác) và `holdings/<fundId>_industry.csv` (ngành theo cổ phiếu), sinh
 * bởi scripts/fund_report/backfill_holdings_digiinvest.py (digiinvest) + scripts/fund_report/update_holdings.py
 * (fmarket top-10 cho quỹ chưa có digiinvest) + scripts/fund_report/fund_reports_to_holdings.py
 * (báo cáo tài chính chính thức, ngành theo vnstock).
 *
 * Lưu ý trung thực: overlap / tỷ trọng trùng chỉ đo trên CỔ PHIẾU (type === 'STOCK').
 * Trái phiếu, tiền mặt và tài sản khác được hiển thị trong danh mục nhưng không
 * tham gia tính overlap. Ngành chỉ có cho cổ phiếu.
 */

/** Tên ngành chuẩn hoá: digiinvest dùng từ vựng riêng (BĐS, Vật liệu, Dầu khí...)
 *  còn báo cáo tài chính (fund_reports_to_holdings.py) theo vnstock (Bất động sản,
 *  Vật liệu xây dựng, Khai khoáng...). Đưa cả hai về một từ vựng để sector drift
 *  và cột ngành nối được ngành chung giữa các quỹ khác nguồn. */
const INDUSTRY_NORMALIZE: Record<string, string> = {
  'BĐS': 'Bất động sản',
  'Vật liệu': 'Vật liệu xây dựng',
  'Dầu khí': 'Khai khoáng',
  'Công nghệ': 'Công nghệ và thông tin',
  'Thực phẩm': 'Thực phẩm - Đồ uống',
  'Điện': 'Tiện ích',
  'Viễn thông': 'Công nghệ và thông tin',
  'Logistics': 'Vận tải - kho bãi',
  'Vận tải': 'Vận tải - kho bãi',
  'Vận tải - Kho bãi': 'Vận tải - kho bãi',
  'Sản xuất Hàng gia dụng': 'SX Hàng gia dụng',
  'Sản xuất Nhựa - Hóa chất': 'SX Nhựa - Hóa chất',
  'Sản xuất Phụ trợ': 'SX Phụ trợ',
  'Sản xuất Thiết bị': 'SX Thiết bị - máy móc',
  'Dược phẩm': 'Chăm sóc sức khỏe',
  'Du lịch': 'Dịch vụ lưu trú - ăn uống - giải trí',
  'Đồ uống': 'Thực phẩm - Đồ uống',
  'Chế biến thủy sản': 'Chế biến Thủy sản',
  'Dịch vụ lưu trú': 'Dịch vụ lưu trú - ăn uống - giải trí',
}

/** Đưa tên ngành về từ vựng chung (vnstock). Tên chưa biết giữ nguyên. */
function normalizeIndustry(ind: string): string {
  return INDUSTRY_NORMALIZE[ind] ?? ind
}

/** Loại tài sản trong danh mục quỹ. */
export type AssetType = 'STOCK' | 'BOND' | 'CASH' | 'OTHER'

/** Một hàng trong holdings/<fundId>_holdings.csv */
export interface Holding {
  date: string // YYYY-MM-DD ngày báo cáo
  stockCode: string
  industry: string
  weightPct: number // % tỷ trọng trong NAV của quỹ
  /** Tổng giá trị cổ phiếu quỹ đang nắm (VND). Có thể 0 nếu nguồn không trả. */
  assetValue: number
  /** Loại tài sản: STOCK / BOND / CASH / OTHER. File cũ không có cột này → 'STOCK'. */
  type: AssetType
}

/** Một hàng trong holdings/<fundId>_industry.csv */
export interface IndustryHolding {
  date: string
  industry: string
  weightPct: number
}

/** Kết quả so sánh overlap giữa 2 quỹ */
export interface OverlapResult {
  /** Toàn bộ danh mục quỹ A (cổ phiếu + trái phiếu + tiền mặt + tài sản khác) */
  stocksA: Holding[]
  /** Toàn bộ danh mục quỹ B */
  stocksB: Holding[]
  /** Các cổ phiếu xuất hiện ở cả A và B (chỉ tính STOCK) */
  overlap: Array<{
    stockCode: string
    industryA: string
    industryB: string
    weightA: number
    weightB: number
    minWeight: number
  }>
  /** Số cổ phiếu mỗi quỹ nắm (chỉ đếm STOCK) */
  stockCountA: number
  stockCountB: number
  overlapCount: number
  /**
   * Tỷ trọng trùng = Σ min(wA, wB) trên cổ phiếu trùng.
   * Đo bằng điểm phần trăm của NAV (có thể hiểu như "đô la trùng trên 100đ".
   */
  weightedOverlapPct: number
  /** Σ wA của cổ phiếu trùng / Σ wA cổ phiếu — phần danh mục cổ phiếu A bị trùng */
  pctInA: number
  /** Σ wB của cổ phiếu trùng / Σ wB cổ phiếu — phần danh mục cổ phiếu B bị trùng */
  pctInB: number
  /** Σ wA của cổ phiếu trùng, tính bằng điểm % NAV (tuyệt đối, không chia danh mục) */
  overlapInA: number
  /** Σ wB của cổ phiếu trùng, tính bằng điểm % NAV (tuyệt đối, không chia danh mục) */
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
 * Danh sách các kỳ báo cáo (cột `date`) có trong file CSV, sắp giảm dần.
 * Dùng để dựng selector chọn kỳ trong UI.
 */
export function getAvailablePeriods(csvText: string): string[] {
  const lines = csvText.trim().split('\n')
  if (lines.length <= 1) return []
  const header = lines[0]!.split(',').map(h => h.trim())
  const idxDate = header.indexOf('date')
  if (idxDate < 0) return []
  const dates = new Set<string>()
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',').map(c => c.trim())
    const d = cells[idxDate]
    if (d) dates.add(d)
  }
  return [...dates].sort().reverse()
}

/**
 * Kỳ báo cáo sẽ dùng cho một quỹ khi người dùng chọn `targetPeriod`:
 * - targetPeriod null → kỳ mới nhất.
 * - Ngược lại → kỳ gần nhất KHÔNG MUỘN HƠN targetPeriod (quỹ chưa có báo cáo
 *   tháng đích thì fallback về kỳ sớm hơn gần nhất). Nếu target sớm hơn mọi
 *   kỳ → kỳ sớm nhất (dữ liệu cũ nhất có thể).
 */
export function resolvePeriod(periods: string[], targetPeriod: string | null): string {
  const sorted = [...periods].sort()
  if (sorted.length === 0) return ''
  if (!targetPeriod) return sorted[sorted.length - 1]!
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]! <= targetPeriod) return sorted[i]!
  }
  return sorted[0]!
}

/**
 * Parse nội dung `holdings/<fundId>_holdings.csv` (cột: date,stock_code,industry,weight_pct,asset_value,type_asset).
 * Lấy kỳ theo `targetPeriod` (xem resolvePeriod); targetPeriod null = kỳ mới nhất.
 * Cột type_asset: STOCK / BOND / CASH / OTHER. File cũ không có cột này → coi là 'STOCK'.
 */
export function parseHoldingsCSV(csvText: string, targetPeriod: string | null = null): Holding[] {
  const lines = csvText.trim().split('\n')
  if (lines.length <= 1) return []
  const header = lines[0]!.split(',').map(h => h.trim())
  const idxDate = header.indexOf('date')
  const idxCode = header.indexOf('stock_code')
  const idxInd = header.indexOf('industry')
  const idxW = header.indexOf('weight_pct')
  const idxVal = header.indexOf('asset_value')
  const idxType = header.indexOf('type_asset')
  if (idxDate < 0 || idxCode < 0 || idxInd < 0 || idxW < 0) return []

  const rows: Holding[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',').map(c => c.trim())
    const w = parseFloat(cells[idxW] ?? '')
    if (Number.isNaN(w)) continue
    const rawType = (idxType >= 0 ? cells[idxType] : '') || 'STOCK'
    rows.push({
      date: cells[idxDate]!,
      stockCode: cells[idxCode]!,
      industry: normalizeIndustry(cells[idxInd]!),
      weightPct: w,
      assetValue: idxVal >= 0 ? parseFloat(cells[idxVal] ?? '') || 0 : 0,
      type: (['STOCK', 'BOND', 'CASH', 'OTHER'] as const).includes(rawType as AssetType)
        ? (rawType as AssetType)
        : 'STOCK',
    })
  }
  if (rows.length === 0) return []

  const period = resolvePeriod(getAvailablePeriods(csvText), targetPeriod)
  return rows.filter(r => r.date === period)
}

/** Parse `holdings/<fundId>_industry.csv` (date,industry,weight_pct) theo targetPeriod. */
export function parseIndustryCSV(csvText: string, targetPeriod: string | null = null): IndustryHolding[] {
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
    rows.push({ date: cells[idxDate]!, industry: normalizeIndustry(cells[idxInd]!), weightPct: w })
  }
  if (rows.length === 0) return []
  const period = resolvePeriod(getAvailablePeriods(csvText), targetPeriod)
  return rows.filter(r => r.date === period)
}

/**
 * Tính overlap giữa holdings của quỹ A và B.
 *
 * Chỉ tính trên CỔ PHIẾU (type === 'STOCK'). Trái phiếu, tiền mặt, tài sản khác
 * được giữ trong `stocksA`/`stocksB` (để UI hiển thị danh mục đầy đủ) nhưng không
 * tham gia overlap. Bỏ qua nếu một bên không có cổ phiếu nào → trả null.
 */
export function computeOverlap(allStocksA: Holding[], allStocksB: Holding[]): OverlapResult | null {
  const stocksA = allStocksA.filter(h => h.type === 'STOCK')
  const stocksB = allStocksB.filter(h => h.type === 'STOCK')
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
    stocksA: allStocksA,
    stocksB: allStocksB,
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
